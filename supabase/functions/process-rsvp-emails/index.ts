import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";

const RSVP_MAILBOX = "duncan@kabuni.com";

async function getAccessToken(admin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  // HARD LOCK: only operate on the duncan@kabuni.com mailbox.
  // Never fall back to any other connected user's Gmail token — doing so
  // would send replies from their personal account.
  const { data } = await admin
    .from("gmail_tokens")
    .select("*")
    .ilike("email_address", RSVP_MAILBOX)
    .limit(1)
    .maybeSingle();
  if (!data) {
    console.warn(`[process-rsvp-emails] no gmail_tokens row for ${RSVP_MAILBOX} — aborting`);
    return null;
  }
  if (new Date(data.token_expiry) > new Date()) return data.access_token;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: data.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const t = await r.json();
  await admin.from("gmail_tokens").update({
    access_token: t.access_token,
    token_expiry: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", data.id);
  return t.access_token;
}

function decodeB64Url(s: string): string {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b + "==".slice(0, (4 - b.length % 4) % 4)), c => c.charCodeAt(0)));
  } catch { return ""; }
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  if (Array.isArray(payload.parts)) {
    const text = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (text?.body?.data) return decodeB64Url(text.body.data);
    for (const p of payload.parts) {
      const r = extractBody(p);
      if (r) return r;
    }
  }
  return "";
}

function parseFromHeader(from: string): { email: string; name: string } {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: from.trim().toLowerCase() };
}

async function sendSlackDM(slackId: string, text: string) {
  const lov = Deno.env.get("LOVABLE_API_KEY");
  const slk = Deno.env.get("SLACK_API_KEY");
  if (!lov || !slk) return;
  const headers = { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": slk, "Content-Type": "application/json" };
  try {
    const o = await fetch(`${SLACK_GATEWAY_URL}/conversations.open`, { method: "POST", headers, body: JSON.stringify({ users: slackId }) });
    const od = await o.json();
    if (!od.ok) return;
    await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST", headers,
      body: JSON.stringify({ channel: od.channel.id, text, username: "Duncan", icon_emoji: ":calendar:" }),
    });
  } catch (e) { console.error("slack dm error", e); }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function encodeRfc2822Html(to: string, subject: string, text: string, html: string, fromName: string, inReplyTo?: string, references?: string): string {
  const boundary = `=_dunc_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: "${fromName}" <duncan@kabuni.com>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push(
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
    ''
  );
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderHtmlEmail(opts: {
  greeting: string;
  intro: string;
  highlights?: { label: string; value: string }[];
  schedule?: { time: string; label: string }[];
  missing?: string[];
  closing?: string;
  ctaNote?: string;
}): string {
  const { schedule = [] } = opts;
  const scheduleBlock = schedule.length
    ? `
      <div style="margin:20px 0 0;padding:18px 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
        <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:12px;">Running order</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${schedule.map((s, i) => `
            <tr>
              <td style="padding:${i === 0 ? "0" : "10px"} 0 ${i === schedule.length - 1 ? "0" : "10px"};border-top:${i === 0 ? "none" : "1px solid #e5e7eb"};color:#111827;font-size:13px;font-weight:600;width:140px;vertical-align:top;font-variant-numeric:tabular-nums;">${escapeHtml(s.time)}</td>
              <td style="padding:${i === 0 ? "0" : "10px"} 0 ${i === schedule.length - 1 ? "0" : "10px"};border-top:${i === 0 ? "none" : "1px solid #e5e7eb"};color:#374151;font-size:14px;">${escapeHtml(s.label)}</td>
            </tr>`).join("")}
        </table>
      </div>`
    : "";
  const { greeting, intro, highlights = [], missing = [], closing, ctaNote } = opts;
  const highlightRows = highlights
    .map(
      (h) => `
        <tr>
          <td style="padding:8px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top;">${escapeHtml(h.label)}</td>
          <td style="padding:8px 0;color:#111827;font-size:14px;font-weight:500;">${escapeHtml(h.value)}</td>
        </tr>`
    )
    .join("");

  const missingBlock = missing.length
    ? `
      <div style="margin:24px 0 8px;padding:16px 18px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
        <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px;">A few details to complete your RSVP</div>
        <ul style="margin:0;padding-left:18px;color:#78350f;font-size:13px;line-height:1.7;">
          ${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}
        </ul>
        <div style="margin-top:10px;font-size:12px;color:#92400e;">Just reply to this email with the details above and we'll take care of the rest.</div>
      </div>`
    : `
      <div style="margin:24px 0 8px;padding:16px 18px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;color:#065f46;font-size:14px;">
        ✅ You're all set — your RSVP is fully confirmed.
      </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:28px 32px 0;">
          <div style="display:inline-block;padding:6px 12px;background:#111827;color:#fff;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Duncan · Kabuni</div>
        </td></tr>
        <tr><td style="padding:20px 32px 8px;">
          <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#111827;font-weight:600;">${escapeHtml(greeting)}</h1>
          <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
        </td></tr>
        ${highlights.length ? `<tr><td style="padding:20px 32px 0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
            ${highlightRows}
          </table>
        </td></tr>` : ""}
        ${scheduleBlock ? `<tr><td style="padding:0 32px;">${scheduleBlock}</td></tr>` : ""}
        <tr><td style="padding:8px 32px 0;">${missingBlock}</td></tr>
        ${ctaNote ? `<tr><td style="padding:12px 32px 0;color:#6b7280;font-size:13px;line-height:1.6;">${escapeHtml(ctaNote)}</td></tr>` : ""}
        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(closing || "See you there.")}</p>
          <p style="margin:18px 0 0;color:#111827;font-size:14px;font-weight:600;">— Duncan</p>
          <p style="margin:2px 0 0;color:#9ca3af;font-size:12px;">Operational intelligence · Kabuni</p>
        </td></tr>
      </table>
      <div style="max-width:560px;margin:14px auto 0;color:#9ca3af;font-size:11px;text-align:center;">You're receiving this because you emailed duncan@kabuni.com about an event.</div>
    </td></tr>
  </table>
</body></html>`;
}

