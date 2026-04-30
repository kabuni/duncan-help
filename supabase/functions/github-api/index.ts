import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GITHUB_API = "https://api.github.com";

type Status = "connected" | "not_configured" | "degraded";
type RequestStage = "verify" | "summary" | "repo_scan";
type CredentialSource = "stored_token" | "none";

class ProviderRequestError extends Error {
  status: number;
  body: unknown;
  stage: RequestStage;
  path: string;

  constructor(message: string, details: { status: number; body: unknown; stage: RequestStage; path: string }) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = details.status;
    this.body = details.body;
    this.stage = details.stage;
    this.path = details.path;
  }
}

type GithubSummary = {
  ok: boolean;
  connected: boolean;
  status: Status;
  credential_source: CredentialSource;
  verification_path: string | null;
  last_verified_at: string | null;
  last_sync_at: string | null;
  degraded_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  metrics_summary: string | null;
  repos_scanned: number;
  open_prs: number;
  blocked_prs: number;
  stale_prs: number;
  release_risks: number;
  signals: Array<Record<string, unknown>>;
  summary: string | null;
};

function baseResponse(overrides: Partial<GithubSummary> = {}): GithubSummary {
  return {
    ok: true,
    connected: false,
    status: "not_configured",
    credential_source: "none",
    verification_path: null,
    last_verified_at: null,
    last_sync_at: null,
    degraded_reason: null,
    error_code: null,
    error_message: null,
    metrics_summary: null,
    repos_scanned: 0,
    open_prs: 0,
    blocked_prs: 0,
    stale_prs: 0,
    release_risks: 0,
    signals: [],
    summary: null,
    ...overrides,
  };
}

function logGithub(event: string, details: Record<string, unknown>) {
  console.log(`[github-api] ${event}`, details);
}

function safeSnippet(value: unknown) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return raw.slice(0, 240);
}

function tokenFingerprint(token?: string | null) {
  if (!token) return null;
  return { token_length: token.length, token_prefix: token.slice(0, 4) };
}

function buildResponse(overrides: Partial<GithubSummary> = {}) {
  const merged = baseResponse(overrides);
  const errorMessage = merged.error_message ?? merged.degraded_reason ?? null;
  const metricsSummary = merged.metrics_summary ?? merged.summary ?? null;
  return {
    ...merged,
    last_sync_at: merged.last_sync_at ?? merged.last_verified_at,
    degraded_reason: errorMessage,
    error_message: errorMessage,
    metrics_summary: metricsSummary,
  } satisfies GithubSummary;
}

function responseWithLogging(overrides: Partial<GithubSummary> = {}) {
  const response = buildResponse(overrides);
  logGithub("returning status", {
    status: response.status,
    connected: response.connected,
    error_code: response.error_code,
    error_message: response.error_message,
  });
  return json(response);
}

async function getUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

function isServiceRoleRequest(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!token && !!serviceRoleKey && token === serviceRoleKey;
}

async function getStoredToken() {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: meta } = await supabase
    .from("company_integrations")
    .select("encrypted_api_key, status, last_sync")
    .eq("integration_id", "github")
    .maybeSingle();

  if (!meta?.encrypted_api_key) return null;

  const { data: token, error } = await supabase.rpc(
    "get_company_integration_secret",
    { p_integration_id: "github" },
  );

  if (error || !token) {
    return {
      token: null,
      lastSync: meta.last_sync ?? null,
      storedStatus: meta.status ?? null,
    };
  }

  return {
    token: token as string,
    lastSync: meta.last_sync ?? null,
    storedStatus: meta.status ?? null,
  };
}

async function githubRequest<T>(path: string, token: string) {
  logGithub("verification endpoint", { path, ...tokenFingerprint(token) });
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "duncan-team-briefing",
    },
  });
  const data = await res.json().catch(() => ({}));
  logGithub("provider response", { path, status: res.status, snippet: safeSnippet(data) });
  if (!res.ok) {
    throw new ProviderRequestError("GitHub API failed", {
      status: res.status,
      body: data,
      stage: path === "/user" ? "verify" : path.includes("/pulls") ? "repo_scan" : "summary",
      path,
    });
  }
  return data as T;
}

