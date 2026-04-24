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
    const { job_role_id, title } = await req.json();
    if (!job_role_id || !title) {
      return new Response(JSON.stringify({ error: "job_role_id and title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Generate JD content via the LLM router
    let aiData: any;
    try {
      aiData = await callLLMWithFallback({
        workflow: "generate-jd",
        messages: [
          {
            role: "system",
            content: `You are an expert HR professional at Kabuni, a purpose-driven company focused on intentional technology, community impact, and long-term thinking. Generate a comprehensive, professional job description.

Kabuni's Core Values:
- Sweat the Detail: Focus on precision, quality, and reliability to build trust.
- Integrity Always: Acting with honesty, accountability, and no ego.
- Behaviour Over Attention: Optimising for real-world impact over "noise" or clicks.
- Progress Is Collective: Designing systems that help individuals and communities move forward together.
- Health, Family and Happiness: Protecting wellbeing and supporting family-first lives.
- Build for the Long Term: Building purposeful infrastructure and movements designed to last.

Structure the JD with these sections:
1. About Kabuni (2-3 sentences)
2. Role Overview (3-4 sentences)
3. Key Responsibilities (6-10 bullet points)
4. Required Skills & Experience (6-8 bullet points)
5. Desirable Skills (3-5 bullet points)
6. What We Offer (4-6 bullet points)
7. Our Values — briefly tie in how the role connects to Kabuni values

Write in a warm but professional tone. Be specific to the role, not generic.`,
          },
          {
            role: "user",
            content: `Generate a complete job description for the role: ${title}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_job_description",
            description: "Return the generated job description with structured sections",
            parameters: {
              type: "object",
              properties: {
                full_text: { type: "string", description: "The complete job description as formatted text with markdown headings and bullet points" },
                competencies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Short competency name (2-5 words)" },
                      description: { type: "string", description: "Brief description (1-2 sentences)" },
                    },
                    required: ["name", "description"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["full_text", "competencies"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_job_description" } },
      });
    } catch (err: any) {
      console.error("AI error:", err?.status, err?.message);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return a JD" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = safeParseToolArguments<{ full_text: string; competencies: any[] }>(toolCall.function.arguments);
    if (!parsed?.full_text) {
      return new Response(JSON.stringify({ error: "AI returned malformed JD" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { full_text, competencies } = parsed;

    // Update job role with competencies and description
    const { error: updateError } = await supabaseAdmin
      .from("job_roles")
      .update({ competencies, description: full_text })
      .eq("id", job_role_id);

    if (updateError) {
      console.error("Update error:", updateError);
    }

    return new Response(
      JSON.stringify({ success: true, job_role_id, full_text, competencies }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Generate JD error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate JD" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
