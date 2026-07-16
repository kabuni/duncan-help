// Daily Google Analytics email report.
// v1 metrics (Palash spec): sessions, page views, top 5 pages, registrations,
// bounce rate, 404 hits (+ top 404 URLs), mobile vs desktop split.
// Payload is intentionally jsonb-flexible so optional metrics (unique users,
// new/returning, sources, landing, conversion rate, KPL/Schools split) can be
// enabled later without a schema change.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const TZ = "Europe/London";

// ---------- GA token ----------
async function loadGaAccessToken(admin: any): Promise<{ accessToken: string; propertyId: string }> {
  const { data: row, error } = await admin
    .from("google_analytics_tokens")
    .select("id, access_token, refresh_token, token_expiry, property_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !row) throw new Error("Google Analytics not connected");
  if (!row.property_id) throw new Error("Google Analytics property_id missing");

  let accessToken = row.access_token as string;
  if (new Date(row.token_expiry) <= new Date(Date.now() + 60_000)) {
    const clientId = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GMAIL_CLIENT_SECRET");
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`GA token refresh failed: ${await res.text()}`);
    const refreshed = await res.json();
    accessToken = refreshed.access_token;
    await admin
      .from("google_analytics_tokens")
      .update({
        access_token: accessToken,
        token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("id", row.id);
  }
  return { accessToken, propertyId: row.property_id };
}

async function runReport(accessToken: string, propertyId: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${ANALYTICS_DATA_API}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GA report failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

const num = (r: any, i = 0) => Number(r?.metricValues?.[i]?.value ?? 0);
const dim = (r: any, i = 0) => String(r?.dimensionValues?.[i]?.value ?? "");

// ---------- Yesterday in Europe/London ----------
function yesterdayInLondon(): { iso: string; startUtcIso: string; endUtcIso: string; label: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  const todayLondon = new Date(Date.UTC(y, m - 1, d));
  const yLondon = new Date(todayLondon.getTime() - 24 * 3600 * 1000);
  const iso = yLondon.toISOString().slice(0, 10);
  // Approximate UTC boundaries for London-day (accepting up to 1h drift near DST for a registrations count).
  const startUtcIso = `${iso}T00:00:00Z`;
  const endUtcIso = `${todayLondon.toISOString().slice(0, 10)}T00:00:00Z`;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).format(yLondon);
  return { iso, startUtcIso, endUtcIso, label };
}

// ---------- Build payload ----------
async function buildPayload(admin: any) {
  const { accessToken, propertyId } = await loadGaAccessToken(admin);
  const { iso, startUtcIso, endUtcIso, label } = yesterdayInLondon();
  const dateRanges = [{ startDate: iso, endDate: iso }];

  const [summary, topPages, devices, notFound] = await Promise.all([
    runReport(accessToken, propertyId, {
      dateRanges,
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }, { name: "bounceRate" }],
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 5,
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
    }),
    runReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      dimensionFilter: {
        orGroup: {
          expressions: [
            { filter: { fieldName: "pageTitle", stringFilter: { matchType: "CONTAINS", value: "404", caseSensitive: false } } },
            { filter: { fieldName: "pageTitle", stringFilter: { matchType: "CONTAINS", value: "not found", caseSensitive: false } } },
          ],
        },
      },
      limit: 10,
    }).catch((e) => ({ rows: [], error: String(e) })),
  ]);

  // Registrations (yesterday, London day → UTC window)
  const { count: registrations } = await admin
    .from("school_registrations")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startUtcIso)
    .lt("created_at", endUtcIso);

  const s = summary.rows?.[0];
  const sessions = num(s, 0);
  const pageViews = num(s, 1);
  const bounceRate = num(s, 2); // 0..1

  const deviceRows = (devices.rows ?? []).map((r: any) => ({
    category: dim(r, 0),
    sessions: num(r, 0),
  }));
  const deviceTotal = deviceRows.reduce((a: number, r: any) => a + r.sessions, 0) || 1;
  const deviceSplit = deviceRows.map((r: any) => ({
    category: r.category,
    sessions: r.sessions,
    share: r.sessions / deviceTotal,
  }));

  const notFoundRows = (notFound.rows ?? []).map((r: any) => ({
    path: dim(r, 0),
    title: dim(r, 1),
    hits: num(r, 0),
  }));
  const notFoundTotal = notFoundRows.reduce((a: number, r: any) => a + r.hits, 0);

  return {
    reportDate: iso,
    reportDateLabel: label,
    timezone: TZ,
    propertyId,
    metrics: {
      sessions,
      pageViews,
      bounceRate,
      registrations: registrations ?? 0,
      notFoundTotal,
    },
    topPages: (topPages.rows ?? []).map((r: any) => ({
      path: dim(r, 0),
      title: dim(r, 1),
      views: num(r, 0),
    })),
    deviceSplit,
    notFound: { total: notFoundTotal, rows: notFoundRows },
    // Optional metrics slots — intentionally omitted in v1, no schema change needed later.
    optional: {},
    generatedAt: new Date().toISOString(),
  };
}

// ---------- Email rendering ----------
const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

