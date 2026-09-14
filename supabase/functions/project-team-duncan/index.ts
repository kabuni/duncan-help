// Duncan as a participant inside the single Project Team Chat.
// Reads real project context (areas of work, tasks, progress, activity, planner)
// and replies into the same project_messages thread. No separate chat history.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const messageId = typeof body?.messageId === "string" ? body.messageId : null;
    if (!projectId) return json({ error: "projectId is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Access check via the same rules the app uses.
    const { data: canAccess } = await admin.rpc("can_access_project", {
      _project_id: projectId,
      _user_id: user.id,
    });
    if (!canAccess) return json({ error: "Forbidden" }, 403);

    // ---- Project context -------------------------------------------------
    const [
      { data: project },
      { data: cards },
      { data: tasks },
      { data: recentMsgs },
      { data: memberRows },
    ] = await Promise.all([
      admin.from("projects").select("*").eq("id", projectId).maybeSingle(),
      admin
        .from("workstream_cards")
        .select("id, task_code, title, description, status, priority, due_date, owner_id")
        .eq("project_id", projectId),
      admin
        .from("workstream_tasks")
        .select("id, title, status, completed, due_date, assignee_id, project_id, card_id")
        .or(`project_id.eq.${projectId}`),
      admin
        .from("project_messages")
        .select("content, author_type, user_id, created_at")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      admin.from("project_members").select("user_id").eq("project_id", projectId),
    ]);

    if (!project) return json({ error: "Project not found" }, 404);

    const cardIds = (cards || []).map((c: any) => c.id);
    let allTasks = (tasks || []) as any[];
    if (cardIds.length) {
      const { data: cardTasks } = await admin
        .from("workstream_tasks")
        .select("id, title, status, completed, due_date, assignee_id, project_id, card_id")
        .in("card_id", cardIds);
      const seen = new Set(allTasks.map((t) => t.id));
      for (const t of (cardTasks || []) as any[]) if (!seen.has(t.id)) allTasks.push(t);
    }

    let activity: any[] = [];
    if (cardIds.length) {
      const { data: act } = await admin
        .from("workstream_activity")
        .select("action, details, created_at, card_id")
        .in("card_id", cardIds)
        .order("created_at", { ascending: false })
        .limit(20);
      activity = (act || []) as any[];
    }

    // People: project members + card owners + task assignees, so Duncan can name and assign.
    const peopleIds = new Set<string>();
    for (const m of (memberRows || []) as any[]) peopleIds.add(m.user_id);
    if (project.user_id) peopleIds.add(project.user_id);
    for (const c of (cards || []) as any[]) if (c.owner_id) peopleIds.add(c.owner_id);
    for (const t of allTasks) if (t.assignee_id) peopleIds.add(t.assignee_id);
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, display_name, role_title")
      .in("user_id", Array.from(peopleIds).length ? Array.from(peopleIds) : ["00000000-0000-0000-0000-000000000000"]);
    const nameOf = (id?: string | null) =>
      (profiles || []).find((p: any) => p.user_id === id)?.display_name || (id ? "Unassigned" : "Unassigned");

    // Planner items that mention this project by name (read-only awareness).
    const { data: plannerEvents } = await admin
      .from("key_events")
      .select("title, start_date, category, status")
      .gte("start_date", new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
      .order("start_date", { ascending: true })
      .limit(40);

    const done = allTasks.filter((t) => t.completed || t.status === "done").length;
    const total = allTasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const today = new Date().toISOString().slice(0, 10);

    const cardLine = (c: any) => {
      const ts = allTasks.filter((t) => t.card_id === c.id);
      const d = ts.filter((t) => t.completed || t.status === "done").length;
      return `- ${c.title} (${c.task_code || "WS"}) — owner ${nameOf(c.owner_id)}, status ${c.status}, due ${c.due_date || "none"}, ${d}/${ts.length} tasks done`;
    };
    const taskLine = (t: any) =>
      `- ${t.title} — ${t.completed || t.status === "done" ? "done" : t.status || "not started"}, assignee ${nameOf(t.assignee_id)}, due ${t.due_date || "none"}${t.due_date && t.due_date < today && !(t.completed || t.status === "done") ? " (OVERDUE)" : ""}`;

    const transcript = ((recentMsgs || []) as any[])
      .slice()
      .reverse()
      .map((m) => `${m.author_type === "duncan" ? "Duncan" : nameOf(m.user_id)}: ${m.content}`)
      .join("\n");

    const context = `PROJECT: ${project.name}
Description: ${project.description || "none"}
Status: ${project.status} | Target date: ${project.target_date || "none"} | Owner: ${nameOf(project.user_id)}
Overall progress: ${pct}% (${done} of ${total} tasks complete)
Today: ${today}

AREAS OF WORK (${(cards || []).length}):
${(cards || []).map(cardLine).join("\n") || "- none yet"}

TASKS (${total}):
${allTasks.map(taskLine).join("\n") || "- none yet"}

RECENT ACTIVITY:
${activity.map((a) => `- ${a.action}: ${typeof a.details === "string" ? a.details : JSON.stringify(a.details)}`).join("\n") || "- none"}

PLANNER (upcoming company/calendar items, read-only):
${((plannerEvents || []) as any[]).map((e) => `- ${e.start_date}: ${e.title} [${e.category || "Event"}]`).join("\n") || "- none"}

PROJECT TEAM:
${(profiles || []).map((p: any) => `- ${p.display_name}${p.role_title ? ` (${p.role_title})` : ""}`).join("\n") || "- none"}

RECENT TEAM CHAT:
${transcript}`;

    const system = `You are Duncan, an intelligent teammate inside this project's team chat. You are one participant in a group conversation — not a separate assistant app.

Rules:
- Be brief and human. 1-4 short sentences, or a tight bullet list. No preamble, no sign-off.
- Ground every answer in the project context provided. Never invent tasks, people, dates or progress.
- If you don't have the information, say so plainly.
- You can create a task with the create_task tool when someone asks for work to be added. Match the assignee to a real team member name; if unclear, leave it unassigned and say so.
- Treat the team's conversation as project context: what people say about blockers and dependencies matters.
- Only respond to what was actually asked. Don't summarise the whole project unless asked.

${context}`;

    const lastMessage = String(body?.message || "").slice(0, 4000);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

    const tools = [
      {
        type: "function",
        function: {
          name: "create_task",
          description: "Create a task in this project. Use when a team member asks Duncan to add/assign work.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              assignee_name: { type: "string", description: "Exact display name of a team member, or empty" },
              due_date: { type: "string", description: "YYYY-MM-DD, or empty" },
              area_of_work: { type: "string", description: "Title of an existing area of work, or empty" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
    ];

    const messages: any[] = [
      { role: "system", content: system },
      { role: "user", content: lastMessage },
    ];

    const callModel = async () => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "gpt-4o", messages, tools, temperature: 0.3, max_tokens: 600 }),
      });
      if (!res.ok) throw new Error(`AI error ${res.status}: ${await res.text()}`);
      return await res.json();
    };

    let data = await callModel();
    let choice = data.choices?.[0];

    // One tool round is enough for chat-scale actions.
    const toolCalls = choice?.message?.tool_calls || [];
    if (toolCalls.length) {
      messages.push(choice.message);
      for (const call of toolCalls) {
        let result = "ok";
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          if (call.function.name === "create_task") {
            const assignee = (profiles || []).find(
              (p: any) =>
                args.assignee_name &&
                String(p.display_name || "").toLowerCase().includes(String(args.assignee_name).toLowerCase()),
            );
            const card = (cards || []).find(
              (c: any) =>
                args.area_of_work &&
                String(c.title || "").toLowerCase().includes(String(args.area_of_work).toLowerCase()),
            );
            const { error } = await admin.from("workstream_tasks").insert({
              title: String(args.title).slice(0, 300),
              project_id: projectId,
              card_id: card?.id ?? null,
              assignee_id: assignee?.user_id ?? null,
              due_date: /^\d{4}-\d{2}-\d{2}$/.test(args.due_date || "") ? args.due_date : null,
              status: "not_started",
              completed: false,
            });
            if (!error && card?.id) {
              await admin.from("workstream_activity").insert({
                card_id: card.id,
                user_id: user.id,
                action: "task_added",
                details: { title: args.title, via: "Duncan in Team Chat" },
              });
            }
            result = error
              ? `failed: ${error.message}`
              : `created task "${args.title}"${assignee ? ` for ${assignee.display_name}` : " (unassigned)"}${args.due_date ? ` due ${args.due_date}` : ""}`;
          }
        } catch (e) {
          result = `failed: ${(e as Error).message}`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      data = await callModel();
      choice = data.choices?.[0];
    }

    const reply = (choice?.message?.content || "").trim();
    if (!reply) return json({ ok: true, skipped: true });

    const { error: insErr } = await admin.from("project_messages").insert({
      project_id: projectId,
      user_id: null,
      author_type: "duncan",
      content: reply,
      reply_to_id: messageId,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    console.error("project-team-duncan error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
