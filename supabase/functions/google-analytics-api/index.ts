import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ANALYTICS_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

type AnalyticsToken = {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  property_id: string | null;
  property_name: string | null;
};

async function refreshAccessToken(tokenData: AnalyticsToken, supabaseAdmin: any) {
  const clientId = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are not configured");

  const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshResponse.ok) throw new Error("Failed to refresh Google Analytics token");
  const refreshed = await refreshResponse.json();
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supabaseAdmin.from("google_analytics_tokens").update({ access_token: refreshed.access_token, token_expiry: newExpiry }).eq("id", tokenData.id);
  return refreshed.access_token as string;
}

async function getProperty(accessToken: string, selectedPropertyId?: string | null) {
  if (selectedPropertyId) return selectedPropertyId;

  const accountsResponse = await fetch(`${ANALYTICS_ADMIN_API}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!accountsResponse.ok) throw new Error("Unable to list Google Analytics accounts");
  const accounts = await accountsResponse.json();
  const firstAccount = accounts.accounts?.[0];
  if (!firstAccount?.name) throw new Error("No Google Analytics account found");

  const propertiesResponse = await fetch(`${ANALYTICS_ADMIN_API}/properties?filter=parent:${firstAccount.name}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!propertiesResponse.ok) throw new Error("Unable to list Google Analytics properties");
  const properties = await propertiesResponse.json();
  const firstProperty = properties.properties?.[0];
  if (!firstProperty?.name) throw new Error("No GA4 property found");

  return firstProperty.name.replace("properties/", "") as string;
}

async function runReport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  const response = await fetch(`${ANALYTICS_DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Google Analytics report failed (${response.status}): ${details}`);
  }

  return await response.json();
}

function metricValue(row: any, index: number) {
  return Number(row?.metricValues?.[index]?.value ?? 0);
}

function dimensionValue(row: any, index: number) {
  return String(row?.dimensionValues?.[index]?.value ?? "—");
}

function rowsToPairs(report: any, metricIndex = 0) {
  return (report.rows ?? []).map((row: any) => ({
    label: dimensionValue(row, 0),
    value: metricValue(row, metricIndex),
    users: metricValue(row, 0),
    sessions: metricValue(row, 1),
  }));
}

async function getDashboard(accessToken: string, propertyId: string) {
  const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];
  const yesterdayRange = [{ startDate: "yesterday", endDate: "today" }];

  const [summary, pages, countries, cities, devices, demographics, sources] = await Promise.all([
    runReport(accessToken, propertyId, {
      dateRanges,
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "engagementRate" }],
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 8,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "city" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 5,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "userAgeBracket" }, { name: "userGender" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 10,
    }).catch((error) => ({ rows: [], unavailableReason: error.message })),
    runReport(accessToken, propertyId, {
      dateRanges: yesterdayRange,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 8,
    }),
  ]);

  const summaryRow = summary.rows?.[0];
  return {
    connected: true,
    propertyId,
    summary: {
      activeUsers: metricValue(summaryRow, 0),
      sessions: metricValue(summaryRow, 1),
      pageViews: metricValue(summaryRow, 2),
      engagementRate: metricValue(summaryRow, 3),
    },
    topPages: rowsToPairs(pages).map((row: any) => ({ page: row.label, views: row.value, users: row.users })),
    reach: {
      countries: rowsToPairs(countries),
      cities: rowsToPairs(cities),
    },
    devices: rowsToPairs(devices),
    demographics: {
      available: !demographics.unavailableReason && (demographics.rows?.length ?? 0) > 0,
      reason: demographics.unavailableReason,
      rows: (demographics.rows ?? []).map((row: any) => ({
        age: dimensionValue(row, 0),
        gender: dimensionValue(row, 1),
        users: metricValue(row, 0),
      })),
    },
    sources: rowsToPairs(sources),
    generatedAt: new Date().toISOString(),
  };
}

async function answerQuestion(question: string, dashboard: any) {
  const data = await callLLMWithFallback({
    workflow: "google-analytics",
    messages: [
      { role: "system", content: "You are Duncan. Answer website analytics questions using only the supplied GA4 dashboard JSON. Be concise, data-backed, and executive-friendly." },
      { role: "user", content: `Question: ${question}\n\nGA4 dashboard JSON:\n${JSON.stringify(dashboard)}` },
    ],
  });
  return data.choices?.[0]?.message?.content ?? "I couldn't generate an analytics answer from the available data.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { action, question } = await req.json();
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "disconnect") {
      await supabaseAdmin.from("google_analytics_tokens").delete().eq("user_id", user.id);
      return new Response(JSON.stringify({ connected: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tokenData, error: tokenError } = await supabaseAdmin
      .from("google_analytics_tokens")
      .select("id, user_id, access_token, refresh_token, token_expiry, property_id, property_name")
      .eq("user_id", user.id)
      .single();

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ connected: false, code: "NOT_CONNECTED" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let accessToken = tokenData.access_token;
    if (new Date(tokenData.token_expiry) <= new Date()) {
      accessToken = await refreshAccessToken(tokenData, supabaseAdmin);
    }

    if (action === "checkConnection") {
      return new Response(JSON.stringify({ connected: true, propertyId: tokenData.property_id, propertyName: tokenData.property_name }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const propertyId = await getProperty(accessToken, tokenData.property_id);
    if (!tokenData.property_id || tokenData.property_id !== propertyId) {
      await supabaseAdmin.from("google_analytics_tokens").update({ property_id: propertyId }).eq("id", tokenData.id);
    }

    const dashboard = await getDashboard(accessToken, propertyId);

    if (action === "askQuestion") {
      if (!question || typeof question !== "string") throw new Error("question is required");
      const answer = await answerQuestion(question, dashboard);
      return new Response(JSON.stringify({ answer, dashboard }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "dashboard") {
      return new Response(JSON.stringify(dashboard), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: any) {
    console.error("Google Analytics API error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
