// Per-user EA inbox poller. Runs every 5 min for every profile where
// `ea_mode_enabled = true` (excluding Nimesh, who is handled by ea-poll-inbox).
// For each opted-in user: scans their personal Gmail for meeting requests,
// auto-replies asking for purpose if missing, and files a meeting_requests row
// so the user can approve/decline from the EA Inbox UI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NIMESH_USER_ID = "517bf518-6111-41b8-9ff0-1249f3055ec7";
const MODEL = "claude-sonnet-4-5";
const SEARCH_QUERY =
  'newer_than:3d in:inbox (meeting OR schedule OR call OR speak OR intro OR chat OR "catch up")';

async function refreshGoogle(rt: string, id: string, secret: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret, refresh_token: rt, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getUserGmail(supa: any, userId: string): Promise<string | null> {
  const { data } = await supa.from("gmail_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry).getTime() - Date.now() > 60_000) return data.access_token;
  const r = await refreshGoogle(
    data.refresh_token,
    Deno.env.get("GMAIL_CLIENT_ID")!,
    Deno.env.get("GMAIL_CLIENT_SECRET")!,
  );
  if (!r) return null;
  await supa.from("gmail_tokens").update({
    access_token: r.access_token,
    token_expiry: new Date(Date.now() + r.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return r.access_token;
}

async function gmail(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Gmail ${path} ${r.status}`);
  return r.json();
}

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  try { return decodeURIComponent(escape(atob(s))); } catch { return atob(s); }
}
function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function extractBody(p: any): string {
  if (!p) return "";
  if (p.body?.data) return b64urlDecode(p.body.data);
  for (const part of p.parts || []) if (part.mimeType === "text/plain" && part.body?.data) return b64urlDecode(part.body.data);
  for (const part of p.parts || []) { const n = extractBody(part); if (n) return n; }
  return "";
}
function header(p: any, name: string): string {
  const h = (p?.headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}
function parseFrom(f: string) {
  const m = f.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m
    ? { name: m[1].trim() || m[2].split("@")[0], email: m[2].trim().toLowerCase() }
    : { name: f.split("@")[0], email: f.trim().toLowerCase() };
}
function parseJsonFromText(t: string) {
  const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
async function callClaude(system: string, user: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 512, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const j = await r.json();
  return j?.content?.[0]?.text ?? "";
}

async function sendReply(token: string, threadId: string, to: string, subject: string, body: string, inReplyTo?: string) {
  const subj = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const lines = [
    `To: ${to}`,
    `Subject: ${subj}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (inReplyTo) { lines.push(`In-Reply-To: ${inReplyTo}`); lines.push(`References: ${inReplyTo}`); }
  const raw = b64urlEncode(lines.join("\r\n") + "\r\n\r\n" + body);
  return gmail(token, "/messages/send", { method: "POST", body: JSON.stringify({ raw, threadId }) });
}

async function pollUser(
  supa: any,
  user: { id: string; email: string; name: string; timezone: string; country: string | null },
  log: any,
) {
  const token = await getUserGmail(supa, user.id);
  if (!token) { log.skipped.push({ user: user.email, reason: "no gmail token" }); return; }

  const list = await gmail(token, `/messages?maxResults=20&q=${encodeURIComponent(SEARCH_QUERY)}`);
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
  log.scanned += ids.length;

  const tzLabel = user.timezone || "Europe/London";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tzLabel, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tzLabel, weekday: "long" }).format(new Date());
  const locBit = user.country ? ` currently based in ${user.country}` : "";

  for (const id of ids) {
    try {
      const msg = await gmail(token, `/messages/${id}?format=full`);
      const threadId = msg.threadId as string;
      const p = msg.payload;
      const from = header(p, "From");
      const subj = header(p, "Subject");
      const mid = header(p, "Message-Id") || header(p, "Message-ID");
      const { name: senderName, email: senderEmail } = parseFrom(from);
      const body = extractBody(p).slice(0, 6000);

      if (senderEmail === user.email.toLowerCase()) continue;

      const { data: existing } = await supa.from("meeting_requests")
        .select("id, status").eq("gmail_thread_id", threadId).eq("user_id", user.id).maybeSingle();
      if (existing) continue;

      const intent = parseJsonFromText(await callClaude(
        `You are Duncan, an EA for ${user.name}${locBit}. Today is ${weekday} ${today} (${tzLabel}). Detect whether this email is a request to meet, call, or schedule time with ${user.name}. Extract any stated purpose and preferred date/time (resolve relative dates against today). Return JSON only: {"is_meeting_request":true|false,"purpose_found":true|false,"purpose":string|null,"preferred_date":"YYYY-MM-DD"|null,"preferred_time_start":"HH:MM"|null,"preferred_time_end":"HH:MM"|null,"urgent":true|false}`,
        `Subject: ${subj}\n\n${body}`,
      ));
      if (!intent?.is_meeting_request) continue;
      log.new_threads++;

      const row: any = {
        user_id: user.id,
        sender_name: senderName, sender_email: senderEmail,
        gmail_thread_id: threadId, gmail_message_id: mid || null,
        original_email_subject: subj, original_email_body: body,
        last_polled_at: new Date().toISOString(),
        purpose: intent.purpose || null,
        priority: intent.urgent ? "P2" : null,
        status: intent.purpose_found ? "pending_approval" : "awaiting_purpose",
      };
      const { data: inserted } = await supa.from("meeting_requests").insert(row).select().single();
      if (inserted && !intent.purpose_found) {
        const first = senderName.split(" ")[0] || "there";
        const reply =
`Hi ${first},

Thanks for reaching out — happy to help ${user.name.split(" ")[0]} find time.

To route this appropriately, could you share:

1. The purpose of the meeting (partnership, hiring, product, etc.)
2. Whether this is time-sensitive or has a preferred date/time.

I'll come back with a proposed slot in ${tzLabel} once I have that.

Best,
Duncan (EA for ${user.name})`;
        await sendReply(token, threadId, senderEmail, subj, reply, mid);
        log.replied_for_purpose++;
      }
    } catch (e: any) {
      log.errors.push({ user: user.email, msg: e?.message });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: users } = await supa.from("profiles")
    .select("id, email, full_name, current_timezone, current_country")
    .eq("ea_mode_enabled", true)
    .neq("id", NIMESH_USER_ID);

  const log: any = { users: 0, scanned: 0, new_threads: 0, replied_for_purpose: 0, errors: [], skipped: [] };
  for (const u of users || []) {
    if (!u.email) continue;
    log.users++;
    await pollUser(supa, {
      id: u.id, email: u.email, name: u.full_name || u.email.split("@")[0],
      timezone: u.current_timezone || "Europe/London",
      country: u.current_country || null,
    }, log);
  }

  return new Response(JSON.stringify({ ok: true, ...log }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
