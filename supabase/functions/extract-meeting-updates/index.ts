// Phase 1 — READ-ONLY extraction of project-relevant items from stored meetings.
// This function NEVER creates, updates or deletes tasks, cards, projects or statuses.
// It only writes suggestion rows into meeting_extractions (+ meeting_project_links).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Kind =
  | "create_task"
  | "update_due_date"
  | "update_owner"
  | "complete_task"
  | "blocked"
  | "decision";

const VALID_KINDS: Kind[] = [
  "create_task",
  "update_due_date",
  "update_owner",
  "complete_task",
  "blocked",
  "decision",
];
const VALID_CONFIDENCE = ["high", "medium", "low"];

function norm(s: string | null | undefined) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Phase 1 shallow resolution: explicit, unambiguous matches only.
 * The shared Project/Area/Task/Owner resolver arrives in Phase 2; anything not
 * obviously named here is intentionally left unresolved (null) for review.
 */
function resolveShallow(
  text: string,
  projects: any[],
  cards: any[],
  tasks: any[],
) {
  const hay = norm(text);
  if (!hay) return { project_id: null, card_id: null, task_id: null };

  // WS-xxxx reference is the strongest, least ambiguous signal.
  const wsMatch = (text.match(/\bWS-?\s?(\d{3,4})\b/i) || [])[1];
  let card = wsMatch
    ? cards.find((c) => (c.task_code || "").replace(/\D/g, "") === wsMatch.padStart(4, "0").slice(-4))
    : undefined;

  if (!card) {
    const named = cards.filter((c) => norm(c.title).length > 6 && hay.includes(norm(c.title)));
    if (named.length === 1) card = named[0];
  }

  let project = card?.project_id
    ? projects.find((p) => p.id === card.project_id)
    : undefined;
  if (!project) {
    const named = projects.filter((p) => norm(p.name).length > 5 && hay.includes(norm(p.name)));
    if (named.length === 1) project = named[0];
  }

  let task: any;
  const scope = card ? tasks.filter((t) => t.card_id === card.id) : tasks;
  const namedTasks = scope.filter((t) => norm(t.title).length > 8 && hay.includes(norm(t.title)));
  if (namedTasks.length === 1) task = namedTasks[0];

  return {
    project_id: project?.id ?? card?.project_id ?? task?.project_id ?? null,
    card_id: card?.id ?? task?.card_id ?? null,
    task_id: task?.id ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const bearer = authHeader.slice(7).trim();
    const isServiceRole = bearer === serviceKey;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: isAdmin } = await userClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const { meeting_id, meeting_ids, limit = 5, dry_run = false } = body ?? {};

    let ids: string[] = meeting_ids || (meeting_id ? [meeting_id] : []);

    if (ids.length === 0) {
      // Meetings that already exist and have content, not yet extracted.
      const { data: done } = await admin.from("meeting_extractions").select("meeting_id");
      const seen = new Set((done || []).map((r: any) => r.meeting_id));
      const { data: candidates } = await admin
        .from("meetings")
        .select("id")
        .or("transcript.not.is.null,summary.not.is.null")
        .order("meeting_date", { ascending: false })
        .limit(50);
      ids = (candidates || []).map((m: any) => m.id).filter((id: string) => !seen.has(id)).slice(0, limit);
    }

    if (ids.length === 0) return json({ success: true, processed: 0, extracted: 0, results: [] });

    // Existing structures used for shallow resolution (read-only).
    const [{ data: projects }, { data: cards }, { data: tasks }, { data: profiles }] = await Promise.all([
      admin.from("projects").select("id, name, description"),
      admin.from("workstream_cards").select("id, task_code, title, project_id"),
      admin.from("workstream_tasks").select("id, title, card_id, project_id, assignee_id, completed"),
      admin.from("profiles").select("id, full_name, email"),
    ]);

    let extracted = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const id of ids) {
      const { data: meeting } = await admin.from("meetings").select("*").eq("id", id).single();
      if (!meeting) {
        results.push({ id, status: "skipped", reason: "meeting not found" });
        continue;
      }

      const content = [
        meeting.summary ? `SUMMARY:\n${meeting.summary}` : "",
        meeting.action_items ? `ACTION ITEMS:\n${JSON.stringify(meeting.action_items)}` : "",
        meeting.transcript ? `TRANSCRIPT:\n${String(meeting.transcript).slice(0, 30000)}` : "",
      ].filter(Boolean).join("\n\n");

      if (!content) {
        results.push({ id, status: "skipped", reason: "no content" });
        continue;
      }

      const projectList = (projects || [])
        .map((p: any) => `- ${p.name}${p.description ? `: ${String(p.description).slice(0, 120)}` : ""}`)
        .join("\n");
      const cardList = (cards || []).map((c: any) => `- ${c.task_code} ${c.title}`).join("\n");

      const systemPrompt = `You read an internal meeting record and identify items that may relate to existing project work.

You are NOT applying anything. You produce SUGGESTIONS only, for a human to review later.

Identify only these kinds:
- create_task: new piece of work being committed to
- update_due_date: a deadline appears to have moved
- update_owner: ownership appears to have changed
- complete_task: existing work stated as finished
- blocked: something is blocked or at risk
- decision: a decision that affects project work

Hard rules:
- Every item MUST include an exact verbatim quote from the record. Never paraphrase the quote.
- Only reference a Project or Area of Work when the content itself names or clearly concerns it.
  Shared attendees are NOT evidence of relevance and must never be the reason for a match.
- Prefer returning nothing over guessing. If unsure, use confidence "low".
- Use confidence "high" only when the item and the work it refers to are both explicit.
- Small talk, scheduling chatter and general commentary are not items.

Known Projects:
${projectList || "(none)"}

Known Areas of Work:
${cardList || "(none)"}`;

      let aiData: any;
      try {
        aiData = await callLLMWithFallback({
          workflow: "generic",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Meeting: "${meeting.title}" (${meeting.meeting_date || "date unknown"})\nAttendees: ${(meeting.participants || meeting.attendee_emails || []).join(", ") || "unknown"}\n\n${content}`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "submit_extractions",
              description: "Submit suggested project-related items found in the meeting",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        kind: { type: "string", enum: VALID_KINDS },
                        confidence: { type: "string", enum: VALID_CONFIDENCE },
                        source_quote: { type: "string", description: "Exact verbatim line from the record" },
                        reasoning: { type: "string", description: "One short sentence on why this is relevant" },
                        title: { type: "string", description: "Short description of the task or change" },
                        owner_name: { type: "string", description: "Person named, if any" },
                        due_date: { type: "string", description: "ISO date if a date is stated, else empty" },
                        project_hint: { type: "string", description: "Project or Area of Work named in the content, if any" },
                      },
                      required: ["kind", "confidence", "source_quote", "reasoning", "title"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["items"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_extractions" } },
          max_tokens: 8192,
        });
      } catch (err: any) {
        console.error("AI error for meeting", id, err?.status, err?.message);
        if (err?.status === 429) return json({ error: "Rate limited. Try again shortly.", extracted }, 429);
        if (err?.status === 402) return json({ error: "AI credits exhausted." }, 402);
        results.push({ id, status: "failed", reason: err?.message });
        continue;
      }

      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      const parsed = toolCall?.function?.arguments
        ? safeParseToolArguments<any>(toolCall.function.arguments)
        : null;
      const items: any[] = Array.isArray(parsed?.items) ? parsed.items : [];

      const rows: any[] = [];
      const links = new Map<string, any>();

      for (const item of items) {
        if (!VALID_KINDS.includes(item.kind) || !VALID_CONFIDENCE.includes(item.confidence)) continue;
        if (!item.source_quote || !String(item.source_quote).trim()) continue;

        const resolveText = [item.project_hint, item.title, item.source_quote].filter(Boolean).join(" \n ");
        const match = resolveShallow(resolveText, projects || [], cards || [], tasks || []);

        // Owner is only a hint in Phase 1 — never resolved to an account silently.
        const ownerGuess = item.owner_name
          ? (profiles || []).find((p: any) =>
              norm(p.full_name) && norm(item.owner_name) === norm(p.full_name))
          : undefined;

        // A kind that acts on an existing task but resolved to none can only be low confidence.
        const actsOnExisting = ["update_due_date", "update_owner", "complete_task"].includes(item.kind);
        const confidence = actsOnExisting && !match.task_id ? "low" : item.confidence;

        rows.push({
          meeting_id: id,
          kind: item.kind,
          status: "pending",
          confidence,
          project_id: match.project_id,
          card_id: match.card_id,
          task_id: match.task_id,
          source_quote: String(item.source_quote).slice(0, 2000),
          reasoning: item.reasoning ? String(item.reasoning).slice(0, 1000) : null,
          proposed: {
            title: item.title ?? null,
            owner_name: item.owner_name ?? null,
            owner_profile_id: ownerGuess?.id ?? null,
            due_date: item.due_date || null,
            project_hint: item.project_hint ?? null,
            meeting_title: meeting.title,
            meeting_date: meeting.meeting_date,
            meeting_source: meeting.source ?? null,
          },
        });

        // Meaning-level link only: the content itself named the project.
        if (match.project_id && (item.project_hint || match.card_id)) {
          links.set(match.project_id, {
            meeting_id: id,
            project_id: match.project_id,
            card_id: match.card_id,
            confidence,
            reasoning: item.reasoning ? String(item.reasoning).slice(0, 1000) : null,
            link_source: "duncan",
          });
        }
      }

      if (dry_run) {
        results.push({ id, title: meeting.title, status: "dry_run", items: rows });
        continue;
      }

      let inserted = 0;
      for (const row of rows) {
        // Deduplication index keeps a previously dismissed line from reappearing.
        const { error } = await admin.from("meeting_extractions").insert(row);
        if (error) {
          if (error.code === "23505") skipped++;
          else console.error("insert failed", error.message);
          continue;
        }
        inserted++;
      }
      extracted += inserted;

      if (links.size > 0) {
        await admin
          .from("meeting_project_links")
          .upsert(Array.from(links.values()), { onConflict: "meeting_id,project_id", ignoreDuplicates: true });
      }

      results.push({
        id,
        title: meeting.title,
        meeting_date: meeting.meeting_date,
        status: "extracted",
        suggestions: inserted,
        duplicates: rows.length - inserted,
      });
    }

    return json({ success: true, processed: ids.length, extracted, skipped_duplicates: skipped, results });
  } catch (error: any) {
    console.error("extract-meeting-updates error:", error);
    return json({ error: error?.message || "Extraction failed" }, 500);
  }
});
