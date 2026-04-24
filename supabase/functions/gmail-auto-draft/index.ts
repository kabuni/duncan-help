// Background worker: pre-drafts replies to new unread Gmail messages
// for users who have opted in (auto_draft_enabled = true).
// Triggered every 10 min by pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_DRAFTS_PER_RUN = 20;
const MAX_DRAFTS_PER_DAY = 100;
const AUTO_DRAFT_PREFIX = "[Auto-drafted by Duncan — review before sending]\n\n";
const DUNCAN_LABEL = "Duncan/Auto-Drafted";

const DENY_SENDER_PATTERNS = [
  /noreply@/i,
  /no-reply@/i,
  /notifications?@/i,
  /mailer-daemon@/i,
  /postmaster@/i,
  /donotreply@/i,
  /bounce@/i,
  /calendar-notification@google\.com/i,
];

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
    return { accessToken: refreshed.access_token, emailAddress: tokenRow.email_address };
  }
  return { accessToken: tokenRow.access_token, emailAddress: tokenRow.email_address };
}

function base64url(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

async function generateReply(
  styleSummary: string,
  threadContext: { from: string; date: string; body: string }[],
  userEmail: string,
): Promise<string | null> {
  const conversation = threadContext
    .map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.body.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are Duncan, drafting an email reply on behalf of ${userEmail}.

USER'S WRITING STYLE (mimic this exactly):
${styleSummary}

RULES:
- Write a short, natural reply that the user would plausibly send.
- Match their tone, vocabulary, sentence length, and sign-off style.
- If the incoming message is ambiguous or asks something you can't answer for the user, write a brief acknowledgement saying you'll follow up.
- Do NOT include a subject line — only the reply body.
- Do NOT include "Re:" prefix.
- Do NOT add greetings like "Hi [Name]" unless that matches the user's style.
- Keep it under 120 words unless the thread clearly needs detail.`;

  try {
    const data = await callLLMWithFallback({
      workflow: "gmail-auto-draft",
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Draft a reply to this email thread:\n\n${conversation}` },
      ],
    });
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err: any) {
    console.error("LLM error:", err?.status, err?.message);
    return null;
  }
}