function renderHtml(p: any): string {
  const rowCss = "padding:6px 10px;border-bottom:1px solid #eee;font-size:14px";
  const numCss = `${rowCss};text-align:right;font-variant-numeric:tabular-nums`;
  const h = (t: string) =>
    `<tr><td colspan="2" style="padding:14px 10px 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd">${t}</td></tr>`;
  const kv = (k: string, v: string) => `<tr><td style="${rowCss}">${k}</td><td style="${numCss}"><b>${v}</b></td></tr>`;

  const topPagesRows = p.topPages.length
    ? p.topPages.map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.path)}</td><td style="${numCss}">${fmt(r.views)}</td></tr>`).join("")
    : `<tr><td colspan="2" style="${rowCss};color:#999">No page views recorded.</td></tr>`;

  const deviceRow = ["desktop", "mobile", "tablet"].map((k) => {
    const d = p.deviceSplit.find((x: any) => x.category?.toLowerCase() === k);
    return d ? `${cap(k)} ${pct(d.share, 0)}` : null;
  }).filter(Boolean).join(" · ") || "—";

  const notFoundRows = p.notFound.rows.length
    ? p.notFound.rows.slice(0, 5).map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.path)}</td><td style="${numCss}">${fmt(r.hits)}</td></tr>`).join("")
    : `<tr><td colspan="2" style="${rowCss};color:#999">No 404s detected.</td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111">
<div style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1px solid #eee">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#888">Duncan · Daily Web Report</div>
    <div style="font-size:18px;font-weight:600;margin-top:4px">${escapeHtml(p.reportDateLabel)}</div>
    <div style="font-size:12px;color:#888;margin-top:2px">GA4 property ${escapeHtml(p.propertyId)} · ${escapeHtml(p.timezone)}</div>
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${h("Traffic")}
    ${kv("Sessions", fmt(p.metrics.sessions))}
    ${kv("Page views", fmt(p.metrics.pageViews))}
    ${kv("Bounce rate", pct(p.metrics.bounceRate))}
    ${h("Conversion")}
    ${kv("Registrations", fmt(p.metrics.registrations))}
    ${h("Devices")}
    <tr><td colspan="2" style="${rowCss}">${escapeHtml(deviceRow)}</td></tr>
    ${h("Top 5 pages")}
    ${topPagesRows}
    ${h(`404 hits (${fmt(p.metrics.notFoundTotal)})`)}
    ${notFoundRows}
  </table>
  <div style="padding:12px 24px;font-size:11px;color:#999;border-top:1px solid #eee">
    Registrations sourced from Duncan database. Yesterday = ${escapeHtml(p.reportDate)} (${escapeHtml(p.timezone)}).
  </div>
</div></body></html>`;
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- Email sending (Gmail as Duncan) ----------
async function getGmailSenderToken(admin: any): Promise<string | null> {
  const { data: row } = await admin.from("gmail_tokens").select("*").eq("email_address", "duncan@kabuni.com").maybeSingle();
  if (!row) return null;
  const now = new Date();
  const expiry = new Date(row.token_expiry);
  if (expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: row.refresh_token,
        client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
        client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) { console.error("gmail refresh failed:", await res.text()); return null; }
    const refreshed = await res.json();
    await admin.from("gmail_tokens").update({
      access_token: refreshed.access_token,
      token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
    }).eq("id", row.id);
    return refreshed.access_token;
  }
  return row.access_token;
}

function base64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildRFC2822(to: string, subject: string, htmlBody: string): string {
  return [
    "From: Duncan <duncan@kabuni.com>",
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ].join("\r\n");
}

async function sendEmail(accessToken: string, to: string, subject: string, html: string) {
  const raw = base64url(buildRFC2822(to, subject, html));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
}

// ---------- Handler ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const toOverride = url.searchParams.get("to");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const payload = await buildPayload(admin);
    const html = renderHtml(payload);
    const subject = `Duncan · Daily Web Report — ${payload.reportDateLabel}`;

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, subject, payload, html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency (skip when a one-off override recipient is provided)
    if (!force && !toOverride) {
      const { data: existing } = await admin
        .from("ga_daily_report_log")
        .select("report_date, status")
        .eq("report_date", payload.reportDate)
        .maybeSingle();
      if (existing && existing.status === "sent") {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_sent", reportDate: payload.reportDate }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Recipients (override wins when provided)
    let recipients: string[] = [];
    if (toOverride) {
      recipients = toOverride.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const { data: recRow } = await admin.from("app_settings").select("value").eq("key", "daily_ga_report_recipients").maybeSingle();
      recipients = Array.isArray(recRow?.value) ? recRow!.value.filter((x: unknown) => typeof x === "string") : [];
    }
    if (recipients.length === 0) throw new Error("No recipients configured in app_settings.daily_ga_report_recipients");


    const accessToken = await getGmailSenderToken(admin);
    if (!accessToken) throw new Error("Gmail sender token unavailable (duncan@kabuni.com)");

    const errors: string[] = [];
    for (const to of recipients) {
      try {
        await sendEmail(accessToken, to, subject, html);
      } catch (e) {
        errors.push(`${to}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const status = errors.length && errors.length === recipients.length ? "failed" : "sent";
    await admin.from("ga_daily_report_log").upsert({
      report_date: payload.reportDate,
      recipients,
      payload,
      status,
      error: errors.length ? errors.join("\n") : null,
      sent_at: new Date().toISOString(),
    }, { onConflict: "report_date" });

    return new Response(JSON.stringify({ ok: status === "sent", status, recipients, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("daily-ga-report error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
