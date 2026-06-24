import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbedding as getEmbeddingShared } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROJECT_CONTEXT_PROMPT = `You are operating inside a Project workspace inside Duncan. You have FULL access to every system Duncan is connected to (Workstreams, Planner/Key Events, Recruitment, Purchase Orders, Projects, Google Calendar, Gmail, Google Drive, Azure DevOps, Slack, Meetings, App Analytics, Google Analytics, etc.) via your existing tools. Use them freely to answer questions and to make changes the user asks for.

PROJECT CHAT — WRITE SAFETY (HARD RULE):
This chat surface is shared/collaborative, so you MUST use a "preview + confirm" pattern for ANY write operation (create, update, delete, send, approve). Never silently mutate data.
1. When the user asks you to change, create, update, delete, send, or approve anything in any system, FIRST respond with a clear preview block:
   - **Action:** what you will do (one line)
   - **Target:** the system + record (e.g. "Workstream card 'Investor demo'", "Gmail to alex@…", "Planner event on 14 May")
   - **Changes:** bullet list of fields/values that will change, with before → after where applicable
   - End with: "Reply **Confirm** to apply, or tell me what to change."
2. Do NOT call the underlying write tool until the user replies with an explicit confirmation ("confirm", "yes do it", "go ahead", "apply", etc.).
3. After the user confirms, execute the tool, then post a short result summary.
4. Read-only queries (lists, searches, summaries, analytics) do NOT require confirmation — answer them directly.
5. If the user batches several writes, present ONE preview that lists all of them, and apply them only after a single confirm.

PROJECT TASKS — HARD RULE (NO WORKSTREAM CARDS FROM PROJECT CHAT):
Tasks created from a project chat live INSIDE this project's task list (the "Planning checklist" panel above the conversation), assigned to project members. They are NOT workstream cards.
- NEVER call \`create_workstream_card\`, \`add_tasks_to_card\`, or \`update_workstream_card\` from this project chat — even if the user says "create tasks", "task list", "to-dos", "action items", or "break it down". Workstream cards are only created later, on demand, via the "Send to Workstreams" button in the UI.
- When the user asks you to draft a plan, list next steps, break down a workflow, or outline tasks: ALWAYS render the actionable items as a markdown checklist using \`- [ ] item\` syntax — one per line, short imperative phrases. The system will automatically save each checklist item into this project's task list, assigned to the right project member, with no further confirmation.
- ASSIGNEES: If the user names assignees (e.g. "Sarah to draft the brief", "@Tom owns infra"), append \` — @Name\` at the end of that checklist item, using the member's first name or display name exactly as it appears in the project membership. Resolve names via \`list_team_members\` if you're unsure. If no assignee is named, leave it unassigned (it will default to the creator).
- DUE DATES: Only include a due date if the user specified one. Append it in square brackets as ISO \`[YYYY-MM-DD]\` at the end of the item (after any assignee), e.g. \`- [ ] Draft brief — @Sarah [2026-07-01]\`. Never invent dates.
- GROUPING: If the work splits into themes, prefix each block with a level-3 markdown heading (e.g. \`### Launch prep\`). All items beneath that heading inherit it as their group.
- After the checklist, add a single short sentence: e.g. "Saved to this project's task list — open the Planning panel to review or send them to Workstreams when ready."`;

