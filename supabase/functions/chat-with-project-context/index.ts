import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbedding as getEmbeddingShared } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROJECT_CONTEXT_PROMPT = `You are operating inside a Project workspace inside Duncan. You have FULL access to every system Duncan is connected to (Workstreams, Planner/Key Events, Recruitment, Purchase Orders, Projects, Google Calendar, Gmail, Google Drive, Basecamp, Azure DevOps, Slack, Meetings, App Analytics, Google Analytics, etc.) via your existing tools. Use them freely to answer questions and to make changes the user asks for.

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

PLANNING CHECKLIST:
This project chat has a "Planning checklist" panel above the conversation. The user can capture to-do items there and one-click promote them to Workstream cards and tasks.
- When the user asks you to draft a plan, list next steps, break down a workflow, or outline what needs to happen, ALWAYS render the actionable items as a markdown checklist using "- [ ] item" syntax (one per line, short imperative phrases).
- If the work splits into themes, prefix each block with a markdown heading (e.g. "### Launch prep") so each theme can become its own workstream card.
- Do not invent due dates or assignees unless the user has specified them.
- After the checklist, add a single sentence reminding the user they can hit "Send to Workstreams" to turn the plan into cards.`;

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
    let priorChatsBlock = "";
    try {
      const { data: otherChats, error: otherChatsError } = await supabase
        .from("project_chats")
        .select("id, title, created_at")
        .eq("project_id", chat.project_id)
        .neq("id", chat_id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (otherChatsError) {
        console.error("Failed to fetch prior project chats:", otherChatsError);
      }

      if (otherChats && otherChats.length > 0) {
        const chatIds = otherChats.map((c: any) => c.id);
        const { data: priorMessages } = await supabase
          .from("chat_messages")
          .select("chat_id, role, content, created_at")
          .in("chat_id", chatIds)
          .order("created_at", { ascending: true });

        if (priorMessages && priorMessages.length > 0) {
          // Group by chat_id
          const grouped: Record<string, Array<{ role: string; content: string }>> = {};
          for (const m of priorMessages) {
            (grouped[m.chat_id] ||= []).push({ role: m.role, content: m.content });
          }

          const MAX_CHARS_PER_CHAT = 5000;
          const sections: string[] = [];
          for (const c of otherChats) {
            const msgs = grouped[c.id];
            if (!msgs || msgs.length === 0) continue;
            // Take enough recent context from each thread for task extraction, while capping token usage.
            const recent = msgs.slice(-20).map((m) => {
              const content = m.content.length > 900 ? m.content.slice(0, 900) + "…" : m.content;
              return `${m.role.toUpperCase()}: ${content}`;
            }).join("\n");
            const trimmed = recent.length > MAX_CHARS_PER_CHAT ? recent.slice(0, MAX_CHARS_PER_CHAT) + "…" : recent;
            sections.push(`### Chat: "${c.title}" (${new Date(c.created_at).toISOString().slice(0, 10)})\n${trimmed}`);
          }

          if (sections.length > 0) {
            priorChatsBlock =
              "\n\n## PRIOR CHAT HISTORY IN THIS PROJECT\nThe following are excerpts from other chat threads within this same project. You have access to these prior project chats. When the user asks about previous chats, last chats, chat history, dates, or tasks mentioned before, answer from this context and do not say you lack chat-history access. If the provided excerpts are insufficient, say exactly what is missing from the available prior-chat excerpts.\n\n" +
              sections.join("\n\n---\n\n");
          }
        }
      }
    } catch (priorErr) {
      console.error("Prior chats retrieval failed (non-fatal):", priorErr);
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

    // 8. Construct AI messages (multimodal-aware)
    const baseSystemPrompt = project.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = baseSystemPrompt + fileContextBlock + priorChatsBlock;

    const aiMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: any }> = [
      { role: "system", content: systemPrompt },
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

    // 9. Stream from OpenAI; relay SSE bytes to client and persist final reply.
    let openaiStream: ReadableStream<Uint8Array>;
    try {
      openaiStream = await streamLLM({
        workflow: "chat-with-project-context",
        messages: aiMessages as any,
        temperature: 0.7,
        max_tokens: 4096,
      });
    } catch (err: any) {
      console.error("AI stream error:", err?.status, err?.message);
      const status = err?.status === 429 ? 429 : 502;
      const msg = err?.status === 429
        ? "Rate limit exceeded. Please try again shortly."
        : "AI service error";
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tee the stream so we can both forward to the client and accumulate the
    // full reply for persistence.
    const [forwardStream, captureStream] = openaiStream.tee();

    // Persist the assistant message after the stream finishes.
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