interface GmailSendResult {
  ok: boolean;
  status: number;
  messageId?: string;
  threadId?: string;
  error?: string;
}

async function sendGmailReply(
  token: string,
  to: string,
  subject: string,
  text: string,
  html: string,
  threadId?: string,
  inReplyTo?: string,
): Promise<GmailSendResult> {
  try {
    const raw = encodeRfc2822Html(to, subject, text, html, "Duncan", inReplyTo, inReplyTo);
    const r = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    });
    const bodyText = await r.text();
    if (!r.ok) {
      console.error("[process-rsvp-emails] gmail send FAILED", {
        to,
        status: r.status,
        body: bodyText,
      });
      return { ok: false, status: r.status, error: `HTTP ${r.status}: ${bodyText}` };
    }
    let parsed: any = {};
    try { parsed = bodyText ? JSON.parse(bodyText) : {}; } catch { /* ignore */ }
    console.log("[process-rsvp-emails] gmail send OK", {
      to,
      status: r.status,
      messageId: parsed.id,
      threadId: parsed.threadId,
    });
    return { ok: true, status: r.status, messageId: parsed.id, threadId: parsed.threadId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[process-rsvp-emails] gmail send EXCEPTION", { to, error: msg });
    return { ok: false, status: 0, error: msg };
  }
}

interface AttendeeExtract {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  organisation_type: string | null;
  organisation_name: string | null;
  location: string | null;
}

interface AiMatchResult {
  event_id: string | null;
  status: string;
  status_explicit?: boolean;
  confidence: number;
  reason: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  organisation_type: string | null;
  organisation_name: string | null;
  location: string | null;
  missing_fields: string[];
  attendees?: AttendeeExtract[];
}