async function getEmbedding(text: string, _apiKey?: string): Promise<number[]> {
  return await getEmbeddingShared(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse input
    const body = await req.json();
    const { chat_id, message } = body;
    const attachments: Array<{ name: string; type: string; base64?: string; extractedText?: string }> =
      Array.isArray(body?.attachments) ? body.attachments : [];

    if (!chat_id || typeof chat_id !== "string") {
      return new Response(JSON.stringify({ error: "chat_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((!message || typeof message !== "string" || message.trim().length === 0) && attachments.length === 0) {
      return new Response(JSON.stringify({ error: "message or attachments required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Fetch chat (RLS enforces ownership)
    const { data: chat, error: chatError } = await supabase
      .from("project_chats")
      .select("id, project_id, title")
      .eq("id", chat_id)
      .single();

    if (chatError || !chat) {
      return new Response(JSON.stringify({ error: "Chat not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Fetch project (RLS enforces ownership)
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, system_prompt")
      .eq("id", chat.project_id)
      .single();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: "Project not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. RAG: Retrieve relevant chunks via vector similarity
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fileContextBlock = "";
    try {
      // Get file IDs and names for this project
      const { data: projectFiles } = await supabase
        .from("project_files")
        .select("id, file_name, extracted_text")
        .eq("project_id", chat.project_id);

      if (projectFiles && projectFiles.length > 0) {
        // Always include file manifest so the AI knows what's uploaded
        const fileManifest = projectFiles.map((f: any) => `- ${f.file_name}${f.extracted_text ? ' (indexed)' : ' (not yet indexed)'}`).join("\n");
        fileContextBlock = `\n\n## PROJECT FILES\nThe following files are uploaded to this project:\n${fileManifest}\n`;

        // Only attempt RAG on indexed files
        const indexedFiles = projectFiles.filter((f: any) => f.extracted_text);
        if (indexedFiles.length > 0) {
          const fileIds = indexedFiles.map((f: any) => f.id);

          // Generate embedding for user query
          const queryEmbedding = await getEmbedding(((message || "").trim() || "attached files"), OPENAI_API_KEY);

          // Use service client for vector similarity query (RPC)
          const serviceClient = createClient(
            supabaseUrl,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
          );

          // Query top 5 most relevant chunks
          const embeddingStr = `[${queryEmbedding.join(",")}]`;
          const { data: chunks, error: chunksError } = await serviceClient
            .rpc("match_project_chunks", {
              query_embedding: embeddingStr,
              file_ids: fileIds,
              match_count: 5,
            });

          if (chunksError) {
            console.error("RAG query error:", chunksError);
          } else if (chunks && chunks.length > 0) {
            // Map chunk file_id back to file name
            const fileMap = Object.fromEntries(indexedFiles.map((f: any) => [f.id, f.file_name]));
            const contextTexts = chunks.map(
              (c: any, i: number) => `[Source: ${fileMap[c.file_id] || 'unknown'} | Similarity: ${(c.similarity * 100).toFixed(0)}%]\n${c.content}`
            );
            fileContextBlock +=
              "\n## RETRIEVED CONTEXT FROM PROJECT FILES\nThe following excerpts were retrieved from the uploaded project files based on relevance to the user's question. You MUST use this information to answer. Do NOT say files are missing or not attached — they are right here.\n\n" +
              contextTexts.join("\n\n---\n\n");
          }
        }
      }
    } catch (ragErr) {
      console.error("RAG retrieval failed (non-fatal):", ragErr);
    }

    // 5b. Fetch project notes (user-authored knowledge area)
    let notesBlock = "";
    try {
      const { data: notes } = await supabase
        .from("project_notes")
        .select("title, content, pinned, updated_at")
        .eq("project_id", chat.project_id)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(10);
      if (notes && notes.length > 0) {
        const htmlToText = (raw: string): string => {
          if (!raw) return "";
          let s = String(raw);
          // Strip scripts/styles entirely
          s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
          // Preserve list/line semantics
          s = s.replace(/<\s*li[^>]*>/gi, "\n• ");
          s = s.replace(/<\s*br\s*\/?>/gi, "\n");
          s = s.replace(/<\/\s*(p|div|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, "\n");
          // Drop all remaining tags
          s = s.replace(/<[^>]+>/g, "");
          // Decode common entities
          s = s.replace(/&nbsp;/g, " ")
               .replace(/&amp;/g, "&")
               .replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">")
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'");
          // Collapse whitespace
          s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
          return s;
        };
        const rendered = notes
          .map((n: any) => {
            const plain = htmlToText(n.content || "");
            const body = plain.length > 3500 ? plain.slice(0, 3500) + "\n…[note truncated]" : plain;
            return `### ${n.pinned ? "📌 " : ""}${n.title || "Untitled note"}\n${body}`;
          })
          .join("\n\n---\n\n");
        notesBlock = `\n\n## PROJECT NOTES\nThe team has captured the following notes inside this project. Treat them as authoritative context and answer questions about them directly from this content:\n\n${rendered}\n`;
        console.log(`[project-notes] injected ${notes.length} notes, total chars=${notesBlock.length}`);
      } else {
        console.log(`[project-notes] no notes found for project ${chat.project_id}`);
      }
    } catch (notesErr) {
      console.error("Notes fetch failed (non-fatal):", notesErr);
    }

    // 5c. Fetch project members + profiles so the model can name assignees and
    // we can resolve "@Name" in the assistant's checklist back to user IDs.
    type MemberRow = { user_id: string; display_name: string | null; first_name: string | null };
    let projectMembers: MemberRow[] = [];
    let membersBlock = "";
    try {
      const { data: members } = await supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", chat.project_id);
      const memberIds = (members || []).map((m: any) => m.user_id);
      if (memberIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", memberIds);
        projectMembers = (profs || []).map((p: any) => {
          const dn = (p.display_name || "").trim();
          return {
            user_id: p.user_id,
            display_name: dn || null,
            first_name: dn ? dn.split(/\s+/)[0] : null,
          };
        });
        if (projectMembers.length > 0) {
          membersBlock =
            "\n\n## PROJECT MEMBERS (assignable for tasks)\n" +
            projectMembers
              .map((m) => `- ${m.display_name || "(no name)"} → @${m.first_name || m.display_name || "user"}`)
              .join("\n");
        }
      }
    } catch (mErr) {
      console.error("Project members fetch failed (non-fatal):", mErr);
    }




    // 6. Fetch last 20 messages from the CURRENT chat for live conversation context
    const { data: history, error: historyError } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(20);

    if (historyError) {
      console.error("Failed to fetch chat history:", historyError);
    }

    // 6b. Fetch summaries of OTHER chats in the same project (cross-chat memory)
    // Only inject this block when the user explicitly references prior chats —
    // otherwise it bloats the prompt and slows the LLM (causing 504s).
    let priorChatsBlock = "";
    const PRIOR_CHAT_REF_RE = /\b(prior|previous|last|earlier|other|past)\s+(chat|chats|conversation|conversations|thread|threads|discussion|discussions)\b|\bchat history\b|\bchat hisory\b/i;
    const userMentionsPriorChats = PRIOR_CHAT_REF_RE.test((message || ""));
    if (userMentionsPriorChats) {
      try {
        const { data: otherChats } = await supabase
          .from("project_chats")
          .select("id, title, created_at")
          .eq("project_id", chat.project_id)
          .neq("id", chat_id)
          .order("created_at", { ascending: false })
          .limit(5);

        if (otherChats && otherChats.length > 0) {
          const chatIds = otherChats.map((c: any) => c.id);
          const { data: priorMessages } = await supabase
            .from("chat_messages")
            .select("chat_id, role, content, created_at")
            .in("chat_id", chatIds)
            .order("created_at", { ascending: false })
            .limit(60);

          if (priorMessages && priorMessages.length > 0) {
            const grouped: Record<string, Array<{ role: string; content: string }>> = {};
            for (const m of [...priorMessages].reverse()) {
              (grouped[m.chat_id] ||= []).push({ role: m.role, content: m.content });
            }
            const MAX_CHARS_PER_CHAT = 1500;
            const sections: string[] = [];
            for (const c of otherChats) {
              const msgs = grouped[c.id];
              if (!msgs || msgs.length === 0) continue;
              const recent = msgs.slice(-8).map((m) => {
                const content = m.content.length > 400 ? m.content.slice(0, 400) + "…" : m.content;
                return `${m.role.toUpperCase()}: ${content}`;
              }).join("\n");
              const trimmed = recent.length > MAX_CHARS_PER_CHAT ? recent.slice(0, MAX_CHARS_PER_CHAT) + "…" : recent;
              sections.push(`### Chat: "${c.title}" (${new Date(c.created_at).toISOString().slice(0, 10)})\n${trimmed}`);
            }
            if (sections.length > 0) {
              priorChatsBlock =
                "\n\n## PRIOR CHAT HISTORY IN THIS PROJECT\nExcerpts from other chat threads in this project, included because the user referenced them.\n\n" +
                sections.join("\n\n---\n\n");
            }
          }
        }
      } catch (priorErr) {
        console.error("Prior chats retrieval failed (non-fatal):", priorErr);
      }
    }


    const userText = (message || "").trim() || "Analyze the attached file(s)";

    // 7. Save user message (persist visible text only — attachment text lives in the prompt)
    const { error: insertUserError } = await supabase
      .from("chat_messages")
      .insert({ chat_id, role: "user", content: userText, user_id: user.id });

    if (insertUserError) {
      console.error("Failed to save user message:", insertUserError);
      return new Response(JSON.stringify({ error: "Failed to save message" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 8. Construct AI messages — we delegate to norman-chat (which owns all
    // system tools and integrations). The first system-style message is the
    // project's context (custom prompt + RAG + cross-chat memory + write-safety
    // rules); norman-chat will prepend its own SYSTEM_PROMPT, so the project
    // context arrives as an additional `system` message.
    const projectContextHeader = `## ACTIVE PROJECT WORKSPACE\nProject: ${project.name}\nProject ID: ${project.id}\nChat ID: ${chat_id}\n`;
    const customProjectPrompt = project.system_prompt?.trim()
      ? `\n\n## PROJECT-SPECIFIC INSTRUCTIONS\n${project.system_prompt.trim()}`
      : "";
    const projectSystemMessage =
      PROJECT_CONTEXT_PROMPT +
      "\n\n" +
      projectContextHeader +
      customProjectPrompt +
      fileContextBlock +
      notesBlock +
      priorChatsBlock +
      membersBlock;

    const aiMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: any }> = [
      { role: "system", content: projectSystemMessage },
    ];

    if (history && history.length > 0) {
      for (const msg of history) {
        const role = (msg.role === "assistant" || msg.role === "user" || msg.role === "system" || msg.role === "tool")
          ? msg.role
          : "user";
        aiMessages.push({ role, content: msg.content });
      }
    }

    // Build current user content: text + image_url parts + extracted text from docs
    if (attachments.length === 0) {
      aiMessages.push({ role: "user", content: userText });
    } else {
      const parts: any[] = [{ type: "text", text: userText }];
      for (const att of attachments) {
        if (att.type?.startsWith("image/") && att.base64) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${att.type};base64,${att.base64}`, detail: "auto" },
          });
        } else if (att.extractedText) {
          parts.push({
            type: "text",
            text: `\n\n--- Attached file: ${att.name} ---\n${att.extractedText}\n--- End of file ---`,
          });
        } else {
          parts.push({
            type: "text",
            text: `\n\n[Attached file: ${att.name} (could not be processed)]`,
          });
        }
      }
      aiMessages.push({ role: "user", content: parts });
    }

    // Pull profile so norman-chat can personalise (best-effort).
    let userProfile: Record<string, unknown> | undefined;
    try {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("display_name, role_title, department, bio, norman_context")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileRow) userProfile = profileRow as any;
    } catch (_e) { /* non-fatal */ }

    // 9. Delegate to norman-chat (owner of all integration tools). Forward the
    // user's auth header so it can resolve identity, RBAC and per-user OAuth
    // tokens. Stream the SSE response back unchanged, and tee a copy to persist
    // the assistant reply on this project chat.
    let upstream: Response;
    try {
      upstream = await fetch(`${supabaseUrl}/functions/v1/norman-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          messages: aiMessages,
          mode: "general",
          userProfile,
        }),
      });
    } catch (err: any) {
      console.error("Failed to reach norman-chat:", err?.message || err);
      return new Response(JSON.stringify({ error: "AI service unreachable" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!upstream.ok || !upstream.body) {
      const errBody = await upstream.text().catch(() => "");
      console.error("norman-chat upstream error:", upstream.status, errBody);
      return new Response(
        JSON.stringify({ error: upstream.status === 429 ? "Rate limit exceeded. Please try again shortly." : "AI service error" }),
        {
          status: upstream.status === 429 ? 429 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Tee so we can forward to client AND persist final reply.
    const [forwardStream, captureStream] = upstream.body.tee();

    (async () => {
      try {
        const reader = captureStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const c = parsed.choices?.[0]?.delta?.content;
              if (c) full += c;
            } catch { /* skip */ }
          }
        }
        if (full.trim().length > 0) {
          const { error: insertAssistantError } = await supabase
            .from("chat_messages")
            .insert({ chat_id, role: "assistant", content: full });
          if (insertAssistantError) {
            console.error("Failed to save assistant message:", insertAssistantError);
          }

          // Auto-extract markdown checklist items into project_chat_plan_items
          // so they appear in the Planning panel, assigned to the right member.
          try {
            const lines = full.split(/\r?\n/);
            const items: Array<{
              title: string;
              group: string | null;
              assignee_profile_id: string | null;
              due_date: string | null;
            }> = [];
            let currentGroup: string | null = null;
            const memberByKey = new Map<string, string>();
            for (const m of projectMembers) {
              if (m.first_name) memberByKey.set(m.first_name.toLowerCase(), m.user_id);
              if (m.display_name) memberByKey.set(m.display_name.toLowerCase(), m.user_id);
            }
            const checklistRe = /^\s*[-*]\s*\[\s*[ xX]?\s*\]\s+(.*)$/;
            const headingRe = /^\s*#{2,4}\s+(.*\S)\s*#*\s*$/;
            const dateRe = /\[(\d{4}-\d{2}-\d{2})\]/;
            const mentionRe = /@([A-Za-z][A-Za-z0-9 _'-]{0,40})(?=\s|$|[—–\-,.;:[\]()])/;
            for (const raw of lines) {
              const hMatch = raw.match(headingRe);
              if (hMatch) {
                currentGroup = hMatch[1].trim() || null;
                continue;
              }
              const cMatch = raw.match(checklistRe);
              if (!cMatch) continue;
              let text = cMatch[1].trim();
              if (!text) continue;
              let due: string | null = null;
              const dm = text.match(dateRe);
              if (dm) {
                due = dm[1];
                text = text.replace(dateRe, "").trim();
              }
              let assignee: string | null = null;
              const am = text.match(mentionRe);
              if (am) {
                const candidate = am[1].trim().toLowerCase();
                // Try longest match first (display_name then first_name).
                if (memberByKey.has(candidate)) {
                  assignee = memberByKey.get(candidate)!;
                } else {
                  const firstToken = candidate.split(/\s+/)[0];
                  if (memberByKey.has(firstToken)) assignee = memberByKey.get(firstToken)!;
                }
                text = text.replace(am[0], "").trim();
              }
              // Strip trailing separators left over (—, -, :, etc.)
              text = text.replace(/[—\-:•·]+\s*$/g, "").trim();
              if (!text) continue;
              items.push({
                title: text.slice(0, 280),
                group: currentGroup,
                assignee_profile_id: assignee,
                due_date: due,
              });
            }

            if (items.length > 0) {
              // Avoid duplicates: skip titles that already exist (any status) for this chat.
              const { data: existing } = await supabase
                .from("project_chat_plan_items")
                .select("title")
                .eq("chat_id", chat_id);
              const have = new Set((existing || []).map((r: any) => String(r.title).toLowerCase()));
              const fresh = items.filter((it) => !have.has(it.title.toLowerCase()));
              if (fresh.length > 0) {
                const { data: maxPosRow } = await supabase
                  .from("project_chat_plan_items")
                  .select("position")
                  .eq("chat_id", chat_id)
                  .order("position", { ascending: false })
                  .limit(1);
                const startPos = (maxPosRow && maxPosRow[0]?.position) || 0;
                const rows = fresh.map((it, i) => ({
                  chat_id,
                  project_id: chat.project_id,
                  created_by: user.id,
                  title: it.title,
                  group_title: it.group,
                  assignee_profile_id: it.assignee_profile_id || user.id,
                  due_date: it.due_date,
                  status: "accepted",
                  position: startPos + i + 1,
                }));
                const { error: planErr } = await supabase
                  .from("project_chat_plan_items")
                  .insert(rows);
                if (planErr) {
                  console.error("[plan-items] insert failed:", planErr.message);
                } else {
                  console.log(`[plan-items] auto-created ${rows.length} task(s) for chat ${chat_id}`);
                }
              }
            }
          } catch (planErr) {
            console.error("[plan-items] extraction failed (non-fatal):", planErr);
          }
        }
      } catch (persistErr) {
        console.error("Failed to capture/persist streamed reply:", persistErr);
      }
    })();

    return new Response(forwardStream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (err: any) {
    console.error("chat-with-project-context error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
