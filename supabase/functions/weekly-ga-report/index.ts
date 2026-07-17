// Weekly Google Analytics executive email digest.
// Metrics: Users, Sessions, Views, Engagement, Avg Session Duration (with WoW + MoM)
// + 9-channel acquisition table, Top Pages, Top Landing Pages, 404s, Geo, Devices.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
function encodeSubject(subject: string): string {
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
}
function buildRFC2822(to: string, subject: string, htmlBody: string): string {
  return [
    "From: Duncan <duncan@kabuni.com>",
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
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

const fmt = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));
const pctRate = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const pctDelta = (n: number | null): string => n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const pctColor = (n: number | null): string => n === null ? "#999" : n > 0 ? "#0a7d20" : n < 0 ? "#b02a37" : "#666";
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function fmtRangeLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };
  return `${new Intl.DateTimeFormat("en-GB", opts).format(s)} to ${new Intl.DateTimeFormat("en-GB", opts).format(e)}`;
}

function renderHtml(p: any): string {
  const rowCss = "padding:6px 10px;border-bottom:1px solid #eee;font-size:14px";
  const numCss = `${rowCss};text-align:right;font-variant-numeric:tabular-nums`;
  const h = (t: string, cols = 2) =>
    `<tr><td colspan="${cols}" style="padding:14px 10px 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#666;border-bottom:1px solid #ddd">${t}</td></tr>`;

  const kpiRow = (label: string, value: string, wow: number | null, mom: number | null) => `
    <tr>
      <td style="${rowCss}">${label}</td>
      <td style="${numCss}"><b>${value}</b></td>
      <td style="${numCss};color:${pctColor(wow)}">${pctDelta(wow)}</td>
      <td style="${numCss};color:${pctColor(mom)}">${pctDelta(mom)}</td>
    </tr>`;

  const s = p.summary.current;
  const w = p.summary.wowDeltaPct;
  const m = p.summary.momDeltaPct;

  const acqRows = p.acquisition.map((c: any) => `
    <tr>
      <td style="${rowCss}">${escapeHtml(c.channel)}${!c.configured ? ' <span style="color:#999;font-size:11px">(not configured)</span>' : ""}</td>
      <td style="${numCss}">${fmt(c.sessions)}</td>
      <td style="${numCss}">${fmt(c.users)}</td>
      <td style="${numCss};color:${pctColor(c.wowDeltaPct)}">${pctDelta(c.wowDeltaPct)}</td>
    </tr>`).join("");

  const topPagesRows = p.topPages.length
    ? p.topPages.slice(0, 5).map((r: any) => `
        <tr>
          <td style="${rowCss}"><b>${escapeHtml(r.title || "—")}</b><br><span style="color:#999;font-size:12px">${escapeHtml(r.path)}</span></td>
          <td style="${numCss}">${fmt(r.views)}</td>
        </tr>`).join("")
    : `<tr><td colspan="2" style="${rowCss};color:#999">No page views recorded.</td></tr>`;

  const landingRows = p.landingPages.length
    ? p.landingPages.slice(0, 5).map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.landing)}</td><td style="${numCss}">${fmt(r.sessions)}</td></tr>`).join("")
    : `<tr><td colspan="2" style="${rowCss};color:#999">No landing page data.</td></tr>`;

  const notFoundRows = p.notFound.rows.length
    ? p.notFound.rows.slice(0, 5).map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.path)}</td><td style="${numCss}">${fmt(r.hits)}</td></tr>`).join("")
    : `<tr><td colspan="2" style="${rowCss};color:#999">No 404s detected.</td></tr>`;

  const countryRows = p.countries.slice(0, 5).map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.label)}</td><td style="${numCss}">${fmt(r.users)}</td></tr>`).join("");
  const cityRows = p.cities.slice(0, 5).map((r: any) => `<tr><td style="${rowCss}">${escapeHtml(r.label)}</td><td style="${numCss}">${fmt(r.users)}</td></tr>`).join("");

  const deviceRow = ["desktop", "mobile", "tablet"].map((k) => {
    const d = p.devices.find((x: any) => x.label?.toLowerCase() === k);
    const total = p.devices.reduce((a: number, x: any) => a + x.users, 0) || 1;
    return d ? `${k[0].toUpperCase()}${k.slice(1)} ${((d.users / total) * 100).toFixed(0)}%` : null;
  }).filter(Boolean).join(" · ") || "—";

  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111">
<div style="max-width:720px;margin:24px auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden">
  <div style="padding:20px 24px;border-bottom:1px solid #eee">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#888">Duncan · Weekly Web Report</div>
    <div style="font-size:18px;font-weight:600;margin-top:4px">${escapeHtml(fmtRangeLabel(p.dateRange.start, p.dateRange.end))}</div>
    <div style="font-size:12px;color:#888;margin-top:2px">GA4 property ${escapeHtml(p.propertyId)}</div>
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${h("Headline KPIs · this week · WoW · MoM", 4)}
    <tr>
      <td style="${rowCss};color:#888;font-size:11px;text-transform:uppercase">Metric</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">Value</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">WoW</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">MoM</td>
    </tr>
    ${kpiRow("Active users", fmt(s.activeUsers), w.activeUsers, m.activeUsers)}
    ${kpiRow("Sessions", fmt(s.sessions), w.sessions, m.sessions)}
    ${kpiRow("Page views", fmt(s.pageViews), w.pageViews, m.pageViews)}
    ${kpiRow("Engagement rate", pctRate(s.engagementRate), w.engagementRate, m.engagementRate)}
    ${kpiRow("Avg session (sec)", fmt(s.avgSessionDurationSec), w.avgSessionDurationSec, m.avgSessionDurationSec)}
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${h("Acquisition · 9 channels", 4)}
    <tr>
      <td style="${rowCss};color:#888;font-size:11px;text-transform:uppercase">Channel</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">Sessions</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">Users</td>
      <td style="${numCss};color:#888;font-size:11px;text-transform:uppercase">WoW</td>
    </tr>
    ${acqRows}
  </table>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
    ${h("Top pages")}
    ${topPagesRows}
    ${h("Top landing pages")}
    ${landingRows}
    ${h(`404 hits (${fmt(p.notFound.total)})`)}
    ${notFoundRows}
    ${h("Top countries")}
    ${countryRows || `<tr><td colspan="2" style="${rowCss};color:#999">—</td></tr>`}
    ${h("Top cities")}
    ${cityRows || `<tr><td colspan="2" style="${rowCss};color:#999">—</td></tr>`}
    ${h("Devices")}
    <tr><td colspan="2" style="${rowCss}">${escapeHtml(deviceRow)}</td></tr>
  </table>

  <div style="padding:12px 24px;font-size:11px;color:#999;border-top:1px solid #eee">
    Source: Google Analytics 4. 404 detection uses page title heuristic. Open the <b>Operations → Website Analytics</b> tab for filters.
  </div>
</div></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const force = url.searchParams.get("force") === "true";
  const toOverride = url.searchParams.get("to");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // Call weekly_report via the analytics API using service-role auth (bypass user JWT check).
    // We inline the call by re-using the same underlying token+logic through a fetch.
    const analyticsRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-analytics-api`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "weekly_report", filters: {} }),
    });
    if (!analyticsRes.ok) throw new Error(`weekly_report failed: ${await analyticsRes.text()}`);
    const payload = await analyticsRes.json();

    const html = renderHtml(payload);
    const rangeLabel = fmtRangeLabel(payload.dateRange.start, payload.dateRange.end);
    const subject = `Duncan · Weekly Web Report — ${rangeLabel}`;

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, subject, payload, html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!force && !toOverride) {
      const { data: existing } = await admin
        .from("ga_daily_report_log")
        .select("report_date, status")
        .eq("cadence", "weekly")
        .eq("report_date", payload.dateRange.start)
        .maybeSingle();
      if (existing && existing.status === "sent") {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_sent", reportDate: payload.dateRange.start }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let recipients: string[] = [];
    if (toOverride) {
      recipients = toOverride.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const { data: recRow } = await admin.from("app_settings").select("value").eq("key", "weekly_ga_report_recipients").maybeSingle();
      recipients = Array.isArray(recRow?.value) ? recRow!.value.filter((x: unknown) => typeof x === "string") : [];
    }
    if (recipients.length === 0) throw new Error("No recipients configured in app_settings.weekly_ga_report_recipients");

    const accessToken = await getGmailSenderToken(admin);
    if (!accessToken) throw new Error("Gmail sender token unavailable (duncan@kabuni.com)");

    const errors: string[] = [];
    for (const to of recipients) {
      try { await sendEmail(accessToken, to, subject, html); }
      catch (e) { errors.push(`${to}: ${e instanceof Error ? e.message : String(e)}`); }
      await new Promise((r) => setTimeout(r, 100));
    }

    const status = errors.length && errors.length === recipients.length ? "failed" : "sent";
    if (!toOverride) {
      await admin.from("ga_daily_report_log").upsert({
        cadence: "weekly",
        report_date: payload.dateRange.start,
        recipients,
        payload,
        status,
        error: errors.length ? errors.join("\n") : null,
        sent_at: new Date().toISOString(),
      }, { onConflict: "cadence,report_date" });
    }

    return new Response(JSON.stringify({ ok: status === "sent", status, recipients, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("weekly-ga-report error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
