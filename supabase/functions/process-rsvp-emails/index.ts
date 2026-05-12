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

async function aiMatch(emailText: string, candidates: any[]): Promise<{ event_id: string | null; status: string; confidence: number; reason: string } | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const sys = `You match an inbound RSVP email to one upcoming event. Return STRICT JSON: {"event_id":"<uuid or null>","status":"yes|no|maybe","confidence":0-1,"reason":"short"}. Use null event_id if no clear match.`;
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

    // Search for RSVP-style emails (last 30 days, unread)
    const q = encodeURIComponent('newer_than:30d (subject:RSVP OR subject:attend OR subject:attending OR "want to attend" OR "would like to attend" OR "I will attend" OR "count me in" OR "I\'ll be there")');
    const listUrl = `${GMAIL_API}/messages?maxResults=25&q=${q}`;
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
        const { email: senderEmail, name: senderName } = parseFromHeader(fromHdr);
        if (!senderEmail) { summary.skipped++; continue; }

        const body = extractBody(msg.payload);
        const emailText = `From: ${senderName} <${senderEmail}>\nSubject: ${subjectHdr}\n\n${body}`;

        const match = await aiMatch(emailText, candidates);
        if (!match || !match.event_id || match.confidence < 0.55) {
          summary.skipped++;
          summary.errors.push(`No match for ${senderEmail}: ${match?.reason || "n/a"}`);
          continue;
        }

        // Find profile by email
        const { data: profile } = await admin
          .from("profiles")
          .select("id,display_name")
          .ilike("email", senderEmail)
          .maybeSingle();

        const display = profile?.display_name || senderName || senderEmail;

        const { error: upErr } = await admin.from("event_rsvps").upsert({
          event_id: match.event_id,
          profile_id: profile?.id || null,
          email: senderEmail,
          display_name: display,
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

        // Slack DM confirmation
        if (profile?.id) {
          const { data: map } = await admin
            .from("user_notification_mappings")
            .select("slack_user_identifier,is_active")
            .eq("duncan_user_id", profile.id)
            .maybeSingle();
          if (map?.is_active && map.slack_user_identifier) {
            const ev = candidates.find((c: any) => c.id === match.event_id)!;
            const when = ev.when ? new Date(ev.when).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "TBD";
            const where = ev.location ? ` (${ev.location})` : "";
            await sendSlackDM(
              map.slack_user_identifier,
              `:calendar: RSVP recorded — *${ev.title}*${where} on ${when}.\nStatus: *${match.status.toUpperCase()}*\n${APP_URL}/diary?event=${match.event_id}`
            );
          }
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
