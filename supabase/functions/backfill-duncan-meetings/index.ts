// Backfill all meeting notes from Duncan's mailbox into the meetings table.
// Broader catchment than fetch-plaud-meetings: no newer_than cap, full Gmail
// pagination, and recognises Plaud, Gemini/Google Meet, Otter, Fireflies,
// Read.ai, plus generic "meeting notes / summary / recap / transcript" subjects.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DUNCAN_EMAIL = "duncan@kabuni.com";

// Broad Gmail query — no newer_than so we sweep the full history.
const GMAIL_QUERY = [
  '(from:plaud OR from:noreply@plaud.ai OR subject:"invited you to view"',
  'OR from:gemini-notes@google.com OR subject:"notes -"',
  'OR from:noreply@otter.ai OR from:fireflies.ai OR from:read.ai',
  'OR subject:"meeting notes" OR subject:"meeting summary"',
  'OR subject:"meeting recap" OR subject:"meeting transcript"',
  'OR subject:"meeting minutes")',
].join(" ");

function base64UrlDecode(data: string): Uint8Array {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

function extractPlainTextBody(payload: any): string {
  if (payload?.mimeType === "text/plain" && payload.body?.data) {
    return new TextDecoder().decode(base64UrlDecode(payload.body.data));
  }
  if (payload?.parts) {
    for (const part of payload.parts) {
      const text = extractPlainTextBody(part);
      if (text) return text;
    }
  }
  if (payload?.mimeType === "text/html" && payload.body?.data) {
    return new TextDecoder().decode(base64UrlDecode(payload.body.data))
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function extractSenderEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

function extractEmailList(headerVal: string): string[] {
  if (!headerVal) return [];
  return headerVal.split(",").map((part) => {
    const m = part.match(/<([^>]+)>/);
    return (m ? m[1] : part).trim().toLowerCase();
  }).filter((e) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e));
}

function classifySource(subject: string, sender: string): string {
  const s = (subject || "").toLowerCase();
  const f = (sender || "").toLowerCase();
  if (f.includes("plaud") || s.includes("plaud") || s.includes("invited you to view")) return "plaud";
  if (f.includes("gemini-notes") || s.startsWith("notes -")) return "google_meet";
  if (f.includes("otter.ai")) return "otter";
  if (f.includes("fireflies")) return "fireflies";
  if (f.includes("read.ai")) return "read_ai";
  return "email_notes";
}

async function getGmailAccessToken(supabaseAdmin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.error("Missing GMAIL_CLIENT_ID/SECRET");
    return null;
  }

  const { data: tokenData, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", DUNCAN_EMAIL)
    .maybeSingle();
  if (error || !tokenData) {
    console.error("No gmail_tokens row for", DUNCAN_EMAIL, error);
    return null;
  }

  if (new Date(tokenData.token_expiry) <= new Date()) {
    const refreshRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!refreshRes.ok) {
      console.error("Gmail token refresh failed:", await refreshRes.text());
      return null;
    }
    const newTokens = await refreshRes.json();
    const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000);
    await supabaseAdmin
      .from("gmail_tokens")
      .update({ access_token: newTokens.access_token, token_expiry: newExpiry.toISOString() })
      .eq("id", tokenData.id);
    return newTokens.access_token;
  }
  return tokenData.access_token;
}