async function processUser(
  supabaseAdmin: any,
  profile: any,
): Promise<{ created: number; skipped: number; errors: number }> {
  const stats = { created: 0, skipped: 0, errors: 0 };
  const userId = profile.user_id;

  // Reset daily counter if date changed
  const today = new Date().toISOString().slice(0, 10);
  let draftsToday = profile.auto_drafts_created_today;
  if (profile.auto_drafts_counter_date !== today) draftsToday = 0;

  if (draftsToday >= MAX_DRAFTS_PER_DAY) {
    console.log(`User ${userId} hit daily cap`);
    return stats;
  }

  const tokenData = await getValidToken(supabaseAdmin, userId);
  if (!tokenData) {
    console.log(`User ${userId} has no valid Gmail token`);
    return stats;
  }
  const headers = { Authorization: `Bearer ${tokenData.accessToken}` };
  const myEmail = tokenData.emailAddress || "";
  const myEmailLower = myEmail.toLowerCase();

  // Fixed 7-day rolling lookback. Duncan label + daily cap prevent re-drafting,
  // so we don't gate by last-run timestamp (that caused the window to shrink to ~10 min).
  const sinceTs = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const query = `is:unread in:inbox after:${sinceTs} -label:"${DUNCAN_LABEL}"`;
  console.log(`User ${userId} query: ${query}`);

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_DRAFTS_PER_RUN}&q=${encodeURIComponent(query)}`,
    { headers },
  );
  if (!listRes.ok) {
    console.error(`User ${userId} list failed:`, await listRes.text());
    stats.errors++;
    return stats;
  }
  const { messages = [] } = await listRes.json();
  console.log(`User ${userId} Gmail returned ${messages.length} messages`);

  for (const m of messages.slice(0, MAX_DRAFTS_PER_RUN)) {
    if (draftsToday >= MAX_DRAFTS_PER_DAY) break;

    try {
      // Fetch full message
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
        { headers },
      );
      if (!msgRes.ok) { stats.errors++; continue; }
      const msg = await msgRes.json();
      const msgHeaders = msg.payload?.headers || [];
      const from = getHeader(msgHeaders, "From");
      const subject = getHeader(msgHeaders, "Subject");
      const messageIdHeader = getHeader(msgHeaders, "Message-ID");
      const referencesHeader = getHeader(msgHeaders, "References");
      const listUnsubscribe = getHeader(msgHeaders, "List-Unsubscribe");
      const labelIds: string[] = msg.labelIds || [];

      // Skip already-drafted
      if (labelIds.some((l) => l.toLowerCase().includes("duncan"))) {
        console.log(`Skip ${m.id}: already-labelled`);
        stats.skipped++; continue;
      }

      // Skip self-sent
      if (from.toLowerCase().includes(myEmailLower)) {
        console.log(`Skip ${m.id}: self-sent`);
        stats.skipped++; continue;
      }

      // Skip automated senders
      if (DENY_SENDER_PATTERNS.some((re) => re.test(from))) {
        console.log(`Skip ${m.id}: automated-sender (${from})`);
        stats.skipped++; continue;
      }
      if (listUnsubscribe) {
        console.log(`Skip ${m.id}: list-unsubscribe`);
        stats.skipped++; continue;
      }

      const bodyText = decodeBody(msg.payload);
      const wordCount = bodyText.trim().split(/\s+/).length;
      if (wordCount < 30) {
        console.log(`Skip ${m.id}: too-short (${wordCount} words)`);
        stats.skipped++; continue;
      }

      // Skip if thread already has a draft (thread-scoped check via DRAFT label)
      const threadRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${msg.threadId}?format=minimal`,
        { headers },
      );
      if (threadRes.ok) {
        const thread = await threadRes.json();
        const threadHasDraft = (thread.messages || []).some((tm: any) =>
          (tm.labelIds || []).includes("DRAFT"),
        );
        if (threadHasDraft) {
          console.log(`Skip ${m.id}: thread-already-has-draft`);
          stats.skipped++; continue;
        }
      }

      // Build thread context (last 5 messages)
      const threadFullRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${msg.threadId}?format=full`,
        { headers },
      );
      const threadCtx: { from: string; date: string; body: string }[] = [];
      if (threadFullRes.ok) {
        const t = await threadFullRes.json();
        const msgs = (t.messages || []).slice(-5);
        for (const tm of msgs) {
          const h = tm.payload?.headers || [];
          threadCtx.push({
            from: getHeader(h, "From"),
            date: getHeader(h, "Date"),
            body: decodeBody(tm.payload).slice(0, 2000),
          });
        }
      }

      // Generate reply
      const reply = await generateReply(profile.style_summary, threadCtx, myEmailLower);
      if (!reply) { stats.errors++; continue; }

      const draftBodyText = AUTO_DRAFT_PREFIX + reply;
      const draftBodyHtml = draftBodyText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const newRefs = referencesHeader
        ? `${referencesHeader} ${messageIdHeader}`.trim()
        : messageIdHeader;

      const boundary = `=_duncan_${crypto.randomUUID().replace(/-/g, "")}`;
      const mimeMessage = [
        `From: ${myEmail}`,
        `To: ${from}`,
        `Subject: ${replySubject}`,
        messageIdHeader ? `In-Reply-To: ${messageIdHeader}` : "",
        newRefs ? `References: ${newRefs}` : "",
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
        "",
        draftBodyText,
        "",
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit",
        "",
        `<div>${draftBodyHtml}</div>`,
        "",
        `--${boundary}--`,
        "",
      ].filter((l, i, arr) => {
        // keep all except blank header lines that came from missing optional headers
        if (l !== "") return true;
        // keep blank line after headers (before first boundary) and inside parts
        return true;
      }).join("\r\n");

      const draftRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: { raw: base64url(mimeMessage), threadId: msg.threadId },
          }),
        },
      );
      if (!draftRes.ok) {
        console.error("Draft create failed:", await draftRes.text());
        stats.errors++;
        continue;
      }

      // Add Duncan label so we don't re-draft
      try {
        const labelsListRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/labels",
          { headers },
        );
        const labelsData = await labelsListRes.json();
        let label = (labelsData.labels || []).find((l: any) => l.name === DUNCAN_LABEL);
        if (!label) {
          const cr = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/labels",
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ name: DUNCAN_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }),
            },
          );
          if (cr.ok) label = await cr.json();
        }
        if (label) {
          await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/modify`,
            {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ addLabelIds: [label.id] }),
            },
          );
        }
      } catch (e: any) {
        console.warn("Label apply failed:", e);
      }

      stats.created++;
      draftsToday++;
    } catch (err: any) {
      console.error(`Message ${m.id} processing failed:`, err);
      stats.errors++;
    }
  }

  // Update profile
  await supabaseAdmin
    .from("gmail_writing_profiles")
    .update({
      auto_draft_last_run_at: new Date().toISOString(),
      auto_drafts_created_today: draftsToday,
      auto_drafts_counter_date: today,
    })
    .eq("user_id", userId);

  return stats;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profiles, error } = await supabaseAdmin
      .from("gmail_writing_profiles")
      .select("*")
      .eq("auto_draft_enabled", true);

    if (error) throw error;

    const totals = { users: 0, created: 0, skipped: 0, errors: 0 };
    for (const p of profiles || []) {
      if (!p.style_summary) continue; // never auto-draft without trained style
      totals.users++;
      const r = await processUser(supabaseAdmin, p);
      totals.created += r.created;
      totals.skipped += r.skipped;
      totals.errors += r.errors;
    }

    console.log("Auto-draft run complete:", totals);
    return new Response(JSON.stringify({ success: true, ...totals }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("gmail-auto-draft fatal:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
