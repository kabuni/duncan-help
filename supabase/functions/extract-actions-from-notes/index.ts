import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExtractedAction {
  title: string;
  assignee_hint?: string | null;
  due_date?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const notes: string = (body?.notes || "").toString();
    const members: { user_id: string; display_name: string | null }[] = Array.isArray(body?.members)
      ? body.members
      : [];

    if (!notes || notes.trim().length < 10) {
      return new Response(JSON.stringify({ error: "Notes are too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const truncated = notes.slice(0, 50000);
    const memberLine = members
      .map((m) => m.display_name)
      .filter(Boolean)
      .join(", ");

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `You extract concrete action items / tasks from meeting notes (often a Gemini-generated meeting doc).

Rules:
- Return ONLY clear, actionable to-dos. Skip generic discussion points, status updates, or background context.
- Each task title should be one sentence, imperative voice (e.g. "Draft Q3 budget proposal").
- Do NOT invent tasks. If unsure, omit it.
- If a person is named as owner, set assignee_hint to their first name or display name as written.
- Known project members (match assignee_hint to one of these names if possible): ${memberLine || "(none provided)"}
- If a due date is mentioned, return it as ISO YYYY-MM-DD. Today is ${today}. Resolve relative dates ("next Friday", "EOW") against today. Otherwise leave null.
- Deduplicate near-identical tasks.`;

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: truncated },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_actions",
              description: "Submit the extracted action items",
              parameters: {
                type: "object",
                properties: {
                  actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        assignee_hint: { type: ["string", "null"] },
                        due_date: { type: ["string", "null"] },
                      },
                      required: ["title"],
                    },
                  },
                },
                required: ["actions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_actions" } },
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return new Response(JSON.stringify({ error: `OpenAI: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await openaiResp.json();
    const argStr = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let parsed: { actions: ExtractedAction[] } = { actions: [] };
    try {
      parsed = argStr ? JSON.parse(argStr) : { actions: [] };
    } catch {
      parsed = { actions: [] };
    }

    return new Response(JSON.stringify({ actions: parsed.actions || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
