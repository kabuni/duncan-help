// Hourly cron: pulls each opted-in user's newly-sent Gmail messages, cleans
// and redacts them, stores rolling samples per recipient domain, and — at most
// once per week per user — regenerates the writing-style profile (overall +
// per-recipient clusters) from the rolling window.
//
// Reads from public.gmail_tokens (per-user OAuth) and writes to
// public.gmail_style_samples + public.gmail_writing_profiles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ROLLING_SAMPLES = 500;
const MAX_NEW_PER_RUN = 60;
const RESUMMARISE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLES_FOR_CLUSTER = 8;
const TOP_N_CLUSTERS = 5;

// --------------------------------------------------------------- helpers

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidToken(supabaseAdmin: any, userId: string) {
  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens").select("*").eq("connected_by", userId).maybeSingle();
  if (!tokenRow) return null;
  const expiry = new Date(tokenRow.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    if (!refreshed) return null;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabaseAdmin.from("gmail_tokens")
      .update({ access_token: refreshed.access_token, token_expiry: newExpiry })
      .eq("id", tokenRow.id);
    return refreshed.access_token;
  }
  return tokenRow.access_token;
}

function decodeBody(payload: any): string {
  let html = "", text = "";
  function walk(p: any) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      text = atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    } else if (p.mimeType === "text/html" && p.body?.data) {
      html = atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }
    (p.parts || []).forEach(walk);
  }
  walk(payload || {});
  return text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getHeader(headers: any[], name: string): string {
  return headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function cleanSample(body: string): string {
  if (!body) return "";
  let text = body
    .replace(/On\s+.+?wrote:[\s\S]*$/gi, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    .split(/^--\s*$/m)[0]
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > 2000) text = text.slice(0, 2000);
  return text;
}

function extractRecipientDomain(toHeader: string): { email: string; domain: string } {
  const m = toHeader.match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
  const email = m ? m[1].toLowerCase() : "";
  const domain = email.includes("@") ? email.split("@")[1] : "";
  return { email, domain };
}

// --------------------------------------------------------------- main loop

async function processUser(supabaseAdmin: any, profile: any): Promise<{ new: number; resummarised: boolean }> {
  const userId = profile.user_id;
  const token = await getValidToken(supabaseAdmin, userId);
  if (!token) return { new: 0, resummarised: false };
  const gmailHeaders = { Authorization: `Bearer ${token}` };

  // Gmail's `after:` search uses YYYY/MM/DD; use the cursor if we have one,
  // otherwise last 7 days as a soft start so we don't backfill everything.
  const cursorIso = profile.incremental_learn_cursor || profile.last_trained_at ||
    new Date(Date.now() - 7 * 86400_000).toISOString();
  const cursorDate = new Date(cursorIso);
  const y = cursorDate.getUTCFullYear();
  const mo = String(cursorDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cursorDate.getUTCDate()).padStart(2, "0");
  const q = `in:sent after:${y}/${mo}/${d}`;

  // List new sent message ids
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      q,
      maxResults: String(MAX_NEW_PER_RUN),
    })}`,
    { headers: gmailHeaders },
  );
  if (!listRes.ok) return { new: 0, resummarised: false };
  const listData = await listRes.json();
  const ids: string[] = (listData.messages || []).map((m: any) => m.id);

  // Skip ones we've already stored
  const { data: existing } = await supabaseAdmin
    .from("gmail_style_samples")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in("gmail_message_id", ids.length ? ids : ["__none__"]);
  const seen = new Set((existing || []).map((r: any) => r.gmail_message_id));
  const fresh = ids.filter((id) => !seen.has(id));

  let inserted = 0;
  let latestSentAt = cursorDate.getTime();

  for (let i = 0; i < fresh.length; i += 10) {
    const batch = fresh.slice(i, i + 10);
    const results = await Promise.all(batch.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: gmailHeaders },
      );
      if (!r.ok) return null;
      const msg = await r.json();
      const headers = msg.payload?.headers || [];
      const subject = getHeader(headers, "Subject");
      const to = getHeader(headers, "To");
      const dateHeader = getHeader(headers, "Date");
      const rawBody = decodeBody(msg.payload);
      const cleaned = cleanSample(rawBody);
      if (cleaned.length < 40) return null;
      const { email, domain } = extractRecipientDomain(to);
      const sentAt = dateHeader ? new Date(dateHeader) : new Date();
      if (isNaN(sentAt.getTime())) return null;
      return {
        user_id: userId,
        gmail_message_id: id,
        recipient_email: email || null,
        recipient_domain: domain || null,
        subject: subject.slice(0, 300) || null,
        sample_text: cleaned,
        word_count: cleaned.split(/\s+/).length,
        sent_at: sentAt.toISOString(),
        weight: 1.0,
        source: "sent",
      };
    }));

    const rows = results.filter(Boolean) as any[];
    if (!rows.length) continue;
    const { error } = await supabaseAdmin
      .from("gmail_style_samples")
      .upsert(rows, { onConflict: "user_id,gmail_message_id" });
    if (!error) {
      inserted += rows.length;
      for (const r of rows) {
        const t = new Date(r.sent_at).getTime();
        if (t > latestSentAt) latestSentAt = t;
      }
    }
  }

  // Trim rolling window to newest MAX_ROLLING_SAMPLES
  await supabaseAdmin.rpc("noop_query", {}).catch(() => {}); // ignore if not present
  const { data: overflow } = await supabaseAdmin
    .from("gmail_style_samples")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("source", "sent")
    .order("created_at", { ascending: false })
    .range(MAX_ROLLING_SAMPLES, MAX_ROLLING_SAMPLES + 500);
  if (overflow && overflow.length) {
    await supabaseAdmin
      .from("gmail_style_samples")
      .delete()
      .in("id", overflow.map((r: any) => r.id));
  }

  const newCursor = new Date(latestSentAt + 1000).toISOString();
  await supabaseAdmin
    .from("gmail_writing_profiles")
    .update({
      incremental_learn_cursor: newCursor,
      last_incremental_run_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // Weekly re-summarise (overall + per-recipient clusters)
  let resummarised = false;
  const lastTrained = profile.last_trained_at ? new Date(profile.last_trained_at).getTime() : 0;
  if (Date.now() - lastTrained >= RESUMMARISE_EVERY_MS && inserted > 0) {
    resummarised = await resummarise(supabaseAdmin, userId);
  }

  return { new: inserted, resummarised };
}

async function resummarise(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data: samples } = await supabaseAdmin
    .from("gmail_style_samples")
    .select("recipient_domain, sample_text, weight, source")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROLLING_SAMPLES);
  if (!samples || samples.length < 10) return false;

  // Overall summary from a weighted mix (up to 150 samples)
  const overallInput = samples.slice(0, 150)
    .map((s: any, i: number) => `--- EMAIL ${i + 1} (weight=${s.weight})${s.source === "edit_correction" ? " [CORRECTION]" : ""} ---\n${s.sample_text}`)
    .join("\n\n");

  const overallPrompt = `You are analysing how a person writes emails. Below are ${Math.min(samples.length, 150)} of their recent sent emails; entries marked [CORRECTION] are edits they made to a draft you wrote — weight those higher when describing their true style.

