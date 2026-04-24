import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bearer = authHeader.slice(7).trim();
    // Allow cron / internal triggers using the service-role key to bypass user-auth.
    const isServiceRole = bearer === supabaseServiceKey;

    if (!isServiceRole) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { meeting_id, meeting_ids } = body;

    // Support single or batch analysis
    const idsToAnalyze: string[] = meeting_ids || (meeting_id ? [meeting_id] : []);

    if (idsToAnalyze.length === 0) {
      // Auto-analyze all un-analyzed meetings with transcripts
      const { data: pending } = await supabaseAdmin
        .from("meetings")
        .select("id")
        .is("analysis", null)
        .not("transcript", "is", null)
        .neq("transcript", "")
        .limit(10);

      if (pending) idsToAnalyze.push(...pending.map((m: any) => m.id));
    }

    if (idsToAnalyze.length === 0) {
      return new Response(JSON.stringify({ error: "No meetings to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let analyzed = 0;
    let failed = 0;
    const results: any[] = [];

    for (const id of idsToAnalyze) {
      const { data: meeting, error } = await supabaseAdmin
        .from("meetings")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !meeting || !meeting.transcript) {
        failed++;
        results.push({ id, status: "failed", reason: "No transcript available" });
        continue;
      }

      try {
        const systemPrompt = `You are an expert meeting analyst. Analyze the following meeting transcript and provide a comprehensive analysis.

You MUST call the analyze_meeting function with your analysis. Be thorough but concise.

For action_items, identify specific tasks mentioned or implied, who is responsible (if stated), and any deadlines.
For participants, extract names of people who spoke or were mentioned as present.
For sentiment, assess the overall tone: positive, negative, neutral, or mixed.
For risks, identify any concerns, blockers, or issues raised.
For decisions, note any decisions that were made during the meeting.
For key_topics, list the main subjects discussed.`;

        let aiData: any;
        try {
          aiData = await callLLMWithFallback({
            workflow: "analyze-meeting",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Meeting: "${meeting.title}" (${meeting.meeting_date || "date unknown"})\n\nTRANSCRIPT:\n${meeting.transcript.slice(0, 60000)}` },
            ],
            tools: [{
              type: "function",
              function: {
                name: "analyze_meeting",
                description: "Submit the meeting analysis results",
                parameters: {
                  type: "object",
                  properties: {
                    summary: {
                      type: "string",
                      description: "Executive summary of the meeting (2-4 sentences)",
                    },
                    key_topics: {
                      type: "array",
                      items: { type: "string" },
                      description: "Main topics discussed",
                    },
                    action_items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          task: { type: "string" },
                          owner: { type: "string", description: "Person responsible, if mentioned" },
                          deadline: { type: "string", description: "Deadline if mentioned, otherwise null" },
                          priority: { type: "string", enum: ["high", "medium", "low"] },
                        },
                        required: ["task", "priority"],
                        additionalProperties: false,
                      },
                    },
                    decisions: {
                      type: "array",
                      items: { type: "string" },
                      description: "Key decisions made during the meeting",
                    },
                    participants: {
                      type: "array",
                      items: { type: "string" },
                      description: "Names of participants identified in the transcript",
                    },
                    sentiment: {
                      type: "string",
                      enum: ["positive", "negative", "neutral", "mixed"],
                    },
                    risks: {
                      type: "array",
                      items: { type: "string" },
                      description: "Risks, concerns, or blockers raised",
                    },
                    follow_ups: {
                      type: "array",
                      items: { type: "string" },
                      description: "Suggested follow-up actions or meetings",
                    },
                  },
                  required: ["summary", "key_topics", "action_items", "decisions", "participants", "sentiment", "risks", "follow_ups"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "analyze_meeting" } },
            max_tokens: 8192,
          });
        } catch (err: any) {
          console.error(`AI error for meeting ${id}:`, err?.status, err?.message);
          if (err?.status === 429) {
            return new Response(JSON.stringify({ error: "Rate limited. Try again shortly.", analyzed, failed }), {
              status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (err?.status === 402) {
            return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
              status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          failed++;
          continue;
        }

        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) { failed++; continue; }

        const analysis = safeParseToolArguments<any>(toolCall.function.arguments);
        if (!analysis) { failed++; continue; }

        // Update meeting with analysis
        await supabaseAdmin
          .from("meetings")
          .update({
            analysis,
            summary: analysis.summary,
            action_items: analysis.action_items,
            participants: analysis.participants || [],
            status: "analyzed",
          })
          .eq("id", id);

        results.push({ id, title: meeting.title, status: "analyzed", summary: analysis.summary });
        analyzed++;
      } catch (err) {
        console.error(`Error analyzing meeting ${id}:`, err);
        failed++;
        results.push({ id, status: "failed", reason: err.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, analyzed, failed, total: idsToAnalyze.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analyze meeting error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to analyze meetings" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
