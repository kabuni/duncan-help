import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY_URL = "https://connector-gateway.lovable.dev/hubspot";
const VERIFY_URL = "https://connector-gateway.lovable.dev/api/v1/verify_credentials";
const HUBSPOT_API = "https://api.hubapi.com";

type Status = "connected" | "not_configured" | "degraded";
type CredentialSource = "connector_gateway" | "stored_token" | "env_secret" | "none";
type RequestStage = "verify" | "summary" | "repo_scan";
type StoredTokenState = "integration_not_configured" | "no_token_stored" | "token_decode_failed" | "token_found" | "query_error";

type HubspotSummary = {
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
  accounts_scanned: number;
  stale_deals: number;
  at_risk_accounts: number;
  customer_escalations: number;
  signals: Array<Record<string, unknown>>;
  summary: string | null;
  active_deals_count?: number;
  active_deals?: Array<Record<string, unknown>>;
  at_risk_accounts_count?: number;
  at_risk_accounts_details?: Array<Record<string, unknown>>;
  key_contacts?: Array<Record<string, unknown>>;
  lists?: Array<Record<string, unknown>>;
  credential_diagnostics?: Record<string, unknown>;
  form_metrics?: {
    newsletter: { form_name: string | null; total: number; last_30d: number; found: boolean };
    scout: { form_name: string | null; total: number; last_30d: number; found: boolean };
    location_breakdown: Array<{ location: string; newsletter_count: number; scout_count: number }>;
  } | null;
};

// Marketing forms (HubSpot Forms API) — fetched dynamically, no hardcoded names.

type HubspotDeal = {
  id: string;
  properties?: Record<string, any>;
  associations?: {
    companies?: { results?: Array<{ id: string }> };
    contacts?: { results?: Array<{ id: string }> };
  };
};

type HubspotCompany = {
  id: string;
  properties?: Record<string, any>;
};

type HubspotContact = {
  id: string;
  properties?: Record<string, any>;
};

class ProviderRequestError extends Error {
  status: number;
  body: unknown;
  source: CredentialSource;
  stage: RequestStage;
  path: string;

  constructor(message: string, details: { status: number; body: unknown; source: CredentialSource; stage: RequestStage; path: string }) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = details.status;
    this.body = details.body;
    this.source = details.source;
    this.stage = details.stage;
    this.path = details.path;
  }
}

function baseResponse(overrides: Partial<HubspotSummary> = {}): HubspotSummary {
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
    accounts_scanned: 0,
    stale_deals: 0,
    at_risk_accounts: 0,
    customer_escalations: 0,
    signals: [],
    summary: null,
    ...overrides,
  };
}

function safeSnippet(value: unknown) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return raw.slice(0, 240);
}

function providerName(source: CredentialSource) {
  return source === "connector_gateway"
    ? "HubSpot connector"
    : source === "stored_token"
    ? "HubSpot token"
    : source === "env_secret"
    ? "HubSpot env secret"
    : "HubSpot credential";
}

function tokenFingerprint(token?: string | null) {
  if (!token) return null;
  return { token_length: token.length, token_prefix: token.slice(0, 4) };
}

function logHubspot(event: string, details: Record<string, unknown>) {
  console.log(`[hubspot-api] ${event}`, details);
}

function buildResponse(overrides: Partial<HubspotSummary> = {}) {
  const merged = baseResponse(overrides);
  const errorMessage = merged.error_message ?? merged.degraded_reason ?? null;
  const metricsSummary = merged.metrics_summary ?? merged.summary ?? null;
  return {
    ...merged,
    last_sync_at: merged.last_sync_at ?? merged.last_verified_at,
    degraded_reason: errorMessage,
    error_message: errorMessage,
    metrics_summary: metricsSummary,
  } satisfies HubspotSummary;
}

