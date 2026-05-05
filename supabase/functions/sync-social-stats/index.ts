// Daily sync: pulls Alex's latest social stats Excel from Duncan's Gmail
// (alex@kabuni.com), parses every account tab, stores latest week snapshot
// per account in social_stats_snapshots.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SENDER = "alex@kabuni.com";

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

function b64urlToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "=".repeat(4 - (norm.length % 4)) : "";
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Attachment = { filename: string; attachmentId: string; mimeType: string };
function findExcelAttachments(payload: any, out: Attachment[] = []): Attachment[] {
  if (!payload) return out;
  const fn = (payload.filename || "").toLowerCase();
  const isXlsx = fn.endsWith(".xlsx") || fn.endsWith(".xls") ||
    payload.mimeType?.includes("spreadsheetml") ||
    payload.mimeType === "application/vnd.ms-excel";
  if (isXlsx && payload.body?.attachmentId) {
    out.push({
      filename: payload.filename,
      attachmentId: payload.body.attachmentId,
      mimeType: payload.mimeType || "",
    });
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) findExcelAttachments(p, out);
  }
  return out;
}

// ---------- Excel parsing ----------
const METRIC_KEYS: Record<string, string> = {
  followers: "followers", "follower count": "followers", "total followers": "followers",
  subscribers: "followers",
  posts: "posts", "post count": "posts", "# posts": "posts",
  likes: "likes", reactions: "likes",
  comments: "comments", replies: "comments",
  shares: "shares", reposts: "shares", retweets: "shares",
  impressions: "impressions", views: "impressions", reach: "impressions",
  engagement: "engagement_rate", "engagement rate": "engagement_rate", "eng %": "engagement_rate",
  "engagement %": "engagement_rate",
};

const WEEK_KEYS = ["week", "week of", "week starting", "date", "week start", "period"];

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

function parseSheet(sheetName: string, sheet: XLSX.WorkSheet) {
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (!rows.length) return null;

  // Find header row: row containing "week" or "date" plus at least one metric
  let headerIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i].map(norm);
    const hasWeek = r.some((c) => WEEK_KEYS.includes(c));
    const hasMetric = r.some((c) => METRIC_KEYS[c]);
    if (hasWeek && hasMetric) { headerIdx = i; header = r; break; }
  }
  if (headerIdx === -1) {
    // Fallback: first row that has any metric column
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i].map(norm);
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

  // Data rows after header
  const dataRows = rows.slice(headerIdx + 1)
    .filter((r) => r.some((c) => c !== null && c !== "" && c !== undefined));
  if (!dataRows.length) return null;

  // Latest = last row with a numeric metric
  let lastIdx = -1;
  for (let i = dataRows.length - 1; i >= 0; i--) {
    const r = dataRows[i];
    if (Object.values(colIdx).some((ci) => toNum(r[ci]) !== null)) { lastIdx = i; break; }
  }
  if (lastIdx === -1) return null;
  const last = dataRows[lastIdx];
  const prev = lastIdx > 0 ? dataRows[lastIdx - 1] : null;

  const pick = (r: any[], k: string) => r ? toNum(r[colIdx[k]]) : null;

  let weekLabel: string | null = null;
  let weekStart: string | null = null;
  if (weekCol >= 0) {
    const v = last[weekCol];
    if (v instanceof Date) {
      weekStart = v.toISOString().slice(0, 10);
      weekLabel = weekStart;
    } else if (typeof v === "number") {
      // Excel serial date
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      weekStart = d.toISOString().slice(0, 10);
      weekLabel = weekStart;
    } else if (v) {
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
    prev_followers: pick(prev as any, "followers"),
    prev_posts: pick(prev as any, "posts"),
    prev_likes: pick(prev as any, "likes"),
    prev_comments: pick(prev as any, "comments"),
    prev_shares: pick(prev as any, "shares"),
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

    // Search recent messages from Alex with Excel attachments
    const q = encodeURIComponent(`from:${SENDER} has:attachment filename:xlsx newer_than:60d`);
    const listRes = await fetch(`${GMAIL_API}/messages?q=${q}&maxResults=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const t = await listRes.text();
      return new Response(JSON.stringify({ error: `Gmail list failed: ${t}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const list = await listRes.json();
    const messages = list.messages || [];
    if (!messages.length) {
      return new Response(JSON.stringify({ ok: true, message: "No matching emails" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Walk most-recent first; pick first message that yields a parseable workbook
    for (const m of messages) {
      const mRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!mRes.ok) continue;
      const msg = await mRes.json();
      const atts = findExcelAttachments(msg.payload);
      if (!atts.length) continue;

      const internalDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;

      // Use the first xlsx attachment
      const att = atts[0];
      const aRes = await fetch(
        `${GMAIL_API}/messages/${m.id}/attachments/${att.attachmentId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!aRes.ok) continue;
      const aJson = await aRes.json();
      const bytes = b64urlToBytes(aJson.data);
      const wb = XLSX.read(bytes, { type: "array", cellDates: true });

      const snapshots: any[] = [];
      for (const name of wb.SheetNames) {
        const parsed = parseSheet(name, wb.Sheets[name]);
        if (!parsed) continue;
        snapshots.push({
          source_message_id: m.id,
          source_filename: att.filename,
          source_email_date: internalDate,
          ...parsed,
        });
      }

      if (!snapshots.length) continue;

      const { error: insErr } = await admin.from("social_stats_snapshots").insert(snapshots);
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        ok: true,
        message_id: m.id,
        filename: att.filename,
        accounts: snapshots.map((s) => s.account),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, message: "No parseable workbook found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[sync-social-stats]", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