function classifyError(error: unknown) {
  if (error instanceof ProviderRequestError) {
    const snippet = safeSnippet(error.body).toLowerCase();
    if (error.status === 429 || /rate limit|too many requests/.test(snippet)) {
      return { error_code: "github_rate_limited", status: "degraded" as Status, error_message: "GitHub is rate limited" };
    }
    if (error.status >= 500) {
      return { error_code: "github_provider_unavailable", status: "degraded" as Status, error_message: "GitHub is temporarily unavailable" };
    }
    if (error.status === 401 || error.status === 403 || /unauthorized|forbidden|bad credentials|authentication/.test(snippet)) {
      if (/scope|permission|resource not accessible by integration|insufficient/.test(snippet)) {
        return { error_code: "github_insufficient_scope", status: "degraded" as Status, error_message: "GitHub token is missing required permissions" };
      }
      if (/expired|revoked/.test(snippet)) {
        return { error_code: "github_token_expired", status: "degraded" as Status, error_message: "GitHub token is expired or revoked" };
      }
      if (/installation|unsupported token|token type/.test(snippet)) {
        return { error_code: "github_verification_mismatch", status: "degraded" as Status, error_message: "GitHub token type does not match the verification flow" };
      }
      return { error_code: "github_invalid_token", status: "degraded" as Status, error_message: "GitHub token is invalid" };
    }
    return { error_code: error.stage === "repo_scan" ? "repo_scan_partial_failure" : "summary_failed", status: "degraded" as Status, error_message: "GitHub request failed" };
  }
  return { error_code: "summary_failed", status: "degraded" as Status, error_message: "GitHub summary failed" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const isInternal = isServiceRoleRequest(req);
  if (!isInternal) {
    const user = await getUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
  }

  const { action } = await req.json().catch(() => ({ action: "status" }));
  const stored = await getStoredToken();

  if (!stored) {
    logGithub("missing token branch", { branch: "stored_token_missing" });
    return responseWithLogging({
      status: "not_configured",
      credential_source: "none",
      verification_path: null,
      error_code: "github_not_configured",
      error_message: "No stored GitHub company token found",
    });
  }

  if (!stored.token) {
    logGithub("decode failure branch", { branch: "stored_token_decode_failed", stored_status: stored.storedStatus });
    return responseWithLogging({
      status: "degraded",
      credential_source: "stored_token",
      verification_path: "/user",
      last_verified_at: stored.lastSync ?? new Date().toISOString(),
      last_sync_at: stored.lastSync ?? new Date().toISOString(),
      error_code: "stored_token_decode_failed",
      error_message: "Stored GitHub token could not be decoded",
    });
  }

  try {
    const verifiedAt = new Date().toISOString();
    logGithub("credential source", { source: "stored_token" });
    await githubRequest("/user", stored.token);

    if (action === "status") {
      return responseWithLogging({
        connected: true,
        status: "connected",
        credential_source: "stored_token",
        verification_path: "/user",
        last_verified_at: verifiedAt,
        last_sync_at: stored.lastSync ?? verifiedAt,
      });
    }

    const repos = await githubRequest<Array<{ owner?: { login?: string }; name?: string; pushed_at?: string | null }>>(
      "/user/repos?sort=updated&per_page=10",
      stored.token,
    );

    let openPrs = 0;
    let blockedPrs = 0;
    let stalePrs = 0;
    const signals: Array<Record<string, unknown>> = [];
    let partialFailure = false;

    for (const repo of repos.slice(0, 5)) {
      const owner = repo.owner?.login;
      const name = repo.name;
      if (!owner || !name) continue;

      try {
        const pulls = await githubRequest<Array<{ title?: string; draft?: boolean; updated_at?: string | null }>>(
          `/repos/${owner}/${name}/pulls?state=open&per_page=20`,
          stored.token,
        );
        openPrs += pulls.length;

        for (const pr of pulls) {
          const updatedAt = Date.parse(pr.updated_at || "");
          const isStale = Number.isFinite(updatedAt) && updatedAt < Date.now() - 7 * 24 * 60 * 60 * 1000;
          if (pr.draft) blockedPrs += 1;
          if (isStale) stalePrs += 1;
          if ((pr.draft || isStale) && signals.length < 6) {
            signals.push({
              type: pr.draft ? "blocked_pr" : "stale_pr",
              repo: `${owner}/${name}`,
              label: pr.title || "Untitled PR",
            });
          }
        }
      } catch (error: any) {
        partialFailure = true;
        logGithub("repo scan failure", {
          repo: `${owner}/${name}`,
          message: error instanceof ProviderRequestError ? safeSnippet(error.body) : (error instanceof Error ? error.message : String(error)),
          error_code: classifyError(error).error_code,
          provider_status: error instanceof ProviderRequestError ? error.status : null,
        });
        if (signals.length < 6) {
          signals.push({
            type: "repo_scan_failed",
            repo: `${owner}/${name}`,
            label: error instanceof Error ? error.message : "GitHub repo scan failed",
          });
        }
      }
    }

    const releaseRisks = blockedPrs + stalePrs;
    const reposScanned = Math.min(repos.length, 5);
    const summary = reposScanned === 0
      ? "GitHub connected but no repositories were available to scan."
      : `${openPrs} open PRs, ${blockedPrs} blocked drafts, and ${stalePrs} stale PRs across ${reposScanned} repositories.`;

    return responseWithLogging({
      connected: true,
      status: partialFailure ? "degraded" : "connected",
      credential_source: "stored_token",
      verification_path: "/user",
      last_verified_at: verifiedAt,
      last_sync_at: stored.lastSync ?? verifiedAt,
      error_code: partialFailure ? "repo_scan_partial_failure" : null,
      error_message: partialFailure ? "Some repositories could not be scanned fully" : null,
      repos_scanned: reposScanned,
      open_prs: openPrs,
      blocked_prs: blockedPrs,
      stale_prs: stalePrs,
      release_risks: releaseRisks,
      signals,
      summary,
      metrics_summary: summary,
    });
  } catch (error: any) {
    const classification = classifyError(error);
    logGithub("verification failure", {
      error_code: classification.error_code,
      error_message: classification.error_message,
      message: error instanceof ProviderRequestError ? safeSnippet(error.body) : (error instanceof Error ? error.message : String(error)),
      provider_status: error instanceof ProviderRequestError ? error.status : null,
      stage: error instanceof ProviderRequestError ? error.stage : null,
      path: error instanceof ProviderRequestError ? error.path : null,
    });
    return responseWithLogging({
      status: classification.status,
      connected: false,
      credential_source: "stored_token",
      verification_path: error instanceof ProviderRequestError ? error.path : "/user",
      last_verified_at: stored.lastSync ?? new Date().toISOString(),
      last_sync_at: stored.lastSync ?? new Date().toISOString(),
      error_code: classification.error_code,
      error_message: classification.error_message,
    });
  }
});
