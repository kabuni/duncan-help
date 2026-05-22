import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

// --- Slack DM via connector gateway ---

async function sendSlackDM(
  slackUserId: string,
  message: string
): Promise<boolean> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const slackConnectionKey = Deno.env.get("SLACK_API_KEY");

  if (!lovableApiKey || !slackConnectionKey) {
    console.error("Missing LOVABLE_API_KEY or SLACK_API_KEY");
    return false;
  }

  const headers = {
    Authorization: `Bearer ${lovableApiKey}`,
    "X-Connection-Api-Key": slackConnectionKey,
    "Content-Type": "application/json",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const openRes = await fetch(`${SLACK_GATEWAY_URL}/conversations.open`, {
        method: "POST",
        headers,
        body: JSON.stringify({ users: slackUserId }),
      });
      const openData = await openRes.json();
      if (!openData.ok) {
        console.error(`conversations.open failed (attempt ${attempt + 1}):`, openData.error);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
        return false;
      }

      const channelId = openData.channel.id;
      const msgRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          channel: channelId,
          text: message,
          username: "Duncan",
          icon_emoji: ":bell:",
        }),
      });
      const msgData = await msgRes.json();
      if (!msgData.ok) {
        console.error(`postMessage failed (attempt ${attempt + 1}):`, msgData.error);
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
        return false;
      }
      return true;
    } catch (err: any) {
      console.error(`Slack DM exception (attempt ${attempt + 1}):`, err);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
      return false;
    }
  }
  return false;
}

// --- Deduplication ---

async function isDuplicate(supabase: any, eventKey: string, windowHours: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("slack_notification_logs")
      .select("id")
      .eq("event_key", eventKey)
      .gte("created_at", cutoff)
      .limit(1);
    if (error) { console.error("Dedup check error:", error); return false; }
    return data && data.length > 0;
  } catch {
    return false;
  }
}

async function logNotification(
  supabase: any,
  slackUserId: string,
  payload: Record<string, unknown>,
  success: boolean,
  eventKey: string,
  userId?: string
) {
  try {
    // Look up profile id for user_id FK
    let profileId = null;
    if (userId) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      profileId = data?.id || null;
    }
    await supabase.from("slack_notification_logs").insert({
      slack_user_identifier: slackUserId,
      payload,
      status: success ? "sent" : "failed",
      sent_at: success ? new Date().toISOString() : null,
      event_key: eventKey,
      user_id: profileId,
    });
  } catch (err: any) {
    console.error("Failed to log notification:", err);
  }
}

// --- Status emoji ---