function responseWithLogging(overrides: Partial<HubspotSummary> = {}) {
  const response = buildResponse(overrides);
  logHubspot("returning status", {
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

async function getStoredToken() {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase
    .from("company_integrations")
    .select("integration_id, encrypted_api_key, status, last_sync, updated_at")
    .eq("integration_id", "hubspot")
    .maybeSingle();

  if (error) {
    logHubspot("company_integrations direct lookup", {
      integration_id: "hubspot",
      state: "query_error",
      row_found: false,
      query_error_code: error.code ?? null,
      query_error_message: error.message ?? null,
    });
    return {
      state: "query_error" as StoredTokenState,
      rowFound: false,
      integrationId: null,
      encodedToken: null,
      token: null,
      decodeOk: false,
      lastSync: null,
      storedStatus: null,
      updatedAt: null,
      queryError: { code: error.code ?? null, message: error.message ?? null },
    };
  }

  const encodedToken = typeof data?.encrypted_api_key === "string" ? data.encrypted_api_key : null;
  const encodedState = encodedToken === null ? "null" : encodedToken.trim().length === 0 ? "empty" : "present";

  if (!data) {
    logHubspot("company_integrations direct lookup", {
      integration_id: "hubspot",
      state: "integration_not_configured",
      row_found: false,
      encrypted_api_key_state: "null",
    });
    return {
      state: "integration_not_configured" as StoredTokenState,
      rowFound: false,
      integrationId: null,
      encodedToken: null,
      token: null,
      decodeOk: false,
      lastSync: null,
      storedStatus: null,
      updatedAt: null,
      queryError: null,
    };
  }

  if (encodedState !== "present") {
    logHubspot("company_integrations direct lookup", {
      integration_id: "hubspot",
      returned_integration_id: data.integration_id ?? null,
      state: "no_token_stored",
      row_found: true,
      status: data.status ?? null,
      last_sync: data.last_sync ?? null,
      updated_at: data.updated_at ?? null,
      encrypted_api_key_state: encodedState,
    });
    return {
      state: "no_token_stored" as StoredTokenState,
      rowFound: true,
      integrationId: data.integration_id ?? null,
      encodedToken,
      token: null,
      decodeOk: false,
      lastSync: data.last_sync ?? null,
      storedStatus: data.status ?? null,
      updatedAt: data.updated_at ?? null,
      queryError: null,
    };
  }

  const { data: vaultToken, error: vaultErr } = await supabase.rpc(
    "get_company_integration_secret",
    { p_integration_id: "hubspot" },
  );

  if (vaultErr || !vaultToken) {
    logHubspot("company_integrations direct lookup", {
      integration_id: "hubspot",
      returned_integration_id: data.integration_id ?? null,
      state: "token_decode_failed",
      row_found: true,
      status: data.status ?? null,
      last_sync: data.last_sync ?? null,
      updated_at: data.updated_at ?? null,
      encrypted_api_key_state: encodedState,
      encoded_length: encodedToken.length,
      encoded_prefix: encodedToken.slice(0, 10),
      decode_ok: false,
      vault_lookup_ok: false,
      vault_error: vaultErr?.message ?? null,
    });
    return {
      state: "token_decode_failed" as StoredTokenState,
      rowFound: !!data,
      integrationId: data?.integration_id ?? null,
      encodedToken,
      token: null,
      decodeOk: false,
      lastSync: data?.last_sync ?? null,
      storedStatus: data?.status ?? null,
      updatedAt: data?.updated_at ?? null,
      queryError: null,
    };
  }

  const decoded = (vaultToken as string).trim();
  const state: StoredTokenState = decoded ? "token_found" : "no_token_stored";
  logHubspot("company_integrations direct lookup", {
    integration_id: "hubspot",
    returned_integration_id: data.integration_id ?? null,
    state,
    row_found: true,
    status: data.status ?? null,
    last_sync: data.last_sync ?? null,
    updated_at: data.updated_at ?? null,
    encrypted_api_key_state: encodedState,
    encoded_length: encodedToken.length,
    encoded_prefix: encodedToken.slice(0, 10),
    decode_ok: true,
    vault_lookup_ok: true,
    decoded_length: decoded.length,
  });
  return {
    state,
    rowFound: !!data,
    integrationId: data?.integration_id ?? null,
    encodedToken,
    token: decoded || null,
    decodeOk: true,
    lastSync: data?.last_sync ?? null,
    storedStatus: data?.status ?? null,
    updatedAt: data?.updated_at ?? null,
    queryError: null,
  };
}

function classifyProviderFailure(error: unknown) {
  const fallback = {
    status: "degraded" as Status,
    error_code: "hubspot_summary_failed",
    error_message: "HubSpot summary failed",
  };

  if (!(error instanceof ProviderRequestError)) {
    return fallback;
  }

  const snippet = safeSnippet(error.body).toLowerCase();
  const label = providerName(error.source);

  if (error.status === 429 || /rate limit|too many requests/.test(snippet)) {
    return {
      status: "degraded" as Status,
      error_code: error.source === "connector_gateway" ? "connector_rate_limited" : "hubspot_rate_limited",
      error_message: `${label} is rate limited`,
    };
  }

  if (error.status >= 500) {
    return {
      status: "degraded" as Status,
      error_code: error.source === "connector_gateway" ? "connector_provider_unavailable" : "hubspot_provider_unavailable",
      error_message: `${label} is temporarily unavailable`,
    };
  }

  if (error.status === 401 || error.status === 403 || /unauthorized|forbidden|authentication|token/.test(snippet)) {
    if (/scope|permission|insufficient/.test(snippet)) {
      return {
        status: "degraded" as Status,
        error_code: error.source === "connector_gateway" ? "connector_insufficient_scope" : "hubspot_insufficient_scope",
        error_message: `${label} is missing required permissions`,
      };
    }

    if (/expired|revoked/.test(snippet)) {
      return {
        status: "degraded" as Status,
        error_code: error.source === "connector_gateway" ? "connector_token_expired" : "hubspot_token_expired",
        error_message: `${label} is expired or revoked`,
      };
    }

    if (/private app|unsupported token|token type|integration installation/.test(snippet)) {
      return {
        status: "degraded" as Status,
        error_code: error.source === "connector_gateway" ? "connector_verification_mismatch" : "hubspot_verification_mismatch",
        error_message: `${label} does not match the expected verification flow`,
      };
    }

    return {
      status: "degraded" as Status,
      error_code: error.source === "connector_gateway" ? "connector_invalid_token" : "hubspot_invalid_token",
      error_message: `${label} is invalid`,
    };
  }

  return fallback;
}

async function verifyGatewayCredentials(lovableKey: string, hubspotKey: string) {
  logHubspot("verification endpoint", { source: "connector_gateway", path: "/api/v1/verify_credentials" });
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": hubspotKey,
    },
  });
  const data = await res.json().catch(() => ({}));
  logHubspot("provider response", {
    source: "connector_gateway",
    stage: "verify",
    status: res.status,
    outcome: data?.outcome ?? null,
    snippet: safeSnippet(data),
  });
  if (!res.ok || data?.outcome === "failed") {
    throw new ProviderRequestError("HubSpot connector verification failed", {
      status: res.status,
      body: data,
      source: "connector_gateway",
      stage: "verify",
      path: "/api/v1/verify_credentials",
    });
  }
}

async function hubspotGateway(path: string, lovableKey: string, hubspotKey: string, stage: RequestStage = "summary") {
  logHubspot("verification endpoint", { source: "connector_gateway", path, stage });
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": hubspotKey,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => ({}));
  logHubspot("provider response", { source: "connector_gateway", stage, path, status: res.status, snippet: safeSnippet(data) });
  if (!res.ok) {
    throw new ProviderRequestError("HubSpot gateway failed", {
      status: res.status,
      body: data,
      source: "connector_gateway",
      stage,
      path,
    });
  }
  return data;
}

async function hubspotApi(path: string, token: string, stage: RequestStage = "summary", source: CredentialSource = "stored_token") {
  logHubspot("verification endpoint", { source, path, stage, auth_header_format: "Bearer <token>", ...tokenFingerprint(token) });
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => ({}));
  logHubspot("provider response", { source, stage, path, status: res.status, snippet: safeSnippet(data) });
  if (!res.ok) {
    throw new ProviderRequestError("HubSpot API failed", {
      status: res.status,
      body: data,
      source,
      stage,
      path,
    });
  }
  return data;
}

async function hubspotApiPost(path: string, body: unknown, token: string, stage: RequestStage = "summary", source: CredentialSource = "stored_token") {
  logHubspot("verification endpoint", { source, path, stage, method: "POST", auth_header_format: "Bearer <token>", ...tokenFingerprint(token) });
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  logHubspot("provider response", { source, stage, path, status: res.status, snippet: safeSnippet(data) });
  if (!res.ok) {
    throw new ProviderRequestError("HubSpot API failed", {
      status: res.status,
      body: data,
      source,
      stage,
      path,
    });
  }
  return data;
}

