// Daily sync: pulls Alex's social stats from Google Sheet
// (https://docs.google.com/spreadsheets/d/1JuNZvCZAsvJEOof4FyElkRPz568aIYnqKiHwAhsHrrA)
// using Duncan's Gmail OAuth token (which now also has sheets.readonly scope).
// Parses each tab and stores latest week snapshot per account in social_stats_snapshots.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SPREADSHEET_ID = "1JuNZvCZAsvJEOof4FyElkRPz568aIYnqKiHwAhsHrrA";

async function getAccessToken(admin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const { data: t } = await admin.from("gmail_tokens").select("*").limit(1).maybeSingle();
  if (!t) return null;

  if (new Date(t.token_expiry) <= new Date()) {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: t.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!r.ok) return null;
    const nt = await r.json();
    const exp = new Date(Date.now() + nt.expires_in * 1000);
    await admin.from("gmail_tokens").update({
      access_token: nt.access_token,
      token_expiry: exp.toISOString(),
    }).eq("id", t.id);
    return nt.access_token;
  }
  return t.access_token;
}

// ---------- Sheet parsing ----------
const METRIC_KEYS: Record<string, string> = {
  followers: "followers", "follower count": "followers", "total followers": "followers",
  subscribers: "followers",
  posts: "posts", "post count": "posts", "# posts": "posts", "posts this week": "posts",
  likes: "likes", reactions: "likes",
  comments: "comments", replies: "comments",
  shares: "shares", reposts: "shares", retweets: "shares",
  impressions: "impressions", views: "impressions", reach: "impressions",
  engagement: "engagement_rate", "engagement rate": "engagement_rate", "eng %": "engagement_rate",
  "engagement %": "engagement_rate",
};

const WEEK_KEYS = ["week", "week of", "week starting", "date", "week start", "period", "w/c", "week commencing"];

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && isFinite(v)) return v;
  const s = String(v).replace(/[, ]/g, "").replace(/%$/, "");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function parseSheet(sheetName: string, rows: any[][]) {
  if (!rows?.length) return null;

  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = (rows[i] || []).map(norm);
    const hasWeek = r.some((c) => WEEK_KEYS.includes(c));
    const hasMetric = r.some((c) => METRIC_KEYS[c]);
    if (hasWeek && hasMetric) { headerIdx = i; header = r; break; }
  }
  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = (rows[i] || []).map(norm);
      if (r.some((c) => METRIC_KEYS[c])) { headerIdx = i; header = r; break; }
    }
  }
  if (headerIdx === -1) return null;

  const colIdx: Record<string, number> = {};
  let weekCol = -1;
  header.forEach((h, idx) => {
    if (weekCol === -1 && WEEK_KEYS.includes(h)) weekCol = idx;
    const key = METRIC_KEYS[h];
    if (key && colIdx[key] === undefined) colIdx[key] = idx;
  });

  const dataRows = rows.slice(headerIdx + 1)
    .filter((r) => r && r.some((c: any) => c !== null && c !== "" && c !== undefined));
  if (!dataRows.length) return null;

  let lastIdx = -1;
  for (let i = dataRows.length - 1; i >= 0; i--) {
    const r = dataRows[i];
    if (Object.values(colIdx).some((ci) => toNum(r[ci]) !== null)) { lastIdx = i; break; }
  }
  if (lastIdx === -1) return null;
  const last = dataRows[lastIdx];
  const prev = lastIdx > 0 ? dataRows[lastIdx - 1] : null;

  const pick = (r: any[] | null, k: string) =>
    r && colIdx[k] !== undefined ? toNum(r[colIdx[k]]) : null;

  let weekLabel: string | null = null;
  let weekStart: string | null = null;
  if (weekCol >= 0) {
    const v = last[weekCol];
    if (v) {
      weekLabel = String(v);
      const d = new Date(weekLabel);
      if (!isNaN(d.getTime())) weekStart = d.toISOString().slice(0, 10);
    }
  }

  return {
    account: sheetName.trim(),
    channel: sheetName.trim(),
    week_label: weekLabel,
    week_start: weekStart,
    followers: pick(last, "followers"),
    posts: pick(last, "posts"),
    likes: pick(last, "likes"),
    comments: pick(last, "comments"),
    shares: pick(last, "shares"),
    impressions: pick(last, "impressions"),
    engagement_rate: pick(last, "engagement_rate"),
    prev_followers: pick(prev, "followers"),
    prev_posts: pick(prev, "posts"),
    prev_likes: pick(prev, "likes"),
    prev_comments: pick(prev, "comments"),
    prev_shares: pick(prev, "shares"),
    raw: { header, last, prev },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const token = await getAccessToken(admin);
    if (!token) {
      return new Response(JSON.stringify({ error: "Gmail not connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Get spreadsheet metadata to list tabs
    const metaRes = await fetch(
      `${SHEETS_API}/${SPREADSHEET_ID}?fields=sheets.properties(title,sheetId)`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      const t = await metaRes.text();
      return new Response(JSON.stringify({ error: `Sheets metadata failed: ${t}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const meta = await metaRes.json();
    const tabs: string[] = (meta.sheets || []).map((s: any) => s.properties.title);
    if (!tabs.length) {
      return new Response(JSON.stringify({ ok: true, message: "No tabs in spreadsheet" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Batch get values for all tabs
    const ranges = tabs.map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z1000`)}`).join("&");
    const valsRes = await fetch(
      `${SHEETS_API}/${SPREADSHEET_ID}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!valsRes.ok) {
      const t = await valsRes.text();
      return new Response(JSON.stringify({ error: `Sheets values failed: ${t}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const valsJson = await valsRes.json();
    const valueRanges = valsJson.valueRanges || [];

    const snapshots: any[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const name = tabs[i];
      const rows = valueRanges[i]?.values || [];
      const parsed = parseSheet(name, rows);
      if (!parsed) { skipped.push(name); continue; }
      snapshots.push({
        source_message_id: SPREADSHEET_ID,
        source_filename: `Google Sheet: ${name}`,
        source_email_date: new Date().toISOString(),
        ...parsed,
      });
    }

    if (!snapshots.length) {
      return new Response(JSON.stringify({
        ok: true, message: "No parseable tabs", tabs, skipped,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: insErr } = await admin.from("social_stats_snapshots").insert(snapshots);
    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      spreadsheet_id: SPREADSHEET_ID,
      accounts: snapshots.map((s) => s.account),
      skipped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[sync-social-stats]", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
