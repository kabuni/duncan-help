import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- Types ---

interface BasecampEvent {
  type: "todo_assigned" | "todo_completed" | "comment_created" | "card_update";
  todoTitle: string;
  projectName: string;
  assigneePersonIds: number[];
  assigneeNames: string[];
  creatorName: string;
  creatorPersonId: number | null;
  url: string;
}

// --- Event Parser ---

function safeString(val: unknown, fallback: string): string {
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

function safeNumber(val: unknown): number | null {
  return typeof val === "number" ? val : null;
}

function extractAssignees(recording: any, body: any): { ids: number[]; names: string[] } {
  const ids: number[] = [];
  const names: string[] = [];
  const assignees = recording?.assignees || body?.assignees || [];
  if (Array.isArray(assignees)) {
    for (const a of assignees) {
      const id = safeNumber(a?.id);
      if (id !== null) {
        ids.push(id);
        names.push(safeString(a?.name, "Unknown"));
      }
    }
  }
  // Fallback: single assignee field
  if (ids.length === 0 && body?.assignee) {
    const id = safeNumber(body.assignee.id);
    if (id !== null) {
      ids.push(id);
      names.push(safeString(body.assignee.name, "Unknown"));
    }
  }
  return { ids, names };
}

function parseEvent(body: any): BasecampEvent | null {
  try {
    const kind = body?.kind;
    const recording = body?.recording || {};
    const creator = body?.creator || {};
    const creatorName = safeString(creator.name, "Someone");
    const creatorPersonId = safeNumber(creator.id);
    const projectName = safeString(body?.bucket?.name, "Unknown project");
    const todoTitle = safeString(recording.title || recording.subject, "Untitled todo");
    const url = safeString(recording.app_url || recording.url, "");

    // Todo assignment
    if (kind === "todo_assignment_created" || kind === "todo_assigned") {
      const { ids, names } = extractAssignees(recording, body);
      if (ids.length === 0) return null;
      return { type: "todo_assigned", todoTitle, projectName, assigneePersonIds: ids, assigneeNames: names, creatorName, creatorPersonId, url };
    }

    // Todo completed
    if (kind === "todo_completed") {
      return {
        type: "todo_completed",
        todoTitle, projectName,
        assigneePersonIds: creatorPersonId ? [creatorPersonId] : [],
        assigneeNames: [creatorName],
        creatorName, creatorPersonId, url,
      };
    }

    // Comment on a todo
    if (kind === "comment_created" && recording.parent?.type === "Todo") {
      const parent = recording.parent || {};
      const { ids, names } = extractAssignees(parent, {});
      // Also include todo creator if available and different
      const todoCreatorId = safeNumber(parent.creator?.id);
      if (todoCreatorId !== null && !ids.includes(todoCreatorId)) {
        ids.push(todoCreatorId);
        names.push(safeString(parent.creator?.name, "Unknown"));
      }
      return {
        type: "comment_created",
        todoTitle: safeString(parent.title || parent.subject, "Untitled todo"),
        projectName, assigneePersonIds: ids, assigneeNames: names,
        creatorName, creatorPersonId, url,
      };
    }

    // Card created or updated
    if (kind === "card_created" || kind === "card_updated") {
      const { ids, names } = extractAssignees(recording, body);
      // If no assignees, notify the creator
      const notifyIds = ids.length > 0 ? ids : (creatorPersonId ? [creatorPersonId] : []);
      const notifyNames = names.length > 0 ? names : [creatorName];
      return {
        type: "card_update",
        todoTitle: safeString(recording.title || recording.subject, "Untitled card"),
        projectName, assigneePersonIds: notifyIds, assigneeNames: notifyNames,
        creatorName, creatorPersonId, url,
      };
    }

    return null;
  } catch (err: any) {
    console.error("parseEvent error:", err);
    return null;
  }
}

// --- User Mapping ---

async function getSlackUser(
  supabase: any,
  basecampPersonId: number,
  basecampName: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("user_notification_mappings")
      .select("slack_user_identifier, is_active")
      .eq("basecamp_person_id", basecampPersonId)
      .maybeSingle();

    if (error || !data) {
      await supabase.from("unmapped_users_log").insert({
        basecamp_person_id: basecampPersonId,
        basecamp_name: basecampName,
        context: "basecamp-webhook",
      }).then(() => {});
      return null;
    }

    if (!data.is_active) return null;
    return data.slack_user_identifier;
  } catch {
    return null;
  }
}

// --- Slack DM with single retry (via connector gateway) ---

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