function statusEmoji(status: string): string {
  switch (status) {
    case "red": return "🔴";
    case "amber": return "🟡";
    case "green": return "🟢";
    case "done": return "✅";
    default: return "⚪";
  }
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const appUrl = Deno.env.get("APP_URL") || "https://duncan-help.lovable.app";
    const now = new Date().toISOString();

    // 1. Find all incomplete tasks with past due dates
    const { data: overdueTasks, error: taskError } = await supabase
      .from("workstream_tasks")
      .select("id, title, card_id, due_date, completed")
      .eq("completed", false)
      .lt("due_date", now)
      .not("due_date", "is", null);

    if (taskError) {
      console.error("Error fetching overdue tasks:", taskError);
      return new Response(JSON.stringify({ error: taskError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      console.log("No overdue tasks found");
      return new Response(JSON.stringify({ success: true, notified: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${overdueTasks.length} overdue tasks`);

    // 2. Collect card IDs and task IDs
    const cardIds = [...new Set(overdueTasks.map(t => t.card_id))];
    const taskIds = overdueTasks.map(t => t.id);

    // 3. Fetch cards, task assignees, and user mappings in parallel
    const [cardsRes, taskAssigneesRes, mappingsRes] = await Promise.all([
      supabase.from("workstream_cards").select("id, title, status, owner_id, status_source").in("id", cardIds),
      supabase.from("workstream_task_assignees").select("task_id, user_id").in("task_id", taskIds),
      supabase.from("user_notification_mappings").select("duncan_user_id, slack_user_identifier, is_active").eq("is_active", true),
    ]);

    const cardMap: Record<string, { id: string; title: string; status: string; owner_id: string | null; status_source?: string | null }> = {};
    (cardsRes.data || []).forEach((c: any) => { cardMap[c.id] = c; });

    // Build mapping from profile.id → slack_user_identifier
    const slackMap: Record<string, string> = {};
    (mappingsRes.data || []).forEach((m: any) => {
      slackMap[m.duncan_user_id] = m.slack_user_identifier;
    });

    // Build profile.user_id → profile.id mapping
    const assigneeUserIds = [...new Set((taskAssigneesRes.data || []).map((a: any) => a.user_id))];
    
    // Also collect card owner_ids for escalation
    const ownerIds = [...new Set(Object.values(cardMap).map(c => c.owner_id).filter(Boolean))];
    const allUserIds = [...new Set([...assigneeUserIds, ...ownerIds as string[]])];

    let profileMap: Record<string, { id: string; display_name: string }> = {};
    if (allUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, display_name")
        .in("user_id", allUserIds);
      (profiles || []).forEach((p: any) => {
        profileMap[p.user_id] = { id: p.id, display_name: p.display_name || "Unknown" };
      });
    }

    // 4. Build task → assignee user_ids map
    const taskAssigneeMap: Record<string, string[]> = {};
    (taskAssigneesRes.data || []).forEach((a: any) => {
      if (!taskAssigneeMap[a.task_id]) taskAssigneeMap[a.task_id] = [];
      taskAssigneeMap[a.task_id].push(a.user_id);
    });

    // Also check legacy single-assignee field
    // Re-fetch tasks with assignee_id for legacy support
    const { data: tasksWithLegacy } = await supabase
      .from("workstream_tasks")
      .select("id, assignee_id")
      .in("id", taskIds)
      .not("assignee_id", "is", null);
    
    (tasksWithLegacy || []).forEach((t: any) => {
      if (t.assignee_id) {
        if (!taskAssigneeMap[t.id]) taskAssigneeMap[t.id] = [];
        if (!taskAssigneeMap[t.id].includes(t.assignee_id)) {
          taskAssigneeMap[t.id].push(t.assignee_id);
        }
      }
    });

    // 5. Send notifications
    let notifiedCount = 0;
    const results: Array<{ taskId: string; userId: string; slackUser: string | null; success: boolean; skipped?: string }> = [];

    for (const task of overdueTasks) {
      const card = cardMap[task.card_id];
      if (!card) continue;

      // Skip "done" cards
      if (card.status === "done") continue;

      const assigneeUserIdsForTask = taskAssigneeMap[task.id] || [];
      if (assigneeUserIdsForTask.length === 0) {
        results.push({ taskId: task.id, userId: "", slackUser: null, success: false, skipped: "no_assignees" });
        continue;
      }

      const dueDate = new Date(task.due_date).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      });

      for (const userId of assigneeUserIdsForTask) {
        const profile = profileMap[userId];
        if (!profile) {
          results.push({ taskId: task.id, userId, slackUser: null, success: false, skipped: "no_profile" });
          continue;
        }

        const slackUserId = slackMap[profile.id];
        if (!slackUserId) {
          results.push({ taskId: task.id, userId, slackUser: null, success: false, skipped: "unmapped" });
          continue;
        }

        // Dedup: 24 hour window per task+user combo
        const eventKey = `overdue-task-${task.id}-${userId}`;
        const dup = await isDuplicate(supabase, eventKey, 24);
        if (dup) {
          results.push({ taskId: task.id, userId, slackUser: slackUserId, success: false, skipped: "duplicate" });
          continue;
        }

        const message = [
          `⏰ *Overdue Task Alert*`,
          ``,
          `Your task *${task.title}* in card *${card.title}* was due on *${dueDate}*.`,
          ``,
          `${statusEmoji(card.status)} Card status: *${card.status.toUpperCase()}*`,
          ``,
          `👉 <${appUrl}/workstreams|Open in Duncan> to update or mark complete.`,
        ].join("\n");

        const success = await sendSlackDM(slackUserId, message);
        await logNotification(
          supabase,
          slackUserId,
          { type: "overdue_task", task_id: task.id, task_title: task.title, card_title: card.title, due_date: task.due_date },
          success,
          eventKey,
          userId
        );

        if (success) notifiedCount++;
        results.push({ taskId: task.id, userId, slackUser: slackUserId, success });
      }

      // 6. Escalation: if task is overdue by 3+ days, notify card owner too
      const daysSinceOverdue = (Date.now() - new Date(task.due_date).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceOverdue >= 3 && card.owner_id) {
        const ownerProfile = profileMap[card.owner_id];
        if (ownerProfile) {
          const ownerSlack = slackMap[ownerProfile.id];
          if (ownerSlack) {
            const escalationKey = `overdue-escalation-${task.id}-${card.owner_id}`;
            const escDup = await isDuplicate(supabase, escalationKey, 48);
            if (!escDup) {
              const assigneeNames = assigneeUserIdsForTask
                .map(uid => profileMap[uid]?.display_name || "Unknown")
                .join(", ");
              const escMessage = [
                `🚨 *Escalation: Overdue Task (${Math.floor(daysSinceOverdue)} days)*`,
                ``,
                `Task *${task.title}* in your card *${card.title}* was due on *${dueDate}*.`,
                `Assigned to: ${assigneeNames}`,
                ``,
                `${statusEmoji(card.status)} Card status: *${card.status.toUpperCase()}*`,
                ``,
                `👉 <${appUrl}/workstreams|Review in Duncan>`,
              ].join("\n");

              const escSuccess = await sendSlackDM(ownerSlack, escMessage);
              await logNotification(supabase, ownerSlack, {
                type: "overdue_escalation", task_id: task.id, card_title: card.title,
              }, escSuccess, escalationKey, card.owner_id);
            }
          }
        }
      }

      // 7. Auto-escalate card status if severely overdue
      // Respect manual overrides: skip if user changed status within last 7 days.
      const manualOverrideCutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: recentManual } = await supabase
        .from("workstream_activity")
        .select("id")
        .eq("card_id", card.id)
        .eq("action", "status_changed")
        .gte("created_at", manualOverrideCutoff)
        .limit(1);
      const hasRecentManualOverride = (recentManual?.length ?? 0) > 0;

      if (hasRecentManualOverride) {
        console.log(`Skipping auto-escalation for card ${card.id} — recent manual status change within 7d`);
      } else if (daysSinceOverdue >= 5 && card.status === "green") {
        await supabase.from("workstream_cards")
          .update({ status: "amber", updated_at: new Date().toISOString() })
          .eq("id", card.id);
        console.log(`Auto-escalated card ${card.id} from green to amber`);
      } else if (daysSinceOverdue >= 7 && card.status === "amber") {
        await supabase.from("workstream_cards")
          .update({ status: "red", updated_at: new Date().toISOString() })
          .eq("id", card.id);
        console.log(`Auto-escalated card ${card.id} from amber to red`);
      }
    }

    console.log(`Overdue check complete: ${notifiedCount} notifications sent`);
    return new Response(JSON.stringify({ success: true, notified: notifiedCount, total_overdue: overdueTasks.length, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("check-overdue-tasks error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
