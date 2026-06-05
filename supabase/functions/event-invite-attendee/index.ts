// Add an attendee manually to a key event and email them an RSVP request
// from duncan@kabuni.com. Reuses the same Gmail mailbox + thread pattern as
// process-rsvp-emails, so when the attendee replies, the existing scanner
// upserts their RSVP into the same row (event_id+email unique constraint).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const RSVP_MAILBOX = "duncan@kabuni.com";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function encodeRfc2822Html(to: string, subject: string, text: string, html: string): string {
  const boundary = `=_dunc_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: "Duncan" <${RSVP_MAILBOX}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ];
  return btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(admin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const { data } = await admin
    .from("gmail_tokens")
    .select("*")
    .ilike("email_address", RSVP_MAILBOX)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry) > new Date()) return data.access_token;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refresh_token,
      grant_type: "refresh_token",
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

function buildEmail(opts: {
  firstName: string | null;
  eventTitle: string;
  eventWhen: string | null;
  eventLocation: string | null;
  inviterName: string | null;
}): { subject: string; text: string; html: string } {
  const { firstName, eventTitle, eventWhen, eventLocation, inviterName } = opts;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const inviteLine = inviterName
    ? `${inviterName} from Kabuni has invited you to ${eventTitle}.`
    : `You're invited to ${eventTitle}.`;

  const detailRows = [
    eventWhen ? { label: "When", value: eventWhen } : null,
    eventLocation ? { label: "Where", value: eventLocation } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  const subject = `RSVP — ${eventTitle}`;

  const text = [
    greeting,
    "",
    inviteLine,
    ...(eventWhen ? [`When: ${eventWhen}`] : []),
    ...(eventLocation ? [`Where: ${eventLocation}`] : []),
    "",
    "Please reply to this email with:",
    "  • Yes / Maybe / No",
    "  • First name",
    "  • Last name",
    "  • Phone (with country code)",
    "  • School / media / company name",
    "  • City / region",
    "",
    "— Duncan",
    "Operational intelligence · Kabuni",
  ].join("\n");

  const detailHtml = detailRows.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:18px 0 0;">
        ${detailRows.map((d) => `<tr>
          <td style="padding:10px 0;color:#6b7280;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:500;">${escapeHtml(d.value)}</td>
        </tr>`).join("")}
      </table>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:28px 32px 0;">
          <div style="display:inline-block;padding:6px 12px;background:#111827;color:#fff;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Duncan · Kabuni</div>
        </td></tr>
        <tr><td style="padding:20px 32px 8px;">
          <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#111827;font-weight:600;">${escapeHtml(greeting)}</h1>
          <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.6;">${escapeHtml(inviteLine)}</p>
          ${detailHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 0;">
          <div style="padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;color:#111827;font-size:14px;line-height:1.6;">
            <div style="font-weight:600;margin-bottom:6px;">Please reply with:</div>
            <ul style="margin:0;padding-left:18px;color:#374151;">
              <li>Yes / Maybe / No</li>
              <li>First name &amp; last name</li>
              <li>Phone (with country code)</li>
              <li>School / media / company name</li>
              <li>City / region</li>
            </ul>
          </div>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;">
          <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">Hit reply and Duncan will take care of the rest.</p>
          <p style="margin:18px 0 0;color:#111827;font-size:14px;font-weight:600;">— Duncan</p>
          <p style="margin:2px 0 0;color:#9ca3af;font-size:12px;">Operational intelligence · Kabuni</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

function formatWhen(startAt: string | null, allDay: boolean, tz: string): string | null {
  if (!startAt) return null;
  try {
    const d = new Date(startAt);
    if (allDay) {
      return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });
    }
    return d.toLocaleString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short",
    });
  } catch { return startAt; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Identify the caller (for inviter name)
  const authHeader = req.headers.get("Authorization") || "";
  let inviterName: string | null = null;
  try {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (u?.user) {
      const { data: p } = await admin.from("profiles").select("display_name").eq("user_id", u.user.id).maybeSingle();
      inviterName = p?.display_name ?? u.user.email ?? null;
    }
  } catch { /* ignore */ }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventId = String(body?.event_id || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const firstName = body?.first_name ? String(body.first_name).trim() : null;
  const lastName = body?.last_name ? String(body.last_name).trim() : null;

  if (!eventId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "event_id and valid email required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load event
  const { data: event, error: evErr } = await admin
    .from("key_events")
    .select("id, title, start_at, all_day, location, start_tz")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr || !event) {
    return new Response(JSON.stringify({ error: "event_not_found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get mailbox token
  const token = await getAccessToken(admin);
  if (!token) {
    return new Response(JSON.stringify({ error: "duncan_mailbox_not_connected" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build & send the invite
  const { subject, text, html } = buildEmail({
    firstName,
    eventTitle: event.title,
    eventWhen: formatWhen(event.start_at, event.all_day, event.start_tz || "Europe/London"),
    eventLocation: event.location ?? null,
    inviterName,
  });

  const raw = encodeRfc2822Html(email, subject, text, html);
  const sendRes = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const sendBody = await sendRes.text();
  if (!sendRes.ok) {
    console.error("[event-invite-attendee] gmail send failed", sendRes.status, sendBody);
    return new Response(JSON.stringify({ error: "gmail_send_failed", detail: sendBody }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let sent: any = {};
  try { sent = JSON.parse(sendBody); } catch { /* ignore */ }

  // Upsert RSVP row so the attendee shows immediately in the panel.
  // Default to "maybe" (pending) with source="invited" until they reply.
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || null;
  const { error: upErr } = await admin
    .from("event_rsvps")
    .upsert({
      event_id: eventId,
      email,
      display_name: displayName,
      first_name: firstName,
      last_name: lastName,
      status: "maybe",
      source: "invited",
      gmail_thread_id: sent.threadId ?? null,
      reply_sent_at: new Date().toISOString(),
      reply_message_id: sent.id ?? null,
      notes: `Invited by ${inviterName || "Duncan"} on ${new Date().toISOString().slice(0, 10)}.`,
    }, { onConflict: "event_id,email" });

  if (upErr) {
    console.error("[event-invite-attendee] rsvp upsert failed", upErr);
    return new Response(JSON.stringify({ ok: true, warning: "invite_sent_but_rsvp_upsert_failed", detail: upErr.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    message_id: sent.id ?? null,
    thread_id: sent.threadId ?? null,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
