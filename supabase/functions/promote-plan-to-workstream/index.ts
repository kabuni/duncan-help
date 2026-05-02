import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PromoteBody {
  chat_id: string;
  mode?: "single_card" | "by_group";
  default_card_title?: string;
  project_tag?: string | null;
  default_due_date?: string | null;
  default_assignee_user_ids?: string[];
  item_ids?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as PromoteBody;
    const {
      chat_id,
      mode = "single_card",
      default_card_title,
      project_tag,
      default_due_date,
      default_assignee_user_ids,
      item_ids,
    } = body;
    if (!chat_id) {
      return new Response(JSON.stringify({ error: "chat_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: chat, error: chatErr } = await userClient
      .from("project_chats")
      .select("id, project_id, title")
      .eq("id", chat_id)
      .maybeSingle();
    if (chatErr || !chat) {
      return new Response(JSON.stringify({ error: "Chat not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: project } = await userClient
      .from("projects")
      .select("id, name")
      .eq("id", chat.project_id)
      .maybeSingle();

    let q = userClient
      .from("project_chat_plan_items")
      .select("*")
      .eq("chat_id", chat_id)
      .neq("status", "promoted")
      .order("position", { ascending: true });

    if (item_ids && item_ids.length > 0) {
      q = q.in("id", item_ids);
    } else {
      q = q.in("status", ["accepted", "done"]);
    }

    const { data: items, error: itemsErr } = await q;
    if (itemsErr) {
      return new Response(JSON.stringify({ error: itemsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No plan items to promote" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decide grouping
    const fallbackTitle = (default_card_title?.trim() || project?.name || chat.title || "Plan").slice(0, 200);
    const groups = new Map<string, any[]>();

    if (mode === "single_card") {
      groups.set(fallbackTitle, items);
    } else {
      for (const it of items) {
        const key = (it.group_title?.trim() || fallbackTitle);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(it);
      }
    }

    const cardsCreated: Array<{ id: string; title: string; tasks: number }> = [];

    for (const [cardTitle, groupItems] of groups.entries()) {
      const dedupQ = admin
        .from("workstream_cards")
        .select("id, title")
        .eq("title", cardTitle)
        .eq("created_by", user.id)
        .is("archived_at", null);
      if (project_tag) dedupQ.eq("project_tag", project_tag);
      const { data: existing } = await dedupQ.limit(1);

      let cardId: string;
      if (existing && existing.length > 0) {
        cardId = existing[0].id;
      } else {
        const { data: newCard, error: cardErr } = await admin
          .from("workstream_cards")
          .insert({
            title: cardTitle,
            description: project ? `From project chat in "${project.name}"` : "",
            status: "amber",
            project_tag: project_tag || null,
            priority: "medium",
            due_date: default_due_date || null,
            created_by: user.id,
            owner_id: user.id,
          })
          .select("id, title")
          .single();
        if (cardErr) {
          console.error("Card create failed:", cardErr);
          continue;
        }
        cardId = newCard.id;

        // Auto-assign creator
        await admin.from("workstream_card_assignees").insert({
          card_id: cardId,
          user_id: user.id,
        });

        // Add per-item assignees as card-level assignees too (deduped)
        const itemAssignees = new Set<string>();
        for (const it of groupItems) {
          if (it.assignee_profile_id && it.assignee_profile_id !== user.id) {
            itemAssignees.add(it.assignee_profile_id);
          }
        }
        if (default_assignee_user_ids) {
          for (const uid of default_assignee_user_ids) {
            if (uid && uid !== user.id) itemAssignees.add(uid);
          }
        }
        if (itemAssignees.size > 0) {
          const rows = Array.from(itemAssignees).map((uid) => ({ card_id: cardId, user_id: uid }));
          await admin.from("workstream_card_assignees").insert(rows);
        }

        await admin.from("workstream_activity").insert({
          card_id: cardId,
          user_id: user.id,
          action: "created",
          details: { title: cardTitle, created_by_duncan: true, source: "project_chat_plan" },
        });
      }

      // Build tasks, deduping by title
      const { data: existingTasks } = await admin
        .from("workstream_tasks")
        .select("title")
        .eq("card_id", cardId);
      const existingTitles = new Set((existingTasks || []).map((t: any) => t.title.toLowerCase()));

      let taskCount = 0;
      for (let i = 0; i < groupItems.length; i++) {
        const it = groupItems[i];
        if (existingTitles.has(it.title.toLowerCase())) {
          await admin.from("project_chat_plan_items").update({ status: "promoted", promoted_card_id: cardId }).eq("id", it.id);
          continue;
        }

        const { data: task, error: taskErr } = await admin
          .from("workstream_tasks")
          .insert({
            card_id: cardId,
            title: it.title,
            description: it.notes || "",
            assignee_id: it.assignee_profile_id || null,
            due_date: it.due_date || default_due_date || null,
            sort_order: i,
            completed: it.status === "done",
          })
          .select("id")
          .single();
        if (taskErr) {
          console.error("Task create failed:", taskErr);
          continue;
        }

        await admin
          .from("project_chat_plan_items")
          .update({
            status: "promoted",
            promoted_card_id: cardId,
            promoted_task_id: task.id,
          })
          .eq("id", it.id);

        taskCount++;
        existingTitles.add(it.title.toLowerCase());
      }

      cardsCreated.push({ id: cardId, title: cardTitle, tasks: taskCount });
    }

    const summaryLines = cardsCreated.map(
      (c) => `- **${c.title}** — ${c.tasks} task${c.tasks === 1 ? "" : "s"} ([open](/workstreams?card=${c.id}))`,
    );
    const summary =
      cardsCreated.length === 0
        ? "_(No new cards created — all items were duplicates.)_"
        : `Promoted plan to Workstreams:\n\n${summaryLines.join("\n")}`;

    await admin.from("chat_messages").insert({
      chat_id,
      role: "assistant",
      content: summary,
    });

    return new Response(
      JSON.stringify({
        success: true,
        cards: cardsCreated,
        items_promoted: items.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("promote-plan-to-workstream error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
