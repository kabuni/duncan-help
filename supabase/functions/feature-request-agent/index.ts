// Duncan's agentic feature request triage.
// Triggered after a feature request is submitted (or via cron sweep).
// Reads the request + thread history, decides whether to clarify or triage,
// and either emails targeted clarifying questions or files a card on the
// Product Backlog workstream with a RICE-based priority.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

type TriageDecision = {
  action: "clarify" | "triage" | "dismiss";
  questions?: string[];
  reasoning?: string;
  refined_title?: string;
  problem_statement?: string;
  proposed_solution?: string;
  acceptance_criteria?: string;
  category?: string;
  rice_reach?: number;
  rice_impact?: number;
  rice_confidence?: number;
  rice_effort?: number;
  priority_band?: "P0" | "P1" | "P2" | "P3";
  effort_band?: "S" | "M" | "L" | "XL";
  dismiss_reason?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { feature_request_id, mode } = await req.json().catch(() => ({}));

    if (mode === "sweep") {
      const swept = await sweepStalled();
      return json({ ok: true, swept });
    }
    if (!feature_request_id) throw new Error("feature_request_id required");

    const result = await processRequest(feature_request_id);
    return json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("feature-request-agent error:", msg);
    return json({ error: msg }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sweepStalled() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("feature_requests")
    .select("id")
    .in("triage_status", ["new", "clarifying"])
    .or(`last_agent_run_at.is.null,last_agent_run_at.lt.${cutoff}`)
    .limit(20);

  const results: unknown[] = [];
  for (const row of data ?? []) {
    try {
      results.push(await processRequest((row as any).id));
    } catch (e) {
      results.push({ id: (row as any).id, error: (e as Error).message });
    }
  }
  return results;
}

async function processRequest(id: string) {
  const { data: fr, error } = await admin
    .from("feature_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !fr) throw new Error("feature request not found");
  if (["filed", "dismissed"].includes(fr.triage_status)) {
    return { skipped: true, reason: `already ${fr.triage_status}` };
  }

  await admin
    .from("feature_requests")
    .update({ last_agent_run_at: new Date().toISOString() })
    .eq("id", id);

  const { data: msgs } = await admin
    .from("feature_request_messages")
    .select("role, channel, body, created_at")
    .eq("feature_request_id", id)
    .order("created_at", { ascending: true });

  const decision = await runLLM(fr, msgs ?? []);

  if (decision.action === "clarify") {
    // Cap clarification rounds
    if ((fr.clarification_round ?? 0) >= 2) {
      // Force triage with a stub if still ambiguous
      return await fileTicket(fr, { ...decision, action: "triage" });
    }
    return await sendClarification(fr, decision);
  }
  if (decision.action === "dismiss") {
    await admin
      .from("feature_requests")
      .update({
        triage_status: "dismissed",
        admin_notes: decision.dismiss_reason ?? null,
      })
      .eq("id", id);
    await notify(fr.user_id, {
      kind: "feature_request_dismissed",
      title: "Feature request closed",
      body: decision.dismiss_reason ?? "Duncan decided not to add this to the backlog.",
      link: "/feature-requests",
    });
    return { dismissed: true };
  }
  return await fileTicket(fr, decision);
}

async function runLLM(fr: any, thread: any[]): Promise<TriageDecision> {
  const system = `You are Duncan, the operational intelligence for Kabuni.
You triage internal feature requests before they enter the engineering backlog.

Return STRICT JSON with keys:
- action: "clarify" | "triage" | "dismiss"
- If clarify: questions (array of 1-4 concise questions — only ask what actually blocks scoring; skip if the request is already clear enough to score).
- If dismiss: dismiss_reason (string — only dismiss for duplicates, spam, out-of-scope for Duncan, or nonsense).
- If triage: refined_title (<= 90 chars), problem_statement, proposed_solution, acceptance_criteria (bullet list as one string), category (one of: ui, ai, integration, workflow, reporting, ops, infra, other), rice_reach (1-10 users/week), rice_impact (0.25|0.5|1|2|3), rice_confidence (0-1), rice_effort (person-weeks, 0.25-8), priority_band (P0|P1|P2|P3), effort_band (S|M|L|XL).

Priority rules of thumb:
- P0: painful blocker for many users or execs, small effort.
- P1: clear value, worth doing next quarter.
- P2: nice-to-have, revisit later.
- P3: parking lot.

Only ask questions if the answer would change the score or the ticket. Prefer to triage with reasonable assumptions.`;

  const userPayload = {
    request: {
      title: fr.title,
      description: fr.description,
      use_case: fr.use_case,
      requester_email: fr.user_email,
      requester_stated_priority: fr.priority,
      clarification_round: fr.clarification_round,
    },
    thread: thread.map((m) => ({ role: m.role, channel: m.channel, body: m.body })),
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.5",
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("LLM error", res.status, text);
    throw new Error(`LLM failed [${res.status}]`);
  }
  const body = await res.json();
  const raw = body?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as TriageDecision;
    if (!parsed.action) throw new Error("no action");
    return parsed;
  } catch {
    // Fallback: force triage with the fields we already have
    return {
      action: "triage",
      refined_title: fr.title,
      problem_statement: fr.description,
      proposed_solution: "See original request. Duncan could not parse a structured plan.",
      acceptance_criteria: "- Requester validates the shipped feature meets the original description.",
      category: "other",
      rice_reach: 3,
      rice_impact: 1,
      rice_confidence: 0.5,
      rice_effort: 1,
      priority_band: "P2",
      effort_band: "M",
    };
  }
}

async function sendClarification(fr: any, decision: TriageDecision) {
  const questions = (decision.questions ?? []).slice(0, 4);
  if (!questions.length) {
    // Nothing to ask — fall through to triage
    return await fileTicket(fr, { ...decision, action: "triage" });
  }
  if (!fr.user_email) throw new Error("no requester email; cannot clarify");

  const round = (fr.clarification_round ?? 0) + 1;
  const senderEmail = await getSetting("feature_request_sender_email", "duncan@kabuni.com");

  const bodyHtml = buildClarifyEmail({
    requesterName: fr.user_email.split("@")[0],
    title: fr.title,
    questions,
    round,
  });

  const bodyText =
    `Hi,\n\nThanks for the feature request "${fr.title}". A few quick questions before I file it:\n\n` +
    questions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
    `\n\nReply to this email or answer in Duncan (Settings > Feature Requests).\n\n— Duncan`;

  const subject = `[Feature Request] ${fr.title}${round > 1 ? ` (follow-up ${round})` : ""}`;

  const sendResult = await sendGmail({
    to: fr.user_email,
    from: senderEmail,
    subject,
    html: bodyHtml,
    threadId: fr.email_thread_id ?? undefined,
  });

  await admin.from("feature_request_messages").insert({
    feature_request_id: fr.id,
    role: "agent",
    channel: "email",
    body: `Subject: ${subject}\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
    gmail_message_id: sendResult?.id ?? null,
    gmail_thread_id: sendResult?.threadId ?? fr.email_thread_id ?? null,
  });

  await admin
    .from("feature_requests")
    .update({
      triage_status: "clarifying",
      clarification_round: round,
      email_thread_id: sendResult?.threadId ?? fr.email_thread_id ?? null,
    })
    .eq("id", fr.id);

  await notify(fr.user_id, {
    kind: "feature_request_clarify",
    title: "Duncan sent you a question",
    body: `Check your email — Duncan needs a quick clarification on "${fr.title}".`,
    link: "/settings",
  });

  return { clarified: true, questions };
}

async function fileTicket(fr: any, decision: TriageDecision) {
  const backlogTag = await getSetting("feature_request_backlog_tag", "Product Backlog");
  const defaultAssignee = await getSetting<string | null>("feature_request_default_assignee", null);

  const ownerId = defaultAssignee ?? (await findFallbackAdmin());
  const status =
    decision.priority_band === "P0" ? "red"
      : decision.priority_band === "P1" ? "yellow"
      : "green";

  const description = [
    `**Requester:** ${fr.user_email ?? "unknown"}`,
    `**Original request:** ${fr.title}`,
    "",
    `**Problem**`,
    decision.problem_statement ?? fr.description,
    "",
    `**Proposed solution**`,
    decision.proposed_solution ?? "—",
    "",
    `**Acceptance criteria**`,
    decision.acceptance_criteria ?? "—",
    "",
    `**RICE**: reach ${decision.rice_reach} × impact ${decision.rice_impact} × confidence ${decision.rice_confidence} / effort ${decision.rice_effort}`,
    `**Priority:** ${decision.priority_band ?? "P2"}  •  **Effort:** ${decision.effort_band ?? "M"}  •  **Category:** ${decision.category ?? "other"}`,
    "",
    `[Open feature request](${APP_URL}/settings)`,
  ].join("\n");

  const { data: card, error: cardErr } = await admin
    .from("workstream_cards")
    .insert({
      title: decision.refined_title ?? fr.title,
      description,
      status,
      priority: decision.priority_band === "P0" ? "High" : decision.priority_band === "P3" ? "Low" : "Medium",
      owner_id: ownerId,
      project_tag: backlogTag,
      category: decision.category ?? null,
      created_by: ownerId,
    })
    .select("id")
    .single();

  if (cardErr) throw new Error(`card insert failed: ${cardErr.message}`);

  await admin
    .from("feature_requests")
    .update({
      triage_status: "filed",
      refined_title: decision.refined_title ?? fr.title,
      problem_statement: decision.problem_statement ?? null,
      proposed_solution: decision.proposed_solution ?? null,
      acceptance_criteria: decision.acceptance_criteria ?? null,
      category: decision.category ?? null,
      rice_reach: decision.rice_reach ?? null,
      rice_impact: decision.rice_impact ?? null,
      rice_confidence: decision.rice_confidence ?? null,
      rice_effort: decision.rice_effort ?? null,
      priority_band: decision.priority_band ?? "P2",
      effort_band: decision.effort_band ?? "M",
      workstream_card_id: card.id,
      status: "planned",
    })
    .eq("id", fr.id);

  await admin.from("feature_request_messages").insert({
    feature_request_id: fr.id,
    role: "agent",
    channel: "in_app",
    body: `Filed as ${decision.priority_band ?? "P2"} on the ${backlogTag} backlog.`,
  });

  await notify(fr.user_id, {
    kind: "feature_request_filed",
    title: `Feature request filed (${decision.priority_band ?? "P2"})`,
    body: `Duncan added "${decision.refined_title ?? fr.title}" to the ${backlogTag}.`,
    link: `/workstreams`,
  });

  // Send closing email to requester (best-effort)
  if (fr.user_email) {
    const senderEmail = await getSetting("feature_request_sender_email", "duncan@kabuni.com");
    try {
      const html = buildFiledEmail({
        title: decision.refined_title ?? fr.title,
        priority: decision.priority_band ?? "P2",
        effort: decision.effort_band ?? "M",
      });
      await sendGmail({
        to: fr.user_email,
        from: senderEmail,
        subject: `[Feature Request] Filed: ${decision.refined_title ?? fr.title}`,
        html,
        threadId: fr.email_thread_id ?? undefined,
      });
    } catch (e) {
      console.warn("closing email failed", (e as Error).message);
    }
  }

  return { filed: true, card_id: card.id, priority: decision.priority_band };
}

async function findFallbackAdmin(): Promise<string | null> {
  const { data } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return (data as any)?.user_id ?? null;
}

async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = (data as any)?.value;
  if (v === null || v === undefined) return fallback;
  return v as T;
}

async function notify(user_id: string | null, n: { kind: string; title: string; body: string; link?: string }) {
  if (!user_id) return;
  await admin.from("notifications").insert({
    user_id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
  });
}

// ---------- Gmail ----------

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

async function sendGmail(opts: { to: string; from: string; subject: string; html: string; threadId?: string }) {
  const token = await getGmailToken();
  if (!token) throw new Error("no Duncan Gmail token");

  const lines = [
    `From: Duncan <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
  ].join("\r\n");
  const raw = btoa(unescape(encodeURIComponent(lines)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const body: Record<string, unknown> = { raw };
  if (opts.threadId) body.threadId = opts.threadId;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`gmail send failed [${res.status}]: ${JSON.stringify(data)}`);
  return { id: data.id, threadId: data.threadId };
}

function esc(v: string) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildClarifyEmail(o: { requesterName: string; title: string; questions: string[]; round: number }) {
  return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;color:#1f2937">
  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:hsl(174,50%,92%);color:hsl(174,60%,28%);font-size:12px;font-weight:600;margin-bottom:20px">Duncan · Feature Request</div>
  <h1 style="margin:0 0 12px;font-size:22px;color:hsl(220,20%,12%)">Quick questions before I file this</h1>
  <p style="margin:0 0 12px;font-size:15px;color:hsl(215,12%,44%)">Hi ${esc(o.requesterName)}, thanks for the request — <strong>${esc(o.title)}</strong>. A few things I need before I can score and file it${o.round > 1 ? " (follow-up)" : ""}:</p>
  <ol style="margin:16px 0;padding-left:20px;font-size:15px;line-height:1.7;color:hsl(220,20%,20%)">
    ${o.questions.map((q) => `<li>${esc(q)}</li>`).join("")}
  </ol>
  <p style="margin:20px 0 0;font-size:14px;color:hsl(215,12%,44%)">Just reply to this email, or answer in Duncan under Settings → Feature Requests.</p>
  <p style="margin:16px 0 0;font-size:13px;color:hsl(215,12%,55%)">— Duncan</p>
</div>`;
}

function buildFiledEmail(o: { title: string; priority: string; effort: string }) {
  return `
<div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#fff;color:#1f2937">
  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:hsl(150,55%,92%);color:hsl(150,60%,28%);font-size:12px;font-weight:600;margin-bottom:20px">Duncan · Filed</div>
  <h1 style="margin:0 0 12px;font-size:22px;color:hsl(220,20%,12%)">Your request is on the backlog</h1>
  <p style="margin:0 0 12px;font-size:15px;color:hsl(215,12%,44%)">I've added <strong>${esc(o.title)}</strong> to the Product Backlog.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:hsl(215,12%,44%);font-size:14px">Priority</td><td style="font-size:14px;font-weight:600">${esc(o.priority)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:hsl(215,12%,44%);font-size:14px">Effort</td><td style="font-size:14px;font-weight:600">${esc(o.effort)}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:13px;color:hsl(215,12%,55%)">I re-rank the backlog automatically as new requests come in.<br/>— Duncan</p>
</div>`;
}
