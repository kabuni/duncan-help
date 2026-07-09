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

const AUTO_DRAFT_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

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

async function getMissingGmailScopes(accessToken: string): Promise<string[] | null> {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) return null;

  const data = await res.json();
  const granted = new Set(String(data.scope || "").split(/\s+/).filter(Boolean));
  if (granted.has("https://mail.google.com/")) return [];
  return AUTO_DRAFT_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
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
  perRecipientStyle: Record<string, any> | null,
  threadContext: { from: string; date: string; body: string }[],
  userEmail: string,
  senderDomain: string,
): Promise<{ reply: string; confidence: number; risk_flags: string[]; summary: string } | null> {
  const conversation = threadContext
    .map((m) => `From: ${m.from}\nDate: ${m.date}\n\n${m.body.slice(0, 2000)}`)
    .join("\n\n---\n\n");

  const clusterHint = perRecipientStyle && senderDomain && perRecipientStyle[senderDomain]
    ? `\n\nTHIS RECIPIENT (${senderDomain}) — tone cluster:\n${JSON.stringify(perRecipientStyle[senderDomain])}\nMatch this cluster when it differs from the overall style.`
    : "";

  const systemPrompt = `You are Duncan, drafting an email reply on behalf of ${userEmail}.

USER'S OVERALL WRITING STYLE (mimic this):
${styleSummary}${clusterHint}

RULES:
- Write a short, natural reply the user would plausibly send.
- Match their tone, vocabulary, sentence length, and sign-off style.
- If the incoming message is ambiguous or asks something you can't answer for the user, write a brief acknowledgement saying you'll follow up.
- Do NOT include a subject line — only the reply body.
- Do NOT include "Re:" prefix.
- Keep it under 120 words unless the thread clearly needs detail.

You must also self-assess the reply. Return STRICT JSON with keys:
  "reply": string,
  "confidence": integer 0-100 (how sure you are the user would send this as-is),
  "risk_flags": array of strings from ["money","legal","commitment","apology","attachment_requested","external_new_domain","sensitive","unclear_ask","none"],
  "summary": one-sentence description of what the incoming email is asking.
Respond with ONLY the JSON, no fences.`;

  try {
    const data = await callLLMWithFallback({
      workflow: "gmail-auto-draft",
      temperature: 0.6,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Draft a reply to this email thread:\n\n${conversation}` },
      ],
    });
    const raw = (data.choices?.[0]?.message?.content || "").trim()
      .replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.reply) return null;
    return {
      reply: String(parsed.reply).trim(),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      risk_flags: Array.isArray(parsed.risk_flags)
        ? parsed.risk_flags.filter((x: any) => typeof x === "string" && x !== "none")
        : [],
      summary: String(parsed.summary || "").slice(0, 400),
    };
  } catch (err: any) {
    console.error("LLM error:", err?.status, err?.message);
    return null;
  }
}

// ---- Trust routing helpers ----------------------------------------------

const HARD_BLOCK_FLAGS = ["money", "legal"];
const DEFAULT_CONFIDENCE_THRESHOLD = 90;
const DEFAULT_MIN_APPROVED = 10;
const MEDIUM_CONFIDENCE_FOR_APPROVAL = 55;

function extractSenderEmail(fromHeader: string): { email: string; name: string; domain: string } {
  const m = fromHeader.match(/(.*?)<([^>]+)>/);
  const email = (m ? m[2] : fromHeader).trim().toLowerCase();
  const name = (m ? m[1] : "").trim().replace(/^"|"$/g, "");
  const domain = email.includes("@") ? email.split("@")[1] : "";
  return { email, name, domain };
}

async function decideRoute(
  supabaseAdmin: any,
  userId: string,
  profile: any,
  senderEmail: string,
  senderDomain: string,
  ai: { confidence: number; risk_flags: string[] },
  threadParticipantCount: number,
  hasAttachments: boolean,
): Promise<"auto_send" | "approval" | "draft"> {
  // Hard blocks: never auto-send
  const blockedFlags = ai.risk_flags.some((f) => HARD_BLOCK_FLAGS.includes(f));
  if (blockedFlags || hasAttachments || threadParticipantCount > 3) {
    return ai.confidence >= MEDIUM_CONFIDENCE_FOR_APPROVAL ? "approval" : "draft";
  }

  const { data: trust } = await supabaseAdmin
    .from("gmail_sender_trust")
    .select("*")
    .eq("user_id", userId)
    .eq("sender_email", senderEmail)
    .maybeSingle();

  if (trust?.force_review) return ai.confidence >= MEDIUM_CONFIDENCE_FOR_APPROVAL ? "approval" : "draft";

  // Check whitelist (only whitelisted senders qualify for auto-send)
  const filterList: string[] = Array.isArray(profile.auto_draft_filter_list)
    ? profile.auto_draft_filter_list
    : [];
  const whitelisted = profile.auto_draft_filter_mode === "whitelist" && filterList.some((e) => {
    const entry = String(e || "").trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith("@")) return senderEmail.endsWith(entry);
    if (entry.includes("@")) return senderEmail === entry;
    return senderEmail.includes(entry);
  });

  const threshold = profile.auto_send_confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const minApproved = profile.auto_send_min_approved ?? DEFAULT_MIN_APPROVED;

  if (trust?.force_trust && ai.confidence >= 70) return "auto_send";
  if (whitelisted && trust
      && trust.confidence >= threshold
      && trust.sends_approved >= minApproved
      && ai.confidence >= threshold) {
    return "auto_send";
  }

  return ai.confidence >= MEDIUM_CONFIDENCE_FOR_APPROVAL ? "approval" : "draft";
}

async function notifyUser(supabaseAdmin: any, userId: string, title: string, body: string, link: string) {
  await supabaseAdmin.from("notifications").insert({
    user_id: userId, title, message: body, link, kind: "email_action",
  });
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

  const missingScopes = await getMissingGmailScopes(tokenData.accessToken);
  if (missingScopes && missingScopes.length > 0) {
    console.warn(`User ${userId} missing Gmail scopes for auto-draft: ${missingScopes.join(", ")}`);
    await supabaseAdmin
      .from("gmail_writing_profiles")
      .update({ auto_draft_enabled: false, auto_draft_last_run_at: new Date().toISOString() })
      .eq("user_id", userId);
    stats.errors++;
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

      // Apply user-defined whitelist/blacklist
      {
        const filterMode = (profile.auto_draft_filter_mode || "blacklist") as "blacklist" | "whitelist";
        const filterList: string[] = Array.isArray(profile.auto_draft_filter_list)
          ? profile.auto_draft_filter_list
          : [];
        const fromLower = from.toLowerCase();
        const matchEmail = (fromLower.match(/<([^>]+)>/)?.[1] || fromLower).trim();
        const matches = filterList
          .map((e) => String(e || "").trim().toLowerCase())
          .filter(Boolean)
          .some((entry) => {
            if (entry.startsWith("@")) return matchEmail.endsWith(entry);
            if (entry.includes("@")) return matchEmail === entry;
            return matchEmail.includes(entry);
          });
        if (filterMode === "blacklist" && matches) {
          console.log(`Skip ${m.id}: blacklisted sender (${from})`);
          stats.skipped++; continue;
        }
        if (filterMode === "whitelist" && filterList.length > 0 && !matches) {
          console.log(`Skip ${m.id}: not in whitelist (${from})`);
          stats.skipped++; continue;
        }
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

      // Detect attachments and count thread participants for risk gating
      const hasAttachments = (msg.payload?.parts || []).some(
        (p: any) => p.filename && p.filename.length > 0,
      );
      const participants = new Set<string>();
      for (const tm of threadCtx) {
        const em = extractSenderEmail(tm.from).email;
        if (em) participants.add(em);
      }

      // Generate reply with self-confidence + risk assessment
      const { email: senderEmail, name: senderName, domain: senderDomain } = extractSenderEmail(from);
      const ai = await generateReply(
        profile.style_summary,
        (profile.per_recipient_style as Record<string, any>) || null,
        threadCtx,
        myEmailLower,
        senderDomain,
      );
      if (!ai) { stats.errors++; continue; }

      const route = await decideRoute(
        supabaseAdmin, userId, profile, senderEmail, senderDomain,
        { confidence: ai.confidence, risk_flags: ai.risk_flags },
        participants.size, hasAttachments,
      );

      // Common label helper — mark the source message so we don't re-draft
      const applyDuncanLabel = async () => {
        try {
          const labelsListRes = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers });
          const labelsData = await labelsListRes.json();
          let label = (labelsData.labels || []).find((l: any) => l.name === DUNCAN_LABEL);
          if (!label) {
            const cr = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/labels",
              { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ name: DUNCAN_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }) },
            );
            if (cr.ok) label = await cr.json();
          }
          if (label) {
            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/modify`,
              { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ addLabelIds: [label.id] }) });
          }
        } catch (e: any) { console.warn("Label apply failed:", e); }
      };

      if (route === "auto_send") {
        // Queue in outbox — actual send happens after undo window
        const undoSeconds = profile.auto_send_undo_seconds ?? 300;
        const sendAfter = new Date(Date.now() + undoSeconds * 1000).toISOString();
        await supabaseAdmin.from("gmail_auto_outbox").upsert({
          user_id: userId,
          gmail_message_id: m.id,
          gmail_thread_id: msg.threadId,
          sender_email: senderEmail,
          subject,
          body: ai.reply,
          status: "queued",
          send_after: sendAfter,
        }, { onConflict: "user_id,gmail_message_id" });
        await notifyUser(supabaseAdmin, userId,
          `Duncan is about to reply to ${senderName || senderEmail}`,
          `"${subject}" — sends in ${Math.round(undoSeconds/60)} min unless you undo.`,
          `/gmail`);
        await applyDuncanLabel();
        stats.created++; draftsToday++;
        continue;
      }

      if (route === "approval") {
        // Queue as pending approval for user decision (bell + Slack)
        await supabaseAdmin.from("gmail_pending_approvals").upsert({
          user_id: userId,
          gmail_message_id: m.id,
          gmail_thread_id: msg.threadId,
          sender_email: senderEmail,
          sender_name: senderName || null,
          subject,
          incoming_snippet: bodyText.slice(0, 500),
          incoming_summary: ai.summary,
          proposed_reply: ai.reply,
          ai_confidence: ai.confidence,
          risk_flags: ai.risk_flags,
          status: "pending",
        }, { onConflict: "user_id,gmail_message_id" });
        await notifyUser(supabaseAdmin, userId,
          `Reply ready for ${senderName || senderEmail}`,
          `"${subject}" — review, edit or send.`,
          `/gmail?approve=${m.id}`);
        await applyDuncanLabel();
        stats.created++; draftsToday++;
        continue;
      }

      // Fallback: create a review-me draft in Gmail (existing behaviour)
      const draftBodyText = AUTO_DRAFT_PREFIX + ai.reply;
      const draftBodyHtml = draftBodyText
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const newRefs = referencesHeader ? `${referencesHeader} ${messageIdHeader}`.trim() : messageIdHeader;
      const boundary = `=_duncan_${crypto.randomUUID().replace(/-/g, "")}`;
      const mimeMessage = [
        `From: ${myEmail}`, `To: ${from}`, `Subject: ${replySubject}`,
        messageIdHeader ? `In-Reply-To: ${messageIdHeader}` : "",
        newRefs ? `References: ${newRefs}` : "",
        "MIME-Version: 1.0",
        `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
        `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit", "", draftBodyText, "",
        `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: 7bit", "", `<div>${draftBodyHtml}</div>`, "",
        `--${boundary}--`, "",
      ].filter(Boolean).join("\r\n");

      const draftRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw: base64url(mimeMessage), threadId: msg.threadId } }) },
      );
      if (!draftRes.ok) { console.error("Draft create failed:", await draftRes.text()); stats.errors++; continue; }
      await applyDuncanLabel();
      stats.created++; draftsToday++;
    } catch (err: any) {
      console.error(`Message ${m.id} processing failed:`, err);
      stats.errors++;
    }
  }
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
