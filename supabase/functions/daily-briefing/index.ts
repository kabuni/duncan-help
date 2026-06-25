import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

    const userEmail = user.email || "";
    const userName = user.user_metadata?.display_name || userEmail;

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, role_title, department, preferences")
      .eq("user_id", user.id)
      .maybeSingle();
    const profileId = profile?.id || null;

    const displayName = profile?.display_name || userName;
    const firstName = displayName.toLowerCase().split(" ")[0];
    const now = new Date();
    const prefs = (profile?.preferences as Record<string, any>) || {};
    const lastBriefingAt = prefs.last_briefing_at
      ? new Date(prefs.last_briefing_at)
      : null;

    // Gate: only one briefing per UTC calendar day per user
    const todayUTC = now.toISOString().split("T")[0];
    const lastBriefingDay = lastBriefingAt
      ? lastBriefingAt.toISOString().split("T")[0]
      : null;
    if (lastBriefingDay === todayUTC) {
      console.log("daily-briefing: already shown today for user", user.id);
      return new Response(
        JSON.stringify({ already_shown_today: true, last_briefing_at: lastBriefingAt?.toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use a minimum 24h window so data is always meaningful
    const minSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sinceDatetime = lastBriefingAt && lastBriefingAt < minSince
      ? lastBriefingAt
      : minSince;
    const sinceISO = sinceDatetime.toISOString();

    const today = now.toISOString().split("T")[0];

    // Run queries in parallel
    const [
      calendarResult,
      meetingsResult,
      workItemsResult,
      _wikiPlaceholder,
      myTokenUsage,
      leaderboardResult,
      assignedCardsResult,
      assignedTasksResult,
      projectTasksResult,
    ] = await Promise.all([
      fetchCalendarEvents(supabaseUrl, supabaseAdmin, authHeader, user.id),

      supabaseAdmin
        .from("meetings")
        .select("id, title, meeting_date, summary, action_items, analysis, status")
        .gte("meeting_date", sinceISO)
        .order("meeting_date", { ascending: false })
        .limit(10),

      supabaseAdmin
        .from("azure_work_items")
        .select("external_id, title, state, work_item_type, priority, changed_date, project_name, assigned_to")
        .or(`assigned_to.ilike.%${displayName}%,assigned_to.ilike.%${userEmail}%`)
        .gte("changed_date", sinceISO)
        .order("changed_date", { ascending: false })
        .limit(15),

      Promise.resolve(null),

      supabaseAdmin
        .from("token_usage")
        .select("total_tokens, request_count, prompt_tokens, completion_tokens")
        .eq("user_id", user.id)
        .eq("usage_date", today)
        .maybeSingle(),

      fetchTokenLeaderboard(supabaseAdmin),

      // Workstream cards assigned to user (active, not archived)
      fetchAssignedCards(supabaseAdmin, user.id),

      // Workstream tasks assigned to user (incomplete)
      fetchAssignedTasks(supabaseAdmin, user.id),

      // Outstanding project tasks (project_chat_plan_items) assigned to user
      fetchProjectTasks(supabaseAdmin, profileId),
    ]);

    // NOTE: We deliberately do NOT update last_briefing_at here.
    // The lock is applied only after successful LLM stream via the
    // `mark-briefing-shown` endpoint. This prevents silent lockouts
    // when the briefing fails mid-flight.

    // Extract action items assigned to user from meetings
    const userActionItems: any[] = [];
    if (meetingsResult.data) {
      for (const meeting of meetingsResult.data) {
        if (meeting.action_items && Array.isArray(meeting.action_items)) {
          for (const item of meeting.action_items as any[]) {
            const assignee = (item.assignee || item.owner || "").toLowerCase();
            if (
              assignee.includes(firstName) ||
              assignee.includes(userEmail.toLowerCase())
            ) {
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

    // Build briefing data
    const briefing = {
      user: {
        name: displayName,
        role: profile?.role_title || null,
        department: profile?.department || null,
      },
      since: lastBriefingAt ? lastBriefingAt.toISOString() : null,
      is_first_briefing: !lastBriefingAt,
      calendar: {
        todays_events: calendarResult || [],
      },
      meetings: {
        recent: meetingsResult.data?.map((m) => ({
          title: m.title,
          date: m.meeting_date,
          summary: m.summary,
          status: m.status,
        })) || [],
        my_action_items: userActionItems,
      },
      work_items: {
        recently_changed: workItemsResult.data?.map((w) => ({
          id: w.external_id,
          title: w.title,
          state: w.state,
          type: w.work_item_type,
          priority: w.priority,
          project: w.project_name,
        })) || [],
      },
      workstreams: {
        assigned_cards: assignedCardsResult || [],
        assigned_tasks: assignedTasksResult || [],
      },
      project_tasks: {
        outstanding: projectTasksResult || [],
      },
      token_usage: {
        my_today: myTokenUsage.data ? {
          total_tokens: myTokenUsage.data.total_tokens,
          prompt_tokens: myTokenUsage.data.prompt_tokens,
          completion_tokens: myTokenUsage.data.completion_tokens,
          request_count: myTokenUsage.data.request_count,
        } : { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, request_count: 0 },
        leaderboard: leaderboardResult || [],
      },
      generated_at: now.toISOString(),
    };

    return new Response(JSON.stringify(briefing), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("daily-briefing error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Helper: Fetch Google Calendar events for today ──
async function fetchCalendarEvents(
  supabaseUrl: string,
  supabaseAdmin: any,
  authHeader: string,
  userId: string
): Promise<any[]> {
  try {
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
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    console.log("Calendar briefing: fetching events for", startOfDay.toISOString(), "to", endOfDay.toISOString());

    const resp = await fetch(`${supabaseUrl}/functions/v1/google-calendar-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        action: "listEvents",
        params: {
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          maxResults: 20,
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Calendar briefing: API error", resp.status, errText);
      return [];
    }
    const result = await resp.json();
    console.log("Calendar briefing: raw result keys", Object.keys(result));
    const events = result.items || result || [];
    if (!Array.isArray(events)) {
      console.log("Calendar briefing: events not an array", typeof events);
      return [];
    }

    console.log("Calendar briefing: found", events.length, "events");

    return events.map((e: any) => ({
      title: e.summary || "No title",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      attendees: e.attendees?.length || 0,
    }));
  } catch (err: any) {
    console.error("Calendar briefing error:", err);
    return [];
  }
}

// ── Helper: Fetch top 3 users by token usage (last 30 days) ──
async function fetchTokenLeaderboard(supabaseAdmin: any) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const { data: usageData } = await supabaseAdmin
      .from("token_usage")
      .select("user_id, total_tokens, request_count")
      .gte("usage_date", thirtyDaysAgo);

    if (!usageData || usageData.length === 0) return [];

    const userTotals: Record<string, { total_tokens: number; request_count: number }> = {};
    for (const row of usageData) {
      if (!userTotals[row.user_id]) {
        userTotals[row.user_id] = { total_tokens: 0, request_count: 0 };
      }
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
    if (profiles) {
      for (const p of profiles) {
        nameMap[p.user_id] = p.display_name || "Unknown";
      }
    }

    return sorted.map(([uid, stats], index) => ({
      rank: index + 1,
      name: nameMap[uid] || "Unknown",
      total_tokens: stats.total_tokens,
      request_count: stats.request_count,
    }));
  } catch (err: any) {
    console.error("Leaderboard error:", err);
    return [];
  }
}

// ── Helper: Fetch workstream cards assigned to user ──
async function fetchAssignedCards(supabaseAdmin: any, userId: string) {
  try {
    // Get card IDs where user is assigned
    const { data: assignments } = await supabaseAdmin
      .from("workstream_card_assignees")
      .select("card_id, assignment_status")
      .eq("user_id", userId);

    if (!assignments || assignments.length === 0) return [];

    const cardIds = assignments.map((a: any) => a.card_id);
    const statusMap: Record<string, string> = {};
    for (const a of assignments) {
      statusMap[a.card_id] = a.assignment_status;
    }

    const { data: cards } = await supabaseAdmin
      .from("workstream_cards")
      .select("id, title, status, priority, due_date, project_tag, updated_at")
      .in("id", cardIds)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(15);

    return (cards || []).map((c: any) => ({
      title: c.title,
      status: c.status,
      priority: c.priority,
      due_date: c.due_date,
      project_tag: c.project_tag,
      assignment_status: statusMap[c.id] || "pending",
    }));
  } catch (err: any) {
    console.error("Workstream cards briefing error:", err);
    return [];
  }
}

// ── Helper: Fetch workstream tasks assigned to user (incomplete) ──
async function fetchAssignedTasks(supabaseAdmin: any, userId: string) {
  try {
    // Check both task_assignees table and direct assignee_id
    const [taskAssigneeResult, directAssignResult] = await Promise.all([
      supabaseAdmin
        .from("workstream_task_assignees")
        .select("task_id")
        .eq("user_id", userId),
      supabaseAdmin
        .from("workstream_tasks")
        .select("id, title, completed, due_date, card_id")
        .eq("assignee_id", userId)
        .eq("completed", false)
        .limit(20),
    ]);

    const taskIds = new Set<string>();
    if (taskAssigneeResult.data) {
      for (const ta of taskAssigneeResult.data) taskIds.add(ta.task_id);
    }
    if (directAssignResult.data) {
      for (const t of directAssignResult.data) taskIds.add(t.id);
    }

    if (taskIds.size === 0) return [];

    const { data: tasks } = await supabaseAdmin
      .from("workstream_tasks")
      .select("id, title, completed, due_date, card_id")
      .in("id", Array.from(taskIds))
      .eq("completed", false)
      .limit(20);

    if (!tasks || tasks.length === 0) return [];

    // Get card titles for context
    const cardIds = [...new Set(tasks.map((t: any) => t.card_id))];
    const { data: cards } = await supabaseAdmin
      .from("workstream_cards")
      .select("id, title")
      .in("id", cardIds);

    const cardMap: Record<string, string> = {};
    if (cards) {
      for (const c of cards) cardMap[c.id] = c.title;
    }

    return tasks.map((t: any) => ({
      title: t.title,
      due_date: t.due_date,
      card_title: cardMap[t.card_id] || "Unknown card",
    }));
  } catch (err: any) {
    console.error("Workstream tasks briefing error:", err);
    return [];
  }
}
