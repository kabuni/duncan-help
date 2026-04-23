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
};

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
  const { data } = await supabase
    .from("company_integrations")
    .select("encrypted_api_key, status, last_sync")
    .eq("integration_id", "hubspot")
    .maybeSingle();

  const encodedToken = typeof data?.encrypted_api_key === "string" ? data.encrypted_api_key : null;

  try {
    return {
      rowFound: !!data,
      encodedToken,
      token: encodedToken ? atob(encodedToken) : null,
      decodeOk: !!encodedToken,
      lastSync: data?.last_sync ?? null,
      storedStatus: data?.status ?? null,
    };
  } catch {
    return {
      rowFound: !!data,
      encodedToken,
      token: null,
      decodeOk: false,
      lastSync: data?.last_sync ?? null,
      storedStatus: data?.status ?? null,
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

async function hubspotApi(path: string, token: string, stage: RequestStage = "summary") {
  logHubspot("verification endpoint", { source: "stored_token", path, stage, ...tokenFingerprint(token) });
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => ({}));
  logHubspot("provider response", { source: "stored_token", stage, path, status: res.status, snippet: safeSnippet(data) });
  if (!res.ok) {
    throw new ProviderRequestError("HubSpot API failed", {
      status: res.status,
      body: data,
      source: "stored_token",
      stage,
      path,
    });
  }
  return data;
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

function buildTeamBriefingSummary(companiesPayload: any, dealsPayload: any, contactsPayload: any, lastVerifiedAt: string, degradedReason: string | null = null, errorCode: string | null = null) {
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
    customer_escalations: 0,
    signals,
    summary,
    metrics_summary: summary,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { action } = await req.json().catch(() => ({ action: "status" }));
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const HUBSPOT_API_KEY = Deno.env.get("HUBSPOT_API_KEY");
  const verifiedAt = new Date().toISOString();

  try {
    if (action === "team_briefing_summary") {
      logHubspot("credential source", { source: "stored_token_preferred_for_team_briefing", connector_available: !!(LOVABLE_API_KEY && HUBSPOT_API_KEY) });
      const stored = await getStoredToken();
      if (!stored) {
        logHubspot("missing token branch", { branch: "stored_token_missing", action });
        return responseWithLogging({
          status: "not_configured",
          credential_source: "none",
          verification_path: null,
          last_verified_at: null,
          last_sync_at: null,
          error_code: "hubspot_not_configured",
          error_message: "No stored company token found for Team Briefing HubSpot access",
        });
      }

      const sanitizedToken = stored.token?.trim() ?? null;
      if (!sanitizedToken) {
        logHubspot("decode failure branch", { branch: "stored_token_decode_failed", stored_status: stored.storedStatus, action });
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

      await hubspotApi("/crm/v3/objects/companies?limit=1&properties=name", sanitizedToken, "verify");
      const [companies, deals, contacts] = await Promise.all([
        hubspotApi("/crm/v3/objects/companies?limit=50&properties=name,hs_lastmodifieddate,hubspotscore,notes_last_updated", sanitizedToken),
        hubspotApi("/crm/v3/objects/deals?limit=50&associations=companies,contacts&properties=dealname,dealstage,hs_lastmodifieddate,amount,closedate,hubspot_owner_id", sanitizedToken),
        hubspotApi("/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,email,company,lifecyclestage,hubspot_owner_id,lastmodifieddate,notes_last_updated", sanitizedToken),
      ]);

      return json({
        ...buildTeamBriefingSummary(companies, deals, contacts, stored.lastSync ?? verifiedAt),
        credential_source: "stored_token",
        verification_path: "/crm/v3/objects/companies",
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
  } catch (error) {
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
