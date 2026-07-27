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

// Fixed reviewer group — Duncan notifies these admins for every feature request.
const REVIEWER_IDS: string[] = [
  "c93fa0ff-fbc9-4f28-808f-b55d8defc9eb", // Palash Soundarkar
  "ab34cb37-78ca-4f51-b980-c43b8e884d27", // Ashish
  "4bc1118e-b1ac-4587-81d5-57105f66b0bd", // Balkrishna
  "15233afa-6b01-44c3-94b7-58c64f6360fa", // Adit Bhargava
];

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
  if (["filed", "triaged", "dismissed"].includes(fr.triage_status)) {
    return { skipped: true, reason: `already ${fr.triage_status}` };
  }

  await admin
    .from("feature_requests")
    .update({ last_agent_run_at: new Date().toISOString() })
    .eq("id", id);

  const suggestions = await runSuggestionLLM(fr);
  return await reviewAndNotify(fr, suggestions);
}

type ReviewOutput = {
  refined_title: string;
  summary: string;
  suggestions: string[]; // bullet suggestions on how to build it
  effort_estimate?: string;
  priority_suggestion?: "P0" | "P1" | "P2" | "P3";
};

async function runSuggestionLLM(fr: any): Promise<ReviewOutput> {
  const system = `You are Duncan, Kabuni's operational intelligence.
A team member has submitted a feature request. Your job is ONLY to:
1. Rewrite the title cleanly (<= 90 chars).
2. Summarise the request in 1-2 sentences (plain English).
3. Give 3-6 concrete implementation suggestions for the engineering team (how to build it, what to consider, edge cases, dependencies).
4. Suggest a rough effort (S/M/L/XL) and priority (P0-P3).

Do NOT ask clarifying questions. Do NOT dismiss. Do NOT create tickets. Just review and suggest.

Return STRICT JSON:
{ "refined_title": string, "summary": string, "suggestions": string[], "effort_estimate": "S"|"M"|"L"|"XL", "priority_suggestion": "P0"|"P1"|"P2"|"P3" }`;

  const payload = {
    title: fr.title,
    description: fr.description,
    use_case: fr.use_case,
    requester_email: fr.user_email,
    requester_priority: fr.priority,
  };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Lovable-API-Key": LOVABLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    console.error("LLM error", res.status, await res.text().catch(() => ""));
    return {
      refined_title: fr.title,
      summary: fr.description?.slice(0, 240) ?? fr.title,
      suggestions: ["Duncan could not auto-analyse this request — please review the raw description."],
    };
  }
  const body = await res.json();
  const raw = body?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      refined_title: (parsed.refined_title || fr.title).slice(0, 120),
      summary: parsed.summary || fr.description?.slice(0, 240) || fr.title,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 8) : [],
      effort_estimate: parsed.effort_estimate,
      priority_suggestion: parsed.priority_suggestion,
    };
  } catch {
    return {
      refined_title: fr.title,
      summary: fr.description?.slice(0, 240) ?? fr.title,
      suggestions: [],
    };
  }
}

async function reviewAndNotify(fr: any, review: ReviewOutput) {
  const suggestionsMd = review.suggestions.map((s) => `- ${s}`).join("\n");

  await admin
    .from("feature_requests")
    .update({
      triage_status: "triaged",
      refined_title: review.refined_title,
      problem_statement: review.summary,
      proposed_solution: suggestionsMd || null,
      priority_band: review.priority_suggestion ?? null,
      effort_band: review.effort_estimate ?? null,
    })
    .eq("id", fr.id);

  await admin.from("feature_request_messages").insert({
    feature_request_id: fr.id,
    role: "agent",
    channel: "in_app",
    body: `Duncan reviewed this request and shared suggestions with the admin reviewers.`,
  });

  // Notify the fixed admin reviewer group
  const shortBody = `${fr.user_email ?? "A user"}: ${review.refined_title}`;
  const link = `/settings`;
  const notifRows = REVIEWER_IDS.map((uid) => ({
    user_id: uid,
    kind: "feature_request_review",
    title: "New feature request to review",
    body: shortBody,
    link,
  }));
  await admin.from("notifications").insert(notifRows);

  // Let the requester know it's been reviewed (no dismissal, no card).
  await notify(fr.user_id, {
    kind: "feature_request_reviewed",
    title: "Duncan reviewed your feature request",
    body: `Suggestions have been shared with the admin reviewers for "${review.refined_title}".`,
    link: "/settings",
  });

  return { reviewed: true, notified: REVIEWER_IDS.length };
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
