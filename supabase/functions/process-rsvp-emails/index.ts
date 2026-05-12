import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";

async function getAccessToken(admin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const { data } = await admin.from("gmail_tokens").select("*").limit(1).maybeSingle();
  if (!data) return null;
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

function encodeRfc2822(to: string, subject: string, body: string, inReplyTo?: string, references?: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendGmailReply(token: string, to: string, subject: string, body: string, threadId?: string, inReplyTo?: string) {
  try {
    const raw = encodeRfc2822(to, subject, body, inReplyTo, inReplyTo);
    await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    });
  } catch (e) { console.error("gmail send error", e); }
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
  state: string | null;
  missing_fields: string[];
} | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const sys = `You parse an inbound RSVP email for an event in India and return STRICT JSON:
{
  "event_id": "<uuid of matched event or null>",
  "status": "yes|no|maybe",
  "confidence": 0-1,
  "reason": "short",
  "first_name": "<string or null>",
  "last_name": "<string or null>",
  "phone": "<full international format e.g. +919812345678 or null>",
  "email": "<best email for the attendee or null>",
  "organisation_type": "school|media|company|other or null",
  "organisation_name": "<string or null>",
  "state": "<Indian state name (e.g. Maharashtra) or null>",
  "missing_fields": ["list of any of: first_name,last_name,phone,email,organisation_type,organisation_name,state that are missing"]
}
Use null event_id if no clear match. Always normalise phone to +<country code><number> with no spaces. Map school/college/university => school, news/tv/journalist/press => media, brand/corp/firm/startup => company.`;
  const user = `Email:\n${emailText.slice(0, 4000)}\n\nCandidate events (JSON):\n${JSON.stringify(candidates)}`;
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

    // Only scan emails addressed TO duncan@kabuni.com (not other inboxes/aliases),
    // and exclude anything Duncan itself sent. AI then decides if it's an RSVP.
    const q = encodeURIComponent('newer_than:30d to:duncan@kabuni.com -from:duncan@kabuni.com -in:chats -in:drafts -in:sent -category:promotions -category:social -category:updates -category:forums -from:noreply -from:no-reply -from:notifications -from:notification');
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
        if (!match || !match.event_id || match.confidence < 0.55) {
          summary.skipped++;
          summary.errors.push(`No match for ${senderEmail}: ${match?.reason || "n/a"}`);
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
          state: match.state,
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

        const when = ev.when ? new Date(ev.when).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" : "TBD";
        const where = ev.location ? ` (${ev.location})` : "";

        // Required fields and what's missing
        const missing: string[] = [];
        if (!match.first_name) missing.push("First name");
        if (!match.last_name) missing.push("Last name");
        if (!match.phone) missing.push("Phone (with country code, e.g. +91…)");
        if (!attendeeEmail) missing.push("Email address");
        if (!match.organisation_type) missing.push("School / Media / Company");
        if (!match.organisation_name) missing.push("Organisation name");
        if (!match.state) missing.push("State in India");

        // Email reply: confirmation or request for missing details
        const replySubject = subjectHdr.toLowerCase().startsWith("re:") ? subjectHdr : `Re: ${subjectHdr}`;
        const replyBody = missing.length === 0
          ? `Hi ${match.first_name || senderName || "there"},\n\nYour RSVP for "${ev.title}"${where} on ${when} is confirmed (${match.status.toUpperCase()}).\n\nWe have your details on file:\n- Name: ${match.first_name} ${match.last_name}\n- Phone: ${match.phone}\n- ${match.organisation_type === "school" ? "School" : match.organisation_type === "media" ? "Media" : "Company"}: ${match.organisation_name}\n- State: ${match.state}\n\nSee you there.\n\n— Duncan`
          : `Hi ${match.first_name || senderName || "there"},\n\nThanks for your RSVP for "${ev.title}"${where} on ${when}. Status recorded: ${match.status.toUpperCase()}.\n\nTo complete your registration, please reply with the following details:\n${missing.map((f) => `- ${f}`).join("\n")}\n\n— Duncan`;
        await sendGmailReply(token, attendeeEmail, replySubject, replyBody, threadId, messageIdHdr);

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
