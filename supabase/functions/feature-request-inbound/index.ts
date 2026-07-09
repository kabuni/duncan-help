// Poll Duncan's Gmail for replies on tracked feature-request threads.
// For each request in 'clarifying' state with an email_thread_id, fetch the
// thread, ingest any new inbound messages (from the requester), and hand off
// to feature-request-agent for a fresh triage decision.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const results = await pollAll();
    return json({ ok: true, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("feature-request-inbound error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pollAll() {
  const { data: reqs } = await admin
    .from("feature_requests")
    .select("id, user_email, email_thread_id, triage_status")
    .eq("triage_status", "clarifying")
    .not("email_thread_id", "is", null)
    .limit(50);

  if (!reqs?.length) return [];

  const token = await getGmailToken();
  if (!token) throw new Error("no Duncan Gmail token");

  const out: unknown[] = [];
  for (const r of reqs as any[]) {
    try {
      const ingested = await ingestThread(r, token);
      if (ingested.newMessages > 0) {
        // Kick off triage re-run
        await admin.functions.invoke("feature-request-agent", {
          body: { feature_request_id: r.id },
        });
      }
      out.push({ id: r.id, ...ingested });
    } catch (e) {
      out.push({ id: r.id, error: (e as Error).message });
    }
  }
  return out;
}

async function ingestThread(r: any, token: string) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(r.email_thread_id)}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    if (res.status === 404) return { newMessages: 0, note: "thread gone" };
    throw new Error(`gmail thread fetch [${res.status}]`);
  }
  const thread = await res.json();
  const messages: any[] = thread.messages ?? [];
  if (!messages.length) return { newMessages: 0 };

  const { data: known } = await admin
    .from("feature_request_messages")
    .select("gmail_message_id")
    .eq("feature_request_id", r.id)
    .not("gmail_message_id", "is", null);
  const knownIds = new Set((known ?? []).map((m: any) => m.gmail_message_id));

  const requesterAddr = (r.user_email ?? "").toLowerCase();
  let inserted = 0;
  for (const m of messages) {
    if (knownIds.has(m.id)) continue;
    const headers: any[] = m.payload?.headers ?? [];
    const fromHeader = (headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "").toLowerCase();
    if (!fromHeader.includes(requesterAddr)) continue; // only inbound from requester
    const body = extractBody(m.payload);
    await admin.from("feature_request_messages").insert({
      feature_request_id: r.id,
      role: "user",
      channel: "email",
      body: body.slice(0, 8000),
      gmail_message_id: m.id,
      gmail_thread_id: m.threadId ?? r.email_thread_id,
    });
    inserted += 1;
  }
  return { newMessages: inserted };
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return decode(payload.body.data);
  const parts: any[] = payload.parts ?? [];
  // Prefer text/plain, fall back to text/html stripped.
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decode(plain.body.data);
  for (const p of parts) {
    const nested = extractBody(p);
    if (nested) return nested;
  }
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html) return decode(html.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function decode(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    try { return atob(b64); } catch { return ""; }
  }
}

async function getGmailToken(): Promise<string | null> {
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("email_address", "duncan@kabuni.com")
    .maybeSingle();
  if (!row) return null;
  const expiry = new Date((row as any).token_expiry);
  if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: (row as any).refresh_token,
        client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
        client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.error("gmail refresh failed", await res.text());
      return null;
    }
    const refreshed = await res.json();
    await admin
      .from("gmail_tokens")
      .update({
        access_token: refreshed.access_token,
        token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("id", (row as any).id);
    return refreshed.access_token;
  }
  return (row as any).access_token;
}