EMAILS:
${overallInput.slice(0, 60000)}

Output STRICT JSON:
{
  "style_summary": "200-400 word natural-language description of tone, formality, sentence rhythm, vocabulary, structural habits, sign-off patterns",
  "common_phrases": { "openers": [], "closers": [], "transitions": [], "sign_offs": [] },
  "tone_metrics": { "avg_sentence_length_words": 0, "formality_1_to_5": 3, "uses_emoji": false, "uses_bullet_points": false, "typical_length_words": 0 },
  "sample_replies": ["3-5 short representative snippets, each <200 chars, redacted"]
}
Respond with ONLY the JSON, no markdown fences.`;

  let overall: any = null;
  try {
    const llm = await callLLMWithFallback({
      workflow: "gmail-learn-incremental",
      messages: [{ role: "user", content: overallPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4096,
      force_provider: "openai",
      model_override: { openai: "gpt-4o" },
    });
    overall = JSON.parse((llm.choices?.[0]?.message?.content || "{}")
      .replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim());
  } catch (e) {
    console.error("resummarise overall failed", e);
    return false;
  }

  // Per-recipient clusters: pick top N domains with enough samples
  const byDomain = new Map<string, any[]>();
  for (const s of samples) {
    if (!s.recipient_domain) continue;
    const arr = byDomain.get(s.recipient_domain) || [];
    arr.push(s);
    byDomain.set(s.recipient_domain, arr);
  }
  const eligible = [...byDomain.entries()]
    .filter(([, arr]) => arr.length >= MIN_SAMPLES_FOR_CLUSTER)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TOP_N_CLUSTERS);

  const perRecipient: Record<string, any> = {};
  for (const [domain, arr] of eligible) {
    const clusterInput = arr.slice(0, 30)
      .map((s: any, i: number) => `--- EMAIL ${i + 1} ---\n${s.sample_text}`)
      .join("\n\n");
    try {
      const llm = await callLLMWithFallback({
        workflow: "gmail-learn-incremental-cluster",
        messages: [{
          role: "user",
          content: `The following ${arr.length > 30 ? 30 : arr.length} emails were all sent by this user to recipients at "${domain}". Describe in 3-5 short sentences how their tone/formality/length to this audience differs from general email. Return STRICT JSON:
{ "cluster_summary": "...", "typical_length_words": 0, "formality_1_to_5": 3 }
EMAILS:
${clusterInput.slice(0, 30000)}`,
        }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 800,
        force_provider: "openai",
        model_override: { openai: "gpt-4o-mini" },
      });
      perRecipient[domain] = JSON.parse((llm.choices?.[0]?.message?.content || "{}")
        .replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim());
      perRecipient[domain].sample_count = arr.length;
    } catch (e) {
      console.error(`cluster ${domain} failed`, e);
    }
  }

  await supabaseAdmin.from("gmail_writing_profiles").update({
    style_summary: overall.style_summary || "",
    common_phrases: overall.common_phrases || {},
    tone_metrics: overall.tone_metrics || {},
    sample_replies: overall.sample_replies || [],
    sample_count: samples.length,
    last_trained_at: new Date().toISOString(),
    per_recipient_style: perRecipient,
  }).eq("user_id", userId);

  return true;
}

// --------------------------------------------------------------- entrypoint

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only process users who already have a profile (i.e. have opted in / been trained once).
  const { data: profiles } = await supabaseAdmin
    .from("gmail_writing_profiles")
    .select("user_id, incremental_learn_cursor, last_incremental_run_at, last_trained_at");

  const results: any[] = [];
  for (const p of profiles || []) {
    try {
      const r = await processUser(supabaseAdmin, p);
      results.push({ user_id: p.user_id, ...r });
    } catch (e: any) {
      console.error("learn-incremental user error", p.user_id, e?.message);
      results.push({ user_id: p.user_id, error: e?.message || String(e) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