async function aiMatch(emailText: string, candidates: any[]): Promise<AiMatchResult | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const sys = `You decide whether an inbound email is a clear RSVP for one of the listed events, and extract attendee details for EVERY attendee mentioned (the sender may RSVP for themselves AND additional guests). Events can be anywhere in the world — do NOT assume any specific country. Return STRICT JSON:
{
  "event_id": "<uuid of the event the sender is RSVPing to, or null>",
  "status": "yes|no|maybe",
  "status_explicit": true if the email contains explicit yes/no/maybe intent words, false if defaulted,
  "confidence": 0-1,
  "reason": "short",
  "first_name": "<primary attendee first name or null>",
  "last_name": "<primary attendee last name or null>",
  "phone": "<primary attendee phone, full international e.g. +447700900000 or null>",
  "email": "<best email for the primary attendee or null>",
  "organisation_type": "school|media|company|other or null",
  "organisation_name": "<string or null>",
  "location": "<city/region/country the primary attendee is travelling from, or null>",
  "missing_fields": ["any of: first_name,last_name,phone,email,organisation_type,organisation_name,location"],
  "attendees": [
    { "first_name":"...", "last_name":"...", "phone":"...", "email":"...",
      "organisation_type":"...", "organisation_name":"...", "location":"..." }
    // ONE entry per attendee. attendees[0] MUST be the primary (sender) and must match the top-level primary fields.
  ]
}

STRICT RULES — set event_id to null and confidence < 0.5 unless ALL of these are true:
1. The email is an inbound RSVP request or response addressed to duncan@kabuni.com. Auto-generated calendar accept/decline notifications from Google Calendar / Outlook are NOT RSVPs — return null for those.
2. The sender (or someone they explicitly bring) is RSVPing with attendance intent (yes/no/maybe — "I'd like to attend", "count me in", "Adit and I will attend", "I won't make it", "tentative").
3. The email clearly identifies ONE specific event from the candidate list — by name, date, or city. If ambiguous, return null.

Discussion, planning, logistics, internal calendar invites, or generic greetings are NOT RSVPs — return null.

MULTI-ATTENDEE PARSING (CRITICAL — read carefully):
- Detect ALL named attendees, INCLUDING the sender themself when they are also attending ("myself", "I will attend", "my presence"). Names may be UPPERCASE, lowercase, mixed case, or with titles (Mr., Dr., Ms.) — normalise to Title Case.
- Names may be glued directly to a hyphen with NO space (e.g. "SHAH- Mobile" or "Shah-Mobile") — treat the hyphen as a field separator regardless of surrounding whitespace.
- Examples (every one of these MUST yield 2+ attendees):
  • "Adit Bhargava and Palash Soundarkar will attend" → 2 attendees
  • "Samaresh Shah - Mobile 9836697979 and Swayam Shah - Mobile 9354138986" → 2 attendees, each with their own phone
  • "myself SAMARESH SHAH- Mobile 9836697979 and SWAYAM SHAH- Mobile 9354138986" → 2 attendees: Samaresh Shah (+919836697979) and Swayam Shah (+919354138986). The word "myself" marks the sender as attendee #1.
  • "Myself, John Doe, Sarah Khan" → 3 attendees (sender + 2 guests)
  • "Adit - 9999999999, Palash" → 2 attendees, only Adit has a phone
  • "I'll come with my colleague Priya Mehta (+91 98123 45678)" → 2 attendees: sender + Priya Mehta
- Conjunctions/separators between attendees include: "and", "&", ",", ";", newline, " plus ", " with ", " along with ". Split on each before assigning fields.
- Associate phone/email/org with the named attendee that IMMEDIATELY precedes it (closest-name-wins). NEVER copy one attendee's phone onto another. If two phones appear in one sentence with two names, the first phone belongs to the first name and the second phone to the second name.
- IGNORE filler/group words as attendees: team, everyone, guests, family, group, friends, colleagues, kids. Do NOT invent attendees from these.
- Do NOT hallucinate or fabricate phone numbers, emails, or names. If a field is not literally present for that attendee, set it to null.
- Deduplicate attendees referring to the same person (same normalised full name).
- The "attendees" array MUST contain one entry per distinct named attendee. If you detected 2 names, return 2 entries — never collapse them.

Match events by name/date/location ONLY. Always normalise phone to +<country code><number> with no spaces. Map school/college/university => school; news/tv/journalist/press => media; brand/corp/firm/startup => company.

LITERAL EXTRACTION ONLY: leave any field null UNLESS the attendee literally states the value in this email (signature blocks count). NEVER infer from event venue, subject, sender domain, or context. The event city must NEVER populate "location" (which is where the attendee is travelling FROM).`;
  const user = `Email:\n${emailText.slice(0, 4000)}\n\nCandidate events (JSON, with ISO start dates):\n${JSON.stringify(candidates)}`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!r.ok) { console.error("openai error", await r.text()); return null; }
    const j = await r.json();
    return JSON.parse(j.choices[0].message.content);
  } catch (e) { console.error("ai parse error", e); return null; }
}

// ─── Multi-attendee helpers ────────────────────────────────────────────────
const FILLER_NAMES = new Set([
  "team", "everyone", "guests", "guest", "family", "group", "friends",
  "colleagues", "kids", "all", "us", "we",
]);
const ATTENDEES_MARKER = "\n\n--ATTENDEES_JSON--\n";

function isEmptyVal(v: any): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function normName(first?: string | null, last?: string | null): string {
  return `${(first || "").trim()} ${(last || "").trim()}`.replace(/\s+/g, " ").trim().toLowerCase();
}

function isFillerAttendee(a: AttendeeExtract): boolean {
  const n = normName(a.first_name, a.last_name);
  if (!n) return true;
  if (FILLER_NAMES.has(n)) return true;
  const parts = n.split(" ");
  if (parts.length === 1 && FILLER_NAMES.has(parts[0])) return true;
  return false;
}

function cleanAttendeeList(list: AttendeeExtract[] | undefined | null): AttendeeExtract[] {
  if (!Array.isArray(list)) return [];
  const seen = new Map<string, AttendeeExtract>();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a: AttendeeExtract = {
      first_name: raw.first_name || null,
      last_name: raw.last_name || null,
      phone: raw.phone || null,
      email: raw.email ? String(raw.email).toLowerCase() : null,
      organisation_type: raw.organisation_type || null,
      organisation_name: raw.organisation_name || null,
      location: raw.location || null,
    };
    if (isFillerAttendee(a)) continue;
    const key = normName(a.first_name, a.last_name) || (a.email || "").toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      const ex = seen.get(key)!;
      for (const k of Object.keys(a) as (keyof AttendeeExtract)[]) {
        if (isEmptyVal(ex[k]) && !isEmptyVal(a[k])) (ex as any)[k] = a[k];
      }
    } else {
      seen.set(key, a);
    }
  }
  return Array.from(seen.values());
}

function attendeeMissing(a: AttendeeExtract): string[] {
  const m: string[] = [];
  if (isEmptyVal(a.first_name)) m.push("first name");
  if (isEmptyVal(a.last_name)) m.push("last name");
  if (isEmptyVal(a.phone)) m.push("mobile (with country code)");
  if (isEmptyVal(a.organisation_name)) m.push("organisation");
  if (isEmptyVal(a.location)) m.push("city / region");
  return m;
}

