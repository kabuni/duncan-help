import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { getEmbedding as getEmbeddingShared } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_SYSTEM_PROMPT = `You are Duncan, an advanced reasoning and operating system for internal company operations.
You are currently operating inside a Project workspace. Focus your responses on the context and instructions provided for this project.
Be direct, precise, and efficient. Use structured output when presenting complex information.`;

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

    // 2. Parse input (selected_file_ids no longer used)
    const { chat_id, message } = await req.json();
    if (!chat_id || typeof chat_id !== "string") {
      return new Response(JSON.stringify({ error: "chat_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "message is required" }), {
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
          const queryEmbedding = await getEmbedding(message.trim(), OPENAI_API_KEY);

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

    // 7. Save user message
    const { error: insertUserError } = await supabase
      .from("chat_messages")
      .insert({ chat_id, role: "user", content: message.trim(), user_id: user.id });

    if (insertUserError) {
      console.error("Failed to save user message:", insertUserError);
      return new Response(JSON.stringify({ error: "Failed to save message" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 8. Construct AI messages
    const baseSystemPrompt = project.system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    const systemPrompt = baseSystemPrompt + fileContextBlock + priorChatsBlock;

    const aiMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
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

    aiMessages.push({ role: "user", content: message.trim() });

    // 9. Call LLM via router (Claude primary, OpenAI fallback)
    let aiData: any;
    try {
      aiData = await callLLMWithFallback({
        workflow: "chat-with-project-context",
        messages: aiMessages,
        temperature: 0.7,
        max_tokens: 4096,
      });
    } catch (err: any) {
      console.error("AI error:", err?.status, err?.message);
      if (err?.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reply = aiData.choices?.[0]?.message?.content || "I couldn't generate a response.";

    // 10. Save assistant message
    const { error: insertAssistantError } = await supabase
      .from("chat_messages")
      .insert({ chat_id, role: "assistant", content: reply });

    if (insertAssistantError) {
      console.error("Failed to save assistant message:", insertAssistantError);
    }

    // 11. Return response
    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("chat-with-project-context error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
