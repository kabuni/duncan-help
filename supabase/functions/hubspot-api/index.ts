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
};

const TEAM_BRIEFING_LISTS = ["Scout Programme", "Marketing Newsletter"] as const;

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

  try {
    const decoded = atob(encodedToken).trim();
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
      decoded_length: decoded.length,
      decoded_prefix: decoded.slice(0, 10),
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
  } catch (decodeError) {
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
      decode_error: decodeError instanceof Error ? decodeError.message : String(decodeError),
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

async function fetchHubspotLists(token: string, source: CredentialSource) {
  const results: Array<{
    requested_name: string;
    list_id: string | null;
    matched_name: string | null;
    member_count: number | null;
    processing_type: string | null;
    updated_at: string | null;
    error?: string | null;
  }> = [];

  for (const requestedName of TEAM_BRIEFING_LISTS) {
    try {
      const search = await hubspotApiPost(
        "/crm/v3/lists/search",
        { query: requestedName, count: 10 },
        token,
        "summary",
        source,
      );
      const lists = Array.isArray(search?.lists) ? search.lists : [];
      const lower = requestedName.toLowerCase();
      const exact = lists.find((l: any) => (l?.name || "").toLowerCase() === lower);
      const partial = exact || lists.find((l: any) => (l?.name || "").toLowerCase().includes(lower));
      const match: any = partial || null;

      if (!match) {
        results.push({
          requested_name: requestedName,
          list_id: null,
          matched_name: null,
          member_count: null,
          processing_type: null,
          updated_at: null,
        });
        continue;
      }

      const listId = String(match.listId ?? match.id ?? "");
      let memberCount: number | null = null;
      let updatedAt: string | null = match.updatedAt ?? null;
      let processingType: string | null = match.processingType ?? null;

      if (typeof match.additionalProperties?.hs_list_size === "number") {
        memberCount = match.additionalProperties.hs_list_size;
      } else if (typeof match.size === "number") {
        memberCount = match.size;
      }

      if (memberCount === null && listId) {
        try {
          const detail = await hubspotApi(`/crm/v3/lists/${listId}`, token, "summary", source);
          const list = detail?.list ?? detail;
          memberCount = typeof list?.additionalProperties?.hs_list_size === "number"
            ? list.additionalProperties.hs_list_size
            : typeof list?.size === "number"
            ? list.size
            : null;
          updatedAt = list?.updatedAt ?? updatedAt;
          processingType = list?.processingType ?? processingType;
        } catch (detailErr) {
          logHubspot("list detail fetch failed", {
            list_id: listId,
            requested_name: requestedName,
            error: detailErr instanceof Error ? detailErr.message : String(detailErr),
          });
        }
      }

      results.push({
        requested_name: requestedName,
        list_id: listId || null,
        matched_name: match.name ?? null,
        member_count: memberCount,
        processing_type: processingType,
        updated_at: updatedAt,
      });
    } catch (err) {
      logHubspot("list search failed", {
        requested_name: requestedName,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({
        requested_name: requestedName,
        list_id: null,
        matched_name: null,
        member_count: null,
        processing_type: null,
        updated_at: null,
        error: err instanceof Error ? err.message : "Lookup failed",
      });
    }
  }

  return results;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { action } = await req.json().catch(() => ({ action: "status" }));
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const HUBSPOT_API_KEY = Deno.env.get("HUBSPOT_API_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const verifiedAt = new Date().toISOString();
  const authHeader = req.headers.get("Authorization");
  const isTrustedInternalCall = !!authHeader && !!SUPABASE_SERVICE_ROLE_KEY && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

  if (!(action === "team_briefing_summary" && isTrustedInternalCall)) {
    const user = await getUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
  } else {
    logHubspot("trusted internal auth accepted", { action, mode: "service_role_bypass" });
  }

  try {
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
      const [companies, deals, contacts] = await Promise.all([
        hubspotApi("/crm/v3/objects/companies?limit=50&properties=name,hs_lastmodifieddate,hubspotscore,notes_last_updated", resolved.token, "summary", resolved.source),
        hubspotApi("/crm/v3/objects/deals?limit=50&associations=companies,contacts&properties=dealname,dealstage,hs_lastmodifieddate,amount,closedate,hubspot_owner_id", resolved.token, "summary", resolved.source),
        hubspotApi("/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,email,company,lifecyclestage,hubspot_owner_id,lastmodifieddate,notes_last_updated", resolved.token, "summary", resolved.source),
      ]);

      return json({
        ...buildTeamBriefingSummary(companies, deals, contacts, resolved.lastSync ?? verifiedAt),
        credential_source: resolved.source,
        verification_path: "/crm/v3/objects/companies",
        credential_diagnostics: resolved.diagnostics,
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
