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

async function aiMatch(emailText: string, candidates: any[]): Promise<{
  event_id: string | null;
  status: string;
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
} | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const sys = `You decide whether an inbound email is a clear RSVP for one of the listed events, and extract attendee details. Events can be anywhere in the world — do NOT assume any specific country. Return STRICT JSON:
{
  "event_id": "<uuid of the event the sender is RSVPing to, or null>",
  "status": "yes|no|maybe",
  "confidence": 0-1,
  "reason": "short",
  "first_name": "<string or null>",
  "last_name": "<string or null>",
  "phone": "<full international format e.g. +447700900000 or null>",
  "email": "<best email for the attendee or null>",
  "organisation_type": "school|media|company|other or null",
  "organisation_name": "<string or null>",
  "location": "<city, region or country the attendee is travelling from, or null>",
  "missing_fields": ["any of: first_name,last_name,phone,email,organisation_type,organisation_name,location"]
}

STRICT RULES — set event_id to null and confidence < 0.5 unless ALL of these are true:
1. The email is an inbound RSVP request or response addressed to the recipient (duncan@kabuni.com). Auto-generated calendar accept/decline notifications from Google Calendar / Outlook are NOT RSVPs — return null for those.
2. The sender is RSVPing for THEMSELVES with explicit attendance intent (yes/no/maybe — e.g. "I'd like to attend", "count me in", "I won't make it", "tentative", "RSVP yes").
3. The email clearly identifies ONE specific event from the candidate list — by event name, by date (e.g. "7 June", "June 7th"), or by city/location. If ambiguous, return null.

Discussion, planning, logistics, internal calendar invites, or generic greetings are NOT RSVPs — return null.

Match events by name/date/location ONLY. Never reject an event because of its country. Always normalise phone to +<country code><number> with no spaces. Map school/college/university => school; news/tv/journalist/press => media; brand/corp/firm/startup => company.`;
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
      try {
        // Skip if already processed
        const { data: existing } = await admin.from("event_rsvps").select("id").eq("gmail_message_id", m.id).maybeSingle();
        if (existing) { summary.skipped++; continue; }

        const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
        if (!msgRes.ok) continue;
        const msg = await msgRes.json();
        const headers = msg.payload?.headers || [];
        const fromHdr = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "";
        const subjectHdr = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
        const messageIdHdr = headers.find((h: any) => h.name?.toLowerCase() === "message-id")?.value || "";
        const threadId = msg.threadId as string | undefined;
        const { email: senderEmail, name: senderName } = parseFromHeader(fromHdr);
        if (!senderEmail) { summary.skipped++; continue; }

        const body = extractBody(msg.payload);
        const emailText = `From: ${senderName} <${senderEmail}>\nSubject: ${subjectHdr}\n\n${body}`;

        // Skip Google/Outlook calendar auto-notifications outright — these are never RSVPs
        // to planner events; they're internal meeting accept/decline pings.
        const subjLower = subjectHdr.toLowerCase();
        const isCalendarAuto =
          /^(accepted|declined|tentatively accepted|tentative|invitation|updated invitation|canceled event|cancelled event):/i.test(subjectHdr) ||
          fromHdr.toLowerCase().includes("calendar-notification@google.com");
        if (isCalendarAuto) { summary.skipped++; continue; }

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
        if (!looksLikeRsvp) { summary.skipped++; continue; }

        const match = await aiMatch(emailText, candidates);
        if (!match || !match.event_id || match.confidence < 0.6) {
          summary.skipped++;
          summary.errors.push(`No match for ${senderEmail} (subject: ${subjectHdr.slice(0,80)}): conf=${match?.confidence ?? "n/a"} reason=${match?.reason || "n/a"}`);
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

        const { error: upErr } = await admin.from("event_rsvps").upsert({
          event_id: match.event_id,
          profile_id: profile?.id || null,
          email: attendeeEmail,
          display_name: display,
          first_name: match.first_name,
          last_name: match.last_name,
          phone: match.phone,
          organisation_type: match.organisation_type,
          organisation_name: match.organisation_name,
          state: match.location,
          status: ["yes", "no", "maybe"].includes(match.status) ? match.status : "yes",
          source: "email",
          notes: subjectHdr,
          gmail_message_id: m.id,
          responded_at: new Date().toISOString(),
        }, { onConflict: "gmail_message_id" });

        if (upErr) { summary.errors.push(upErr.message); continue; }
        summary.rsvps++;

        // Mark as read
        await fetch(`${GMAIL_API}/messages/${m.id}/modify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        }).catch(() => {});

        // Format date in IST. No UK time anywhere.
        const fmtDateIST = (iso: string) =>
          new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
        const fmtTimeIST = (iso: string) =>
          new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

        const titleLower = (ev.title || "").toLowerCase();
        const isMumbaiShowcase = titleLower.includes("kabuni showcase mumbai") || titleLower.includes("showcase mumbai");

        // Per-event schedule. Mumbai showcase has a fixed running order in IST.
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

        // Required fields and what's missing
        const missing: string[] = [];
        if (!match.first_name) missing.push("First name");
        if (!match.last_name) missing.push("Last name");
        if (!match.phone) missing.push("Phone (with country code, e.g. +91…)");
        if (!attendeeEmail) missing.push("Email address");
        if (!match.organisation_type) missing.push("School / Media / Company");
        if (!match.organisation_name) missing.push("Organisation name");
        if (!match.location) missing.push("City / region you're travelling from");

        // Email reply: confirmation or request for missing details
        const replySubject = subjectHdr.toLowerCase().startsWith("re:") ? subjectHdr : `Re: ${subjectHdr}`;
        const firstName = match.first_name || senderName?.split(" ")[0] || "there";
        const statusUpper = match.status.toUpperCase();
        const orgLabel = match.organisation_type === "school" ? "School" : match.organisation_type === "media" ? "Media" : "Company";

        const highlights: { label: string; value: string }[] = [
          { label: "Event", value: ev.title },
          { label: "When", value: whenLabel },
        ];
        if (whereValue) highlights.push({ label: "Where", value: whereValue });
        highlights.push({ label: "Status", value: statusUpper });
        if (match.first_name || match.last_name) highlights.push({ label: "Name", value: `${match.first_name || ""} ${match.last_name || ""}`.trim() });
        if (match.phone) highlights.push({ label: "Phone", value: match.phone });
        if (match.organisation_name) highlights.push({ label: orgLabel, value: match.organisation_name });
        if (match.location) highlights.push({ label: "Travelling from", value: match.location });

        const intro = isMumbaiShowcase
          ? (missing.length === 0
              ? `We've got you down for ${ev.title} at ${whereValue} on ${whenLabel.split(" · ")[0]}. Here's the running order for the day.`
              : `Thanks for your RSVP for ${ev.title} at ${whereValue} on ${whenLabel.split(" · ")[0]} — your status is recorded as ${statusUpper}. Here's the running order, and we just need a few more details from you.`)
          : (missing.length === 0
              ? `Your RSVP for "${ev.title}" is fully confirmed. Here's what we have on file.`
              : `Thanks for your RSVP for "${ev.title}" — your status is recorded as ${statusUpper}. We just need a few more details to complete your registration.`);

        const greeting = missing.length === 0
          ? (isMumbaiShowcase ? `You're confirmed for Kabuni Showcase Mumbai, ${firstName} 🎉` : `You're confirmed, ${firstName} 🎉`)
          : `Thanks, ${firstName} — almost there`;

        const html = renderHtmlEmail({
          greeting,
          intro,
          highlights,
          schedule,
          missing,
          closing: missing.length === 0 ? "Looking forward to seeing you there." : "Reply to this email with the missing details and you'll be all set.",
        });

        const scheduleText = schedule.length
          ? `\nRunning order:\n${schedule.map((s) => `  ${s.time}  —  ${s.label}`).join("\n")}\n`
          : "";
        const whereText = whereValue ? ` (${whereValue})` : "";
        const textBody = missing.length === 0
          ? `Hi ${firstName},\n\nYour RSVP for "${ev.title}"${whereText} on ${whenLabel} is confirmed (${statusUpper}).\n${scheduleText}\nWe have your details on file:\n- Name: ${match.first_name || ""} ${match.last_name || ""}\n- Phone: ${match.phone || "—"}\n- ${orgLabel}: ${match.organisation_name || "—"}\n- Travelling from: ${match.location || "—"}\n\nSee you there.\n\n— Duncan`
          : `Hi ${firstName},\n\nThanks for your RSVP for "${ev.title}"${whereText} on ${whenLabel}. Status recorded: ${statusUpper}.\n${scheduleText}\nTo complete your registration, please reply with the following details:\n${missing.map((f) => `- ${f}`).join("\n")}\n\n— Duncan`;

        await sendGmailReply(token, attendeeEmail, replySubject, textBody, html, threadId, messageIdHdr);

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