async function fetchHubspotForms(token: string, source: CredentialSource) {
  const results: Array<{
    requested_name: string;
    list_id: string | null;
    matched_name: string | null;
    member_count: number | null;
    processing_type: string | null;
    updated_at: string | null;
    error?: string | null;
  }> = [];

  let formsPayload: any;
  try {
    formsPayload = await hubspotApi("/marketing/v3/forms?limit=100&formTypes=all", token, "summary", source);
  } catch (err) {
    const detail = err instanceof ProviderRequestError ? {
      status: err.status,
      body: typeof err.body === "string" ? err.body.slice(0, 1500) : JSON.stringify(err.body ?? {}).slice(0, 1500),
    } : {};
    logHubspot("form fetch failed", {
      error: err instanceof Error ? err.message : String(err),
      ...detail,
    });
    return results;
  }

  const forms: any[] = Array.isArray(formsPayload?.results) ? formsPayload.results : [];
  logHubspot("form_fetch_ok", { count: forms.length });

  // Fetch submission counts in parallel with limited concurrency.
  const concurrency = 10;
  const withCounts: Array<{ form: any; submission_count: number | null; error: string | null }> = [];
  for (let i = 0; i < forms.length; i += concurrency) {
    const batch = forms.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(async (form) => {
      const formId = form?.id ?? form?.guid ?? null;
      if (!formId) {
        logHubspot("form_count_skip_no_id", { name: form?.name ?? null });
        return { form, submission_count: null, error: "missing form id" };
      }
      try {
        // Try v3 submissions endpoint first (more reliable; honors current scopes)
        // Falls back to legacy v1 endpoint on 404/410.
        let after: string | null = null;
        let count = 0;
        let totalFromApi: number | null = null;
        let pages = 0;
        let usedFallback = false;
        const MAX_PAGES = 40; // safety cap (40 * 50 = 2000 submissions)
        let firstPageKeys: string[] = [];
        while (pages < MAX_PAGES) {
          pages++;
          // Prefer v3 endpoint; if it 404s on first page, switch to v1.
          const v3Path = `/marketing/v3/forms/${formId}/submissions?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
          const v1Path = `/form-integrations/v1/submissions/forms/${formId}?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
          const path = usedFallback ? v1Path : v3Path;
          let resp: any;
          try {
            resp = await hubspotApi(path, token, "summary", source);
          } catch (innerErr) {
            const status = innerErr instanceof ProviderRequestError ? innerErr.status : 0;
            if (!usedFallback && pages === 1 && (status === 404 || status === 410 || status === 400)) {
              usedFallback = true;
              pages = 0;
              after = null;
              continue;
            }
            throw innerErr;
          }
          if (pages === 1) firstPageKeys = resp && typeof resp === "object" ? Object.keys(resp) : [];
          if (totalFromApi === null) {
            const t = typeof resp?.total === "number"
              ? resp.total
              : typeof resp?.totalCount === "number"
              ? resp.totalCount
              : null;
            if (t !== null) totalFromApi = t;
          }
          const results: any[] = Array.isArray(resp?.results) ? resp.results : [];
          count += results.length;
          const next = resp?.paging?.next?.after ?? null;
          if (!next) break;
          after = next;
        }
        const submission_count = totalFromApi !== null ? totalFromApi : count;
        logHubspot("form_count_ok", {
          formId,
          name: form?.name ?? null,
          pages,
          totalFromApi,
          count,
          submission_count,
          endpoint: usedFallback ? "v1" : "v3",
          firstPageKeys,
        });
        return { form, submission_count, error: null };
      } catch (err) {
        const status = err instanceof ProviderRequestError ? err.status : null;
        const body = err instanceof ProviderRequestError
          ? (typeof err.body === "string" ? err.body.slice(0, 500) : JSON.stringify(err.body ?? {}).slice(0, 500))
          : null;
        logHubspot("form_count_failed", {
          formId,
          name: form?.name ?? null,
          status,
          body,
          message: err instanceof Error ? err.message : String(err),
        });
        return {
          form,
          submission_count: null,
          error: status ? `HTTP ${status}: ${err instanceof Error ? err.message : String(err)}` : (err instanceof Error ? err.message : String(err)),
        };
      }
    }));
    withCounts.push(...settled);
  }


  for (const { form, submission_count, error } of withCounts) {
    const name = form?.name ?? "Unnamed form";
    results.push({
      requested_name: name,
      list_id: form?.id ?? form?.guid ?? null,
      matched_name: name,
      member_count: submission_count,
      processing_type: form?.formType ?? null,
      updated_at: form?.updatedAt ?? null,
      ...(error ? { error } : {}),
    });
  }

  return results;
}

type FormMetric = {
  form_id: string | null;
  form_name: string | null;
  total: number;
  last_30d: number;
  contact_ids_30d: string[];
  contact_emails_30d: string[];
  found: boolean;
};

function pickForm(forms: any[], includes: string[]): any | null {
  for (const inc of includes) {
    const m = forms.find((f) => typeof f?.name === "string" && f.name.toLowerCase().includes(inc));
    if (m) return m;
  }
  return null;
}