async function sendSlackDM(
  slackUserId: string,
  message: string,
  _slackApiKey: string
): Promise<boolean> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const slackConnectionKey = Deno.env.get("SLACK_API_KEY");

  if (!lovableApiKey || !slackConnectionKey) {
    console.error("Missing LOVABLE_API_KEY or SLACK_API_KEY for connector gateway");
    return false;
  }

  const gatewayHeaders = {
    "Authorization": `Bearer ${lovableApiKey}`,
    "X-Connection-Api-Key": slackConnectionKey,
    "Content-Type": "application/json",
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Open DM channel
      const openRes = await fetch(`${SLACK_GATEWAY_URL}/conversations.open`, {
        method: "POST",
        headers: gatewayHeaders,
        body: JSON.stringify({ users: slackUserId }),
      });
      const openData = await openRes.json();
      if (!openData.ok) {
        console.error(`Slack conversations.open failed (attempt ${attempt + 1}):`, openData.error);
        if (attempt === 0) { await delay(500); continue; }
        return false;
      }

      const channelId = openData.channel.id;
      const msgRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
        method: "POST",
        headers: gatewayHeaders,
        body: JSON.stringify({ channel: channelId, text: message, username: "Duncan", icon_emoji: ":bell:" }),
      });
      const msgData = await msgRes.json();
      if (!msgData.ok) {
        console.error(`Slack postMessage failed (attempt ${attempt + 1}):`, msgData.error);
        if (attempt === 0) { await delay(500); continue; }
        return false;
      }
      return true;
    } catch (err: any) {
      console.error(`Slack DM exception (attempt ${attempt + 1}):`, err);
      if (attempt === 0) { await delay(500); continue; }
      return false;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Message Formatting ---

function formatMessage(event: BasecampEvent): string {
  const link = event.url ? `<${event.url}|${event.todoTitle}>` : event.todoTitle;

  switch (event.type) {
    case "todo_assigned":
      return `📋 *New task assigned to you*\n${link}\n📁 ${event.projectName}\n👤 Assigned by ${event.creatorName}`;
    case "todo_completed":
      return `✅ *Task completed*\n${link}\n📁 ${event.projectName}\n👤 Completed by ${event.creatorName}`;
    case "comment_created":
      return `💬 *New comment on your task*\n${link}\n📁 ${event.projectName}\n👤 Comment by ${event.creatorName}`;
    case "card_update":
      return `🗂️ *Card updated*\n${link}\n📁 ${event.projectName}\n👤 By ${event.creatorName}`;
    default:
      return `📌 Update on: ${link}`;
  }
}

// --- Deduplication ---

function buildEventKey(event: BasecampEvent): string {
  const fallback = `${event.projectName}-${event.creatorName}`;
  const key = `${event.type}-${event.todoTitle}-${event.url || fallback}`;
  return key.length > 255 ? key.substring(0, 255) : key;
}

async function isDuplicateEvent(supabase: any, eventKey: string): Promise<boolean> {
  try {
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const { data, error } = await supabase
      .from("slack_notification_logs")
      .select("id")
      .eq("event_key", eventKey)
      .gte("created_at", sixtySecondsAgo)
      .limit(1);

    if (error) {
      console.error("Dedup check error:", error);
      return false; // fail open
    }
    return data && data.length > 0;
  } catch {
    return false;
  }
}

// --- Logging ---

async function logResult(
  supabase: any,
  slackUserId: string,
  payload: any,
  success: boolean,
  eventKey?: string
) {
  try {
    await supabase.from("slack_notification_logs").insert({
      slack_user_identifier: slackUserId,
      payload,
      status: success ? "sent" : "failed",
      sent_at: success ? new Date().toISOString() : null,
      event_key: eventKey || null,
    });
  } catch (err: any) {
    console.error("Failed to log notification result:", err);
  }
}

// --- Main Handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("Basecamp webhook received:", JSON.stringify(body).substring(0, 500));

    // Validate account ID
    const expectedAccountId = Deno.env.get("BASECAMP_ACCOUNT_ID");
    if (expectedAccountId && body.account_id) {
      if (String(body.account_id) !== String(expectedAccountId)) {
        console.log(`Account ID mismatch: got ${body.account_id}, expected ${expectedAccountId}`);
        return new Response(JSON.stringify({ ignored: true, reason: "account_id_mismatch" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const event = parseEvent(body);
    if (!event) {
      console.log(`Ignoring unsupported event kind: ${body?.kind}`);
      return new Response(JSON.stringify({ ignored: true, reason: "unsupported_event", kind: body?.kind }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.assigneePersonIds.length === 0) {
      console.log("No assignees found, skipping");
      return new Response(JSON.stringify({ ignored: true, reason: "no_assignees" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const slackApiKey = Deno.env.get("SLACK_API_KEY");
    if (!slackApiKey) {
      console.error("SLACK_API_KEY not configured");
      return new Response(JSON.stringify({ error: "Slack not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplication check (once per webhook, before user loop)
    const eventKey = buildEventKey(event);
    const duplicate = await isDuplicateEvent(supabase, eventKey);
    if (duplicate) {
      console.log(`Duplicate event detected, skipping: ${eventKey}`);
      return new Response(JSON.stringify({ ignored: true, reason: "duplicate_event", event_key: eventKey }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const message = formatMessage(event);
    const results: { personId: number; slackUser: string | null; success: boolean; skipped?: string }[] = [];

    for (let i = 0; i < event.assigneePersonIds.length; i++) {
      const personId = event.assigneePersonIds[i];
      const personName = event.assigneeNames[i] || "Unknown";

      // Skip self-notifications for comments
      if (event.type === "comment_created" && event.creatorPersonId === personId) {
        results.push({ personId, slackUser: null, success: false, skipped: "self_comment" });
        continue;
      }

      const slackUserId = await getSlackUser(supabase, personId, personName);
      if (!slackUserId) {
        results.push({ personId, slackUser: null, success: false, skipped: "unmapped" });
        continue;
      }

      const success = await sendSlackDM(slackUserId, message, slackApiKey);
      await logResult(supabase, slackUserId, { type: event.type, todo: event.todoTitle, project: event.projectName, event_key: eventKey }, success, eventKey);
      results.push({ personId, slackUser: slackUserId, success });
    }

    console.log(`Webhook processed: type=${event.type}, results=${JSON.stringify(results)}`);
    return new Response(JSON.stringify({ success: true, type: event.type, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("basecamp-webhook error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
