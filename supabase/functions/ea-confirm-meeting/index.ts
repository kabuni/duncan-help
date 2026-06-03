// EA Mode — admin action: confirm a proposed slot (creates GCal event + sends
// confirmation email) or decline a request.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NIMESH_USER_ID = "517bf518-6111-41b8-9ff0-1249f3055ec7";
const NIMESH_EMAIL = "nimesh@kabuni.com";

async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`token refresh failed: ${await r.text()}`);
  return await r.json();
}

async function getDuncanGmailAccess(supa: any) {
  const { data: row } = await supa.from("duncan_gmail_tokens").select("*").limit(1).maybeSingle();
  if (!row) throw new Error("Duncan Gmail not connected");
  if (new Date(row.token_expiry).getTime() - Date.now() > 60_000) return row.access_token;
  const refreshed = await refreshGoogleToken(
    row.refresh_token,
    Deno.env.get("GMAIL_CLIENT_ID")!, Deno.env.get("GMAIL_CLIENT_SECRET")!,
  );
  await supa.from("duncan_gmail_tokens")
    .update({ access_token: refreshed.access_token,
              token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() })
    .eq("id", row.id);
  return refreshed.access_token;
}

async function getNimeshCalendarAccess(supa: any) {
  const { data: row } = await supa.from("google_calendar_tokens")
    .select("*").eq("user_id", NIMESH_USER_ID).maybeSingle();
  if (!row) throw new Error("Nimesh calendar not connected");
  if (new Date(row.token_expiry).getTime() - Date.now() > 60_000) return row.access_token;
  const refreshed = await refreshGoogleToken(
    row.refresh_token,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
  );
  await supa.from("google_calendar_tokens")
    .update({ access_token: refreshed.access_token,
              token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() })
    .eq("user_id", NIMESH_USER_ID);
  return refreshed.access_token;
}

function b64urlEncode(s: string) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fmtLondon(iso: string) {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-GB",
      { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(d),
    time: new Intl.DateTimeFormat("en-GB",
      { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const supaUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await supaUser.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const supa = createClient(supabaseUrl, svcKey);
  const { data: roles } = await supa.from("user_roles").select("role").eq("user_id", user.id);
  if (!(roles ?? []).some((r: any) => r.role === "admin")) {
    return new Response(JSON.stringify({ error: "Admin only" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { request_id, action, override_start, override_end } = body || {};
  if (!request_id || !["approve", "decline"].includes(action)) {
    return new Response(JSON.stringify({ error: "request_id and action (approve|decline) required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: row, error } = await supa
    .from("meeting_requests").select("*").eq("id", request_id).maybeSingle();
  if (error || !row) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
  }

  try {
    if (action === "decline") {
      await supa.from("meeting_requests").update({ status: "declined" }).eq("id", request_id);
      return new Response(JSON.stringify({ ok: true, status: "declined" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Approve path
    const startIso = override_start || row.proposed_slot;
    const endIso = override_end || row.proposed_slot_end;
    if (!startIso || !endIso) throw new Error("No slot to confirm");

    const gmailToken = await getDuncanGmailAccess(supa);
    const calToken = await getNimeshCalendarAccess(supa);

    const purpose = row.purpose || "Meeting";
    const eventRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${calToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `${purpose} – ${row.sender_name}`,
          description: `${row.original_email_body}\n\n—\nPriority: ${row.priority} — ${row.priority_reason ?? ""}`,
          start: { dateTime: startIso, timeZone: "Europe/London" },
          end:   { dateTime: endIso,   timeZone: "Europe/London" },
          attendees: [{ email: NIMESH_EMAIL }, { email: row.sender_email }],
          conferenceData: {
            createRequest: { requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" } },
          },
        }),
      },
    );
    if (!eventRes.ok) throw new Error(`Calendar create ${eventRes.status}: ${await eventRes.text()}`);
    const event = await eventRes.json();

    const f = fmtLondon(startIso);
    const firstName = row.sender_name.split(" ")[0] || "there";
    const confirmBody =
`Hi ${firstName},

Great news — I've found a slot for your meeting with Nimesh.

📅 ${f.day}
⏰ ${f.time} (UK Time)
📍 Google Meet (invite to follow)

Topic: ${purpose}

Please let me know if you need to reschedule.

Best,
Duncan (EA for Nimesh Patel)`;

    const headers = [
      `To: ${row.sender_email}`,
      `Subject: Meeting Confirmed – Nimesh Patel | ${f.day}, ${f.time}`,
      'Content-Type: text/plain; charset="UTF-8"',
      `In-Reply-To: ${row.gmail_message_id ?? ""}`,
      `References: ${row.gmail_message_id ?? ""}`,
    ].filter(h => !h.endsWith(": ")).join("\r\n");
    const raw = btoa(unescape(encodeURIComponent(headers + "\r\n\r\n" + confirmBody)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const mailRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${gmailToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw, threadId: row.gmail_thread_id }),
    });
    if (!mailRes.ok) console.warn("send confirm email failed", await mailRes.text());

    await supa.from("meeting_requests").update({
      status: "confirmed",
      calendar_event_id: event.id,
      proposed_slot: startIso,
      proposed_slot_end: endIso,
    }).eq("id", request_id);

    return new Response(JSON.stringify({ ok: true, status: "confirmed", event_id: event.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("ea-confirm-meeting error", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