function displayAttendee(a: AttendeeExtract): string {
  const n = `${a.first_name || ""} ${a.last_name || ""}`.trim();
  return n || a.email || "(unnamed)";
}

function parseAttendeesSidecar(notes: string | null | undefined): { subject: string; attendees: AttendeeExtract[] } {
  const s = notes || "";
  const idx = s.indexOf(ATTENDEES_MARKER);
  if (idx === -1) return { subject: s, attendees: [] };
  const subject = s.slice(0, idx);
  const jsonPart = s.slice(idx + ATTENDEES_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed)) return { subject, attendees: cleanAttendeeList(parsed) };
  } catch { /* ignore */ }
  return { subject, attendees: [] };
}

function serialiseNotes(subject: string, attendees: AttendeeExtract[]): string {
  if (!attendees.length) return subject || "";
  return `${subject || ""}${ATTENDEES_MARKER}${JSON.stringify(attendees)}`;
}

function mergeAttendeeLists(existing: AttendeeExtract[], incoming: AttendeeExtract[]): AttendeeExtract[] {
  const out = existing.map((a) => ({ ...a }));
  for (const inc of incoming) {
    const key = normName(inc.first_name, inc.last_name);
    if (!key) continue;
    const ix = out.findIndex((a) => normName(a.first_name, a.last_name) === key);
    if (ix === -1) {
      out.push({ ...inc });
    } else {
      const cur = out[ix];
      for (const k of Object.keys(inc) as (keyof AttendeeExtract)[]) {
        if (isEmptyVal(cur[k]) && !isEmptyVal(inc[k])) (cur as any)[k] = inc[k];
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const summary: any = { scanned: 0, rsvps: 0, skipped: 0, errors: [] as string[] };

  try {
    const token = await getAccessToken(admin);
    if (!token) throw new Error("Gmail not connected");

    // Upcoming events (next 12 months)
    const { data: events } = await admin
      .from("key_events")
      .select("id,title,event_name,start_at,location,category")
      .eq("deleted_in_google", false)
      .gte("start_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .lte("start_at", new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString())
      .order("start_at", { ascending: true });

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ ok: true, summary, note: "no upcoming events" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const candidates = events.map((e: any) => ({
      id: e.id,
      title: e.event_name || e.title,
      when: e.start_at,
      location: e.location,
      category: e.category,
    }));

    // The connected mailbox IS duncan@kabuni.com, so anything in this inbox was received by Duncan
    // (via To, CC, BCC, alias or forward). We just exclude self-sent and obvious automated mail.
    // The AI matcher then strictly decides whether each email is a real RSVP.
    const q = encodeURIComponent('newer_than:30d -from:duncan@kabuni.com -in:chats -in:drafts -in:sent -category:promotions -category:social -category:updates -category:forums -from:noreply -from:no-reply -from:notifications -from:notification');
    const listUrl = `${GMAIL_API}/messages?maxResults=50&q=${q}`;
    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
    const list = await listRes.json();
    const messages = list.messages || [];
    summary.scanned = messages.length;

    for (const m of messages) {
      // ── Atomic dedup claim BEFORE any side effects ──
      // Insert a 'processing' ledger row gated by the UNIQUE(gmail_message_id)
      // constraint. If another worker (or a prior successful run) already
      // claimed this message, the insert returns a 23505 conflict and we skip
      // immediately — no Gmail fetch, no OpenAI call, no RSVP writes, no
      // outbound email. This eliminates the race window where a side effect
      // (e.g. reply send) succeeds but the post-hoc ledger insert fails,
      // causing the next cron tick to replay the same message.
      let ledgerId: string;
      {
        const { data: claim, error: claimErr } = await admin
          .from("event_rsvp_messages")
          .insert({ gmail_message_id: m.id, outcome: "processing" })
          .select("id")
          .single();
        if (claimErr || !claim) {
          // 23505 = unique_violation → already claimed by another worker /
          // prior run. Any other error → log and skip (do NOT proceed without
          // a claim, or we risk the original race condition).
          if ((claimErr as any)?.code !== "23505") {
            summary.errors.push(`claim ${m.id}: ${claimErr?.message || "unknown"}`);
          }
          summary.skipped++;
          continue;
        }
        ledgerId = claim.id;
      }

      // Best-effort finaliser for the claimed ledger row. Marks outcome and
      // attaches rsvp_id / sender / subject once known. On uncaught errors
      // below we mark the row 'failed' so it isn't infinitely replayed.
      const finalizeLedger = async (patch: Record<string, any>) => {
        try {
          await admin.from("event_rsvp_messages").update(patch).eq("id", ledgerId);
        } catch (e) {
          console.error("[process-rsvp-emails] finalizeLedger failed", e);
        }
      };

      try {


        const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
        if (!msgRes.ok) { await finalizeLedger({ outcome: "skipped_fetch_failed" }); continue; }
        const msg = await msgRes.json();
        const headers = msg.payload?.headers || [];
        const fromHdr = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "";
        const subjectHdr = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
        const messageIdHdr = headers.find((h: any) => h.name?.toLowerCase() === "message-id")?.value || "";
        const threadId = msg.threadId as string | undefined;
        const { email: senderEmail, name: senderName } = parseFromHeader(fromHdr);
        if (!senderEmail) {
          summary.skipped++;
          await finalizeLedger({ outcome: "skipped_no_sender", gmail_thread_id: threadId ?? null, subject: subjectHdr });
          continue;
        }

        const body = extractBody(msg.payload);
        const emailText = `From: ${senderName} <${senderEmail}>\nSubject: ${subjectHdr}\n\n${body}`;

        // Skip Google/Outlook calendar auto-notifications outright — these are never RSVPs
        // to planner events; they're internal meeting accept/decline pings.
        const subjLower = subjectHdr.toLowerCase();
        const isCalendarAuto =
          /^(accepted|declined|tentatively accepted|tentative|invitation|updated invitation|canceled event|cancelled event):/i.test(subjectHdr) ||
          fromHdr.toLowerCase().includes("calendar-notification@google.com");
        if (isCalendarAuto) {
          summary.skipped++;
          await finalizeLedger({ outcome: "skipped_calendar_auto", gmail_thread_id: threadId ?? null, sender_email: senderEmail, subject: subjectHdr });
          continue;
        }

        // Cheap pre-filter: only call the LLM for emails that look like RSVPs.
        const lower = `${subjectHdr}\n${body}`.toLowerCase();
        const intentHints = [
          "rsvp", "attend", "attending", "join", "register", "registration",
          "count me in", "i'll be there", "i will be there", "interested in",
          "would like to come", "want to come", "save me a seat", "sign me up",
          "confirm my", "i'm in", "confirming attendance",
        ];
        const eventHints = candidates.flatMap((c: any) => {
          const out: string[] = [];
          if (c.title) out.push(String(c.title).toLowerCase());
          if (c.location) out.push(String(c.location).toLowerCase().split(",")[0].trim());
          return out;
        });
        const looksLikeRsvp =
          intentHints.some((h) => lower.includes(h)) ||
          eventHints.some((h) => h && h.length > 3 && lower.includes(h));
        if (!looksLikeRsvp) {
          summary.skipped++;
          await finalizeLedger({ outcome: "skipped_not_rsvp", gmail_thread_id: threadId ?? null, sender_email: senderEmail, subject: subjectHdr });
          continue;
        }

        const match = await aiMatch(emailText, candidates);
        if (!match || !match.event_id || match.confidence < 0.6) {
          summary.skipped++;
          summary.errors.push(`No match for ${senderEmail} (subject: ${subjectHdr.slice(0,80)}): conf=${match?.confidence ?? "n/a"} reason=${match?.reason || "n/a"}`);
          await finalizeLedger({ outcome: "skipped_no_match", gmail_thread_id: threadId ?? null, sender_email: senderEmail, subject: subjectHdr });
          continue;
        }

        const ev = candidates.find((c: any) => c.id === match.event_id)!;
        const attendeeEmail = (match.email || senderEmail).toLowerCase();

        // Find profile by email
        const { data: profile } = await admin
          .from("profiles")
          .select("id,display_name")
          .ilike("email", attendeeEmail)
          .maybeSingle();

        const fullName = [match.first_name, match.last_name].filter(Boolean).join(" ").trim();
        const display = fullName || profile?.display_name || senderName || attendeeEmail;

        // Look for an existing RSVP in the same Gmail thread, then fall back to (event_id, email).
        let existingRsvp: any = null;
        if (threadId) {
          const { data } = await admin
            .from("event_rsvps")
            .select("*")
            .eq("gmail_thread_id", threadId)
            .maybeSingle();
          if (data) existingRsvp = data;
        }
        if (!existingRsvp) {
          const { data } = await admin
            .from("event_rsvps")
            .select("*")
            .eq("event_id", match.event_id)
            .ilike("email", attendeeEmail)
            .maybeSingle();
          if (data) existingRsvp = data;
        }

        const isFollowUp = !!existingRsvp;
        const nowIso = new Date().toISOString();
        const isEmpty = isEmptyVal;
        const mergeField = (oldVal: any, newVal: any) => (isEmpty(oldVal) && !isEmpty(newVal) ? newVal : oldVal);

        // ── Build incoming attendee list (primary + additional) ──
        const primaryAttendee: AttendeeExtract = {
          first_name: match.first_name,
          last_name: match.last_name,
          phone: match.phone,
          email: match.email ? String(match.email).toLowerCase() : attendeeEmail,
          organisation_type: match.organisation_type,
          organisation_name: match.organisation_name,
          location: match.location,
        };
        const aiList = cleanAttendeeList(match.attendees);
        // Ensure primary is first; dedupe against AI list by normalised name
        const primaryKey = normName(primaryAttendee.first_name, primaryAttendee.last_name);
        let incomingAttendees: AttendeeExtract[];
        if (!primaryKey || isFillerAttendee(primaryAttendee)) {
          incomingAttendees = aiList;
        } else {
          const rest = aiList.filter((a) => normName(a.first_name, a.last_name) !== primaryKey);
          // try to merge AI primary entry into our primary
          const aiPrimary = aiList.find((a) => normName(a.first_name, a.last_name) === primaryKey);
          if (aiPrimary) {
            for (const k of Object.keys(aiPrimary) as (keyof AttendeeExtract)[]) {
              if (isEmpty(primaryAttendee[k]) && !isEmpty(aiPrimary[k])) (primaryAttendee as any)[k] = aiPrimary[k];
            }
          }
          incomingAttendees = [primaryAttendee, ...rest];
        }

        // Attendees without an explicit email inherit the sender's email
        // (shared RSVPs: e.g. parent emails on behalf of family/colleagues).
        for (const a of incomingAttendees) {
          if (isEmpty(a.email)) a.email = attendeeEmail;
        }

        let rsvpId: string;
        const newValid = ["yes", "no", "maybe"].includes(match.status) ? match.status : null;
        // Status protection: never overwrite explicit "no" with anything other than another explicit value.
        const existingStatus: string | null = existingRsvp?.status ?? null;
        const incomingExplicit = !!match.status_explicit && !!newValid;
        let finalStatus: string;
        if (existingStatus === "no" && !incomingExplicit) {
          finalStatus = "no";
        } else if (incomingExplicit) {
          finalStatus = newValid!;
        } else {
          finalStatus = existingStatus || newValid || "yes";
        }

        // ── Merge attendees sidecar into notes ──
        const existingNotesParsed = parseAttendeesSidecar(existingRsvp?.notes);
        const existingAttendees = existingNotesParsed.attendees;
        const mergedAttendees = mergeAttendeeLists(existingAttendees, incomingAttendees);
        const notesSubjectPart = existingRsvp?.notes
          ? (existingNotesParsed.subject || subjectHdr)
          : subjectHdr;
        const finalNotes = serialiseNotes(notesSubjectPart, mergedAttendees);

        // Primary row reflects attendees[0] (the sender / primary attendee)
        const primaryRow = mergedAttendees[0] || primaryAttendee;

        if (isFollowUp) {
          const merged = {
            profile_id: existingRsvp.profile_id || profile?.id || null,
            display_name: existingRsvp.display_name || (([primaryRow.first_name, primaryRow.last_name].filter(Boolean).join(" ").trim()) || profile?.display_name || senderName || attendeeEmail),
            first_name: mergeField(existingRsvp.first_name, primaryRow.first_name),
            last_name: mergeField(existingRsvp.last_name, primaryRow.last_name),
            phone: mergeField(existingRsvp.phone, primaryRow.phone),
            organisation_type: mergeField(existingRsvp.organisation_type, primaryRow.organisation_type),
            organisation_name: mergeField(existingRsvp.organisation_name, primaryRow.organisation_name),
            state: mergeField(existingRsvp.state, primaryRow.location),
            status: finalStatus,
            notes: finalNotes,
            gmail_thread_id: existingRsvp.gmail_thread_id || threadId || null,
            last_inbound_message_id: m.id,
            follow_up_count: (existingRsvp.follow_up_count || 0) + 1,
            responded_at: nowIso,
          };
          const { error: updErr } = await admin
            .from("event_rsvps")
            .update(merged)
            .eq("id", existingRsvp.id);
          if (updErr) { summary.errors.push(`rsvp-update: ${updErr.message}`); continue; }
          rsvpId = existingRsvp.id;
        } else {
          const fullName2 = [primaryRow.first_name, primaryRow.last_name].filter(Boolean).join(" ").trim();
          const display2 = fullName2 || profile?.display_name || senderName || attendeeEmail;
          const { data: inserted, error: insErr } = await admin
            .from("event_rsvps")
            .insert({
              event_id: match.event_id,
              profile_id: profile?.id || null,
              email: attendeeEmail,
              display_name: display2,
              first_name: primaryRow.first_name,
              last_name: primaryRow.last_name,
              phone: primaryRow.phone,
              organisation_type: primaryRow.organisation_type,
              organisation_name: primaryRow.organisation_name,
              state: primaryRow.location,
              status: finalStatus,
              source: "email",
              notes: finalNotes,
              gmail_message_id: m.id,
              gmail_thread_id: threadId || null,
              last_inbound_message_id: m.id,
              follow_up_count: 0,
              responded_at: nowIso,
            })
            .select("id")
            .single();
          if (insErr || !inserted) { summary.errors.push(`rsvp-insert: ${insErr?.message || "unknown"}`); continue; }
          rsvpId = inserted.id;
        }
        summary.rsvps++;

        // Log this Gmail message in the dedup ledger so it isn't reprocessed.
        await admin.from("event_rsvp_messages").insert({
          gmail_message_id: m.id,
          gmail_thread_id: threadId || null,
          rsvp_id: rsvpId,
          sender_email: senderEmail,
          subject: subjectHdr,
          outcome: isFollowUp ? "follow_up" : "new_rsvp",
        });

        // Re-read merged row + parse attendees sidecar so missing[] reflects FINAL state.
        const { data: rsvpRow } = await admin
          .from("event_rsvps")
          .select("first_name,last_name,phone,email,organisation_type,organisation_name,state,status,notes")
          .eq("id", rsvpId)
          .single();
        const r: any = rsvpRow || {};
        const finalAttendees = parseAttendeesSidecar(r.notes).attendees;
        // Fallback: synthesise a single attendee from primary fields if sidecar is empty
        const attendeesForReply: AttendeeExtract[] = finalAttendees.length ? finalAttendees : [{
          first_name: r.first_name, last_name: r.last_name, phone: r.phone,
          email: r.email, organisation_type: r.organisation_type,
          organisation_name: r.organisation_name, location: r.state,
        }];

        // Mark as read
        await fetch(`${GMAIL_API}/messages/${m.id}/modify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        }).catch(() => {});

        // Format date in IST.
        const fmtDateIST = (iso: string) =>
          new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
        const fmtTimeIST = (iso: string) =>
          new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

        const titleLower = (ev.title || "").toLowerCase();
        const isMumbaiShowcase = titleLower.includes("kabuni showcase mumbai") || titleLower.includes("showcase mumbai");

        let schedule: { time: string; label: string }[] = [];
        let whenLabel = ev.when ? `${fmtDateIST(ev.when)} · ${fmtTimeIST(ev.when)} IST` : "TBD";
        let whereValue = ev.location || "";

        if (isMumbaiShowcase) {
          schedule = [
            { time: "12:00 – 13:00 IST", label: "Lunch" },
            { time: "13:00 – 15:00 IST", label: "Kabuni Launch (main event)" },
            { time: "15:00 – 16:00 IST", label: "High tea" },
          ];
          whenLabel = ev.when ? `${fmtDateIST(ev.when)} · 12:00 – 16:00 IST` : "Saturday, 7 June · 12:00 – 16:00 IST";
          whereValue = whereValue || "Jio Centre, Mumbai";
        }

        // ── Per-attendee completeness ──
        const completeAttendees: AttendeeExtract[] = [];
        const incompleteAttendees: { a: AttendeeExtract; missing: string[] }[] = [];
        for (const a of attendeesForReply) {
          const miss = attendeeMissing(a);
          if (miss.length === 0) completeAttendees.push(a);
          else incompleteAttendees.push({ a, missing: miss });
        }
        const allComplete = incompleteAttendees.length === 0 && attendeesForReply.length > 0;
        const isMulti = attendeesForReply.length > 1;

        // Flat missing[] (used by HTML renderer). For multi-attendee, prefix each line with attendee name.
        const missing: string[] = incompleteAttendees.flatMap(({ a, missing: ms }) =>
          isMulti ? ms.map((m) => `${displayAttendee(a)} — ${m}`) : ms.map((m) => m.charAt(0).toUpperCase() + m.slice(1))
        );

        const asciiSubject = subjectHdr.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
        const replySubject = asciiSubject.toLowerCase().startsWith("re:") ? asciiSubject : `Re: ${asciiSubject}`;
        const firstName = r.first_name || senderName?.split(" ")[0] || "there";
        const statusUpper = String(r.status || finalStatus).toUpperCase();
        const orgLabel = r.organisation_type === "school" ? "School" : r.organisation_type === "media" ? "Media" : "Company";

        const highlights: { label: string; value: string }[] = [
          { label: "Event", value: ev.title },
          { label: "When", value: whenLabel },
        ];
        if (whereValue) highlights.push({ label: "Where", value: whereValue });
        highlights.push({ label: "Status", value: statusUpper });

        if (isMulti) {
          highlights.push({ label: "Attendees", value: String(attendeesForReply.length) });
          for (const a of attendeesForReply) {
            const bits: string[] = [];
            if (a.phone) bits.push(a.phone);
            if (a.organisation_name) bits.push(a.organisation_name);
            highlights.push({ label: displayAttendee(a), value: bits.join(" · ") || "—" });
          }
        } else {
          if (r.first_name || r.last_name) highlights.push({ label: "Name", value: `${r.first_name || ""} ${r.last_name || ""}`.trim() });
          if (r.phone) highlights.push({ label: "Phone", value: r.phone });
          if (r.organisation_name) highlights.push({ label: orgLabel, value: r.organisation_name });
          if (r.state) highlights.push({ label: "Travelling from", value: r.state });
        }

        // Skip duplicate completion email
        const existingNotesAttendees = parseAttendeesSidecar(existingRsvp?.notes).attendees;
        const wasAlreadyComplete = existingRsvp
          ? (existingNotesAttendees.length
              ? existingNotesAttendees.every((a) => attendeeMissing(a).length === 0)
              : [existingRsvp.first_name, existingRsvp.last_name, existingRsvp.phone, existingRsvp.organisation_name].every((v) => !isEmpty(v)))
          : false;
        const alreadySentConfirmation = !!existingRsvp?.reply_sent_at;
        const skipSend = allComplete && wasAlreadyComplete && alreadySentConfirmation
          && existingNotesAttendees.length === attendeesForReply.length;

        if (skipSend) {
          console.log("[process-rsvp-emails] skipping duplicate completion email", { rsvp_id: rsvpId, thread_id: threadId });
          continue;
        }

        const completeListText = completeAttendees.map((a) => `• ${displayAttendee(a)}`).join("\n");
        const incompleteListText = incompleteAttendees
          .map(({ a, missing: ms }) => `• ${displayAttendee(a)} — ${ms.join(", ")}`).join("\n");

        const intro = isMulti
          ? (allComplete
              ? `Thanks — all ${attendeesForReply.length} attendees are fully registered for "${ev.title}".`
              : `Thanks for the RSVP for "${ev.title}". ${completeAttendees.length ? `${completeAttendees.length} attendee${completeAttendees.length>1?"s are":" is"} fully registered. ` : ""}We still need a few details for the others.`)
          : (isFollowUp
              ? (allComplete
                  ? `Thanks — your RSVP for "${ev.title}" is now complete. Here's what we have on file.`
                  : `Thanks for the update on your RSVP for "${ev.title}". We still need a few more details to complete your registration.`)
              : (isMumbaiShowcase
                  ? (allComplete
                      ? `We've got you down for ${ev.title} at ${whereValue} on ${whenLabel.split(" · ")[0]}. Here's the running order for the day.`
                      : `Thanks for your RSVP for ${ev.title} at ${whereValue} on ${whenLabel.split(" · ")[0]} — your status is recorded as ${statusUpper}. Here's the running order, and we just need a few more details from you.`)
                  : (allComplete
                      ? `Your RSVP for "${ev.title}" is fully confirmed. Here's what we have on file.`
                      : `Thanks for your RSVP for "${ev.title}" — your status is recorded as ${statusUpper}. We just need a few more details to complete your registration.`)));

        const greeting = allComplete
          ? (isMulti ? `You're all confirmed 🎉` : (isFollowUp ? `Thanks, ${firstName} — your RSVP is now complete` : (isMumbaiShowcase ? `You're confirmed for Kabuni Showcase Mumbai, ${firstName} 🎉` : `You're confirmed, ${firstName} 🎉`)))
          : `Thanks, ${firstName} — almost there`;

        const html = renderHtmlEmail({
          greeting,
          intro,
          highlights,
          schedule,
          missing,
          closing: allComplete ? "Looking forward to seeing you all there." : "Reply to this email with the missing details and you'll be all set.",
        });

        const scheduleText = schedule.length
          ? `\nRunning order:\n${schedule.map((s) => `  ${s.time}  —  ${s.label}`).join("\n")}\n`
          : "";
        const whereText = whereValue ? ` (${whereValue})` : "";
        const textBody = isMulti
          ? (allComplete
              ? `Hi ${firstName},\n\nAll ${attendeesForReply.length} attendees are confirmed for "${ev.title}"${whereText} on ${whenLabel} (${statusUpper}).\n\nRegistered:\n${completeListText}\n${scheduleText}\nSee you there.\n\n— Duncan`
              : `Hi ${firstName},\n\nThanks for the RSVP for "${ev.title}"${whereText} on ${whenLabel} (${statusUpper}).\n\n${completeAttendees.length ? `Fully registered:\n${completeListText}\n\n` : ""}I still need:\n${incompleteListText}\n\nJust reply to this email with the missing details.\n\n— Duncan`)
          : (allComplete
              ? `Hi ${firstName},\n\n${isFollowUp ? `Thanks — your RSVP is now complete.` : `Your RSVP for "${ev.title}"${whereText} on ${whenLabel} is confirmed (${statusUpper}).`}\n${scheduleText}\nWe have your details on file:\n- Name: ${r.first_name || ""} ${r.last_name || ""}\n- Phone: ${r.phone || "—"}\n- ${orgLabel}: ${r.organisation_name || "—"}\n- Travelling from: ${r.state || "—"}\n\nSee you there.\n\n— Duncan`
              : `Hi ${firstName},\n\nThanks. We still need the following details to complete your RSVP for "${ev.title}"${whereText}:\n${missing.map((f) => `- ${f}`).join("\n")}\n\nJust reply to this email with the details above.\n\n— Duncan`);

        const sendResult = await sendGmailReply(token, attendeeEmail, replySubject, textBody, html, threadId, messageIdHdr);
        const replyUpdate = sendResult.ok
          ? { reply_sent_at: new Date().toISOString(), reply_message_id: sendResult.messageId ?? null, reply_error: null }
          : { reply_error: (sendResult.error ?? `HTTP ${sendResult.status}`).slice(0, 2000) };
        const { error: replyUpdErr } = await admin
          .from("event_rsvps")
          .update(replyUpdate)
          .eq("id", rsvpId);
        if (replyUpdErr) {
          console.error("[process-rsvp-emails] failed to persist reply status", { rsvp_id: rsvpId, error: replyUpdErr.message });
          summary.errors.push(`reply-status-update: ${replyUpdErr.message}`);
        }
        if (!sendResult.ok) {
          summary.errors.push(`gmail-send ${attendeeEmail}: ${sendResult.error}`);
        }


      } catch (e) {
        summary.errors.push(String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-rsvp-emails error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e), summary }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