async function runBackfill(supabaseAdmin: any, requestingUserId: string | null) {
  const gmailToken = await getGmailAccessToken(supabaseAdmin);
  if (!gmailToken) {
    console.error("[backfill] no gmail token; aborting");
    return;
  }
  const headers = { Authorization: `Bearer ${gmailToken}` };

  let pageToken: string | undefined;
  let pages = 0;
  let totalSeen = 0;
  let inserted = 0;
  let skipped = 0;
  const insertedIds: string[] = [];

  do {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set("q", GMAIL_QUERY);
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.error("[backfill] gmail list failed", res.status, await res.text());
      break;
    }
    const data = await res.json();
    const messages: any[] = data.messages || [];
    totalSeen += messages.length;
    pageToken = data.nextPageToken;
    pages++;
    console.log(`[backfill] page ${pages} — ${messages.length} msgs (total seen ${totalSeen})`);

    // Bulk-dedupe: pre-check which ids already exist
    const ids = messages.map((m) => m.id);
    let existingSet = new Set<string>();
    if (ids.length) {
      const { data: existing } = await supabaseAdmin
        .from("meetings")
        .select("gmail_message_id")
        .in("gmail_message_id", ids);
      existingSet = new Set((existing || []).map((r: any) => r.gmail_message_id));
    }

    for (const msg of messages) {
      if (existingSet.has(msg.id)) { skipped++; continue; }

      try {
        const msgRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, { headers });
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();

        const hdrs = msgData.payload?.headers || [];
        const get = (n: string) => hdrs.find((h: any) => h.name.toLowerCase() === n)?.value || "";
        const subject = get("subject");
        const from = get("from");
        const to = get("to");
        const cc = get("cc");
        const dateHeader = get("date");

        const senderEmail = extractSenderEmail(from);
        const attendeeEmails = Array.from(new Set([
          ...extractEmailList(to),
          ...extractEmailList(cc),
        ]));

        const bodyText = extractPlainTextBody(msgData.payload);
        let meetingDate: string;
        try { meetingDate = new Date(dateHeader).toISOString(); }
        catch { meetingDate = new Date().toISOString(); }

        const source = classifySource(subject, senderEmail);
        const title = subject || `Meeting notes — ${new Date(meetingDate).toISOString().slice(0, 10)}`;
        const transcript = (bodyText || "").slice(0, 200000);

        const { data: inserted_row, error: insertErr } = await supabaseAdmin
          .from("meetings")
          .insert({
            title,
            meeting_date: meetingDate,
            transcript: transcript || null,
            gmail_message_id: msg.id,
            email_subject: subject,
            sender_email: senderEmail,
            attendee_emails: attendeeEmails.length ? attendeeEmails : null,
            source,
            status: transcript ? "transcribed" : "pending",
            fetched_by: requestingUserId,
          })
          .select("id")
          .single();
        if (insertErr) {
          console.error(`[backfill] insert failed for ${msg.id}`, insertErr.message);
          continue;
        }
        inserted++;
        if (inserted_row?.id) insertedIds.push(inserted_row.id);
      } catch (e: any) {
        console.error(`[backfill] error processing ${msg.id}`, e?.message);
      }
    }

    // Soft cap to keep one run bounded; re-running is safe (idempotent).
    if (pages >= 50) {
      console.log("[backfill] page cap reached, stopping for this run");
      break;
    }
  } while (pageToken);

  console.log(`[backfill] done — pages=${pages} seen=${totalSeen} inserted=${inserted} skipped=${skipped}`);

  // Queue analysis in batches of 10 ids.
  for (let i = 0; i < insertedIds.length; i += 10) {
    const batch = insertedIds.slice(i, i + 10);
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/analyze-meeting`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ meeting_ids: batch }),
      });
    } catch (e: any) {
      console.error("[backfill] analyze-meeting dispatch failed", e?.message);
    }
  }
  console.log(`[backfill] analyze-meeting dispatched for ${insertedIds.length} new meetings`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    let requestingUserId: string | null = null;
    let isAdmin = false;

    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = bearer === supabaseServiceKey;

    if (!isServiceRole) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requestingUserId = user.id;

      const admin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      isAdmin = (roles || []).some((r: any) => r.role === "admin");
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin role required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Long-running sweep in the background so the HTTP call returns immediately.
    // @ts-ignore EdgeRuntime is provided by Supabase Edge runtime
    EdgeRuntime.waitUntil(runBackfill(supabaseAdmin, requestingUserId));

    return new Response(
      JSON.stringify({ started: true, message: "Backfill started in the background. Re-run later to pick up more." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("backfill-duncan-meetings error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Backfill failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
