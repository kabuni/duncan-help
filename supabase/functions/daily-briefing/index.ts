import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback, classifyLLMError } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Per-source resilience: wrap a gather step so a single failure doesn't tank the briefing.
type SourceResult<T> = { status: "ok" | "failed"; data: T | null; error?: string };
async function withStatus<T>(name: string, fn: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    const data = await fn();
    return { status: "ok", data };
  } catch (e: any) {
    console.warn(`[daily-briefing] source=${name} failed:`, e?.message || e);
    return { status: "failed", data: null, error: String(e?.message || e).slice(0, 240) };
  }
}

const PRIMARY_MODEL_DEGRADED = new Set(["claude-haiku-4-5", "gpt-5-mini"]);

const BRIEFING_SYSTEM_PROMPT = `You are Duncan, the company's operational intelligence assistant. You are writing a personalised morning briefing for one team member.

This is a REPORT, not a conversation. You receive a structured context object that has already been gathered for you. Do not ask follow-up questions, do not offer to take actions, do not mention tools. Just synthesise the context into a clear, scannable briefing.

Output rules:
- Use markdown. Open with a one-line greeting ("Good morning, <first name> — here's your briefing.").
- Cover sections in this order, but SKIP a section if its data is truly empty:
  1. 📅 Today's calendar
  2. ✅ Action items assigned to you (from meetings)
  3. 📌 Outstanding planner tasks
  4. 🗂️ Workstream cards & tasks assigned to you
  5. 🎓 Onboarding blockers (only if onboarding_blockers is non-empty — list red cards + overdue onboarding tasks with the new hire name)
  6. 🛠️ Recently changed work items
  7. 📝 Recent meeting summaries (1-line each, max 3)
  8. 📈 Your AI usage today + 30-day top 3 leaderboard (always include if token_usage data is present)
- Keep it tight. Bullets over paragraphs. Highlight blockers and overdue items.
- DATA COVERAGE: If the context object contains a "degraded_sources" array, add a short note at the end ("⚠️ Some data unavailable: …") naming the failed sources. Do not invent data for missing sections.
- Never speculate beyond what the context shows. Never mention "tools" or "I cannot access".`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const runStartedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  let userId: string | null = null;
  const degradedSources: string[] = [];

  try {
    // Parse request body (optional)
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const url = new URL(req.url);
    const format = body?.format || url.searchParams.get("format") || "briefing";
    const forceRefresh = !!body?.force;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = user.id;

    const userEmail = user.email || "";
    const userName = user.user_metadata?.display_name || userEmail;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, role_title, department, preferences")
      .eq("user_id", user.id)
      .maybeSingle();

    const displayName = profile?.display_name || userName;
    const firstName = displayName.toLowerCase().split(" ")[0];
    const now = new Date();
    const prefs = (profile?.preferences as Record<string, any>) || {};
    const lastBriefingAt = prefs.last_briefing_at ? new Date(prefs.last_briefing_at) : null;

    // Gate: only one briefing per UTC calendar day per user (unless force).
    const todayUTC = now.toISOString().split("T")[0];
    const lastBriefingDay = lastBriefingAt ? lastBriefingAt.toISOString().split("T")[0] : null;
    if (!forceRefresh && format === "briefing" && lastBriefingDay === todayUTC) {
      console.log("daily-briefing: already shown today for user", user.id);
      return new Response(
        JSON.stringify({ already_shown_today: true, last_briefing_at: lastBriefingAt?.toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const minSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sinceDatetime = lastBriefingAt && lastBriefingAt < minSince ? lastBriefingAt : minSince;
    const sinceISO = sinceDatetime.toISOString();
    const today = now.toISOString().split("T")[0];

    // ── 1. Gather context (per-source resilience) ──
    const contextStartedAt = Date.now();

    const [
      calendar,
      meetings,
      workItems,
      myTokenUsage,
      leaderboard,
      assignedCards,
      assignedTasks,
      projectTasks,
      onboardingBlockers,
    ] = await Promise.all([
      withStatus("calendar", () => fetchCalendarEvents(supabaseUrl, supabaseAdmin, authHeader, user.id)),
      withStatus("meetings", async () => {
        const { data, error } = await supabaseAdmin
          .from("meetings")
          .select("id, title, meeting_date, summary, action_items, analysis, status")
          .gte("meeting_date", sinceISO)
          .order("meeting_date", { ascending: false })
          .limit(10);
        if (error) throw error;
        return data || [];
      }),
      withStatus("work_items", async () => {
        const { data, error } = await supabaseAdmin
          .from("azure_work_items")
          .select("external_id, title, state, work_item_type, priority, changed_date, project_name, assigned_to")
          .or(`assigned_to.ilike.%${displayName}%,assigned_to.ilike.%${userEmail}%`)
          .gte("changed_date", sinceISO)
          .order("changed_date", { ascending: false })
          .limit(15);
        if (error) throw error;
        return data || [];
      }),
      withStatus("token_usage", async () => {
        const { data, error } = await supabaseAdmin
          .from("token_usage")
          .select("total_tokens, request_count, prompt_tokens, completion_tokens")
          .eq("user_id", user.id)
          .eq("usage_date", today)
          .maybeSingle();
        if (error) throw error;
        return data || { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, request_count: 0 };
      }),
      withStatus("leaderboard", () => fetchTokenLeaderboard(supabaseAdmin)),
      withStatus("workstream_cards", () => fetchAssignedCards(supabaseAdmin, user.id)),
      withStatus("workstream_tasks", () => fetchAssignedTasks(supabaseAdmin, user.id)),
      withStatus("project_tasks", () => fetchProjectTasks(supabaseAdmin, user.id)),
      withStatus("onboarding_blockers", () => fetchOnboardingBlockers(supabaseAdmin)),
    ]);

    const contextMs = Date.now() - contextStartedAt;

    // Track which sources degraded.
    for (const [name, src] of [
      ["calendar", calendar], ["meetings", meetings], ["work_items", workItems],
      ["token_usage", myTokenUsage], ["leaderboard", leaderboard],
      ["workstream_cards", assignedCards], ["workstream_tasks", assignedTasks],
      ["project_tasks", projectTasks], ["onboarding_blockers", onboardingBlockers],
    ] as const) {
      if (src.status === "failed") degradedSources.push(name);
    }

    // Extract action items assigned to user from meetings (only if meetings ok)
    const userActionItems: any[] = [];
    if (meetings.status === "ok" && Array.isArray(meetings.data)) {
      for (const meeting of meetings.data as any[]) {
        if (meeting.action_items && Array.isArray(meeting.action_items)) {
          for (const item of meeting.action_items as any[]) {
            const assignee = (item.assignee || item.owner || "").toLowerCase();
            if (assignee.includes(firstName) || assignee.includes(userEmail.toLowerCase())) {
              userActionItems.push({
                action: item.action || item.title || item.description,
                meeting_title: meeting.title,
                meeting_date: meeting.meeting_date,
                due: item.due_date || item.deadline || null,
              });
            }
          }
        }
      }
    }

    const context = {
      user: {
        name: displayName,
        first_name: firstName,
        role: profile?.role_title || null,
        department: profile?.department || null,
      },
      since: lastBriefingAt ? lastBriefingAt.toISOString() : null,
      is_first_briefing: !lastBriefingAt,
      generated_at: now.toISOString(),
      degraded_sources: degradedSources,
      sources: {
        calendar: {
          status: calendar.status,
          error: calendar.error,
          todays_events: calendar.data || [],
        },
        meetings: {
          status: meetings.status,
          error: meetings.error,
          recent: (meetings.data as any[] | null)?.map((m) => ({
            title: m.title, date: m.meeting_date, summary: m.summary, status: m.status,
          })) || [],
          my_action_items: userActionItems,
        },
        work_items: {
          status: workItems.status,
          error: workItems.error,
          recently_changed: (workItems.data as any[] | null)?.map((w) => ({
            id: w.external_id, title: w.title, state: w.state, type: w.work_item_type,
            priority: w.priority, project: w.project_name,
          })) || [],
        },
        workstreams: {
          status: (assignedCards.status === "ok" && assignedTasks.status === "ok") ? "ok" : "failed",
          assigned_cards: assignedCards.data || [],
          assigned_tasks: assignedTasks.data || [],
        },
        project_tasks: {
          status: projectTasks.status,
          error: projectTasks.error,
          outstanding: projectTasks.data || [],
        },
        token_usage: {
          status: (myTokenUsage.status === "ok" && leaderboard.status === "ok") ? "ok" : "failed",
          my_today: myTokenUsage.data,
          leaderboard: leaderboard.data || [],
        },
      },
    };

    // Optional raw-context mode for other surfaces (no LLM call).
    if (format === "context") {
      return new Response(JSON.stringify(context), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Synthesise via shared LLM router ──
    const llmStartedAt = Date.now();
    let llmResult: Awaited<ReturnType<typeof callLLMWithFallback>> | null = null;
    let synthesisError: any = null;
    try {
      llmResult = await callLLMWithFallback({
        workflow: "daily-briefing",
        max_tokens: 2000,
        messages: [
          { role: "system", content: BRIEFING_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Generate my personalised morning briefing. Context object:\n\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      });
    } catch (err) {
      synthesisError = err;
    }
    const llmMs = Date.now() - llmStartedAt;
    const totalMs = Date.now() - runStartedAt;

    if (synthesisError || !llmResult) {
      const classified = synthesisError
        ? (synthesisError.code
            ? synthesisError
            : classifyLLMError("openai", synthesisError?.status, synthesisError?.message || String(synthesisError)))
        : classifyLLMError("openai", 502, "empty LLM result");
      // Persist failure metric
      await writeMetric(supabaseAdmin, {
        user_id: userId!,
        total_ms: totalMs,
        context_ms: contextMs,
        llm_ms: llmMs,
        status: "failed",
        model: null,
        provider: null,
        attempts: 1,
        fallback_used: false,
        degraded: false,
        degraded_sources: degradedSources,
        prompt_tokens: null,
        completion_tokens: null,
        error_code: classified.code || "upstream_error",
        error_message: String(classified.message || synthesisError?.message || "").slice(0, 500),
      });
      console.log(
        `[briefing] user=${userId} status=failed total_ms=${totalMs} context_ms=${contextMs} llm_ms=${llmMs} ` +
        `degraded_sources=${JSON.stringify(degradedSources)} error_code=${classified.code} error="${(classified.message || "").slice(0, 120)}"`,
      );
      return new Response(
        JSON.stringify({
          error: classified.message || "Briefing synthesis failed",
          error_code: classified.code || "upstream_error",
          degraded_sources: degradedSources,
        }),
        { status: classified.status >= 400 ? classified.status : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const markdown = llmResult.choices?.[0]?.message?.content || "";
    const provider = llmResult._provider;
    const model = llmResult._model;
    const fallbackUsed = provider !== "claude"; // primary for daily-briefing is claude
    const degraded = PRIMARY_MODEL_DEGRADED.has(model);

    await writeMetric(supabaseAdmin, {
      user_id: userId!,
      total_ms: totalMs,
      context_ms: contextMs,
      llm_ms: llmMs,
      status: "success",
      model,
      provider,
      attempts: 1, // router doesn't expose attempt count; tracked via fallback/degraded flags
      fallback_used: fallbackUsed,
      degraded,
      degraded_sources: degradedSources,
      prompt_tokens: llmResult.usage?.prompt_tokens ?? null,
      completion_tokens: llmResult.usage?.completion_tokens ?? null,
      error_code: null,
      error_message: null,
    });

    console.log(
      `[briefing] user=${userId} status=success total_ms=${totalMs} context_ms=${contextMs} llm_ms=${llmMs} ` +
      `provider=${provider} model=${model} fallback=${fallbackUsed} degraded=${degraded} ` +
      `degraded_sources=${JSON.stringify(degradedSources)} ` +
      `tokens_in=${llmResult.usage?.prompt_tokens ?? 0} tokens_out=${llmResult.usage?.completion_tokens ?? 0}`,
    );

    return new Response(
      JSON.stringify({
        markdown,
        provider,
        model,
        fallback_used: fallbackUsed,
        degraded,
        degraded_sources: degradedSources,
        took_ms: totalMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("daily-briefing error:", e);
    // Best-effort failure metric if we know the user.
    if (userId) {
      try {
        await writeMetric(supabaseAdmin, {
          user_id: userId,
          total_ms: Date.now() - runStartedAt,
          context_ms: null,
          llm_ms: null,
          status: "failed",
          model: null,
          provider: null,
          attempts: 1,
          fallback_used: false,
          degraded: false,
          degraded_sources: degradedSources,
          prompt_tokens: null,
          completion_tokens: null,
          error_code: "upstream_error",
          error_message: String(e?.message || e).slice(0, 500),
        });
      } catch { /* swallow */ }
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Metrics writer ──
async function writeMetric(supabaseAdmin: any, row: {
  user_id: string;
  total_ms: number | null;
  context_ms: number | null;
  llm_ms: number | null;
  status: "success" | "failed";
  model: string | null;
  provider: string | null;
  attempts: number;
  fallback_used: boolean;
  degraded: boolean;
  degraded_sources: string[];
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error_code: string | null;
  error_message: string | null;
}) {
  try {
    const { error } = await supabaseAdmin.from("briefing_runs").insert(row);
    if (error) console.warn("[briefing] metric write failed:", error.message);
  } catch (e: any) {
    console.warn("[briefing] metric write threw:", e?.message || e);
  }
}

// ── Helper: Fetch Google Calendar events for today ──
async function fetchCalendarEvents(
  supabaseUrl: string,
  supabaseAdmin: any,
  authHeader: string,
  userId: string
): Promise<any[]> {
  const { data: calToken } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!calToken) {
    console.log("Calendar briefing: no token found for user", userId);
    return [];
  }

  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  const resp = await fetch(`${supabaseUrl}/functions/v1/google-calendar-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({
      action: "listEvents",
      params: { timeMin: startOfDay.toISOString(), timeMax: endOfDay.toISOString(), maxResults: 20 },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`calendar-api ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const result = await resp.json();
  const events = result.items || result || [];
  if (!Array.isArray(events)) return [];

  return events.map((e: any) => ({
    title: e.summary || "No title",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || null,
    attendees: e.attendees?.length || 0,
  }));
}

// ── Helper: Fetch top 3 users by token usage (last 30 days) ──
async function fetchTokenLeaderboard(supabaseAdmin: any) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data: usageData, error } = await supabaseAdmin
    .from("token_usage")
    .select("user_id, total_tokens, request_count")
    .gte("usage_date", thirtyDaysAgo);

  if (error) throw error;
  if (!usageData || usageData.length === 0) return [];

  const userTotals: Record<string, { total_tokens: number; request_count: number }> = {};
  for (const row of usageData) {
    if (!userTotals[row.user_id]) userTotals[row.user_id] = { total_tokens: 0, request_count: 0 };
    userTotals[row.user_id].total_tokens += row.total_tokens;
    userTotals[row.user_id].request_count += row.request_count;
  }

  const sorted = Object.entries(userTotals)
    .sort((a, b) => b[1].total_tokens - a[1].total_tokens)
    .slice(0, 3);

  const userIds = sorted.map(([uid]) => uid);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  const nameMap: Record<string, string> = {};
  for (const p of profiles || []) nameMap[p.user_id] = p.display_name || "Unknown";

  return sorted.map(([uid, stats], index) => ({
    rank: index + 1,
    name: nameMap[uid] || "Unknown",
    total_tokens: stats.total_tokens,
    request_count: stats.request_count,
  }));
}

// ── Helper: Fetch workstream cards assigned to user ──
async function fetchAssignedCards(supabaseAdmin: any, userId: string) {
  const { data: assignments, error } = await supabaseAdmin
    .from("workstream_card_assignees")
    .select("card_id, assignment_status")
    .eq("user_id", userId);
  if (error) throw error;
  if (!assignments || assignments.length === 0) return [];

  const cardIds = assignments.map((a: any) => a.card_id);
  const statusMap: Record<string, string> = {};
  for (const a of assignments) statusMap[a.card_id] = a.assignment_status;

  const { data: cards, error: cErr } = await supabaseAdmin
    .from("workstream_cards")
    .select("id, title, status, priority, due_date, project_tag, updated_at")
    .in("id", cardIds)
    .is("archived_at", null)
    .neq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(15);
  if (cErr) throw cErr;

  return (cards || []).map((c: any) => ({
    title: c.title, status: c.status, priority: c.priority,
    due_date: c.due_date, project_tag: c.project_tag,
    assignment_status: statusMap[c.id] || "pending",
  }));
}

// ── Helper: Fetch workstream tasks assigned to user (incomplete) ──
async function fetchAssignedTasks(supabaseAdmin: any, userId: string) {
  const [taskAssigneeResult, directAssignResult] = await Promise.all([
    supabaseAdmin.from("workstream_task_assignees").select("task_id").eq("user_id", userId),
    supabaseAdmin
      .from("workstream_tasks")
      .select("id, title, completed, due_date, card_id")
      .eq("assignee_id", userId)
      .eq("completed", false)
      .limit(20),
  ]);
  if (taskAssigneeResult.error) throw taskAssigneeResult.error;
  if (directAssignResult.error) throw directAssignResult.error;

  const taskIds = new Set<string>();
  for (const ta of taskAssigneeResult.data || []) taskIds.add(ta.task_id);
  for (const t of directAssignResult.data || []) taskIds.add(t.id);
  if (taskIds.size === 0) return [];

  const { data: tasks, error } = await supabaseAdmin
    .from("workstream_tasks")
    .select("id, title, completed, due_date, card_id")
    .in("id", Array.from(taskIds))
    .eq("completed", false)
    .limit(20);
  if (error) throw error;
  if (!tasks || tasks.length === 0) return [];

  const cardIds = [...new Set(tasks.map((t: any) => t.card_id))];
  const { data: cards } = await supabaseAdmin
    .from("workstream_cards")
    .select("id, title")
    .in("id", cardIds);
  const cardMap: Record<string, string> = {};
  for (const c of cards || []) cardMap[c.id] = c.title;

  return tasks.map((t: any) => ({
    title: t.title, due_date: t.due_date, card_title: cardMap[t.card_id] || "Unknown card",
  }));
}

// ── Helper: Fetch outstanding project tasks assigned to user ──
async function fetchProjectTasks(supabaseAdmin: any, userId: string | null) {
  if (!userId) return [];
  const { data: tasks, error } = await supabaseAdmin
    .from("project_chat_plan_items")
    .select("id, project_id, title, status, due_date, deadline, completed_at")
    .eq("assignee_profile_id", userId)
    .is("completed_at", null)
    .neq("status", "done")
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(25);
  if (error) throw error;
  if (!tasks || tasks.length === 0) return [];

  const projectIds = [...new Set(tasks.map((t: any) => t.project_id).filter(Boolean))];
  const { data: projects } = await supabaseAdmin.from("projects").select("id, name").in("id", projectIds);
  const projectMap: Record<string, string> = {};
  for (const p of projects || []) projectMap[p.id] = p.name;

  const today = new Date().toISOString().split("T")[0];
  return tasks.map((t: any) => ({
    title: t.title,
    status: t.status,
    due_date: t.due_date,
    deadline: t.deadline,
    project: projectMap[t.project_id] || "Unknown project",
    overdue_deadline: !!(t.deadline && t.deadline < today),
    overdue_due: !!(t.due_date && t.due_date < today),
  }));
}
