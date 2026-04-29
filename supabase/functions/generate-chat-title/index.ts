// Generates a concise (max 5 words, no punctuation) title for a chat
// based on the first few messages. Uses OpenAI directly (consistent with
// the rest of the codebase, which bypasses the Lovable AI Gateway).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You generate concise titles for chat conversations.
Rules (strict):
- Maximum 5 words
- No punctuation of any kind (no quotes, periods, commas, colons, dashes, emojis)
- Title Case
- Reflect the user's intent or topic, not the literal phrasing
- Return ONLY the title, no explanation, no prefix`;

function sanitizeTitle(raw: string): string {
  if (!raw) return "";
  let t = raw.trim();
  // strip wrapping quotes
  t = t.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "");
  // strip a trailing period or other terminal punctuation
  t = t.replace(/[.!?,;:]+$/g, "");
  // collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  // hard cap to 5 words
  const words = t.split(" ").filter(Boolean).slice(0, 5);
  return words.join(" ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Take first 5 messages, truncate each for token efficiency
    const sample = messages.slice(0, 5).map((m: any) => {
      const role = (m?.role === "assistant" || m?.role === "user") ? m.role : "user";
      const content = typeof m?.content === "string" ? m.content : String(m?.content ?? "");
      return { role, content: content.slice(0, 800) };
    });

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcript = sample
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 20,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Generate a title for this conversation:\n\n${transcript}` },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("OpenAI title error:", resp.status, errText);
      return new Response(JSON.stringify({ error: "Title generation failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const title = sanitizeTitle(raw);

    if (!title) {
      return new Response(JSON.stringify({ error: "Empty title" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ title }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-chat-title error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