async function fetchFormMetrics(token: string, source: CredentialSource, form: any | null): Promise<FormMetric> {
  if (!form?.id && !form?.guid) {
    return { form_id: null, form_name: null, total: 0, last_30d: 0, contact_ids_30d: [], contact_emails_30d: [], found: false };
  }
  const formId = form.id ?? form.guid;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let after: string | null = null;
  let total = 0;
  let last30 = 0;
  const ids = new Set<string>();
  const emails = new Set<string>();
  let pages = 0;
  let totalCaptured = false;

  while (pages < 20) {
    pages++;
    const path = `/form-integrations/v1/submissions/forms/${formId}?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    let resp: any;
    try {
      resp = await hubspotApi(path, token, "summary", source);
    } catch (err) {
      logHubspot("form_metrics fetch failed", { formId, page: pages, error: err instanceof Error ? err.message : String(err) });
      break;
    }
    if (!totalCaptured) {
      const t = typeof resp?.total === "number" ? resp.total : typeof resp?.totalCount === "number" ? resp.totalCount : null;
      if (t !== null) { total = t; totalCaptured = true; }
    }
    const results: any[] = Array.isArray(resp?.results) ? resp.results : [];
    let oldestInPage = Infinity;
    for (const sub of results) {
      const ts = typeof sub?.submittedAt === "number" ? sub.submittedAt : Date.parse(sub?.submittedAt || "");
      if (Number.isFinite(ts)) oldestInPage = Math.min(oldestInPage, ts);
      if (Number.isFinite(ts) && ts >= cutoff) {
        last30++;
        const vid = sub?.contact?.vid ?? sub?.contactId ?? null;
        if (vid) ids.add(String(vid));
        const values: any[] = Array.isArray(sub?.values) ? sub.values : [];
        const emailField = values.find((v) => typeof v?.name === "string" && v.name.toLowerCase() === "email");
        if (emailField?.value) emails.add(String(emailField.value).toLowerCase());
      }
    }
    const next = resp?.paging?.next?.after ?? null;
    if (!next) break;
    if (oldestInPage < cutoff) break; // past 30d window
    after = next;
  }

  if (!totalCaptured) total = last30; // fallback
  return {
    form_id: formId,
    form_name: form?.name ?? null,
    total,
    last_30d: last30,
    contact_ids_30d: [...ids],
    contact_emails_30d: [...emails],
    found: true,
  };
}

async function fetchContactsLocations(token: string, source: CredentialSource, ids: string[], emails: string[]): Promise<Map<string, { city: string | null; country: string | null; email: string | null }>> {
  const map = new Map<string, { city: string | null; country: string | null; email: string | null }>();
  const props = ["city", "country", "email"];

  async function batchRead(idValues: string[], idProperty?: string) {
    for (let i = 0; i < idValues.length; i += 100) {
      const inputs = idValues.slice(i, i + 100).map((v) => ({ id: v }));
      try {
        const body: any = { properties: props, inputs };
        if (idProperty) body.idProperty = idProperty;
        const resp = await hubspotApiPost("/crm/v3/objects/contacts/batch/read", body, token, "summary", source);
        const results: any[] = Array.isArray(resp?.results) ? resp.results : [];
        for (const c of results) {
          const id = String(c?.id ?? "");
          const email = c?.properties?.email ? String(c.properties.email).toLowerCase() : null;
          const entry = {
            city: c?.properties?.city || null,
            country: c?.properties?.country || null,
            email,
          };
          if (id) map.set(id, entry);
          if (email) map.set(`email:${email}`, entry);
        }
      } catch (err) {
        logHubspot("contacts batch_read failed", { count: inputs.length, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  if (ids.length > 0) await batchRead(ids);
  if (emails.length > 0) await batchRead(emails, "email");
  return map;
}

function aggregateLocationBreakdown(
  newsletter: FormMetric,
  scout: FormMetric,
  locMap: Map<string, { city: string | null; country: string | null; email: string | null }>,
): Array<{ location: string; newsletter_count: number; scout_count: number }> {
  const counts = new Map<string, { newsletter_count: number; scout_count: number }>();

  function locFor(id: string | null, email: string | null): string {
    let entry = id ? locMap.get(id) : undefined;
    if (!entry && email) entry = locMap.get(`email:${email.toLowerCase()}`);
    if (!entry) return "Unknown";
    const label = [entry.city, entry.country].filter(Boolean).join(", ");
    return label || "Unknown";
  }

  function tally(metric: FormMetric, key: "newsletter_count" | "scout_count") {
    const n = Math.max(metric.contact_ids_30d.length, metric.contact_emails_30d.length);
    for (let i = 0; i < n; i++) {
      const id = metric.contact_ids_30d[i] ?? null;
      const email = metric.contact_emails_30d[i] ?? null;
      const loc = locFor(id, email);
      const cur = counts.get(loc) ?? { newsletter_count: 0, scout_count: 0 };
      cur[key]++;
      counts.set(loc, cur);
    }
  }

  tally(newsletter, "newsletter_count");
  tally(scout, "scout_count");

  return [...counts.entries()]
    .map(([location, v]) => ({ location, ...v }))
    .sort((a, b) => (b.newsletter_count + b.scout_count) - (a.newsletter_count + a.scout_count))
    .slice(0, 10);
}

async function buildHubspotFormMetrics(token: string, source: CredentialSource) {
  try {
    const formsPayload = await hubspotApi("/marketing/v3/forms?limit=100&formTypes=all", token, "summary", source);
    const forms: any[] = Array.isArray(formsPayload?.results) ? formsPayload.results : [];
    const newsletterForm = pickForm(forms, ["newsletter", "subscribe", "signup", "sign up"]);
    const scoutForm = pickForm(forms, ["scout"]);
    const [newsletter, scout] = await Promise.all([
      fetchFormMetrics(token, source, newsletterForm),
      fetchFormMetrics(token, source, scoutForm),
    ]);
    const allIds = [...new Set([...newsletter.contact_ids_30d, ...scout.contact_ids_30d])];
    const allEmails = [...new Set([...newsletter.contact_emails_30d, ...scout.contact_emails_30d])];
    const locMap = await fetchContactsLocations(token, source, allIds, allEmails);
    const location_breakdown = aggregateLocationBreakdown(newsletter, scout, locMap);
    return {
      newsletter: { form_name: newsletter.form_name, total: newsletter.total, last_30d: newsletter.last_30d, found: newsletter.found },
      scout: { form_name: scout.form_name, total: scout.total, last_30d: scout.last_30d, found: scout.found },
      location_breakdown,
    };
  } catch (err) {
    logHubspot("form_metrics aggregation failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function normalizeBearerToken(token: string | null | undefined) {
  const trimmed = token?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveTeamBriefingToken(envToken?: string | null) {
  const stored = await getStoredToken();
  const encodedToken = stored?.encodedToken ?? null;
  const envFallbackToken = normalizeBearerToken(envToken);
  logHubspot("team_briefing_summary token lookup", {
    lookup_state: stored?.state ?? null,
    row_found: stored?.rowFound ?? false,
    integration_id: stored?.integrationId ?? null,
    last_sync: stored?.lastSync ?? null,
    updated_at: stored?.updatedAt ?? null,
    encrypted_api_key_state: encodedToken === null ? "null" : encodedToken.length === 0 ? "empty" : "present",
    encoded_length: encodedToken?.length ?? 0,
    encoded_prefix: encodedToken ? encodedToken.slice(0, 10) : null,
    decode_ok: stored?.decodeOk ?? false,
    decoded_prefix: stored?.token ? stored.token.trim().slice(0, 10) : null,
    decoded_length: stored?.token ? stored.token.trim().length : 0,
    stored_status: stored?.storedStatus ?? null,
    env_fallback_available: !!envFallbackToken,
  });

  const storedToken = normalizeBearerToken(stored?.token);
  if (stored?.encodedToken && !stored?.decodeOk) {
    logHubspot("team_briefing_summary token source", { selected_source: "decode_failed_no_fallback_yet" });
  }

  if (storedToken) {
    logHubspot("team_briefing_summary token source", {
      selected_source: "stored_token",
      header_mode: "Bearer",
      token_prefix: storedToken.slice(0, 10),
      token_length: storedToken.length,
    });
    return {
      token: storedToken,
      source: "stored_token" as CredentialSource,
      lastSync: stored?.lastSync ?? null,
      stored,
      diagnostics: {
        stored_token_state: stored?.state ?? null,
        env_fallback_available: !!envFallbackToken,
      },
    };
  }

  const fallbackToken = envFallbackToken;
  if (fallbackToken) {
    logHubspot("team_briefing_summary token source", {
      selected_source: "env_secret",
      header_mode: "Bearer",
      token_prefix: fallbackToken.slice(0, 10),
      token_length: fallbackToken.length,
    });
    return {
      token: fallbackToken,
      source: "env_secret" as CredentialSource,
      lastSync: stored?.lastSync ?? null,
      stored,
      diagnostics: {
        stored_token_state: stored?.state ?? null,
        env_fallback_available: true,
      },
    };
  }

  return {
    token: null,
    source: "none" as CredentialSource,
    lastSync: stored?.lastSync ?? null,
    stored,
    diagnostics: {
      stored_token_state: stored?.state ?? null,
      env_fallback_available: false,
    },
  };
}

function summarise(companies: any, deals: any, lastVerifiedAt: string, degradedReason: string | null = null, errorCode: string | null = null) {
  const companyResults = Array.isArray(companies?.results) ? companies.results : [];
  const dealResults = Array.isArray(deals?.results) ? deals.results : [];
  const staleDeals = dealResults.filter((deal: any) => {
    const ts = Date.parse(deal?.properties?.hs_lastmodifieddate || "");
    return Number.isFinite(ts) && ts < Date.now() - 14 * 24 * 60 * 60 * 1000;
  });
  const atRiskAccounts = companyResults.filter((company: any) => Number(company?.properties?.hubspotscore || 0) < 20);
  const signals = [
    ...staleDeals.slice(0, 3).map((deal: any) => ({ type: "stale_deal", label: deal?.properties?.dealname || "Unnamed deal", stage: deal?.properties?.dealstage || null })),
    ...atRiskAccounts.slice(0, 3).map((company: any) => ({ type: "at_risk_account", label: company?.properties?.name || "Unnamed company" })),
  ];
  const summary = companyResults.length === 0 && dealResults.length === 0
    ? "HubSpot connected but returned no recent CRM records."
    : `${staleDeals.length} stale deals and ${atRiskAccounts.length} low-score accounts across ${companyResults.length} scanned accounts.`;

  return buildResponse({
    connected: true,
    status: degradedReason ? "degraded" : "connected",
    last_verified_at: lastVerifiedAt,
    last_sync_at: lastVerifiedAt,
    degraded_reason: degradedReason,
    error_code: errorCode,
    error_message: degradedReason,
    accounts_scanned: companyResults.length,
    stale_deals: staleDeals.length,
    at_risk_accounts: atRiskAccounts.length,
    customer_escalations: 0,
    signals,
    summary,
    metrics_summary: summary,
  });
}

function extractResults<T>(payload: any): T[] {
  return Array.isArray(payload?.results) ? payload.results : [];
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function formatPersonName(first?: string | null, last?: string | null) {
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || null;
}

function normalizeDealStage(stage?: string | null) {
  return (stage ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

function isClosedDeal(stage?: string | null) {
  const normalized = normalizeDealStage(stage);
  return normalized.includes("closed won") || normalized.includes("closed lost") || normalized === "closedwon" || normalized === "closedlost";
}

function buildTeamBriefingSummary(companiesPayload: any, dealsPayload: any, contactsPayload: any, lastVerifiedAt: string, degradedReason: string | null = null, errorCode: string | null = null, lists: Array<Record<string, unknown>> = []) {
  const companies = extractResults<HubspotCompany>(companiesPayload);
  const deals = extractResults<HubspotDeal>(dealsPayload);
  const contacts = extractResults<HubspotContact>(contactsPayload);

  const companyMap = new Map(companies.map((company) => [company.id, company]));
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const now = Date.now();
  const staleThreshold = now - 21 * 24 * 60 * 60 * 1000;

  const activeDeals = deals
    .filter((deal) => !isClosedDeal(deal.properties?.dealstage))
    .map((deal) => {
      const companyId = deal.associations?.companies?.results?.[0]?.id ?? null;
      const ownerId = deal.properties?.hubspot_owner_id ?? null;
      const closeDate = deal.properties?.closedate ?? null;
      const lastModified = deal.properties?.hs_lastmodifieddate ?? null;
      return {
        id: deal.id,
        name: deal.properties?.dealname || "Unnamed deal",
        stage: deal.properties?.dealstage || "Unknown stage",
        amount: Number(deal.properties?.amount || 0),
        owner_id: ownerId,
        owner_label: ownerId ? `Owner ${ownerId}` : "Unassigned",
        close_date: closeDate,
        last_modified: lastModified,
        company_id: companyId,
        company_name: companyId ? companyMap.get(companyId)?.properties?.name ?? "Unknown account" : "Unlinked account",
      };
    })
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));

  const atRiskAccounts = activeDeals
    .map((deal) => {
      const company = deal.company_id ? companyMap.get(deal.company_id) : null;
      const companyScore = Number(company?.properties?.hubspotscore || 0);
      const companyLastActivity = parseTimestamp(company?.properties?.notes_last_updated ?? company?.properties?.hs_lastmodifieddate);
      const dealLastModified = parseTimestamp(deal.last_modified);
      const dealCloseDate = parseTimestamp(deal.close_date);
      const stale = !!dealLastModified && dealLastModified < staleThreshold;
      const overdue = !!dealCloseDate && dealCloseDate < now;
      const lowScore = Number.isFinite(companyScore) && companyScore > 0 && companyScore < 20;
      const inactiveAccount = !!companyLastActivity && companyLastActivity < staleThreshold;
      const reasons = [
        stale ? "deal stale >21d" : null,
        overdue ? "close date passed" : null,
        lowScore ? `health score ${companyScore}` : null,
        inactiveAccount ? "account inactive >21d" : null,
      ].filter(Boolean) as string[];

      if (reasons.length === 0) return null;

      return {
        account_id: deal.company_id,
        account_name: deal.company_name,
        risk_reasons: reasons,
        stage: deal.stage,
        deal_name: deal.name,
        amount: deal.amount,
        owner_label: deal.owner_label,
        last_activity_at: company?.properties?.notes_last_updated ?? deal.last_modified ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 6) as Array<Record<string, unknown>>;

  const contactPriority = contacts
    .map((contact) => {
      const companyName = contact.properties?.company || null;
      const lastActivity = parseTimestamp(contact.properties?.lastmodifieddate ?? contact.properties?.notes_last_updated);
      const associatedDeal = activeDeals.find((deal) => deal.company_name && companyName && deal.company_name === companyName);
      return {
        id: contact.id,
        name: formatPersonName(contact.properties?.firstname, contact.properties?.lastname) || contact.properties?.email || "Unnamed contact",
        email: contact.properties?.email || null,
        company: companyName,
        lifecycle_stage: contact.properties?.lifecyclestage || null,
        owner_id: contact.properties?.hubspot_owner_id || null,
        owner_label: contact.properties?.hubspot_owner_id ? `Owner ${contact.properties?.hubspot_owner_id}` : "Unassigned",
        last_activity_at: contact.properties?.lastmodifieddate ?? contact.properties?.notes_last_updated ?? null,
        associated_deal_name: associatedDeal?.name ?? null,
        associated_deal_amount: associatedDeal?.amount ?? 0,
        priority_score: (associatedDeal?.amount ?? 0) + (lastActivity ? Math.max(0, 1_000_000_000_000 - lastActivity) / 1_000_000_000 : 0),
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 6)
    .map(({ priority_score, ...contact }) => contact);

  const staleDeals = activeDeals.filter((deal) => {
    const ts = parseTimestamp(deal.last_modified);
    return !!ts && ts < staleThreshold;
  });

  const signals = [
    ...staleDeals.slice(0, 3).map((deal) => ({ type: "stale_deal", label: deal.name, stage: deal.stage, company: deal.company_name })),
    ...atRiskAccounts.slice(0, 3).map((account: any) => ({ type: "at_risk_account", label: account.account_name, reasons: account.risk_reasons })),
  ];

  const summary = activeDeals.length === 0 && contactPriority.length === 0
    ? "HubSpot connected but returned no active pipeline or contact signal for Team Briefing."
    : `${activeDeals.length} active deals, ${atRiskAccounts.length} at-risk accounts, and ${contactPriority.length} priority contacts surfaced from CRM.`;

  return buildResponse({
    connected: true,
    status: degradedReason ? "degraded" : "connected",
    last_verified_at: lastVerifiedAt,
    last_sync_at: lastVerifiedAt,
    degraded_reason: degradedReason,
    error_code: errorCode,
    error_message: degradedReason,
    accounts_scanned: companies.length,
    stale_deals: staleDeals.length,
    at_risk_accounts: atRiskAccounts.length,
    at_risk_accounts_count: atRiskAccounts.length,
    at_risk_accounts_details: atRiskAccounts,
    active_deals_count: activeDeals.length,
    active_deals: activeDeals.slice(0, 6),
    key_contacts: contactPriority,
    lists,
    customer_escalations: 0,
    signals,
    summary,
    metrics_summary: summary,
  });
}

async function fetchFormSubmissionsList(
  token: string,
  source: CredentialSource,
  form: any,
  limit: number,
) {
  const formId = form?.id ?? form?.guid;
  if (!formId) {
    return { form_name: form?.name ?? null, form_id: null, submissions: [], truncated: false };
  }
  type SubRow = {
    contact_id: string | null;
    email: string | null;
    first: string | null;
    last: string | null;
    submitted_at: string | null;
  };
  const rows: SubRow[] = [];
  let after: string | null = null;
  let usedFallback = false;
  let pages = 0;
  const MAX_PAGES = 40;
  let truncated = false;

  outer: while (pages < MAX_PAGES && rows.length < limit) {
    pages++;
    const v3 = `/marketing/v3/forms/${formId}/submissions?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const v1 = `/form-integrations/v1/submissions/forms/${formId}?limit=50${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const path = usedFallback ? v1 : v3;
    let resp: any;
    try {
      resp = await hubspotApi(path, token, "summary", source);
    } catch (err) {
      const status = err instanceof ProviderRequestError ? err.status : 0;
      if (!usedFallback && pages === 1 && (status === 404 || status === 410 || status === 400)) {
        usedFallback = true;
        pages = 0;
        after = null;
        continue;
      }
      throw err;
    }
    const results: any[] = Array.isArray(resp?.results) ? resp.results : [];
    for (const sub of results) {
      const tsRaw = sub?.submittedAt;
      const ts = typeof tsRaw === "number"
        ? new Date(tsRaw).toISOString()
        : typeof tsRaw === "string"
        ? tsRaw
        : null;
      const vid = sub?.contact?.vid ?? sub?.contactId ?? null;
      const values: any[] = Array.isArray(sub?.values) ? sub.values : [];
      const getVal = (name: string) => {
        const f = values.find((v) => typeof v?.name === "string" && v.name.toLowerCase() === name);
        return f?.value != null ? String(f.value) : null;
      };
      rows.push({
        contact_id: vid ? String(vid) : null,
        email: getVal("email")?.toLowerCase() ?? null,
        first: getVal("firstname"),
        last: getVal("lastname"),
        submitted_at: ts,
      });
      if (rows.length >= limit) {
        truncated = true;
        break outer;
      }
    }
    const next = resp?.paging?.next?.after ?? null;
    if (!next) break;
    after = next;
  }

  const ids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean) as string[])];
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean) as string[])];
  const props = ["firstname", "lastname", "email", "city", "country"];
  type Enrich = { first: string | null; last: string | null; email: string | null; city: string | null; country: string | null };
  const map = new Map<string, Enrich>();

  async function batchRead(values: string[], idProperty?: string) {
    for (let i = 0; i < values.length; i += 100) {
      const inputs = values.slice(i, i + 100).map((v) => ({ id: v }));
      try {
        const body: any = { properties: props, inputs };
        if (idProperty) body.idProperty = idProperty;
        const resp = await hubspotApiPost("/crm/v3/objects/contacts/batch/read", body, token, "summary", source);
        const out: any[] = Array.isArray(resp?.results) ? resp.results : [];
        for (const c of out) {
          const id = String(c?.id ?? "");
          const p = c?.properties ?? {};
          const entry: Enrich = {
            first: p.firstname || null,
            last: p.lastname || null,
            email: p.email ? String(p.email).toLowerCase() : null,
            city: p.city || null,
            country: p.country || null,
          };
          if (id) map.set(id, entry);
          if (entry.email) map.set(`email:${entry.email}`, entry);
        }
      } catch (err) {
        logHubspot("form_submissions enrich failed", { count: inputs.length, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  if (ids.length) await batchRead(ids);
  if (emails.length) await batchRead(emails, "email");

  const submissions = rows.map((r) => {
    const enrich = (r.contact_id && map.get(r.contact_id)) || (r.email && map.get(`email:${r.email}`)) || null;
    const first = r.first || enrich?.first || null;
    const last = r.last || enrich?.last || null;
    const name = [first, last].filter(Boolean).join(" ").trim() || null;
    return {
      name,
      email: r.email || enrich?.email || null,
      city: enrich?.city || null,
      country: enrich?.country || null,
      submitted_at: r.submitted_at,
    };
  });

  return { form_name: form?.name ?? null, form_id: String(formId), submissions, truncated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const reqBody = await req.json().catch(() => ({} as any));
  const action = reqBody?.action ?? "status";
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const HUBSPOT_API_KEY = Deno.env.get("HUBSPOT_API_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const verifiedAt = new Date().toISOString();
  const authHeader = req.headers.get("Authorization");
  // Trusted internal calls (e.g. ceo-briefing) authenticate with the service role key.
  // Accept either an exact match against SUPABASE_SERVICE_ROLE_KEY (legacy) OR a JWT
  // whose role claim is "service_role" (new signing-keys system).
  const bearerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : "";
  let isTrustedInternalCall = !!bearerToken && !!SUPABASE_SERVICE_ROLE_KEY && bearerToken === SUPABASE_SERVICE_ROLE_KEY;
  if (!isTrustedInternalCall && bearerToken) {
    try {
      const parts = bearerToken.split(".");
      if (parts.length === 3) {
        const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padding = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
        const claims = JSON.parse(atob(padded + padding));
        if (claims?.role === "service_role") {
          isTrustedInternalCall = true;
        }
      }
    } catch (_e) {
      // ignore — fall through to user-JWT validation
    }
  }

  let callerUser: { id: string; email?: string | null } | null = null;
  if (!isTrustedInternalCall) {
    callerUser = (await getUser(req)) as any;
    if (!callerUser) return json({ error: "Unauthorized" }, 401);
  } else {
    logHubspot("trusted internal auth accepted", { action, mode: "service_role_bypass" });
  }

  try {
    if (action === "form_submissions") {
      const CEO_EMAILS = ["nimesh@kabuni.com", "palash@kabuni.com"];
      const callerEmail = (callerUser?.email ?? "").toLowerCase();
      let allowed = isTrustedInternalCall || CEO_EMAILS.includes(callerEmail);
      if (!allowed && callerUser?.id && SUPABASE_SERVICE_ROLE_KEY) {
        const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, SUPABASE_SERVICE_ROLE_KEY);
        const { data: roleRow } = await adminClient
          .from("user_roles")
          .select("role")
          .eq("user_id", callerUser.id)
          .eq("role", "admin")
          .maybeSingle();
        if (roleRow) allowed = true;
      }
      if (!allowed) return json({ error: "Forbidden" }, 403);

      const formKey = String(reqBody?.form_key || "").toLowerCase();
      const formIdOverride = reqBody?.form_id ? String(reqBody.form_id) : null;
      const limit = Math.min(Math.max(Number(reqBody?.limit) || 200, 1), 500);
      if (!formIdOverride && formKey !== "newsletter" && formKey !== "scout") {
        return json({ error: "form_key must be 'newsletter' or 'scout', or provide form_id" }, 400);
      }

      const resolved = await resolveTeamBriefingToken(HUBSPOT_API_KEY);
      if (!resolved.token) {
        return json({ status: "not_configured", error: "HubSpot is not connected", submissions: [] }, 200);
      }

      let targetForm: any = null;
      if (formIdOverride) {
        targetForm = { id: formIdOverride, name: null };
      } else {
        const formsPayload = await hubspotApi("/marketing/v3/forms?limit=100&formTypes=all", resolved.token, "summary", resolved.source);
        const forms: any[] = Array.isArray(formsPayload?.results) ? formsPayload.results : [];
        targetForm = formKey === "newsletter"
          ? pickForm(forms, ["newsletter", "subscribe", "signup", "sign up"])
          : pickForm(forms, ["scout"]);
        if (!targetForm) {
          return json({ status: "not_found", form_key: formKey, submissions: [], truncated: false }, 200);
        }
      }

      const result = await fetchFormSubmissionsList(resolved.token, resolved.source, targetForm, limit);
      return json({ status: "ok", form_key: formKey, ...result });
    }

    if (action === "team_briefing_summary") {
      logHubspot("credential source", { source: "stored_token_preferred_for_team_briefing", connector_available: !!(LOVABLE_API_KEY && HUBSPOT_API_KEY), env_fallback_available: !!HUBSPOT_API_KEY });
      const resolved = await resolveTeamBriefingToken(HUBSPOT_API_KEY);
      logHubspot("team_briefing_summary credential decision", {
        stored_token_state: resolved.stored?.state ?? null,
        env_fallback_available: !!normalizeBearerToken(HUBSPOT_API_KEY),
        selected_source: resolved.source,
      });
      if (!resolved.token) {
        const state = resolved.stored?.state ?? "integration_not_configured";
        const errorCode = state === "token_decode_failed"
          ? "stored_token_decode_failed"
          : state === "no_token_stored"
          ? "no_token_stored"
          : state === "query_error"
          ? "company_integration_lookup_failed"
          : "integration_not_configured";
        logHubspot("missing token branch", { branch: errorCode, action, stored_token_state: state });
        return responseWithLogging({
          status: state === "token_decode_failed" || state === "query_error" ? "degraded" : "not_configured",
          credential_source: resolved.source,
          verification_path: null,
          last_verified_at: null,
          last_sync_at: resolved.lastSync,
          error_code: errorCode,
          error_message: errorCode === "stored_token_decode_failed"
            ? "Stored HubSpot token could not be decoded and no fallback secret is configured"
            : errorCode === "no_token_stored"
            ? "HubSpot company integration row exists but encrypted_api_key is empty or null and no fallback secret is configured"
            : errorCode === "company_integration_lookup_failed"
            ? "HubSpot company integration lookup failed and no fallback secret is configured"
            : "HubSpot company integration row does not exist and no fallback secret is configured",
          credential_diagnostics: resolved.diagnostics,
        });
      }

      await hubspotApi("/crm/v3/objects/companies?limit=1&properties=name", resolved.token, "verify", resolved.source);
      const [companies, deals, contacts, lists, formMetrics] = await Promise.all([
        hubspotApi("/crm/v3/objects/companies?limit=50&properties=name,hs_lastmodifieddate,hubspotscore,notes_last_updated", resolved.token, "summary", resolved.source),
        hubspotApi("/crm/v3/objects/deals?limit=50&associations=companies,contacts&properties=dealname,dealstage,hs_lastmodifieddate,amount,closedate,hubspot_owner_id", resolved.token, "summary", resolved.source),
        hubspotApi("/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,email,company,lifecyclestage,hubspot_owner_id,lastmodifieddate,notes_last_updated", resolved.token, "summary", resolved.source),
        fetchHubspotForms(resolved.token, resolved.source),
        buildHubspotFormMetrics(resolved.token, resolved.source),
      ]);

      return json({
        ...buildTeamBriefingSummary(companies, deals, contacts, resolved.lastSync ?? verifiedAt, null, null, lists),
        form_metrics: formMetrics,
        credential_source: resolved.source,
        verification_path: "/crm/v3/objects/companies",
        credential_diagnostics: resolved.diagnostics,
      });
    }

    if (action === "search") {
      const query = String(reqBody?.query || "").trim();
      const objects: string[] = Array.isArray(reqBody?.objects) && reqBody.objects.length
        ? reqBody.objects.filter((o: any) => ["contacts", "companies", "deals"].includes(o))
        : ["contacts", "companies", "deals"];
      const limit = Math.min(Math.max(Number(reqBody?.limit) || 10, 1), 25);
      if (!query) return json({ error: "query is required" }, 400);

      const resolved = await resolveTeamBriefingToken(HUBSPOT_API_KEY);
      if (!resolved.token) {
        return json({ status: "not_configured", error: "HubSpot is not connected", results: {} }, 200);
      }

      const searchObject = async (objectType: string, props: string[], filters: any[]) => {
        try {
          const data = await hubspotApiPost(
            `/crm/v3/objects/${objectType}/search`,
            { filterGroups: filters.map((f) => ({ filters: [f] })), properties: props, limit },
            resolved.token!,
            "summary",
            resolved.source,
          );
          return (data?.results || []).map((r: any) => ({ id: r.id, ...r.properties }));
        } catch (e: any) {
          return { error: e?.message || String(e) };
        }
      };

      const results: Record<string, unknown> = {};
      if (objects.includes("contacts")) {
        results.contacts = await searchObject("contacts", ["firstname", "lastname", "email", "company", "lifecyclestage"], [
          { propertyName: "email", operator: "CONTAINS_TOKEN", value: query },
          { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: query },
          { propertyName: "lastname", operator: "CONTAINS_TOKEN", value: query },
        ]);
      }
      if (objects.includes("companies")) {
        results.companies = await searchObject("companies", ["name", "domain", "industry", "hubspotscore", "country"], [
          { propertyName: "name", operator: "CONTAINS_TOKEN", value: query },
          { propertyName: "domain", operator: "CONTAINS_TOKEN", value: query },
        ]);
      }
      if (objects.includes("deals")) {
        results.deals = await searchObject("deals", ["dealname", "dealstage", "amount", "closedate", "pipeline"], [
          { propertyName: "dealname", operator: "CONTAINS_TOKEN", value: query },
        ]);
      }

      return json({ status: "connected", query, results, credential_source: resolved.source });
    }

    if (action === "social_feed") {
      const resolved = await resolveTeamBriefingToken(HUBSPOT_API_KEY);
      if (!resolved.token) {
        return json({ status: "not_configured", channels: [], posts: [], error: "HubSpot is not connected" }, 200);
      }

      // HubSpot Broadcast API channelType is a STRING (e.g. "FacebookPage",
      // "InstagramBusinessAccount", "LinkedInCompany"). Older docs reference
      // numeric codes — we keep those as a fallback.
      const NUMERIC_PLATFORM: Record<number, string> = {
        1: "Twitter",
        2: "LinkedIn",
        3: "Facebook",
        4: "LinkedIn",
        6: "Instagram",
      };

      const resolvePlatform = (raw: unknown): string => {
        if (raw == null) return "Other";
        if (typeof raw === "number" && NUMERIC_PLATFORM[raw]) return NUMERIC_PLATFORM[raw];
        const s = String(raw).toLowerCase();
        if (!s) return "Other";
        if (s.includes("instagram")) return "Instagram";
        if (s.includes("linkedin")) return "LinkedIn";
        if (s.includes("facebook") || s === "fb" || s.includes("fbpage")) return "Facebook";
        if (s.includes("twitter") || s === "x" || s.includes("tweet")) return "Twitter";
        if (s.includes("youtube")) return "YouTube";
        if (s.includes("tiktok")) return "TikTok";
        const asNum = Number(s);
        if (!Number.isNaN(asNum) && NUMERIC_PLATFORM[asNum]) return NUMERIC_PLATFORM[asNum];
        return "Other";
      };

      let channelsRaw: any[] = [];
      let postsRaw: any[] = [];
      const errors: Record<string, string> = {};

      try {
        const data = await hubspotApi(
          "/broadcast/v1/channels/setting/publish/current",
          resolved.token,
          "summary",
          resolved.source,
        );
        channelsRaw = Array.isArray(data) ? data : (data?.results ?? []);
      } catch (e: any) {
        errors.channels = e?.message || String(e);
      }

      try {
        const data = await hubspotApi(
          "/broadcast/v1/broadcasts?limit=10",
          resolved.token,
          "summary",
          resolved.source,
        );
        postsRaw = Array.isArray(data) ? data : (data?.results ?? []);
      } catch (e: any) {
        errors.posts = e?.message || String(e);
      }

      // Diagnostic log: dump key fields per channel + a sample broadcast so we
      // can verify what HubSpot actually returns for this portal.
      logHubspot("social channels raw", {
        count: channelsRaw.length,
        channels: channelsRaw.map((c: any) => ({
          name: c?.name,
          channelType: c?.channelType,
          type: c?.type,
          channelKey: c?.channelKey,
          accountType: c?.accountType,
          channelId: c?.channelId,
          channelGuid: c?.channelGuid,
          accountGuid: c?.accountGuid,
          all_keys: c && typeof c === "object" ? Object.keys(c) : [],
        })),
      });
      logHubspot("social broadcasts raw sample", {
        count: postsRaw.length,
        sample: postsRaw[0] ?? null,
      });

      const channels = channelsRaw.map((c: any) => {
        const rawType = c.channelType ?? c.type ?? c.channelKey ?? c.accountType;
        return {
          guid: c.channelGuid ?? c.accountGuid ?? c.channelId ?? c.channel ?? c.id,
          name: c.name || c.channelName || c.settingName || "Channel",
          platform: resolvePlatform(rawType),
          type: rawType ?? null,
        };
      });

      const channelLookup = new Map<string, { name: string; platform: string }>();
      channels.forEach((c) => {
        if (c.guid) channelLookup.set(String(c.guid), { name: c.name, platform: c.platform });
      });

      const posts = postsRaw
        .map((b: any) => {
          const ch = b.channel ? channelLookup.get(String(b.channel)) : null;
          const rawType = b.channelType ?? b.type ?? b.channelKey;
          const platform = ch?.platform || resolvePlatform(rawType);
          const triggerAt = b.triggerAt || b.finishedAt || b.createdAt;
          const publishedAt = typeof triggerAt === "number"
            ? new Date(triggerAt).toISOString()
            : (typeof triggerAt === "string" ? triggerAt : null);
          const body = (b.content?.body || b.message || "").toString();
          const url = b.content?.link || b.contentDetails?.link || b.permalink || null;
          return {
            id: b.broadcastGuid || b.id || crypto.randomUUID(),
            channel: ch?.name || "—",
            platform,
            publishedAt,
            body,
            url,
            status: b.status || null,
          };
        })
        .sort((a, b) => {
          const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
          const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
          return tb - ta;
        })
        .slice(0, 10);

      return json({
        status: "connected",
        credential_source: resolved.source,
        channels,
        posts,
        errors: Object.keys(errors).length ? errors : undefined,
      });
    }





    if (LOVABLE_API_KEY && HUBSPOT_API_KEY) {
      logHubspot("credential source", { source: "connector_gateway" });
      await verifyGatewayCredentials(LOVABLE_API_KEY, HUBSPOT_API_KEY);

      if (action === "status") {
        return responseWithLogging({
          connected: true,
          status: "connected",
          credential_source: "connector_gateway",
          verification_path: "/api/v1/verify_credentials",
          last_verified_at: verifiedAt,
          last_sync_at: verifiedAt,
        });
      }

      const [companies, deals] = await Promise.all([
        hubspotGateway("/crm/v3/objects/companies?limit=25&properties=name,hs_lastmodifieddate,hubspotscore", LOVABLE_API_KEY, HUBSPOT_API_KEY),
        hubspotGateway("/crm/v3/objects/deals?limit=25&properties=dealname,dealstage,hs_lastmodifieddate,amount", LOVABLE_API_KEY, HUBSPOT_API_KEY),
      ]);
      return json({
        ...summarise(companies, deals, verifiedAt),
        credential_source: "connector_gateway",
        verification_path: "/api/v1/verify_credentials",
      });
    }

    logHubspot("credential source", { source: "stored_token", connector_available: false });
    const stored = await getStoredToken();
    if (!stored) {
      logHubspot("missing token branch", { branch: "stored_token_missing" });
      return responseWithLogging({
        status: "not_configured",
        credential_source: "none",
        verification_path: null,
        last_verified_at: null,
        last_sync_at: null,
        error_code: "hubspot_not_configured",
        error_message: "No HubSpot connector linked and no stored company token found",
      });
    }

    if (!stored.token) {
      logHubspot("decode failure branch", { branch: "stored_token_decode_failed", stored_status: stored.storedStatus });
      return responseWithLogging({
        status: "degraded",
        credential_source: "stored_token",
        verification_path: "/crm/v3/objects/companies",
        last_verified_at: stored.lastSync ?? verifiedAt,
        last_sync_at: stored.lastSync ?? verifiedAt,
        error_code: "stored_token_decode_failed",
        error_message: "Stored HubSpot token could not be decoded",
      });
    }

    await hubspotApi("/crm/v3/objects/companies?limit=1&properties=name", stored.token, "verify");
    if (action === "status") {
      return responseWithLogging({
        connected: true,
        status: "connected",
        credential_source: "stored_token",
        verification_path: "/crm/v3/objects/companies",
        last_verified_at: verifiedAt,
        last_sync_at: stored.lastSync ?? verifiedAt,
      });
    }

    const [companies, deals] = await Promise.all([
      hubspotApi("/crm/v3/objects/companies?limit=25&properties=name,hs_lastmodifieddate,hubspotscore", stored.token),
      hubspotApi("/crm/v3/objects/deals?limit=25&properties=dealname,dealstage,hs_lastmodifieddate,amount", stored.token),
    ]);

    return json({
      ...summarise(companies, deals, stored.lastSync ?? verifiedAt),
      credential_source: "stored_token",
      verification_path: "/crm/v3/objects/companies",
    });
  } catch (error: any) {
    const classification = classifyProviderFailure(error);
    logHubspot("classified failure", {
      error_code: classification.error_code,
      error_message: classification.error_message,
      status: classification.status,
      provider_status: error instanceof ProviderRequestError ? error.status : null,
      source: error instanceof ProviderRequestError ? error.source : null,
      stage: error instanceof ProviderRequestError ? error.stage : null,
      path: error instanceof ProviderRequestError ? error.path : null,
      snippet: error instanceof ProviderRequestError ? safeSnippet(error.body) : (error instanceof Error ? error.message : String(error)),
    });
    const lastSyncAt = error instanceof ProviderRequestError && error.source === "stored_token"
      ? (await getStoredToken())?.lastSync ?? verifiedAt
      : verifiedAt;
    return responseWithLogging({
      status: classification.status,
      connected: false,
      credential_source: error instanceof ProviderRequestError ? error.source : "none",
      verification_path: error instanceof ProviderRequestError ? error.path : null,
      last_verified_at: verifiedAt,
      last_sync_at: lastSyncAt,
      error_code: classification.error_code,
      error_message: classification.error_message,
    });
  }
});
