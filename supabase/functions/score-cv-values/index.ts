import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";
import { extractCvText } from "../_shared/cv-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const KABUNI_VALUES = [
  { key: "sweat_the_detail", name: "Sweat the Detail", description: "Care deeply about the small things. Precision, quality, and reliability are non-negotiable." },
  { key: "integrity_always", name: "Integrity Always", description: "Act with honesty, consistency, and accountability. No ego. No shortcuts." },
  { key: "behaviour_over_attention", name: "Behaviour Over Attention", description: "Optimise for real-world impact, not clicks or noise. If it doesn't change behaviour, it doesn't matter." },
  { key: "progress_is_collective", name: "Progress Is Collective", description: "Lift each other, celebrate progress, and design systems that help individuals, families, and communities move forward together." },
  { key: "health_family_happiness", name: "Health, Family and Happiness", description: "Protect wellbeing, support family first, and build in ways that allow people to live healthy, balanced lives." },
  { key: "build_for_long_term", name: "Build for the Long Term", description: "Build with purpose, patience, and ambition. Creating infrastructure, not features. A movement designed to last." },
];

// P8: Clamp score to valid range
function clampScore(score: number): number {
  const n = Number(score);
  if (isNaN(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

async function getCvMessages(supabaseAdmin: any, storagePath: string): Promise<any[] | null> {
  const cv = await extractCvText(supabaseAdmin, storagePath);
  if (!cv) return null;
  return [
    {
      role: "user",
      content: `Candidate CV (${cv.filename}):\n\n${cv.text}\n\nScore this candidate's CV against the Kabuni company values described in the system prompt.`,
    },
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = body.candidate_id;
    const roleId = body.role_id;

    // P7: Only score candidates that need scoring
    let query = supabaseAdmin
      .from("candidates")
      .select("*")
      .not("cv_storage_path", "is", null)
      .not("job_role_id", "is", null); // Must have a valid role

    if (candidateId) {
      query = query.eq("id", candidateId);
    } else {
      // P7: Skip already values-scored candidates unless explicitly targeting one
      query = query.is("values_score", null);
    }

    if (roleId) {
      query = query.eq("job_role_id", roleId);
    }

    // P7: Exclude unmatched and parse_failed candidates
    query = query.not("status", "in", '("unmatched","parse_failed")');

    const { data: candidates, error: fetchError } = await query;

    if (fetchError || !candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ error: "No eligible candidates to score" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const valuesDescription = KABUNI_VALUES.map((v, i) => `${i + 1}. ${v.name}: ${v.description}`).join("\n");

    const systemPrompt = `You are an expert recruitment assessor for Kabuni. Your task is to critically evaluate a candidate's CV against Kabuni's 6 core values.

For EACH value, score the candidate from 1-5 based on evidence in their CV:
1 = No evidence at all
2 = Minimal/weak evidence  
3 = Some evidence but not strong
4 = Good evidence demonstrated
5 = Exceptional, clear and strong evidence

Be CRITICAL and evidence-based. Do not give high scores without clear justification from the CV content.

The 6 Kabuni Core Values:
${valuesDescription}

You MUST call the score_values function with your assessment.`;

    const toolDef = {
      type: "function",
      function: {
        name: "score_values",
        description: "Submit the values-based scoring for a candidate",
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            KABUNI_VALUES.map((v) => [
              v.key,
              {
                type: "object",
                properties: {
                  score: { type: "number", minimum: 1, maximum: 5 },
                  justification: { type: "string", description: "Brief evidence-based justification (1-2 sentences)" },
                },
                required: ["score", "justification"],
                additionalProperties: false,
              },
            ])
          ),
          required: KABUNI_VALUES.map((v) => v.key),
          additionalProperties: false,
        },
      },
    };

    // Long-running: process candidates in the background to avoid the 150s edge timeout.
    // The UI polls candidate rows for `values_score` / `status` updates.
    const processCandidates = async () => {
      let scored = 0;
      let failed = 0;

      for (const candidate of candidates) {
        try {
          const cvMessages = await getCvMessages(supabaseAdmin, candidate.cv_storage_path!);
          if (!cvMessages) {
            failed++;
            continue;
          }

          let aiData: any;
          try {
            // Deterministic scoring on Claude Haiku 4.5 (temperature=0).
            aiData = await callLLMWithFallback({
              workflow: "score-cv-values",
              force_provider: "claude",
              model_override: { claude: "claude-haiku-4-5" },
              temperature: 0,
              messages: [{ role: "system", content: systemPrompt }, ...cvMessages],
              tools: [toolDef as any],
              tool_choice: { type: "function", function: { name: "score_values" } } as any,
            });
          } catch (err: any) {
            console.error(`AI error for ${candidate.id}:`, err?.status, err?.message);
            if (err?.status === 429 || err?.status === 402) {
              console.error(`Aborting batch due to status ${err?.status}. Scored=${scored} Failed=${failed}`);
              return;
            }
            failed++;
            continue;
          }

          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall?.function?.arguments) {
            console.error(`No tool call for candidate ${candidate.id}`);
            failed++;
            continue;
          }

          const scores = safeParseToolArguments<Record<string, any>>(toolCall.function.arguments);
          if (!scores) {
            console.error(`Malformed scores tool args for candidate ${candidate.id}`);
            failed++;
            continue;
          }

          // P8: Clamp all scores to valid range 1-5
          for (const v of KABUNI_VALUES) {
            if (scores[v.key]?.score !== undefined) {
              scores[v.key].score = clampScore(scores[v.key].score);
            }
          }

          const allScores = KABUNI_VALUES.map((v) => scores[v.key]?.score ?? 0).filter((s) => s > 0);
          if (allScores.length === 0) {
            console.error(`All scores were 0 for candidate ${candidate.id}`);
            failed++;
            continue;
          }
          const valuesAvg = allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length;
          const valuesScore = Math.round(valuesAvg * 10) / 10;

          const existingDetails = (candidate.scoring_details as any) || {};
          const newDetails = { ...existingDetails, values: scores };

          // total_score is recomputed automatically by the DB trigger
          // (single source of truth: trg_recompute_total_score)
          const competencyScore = candidate.competency_score;
          const newStatus = competencyScore != null ? "fully_scored" : "values_scored";

          const { error: updateError } = await supabaseAdmin
            .from("candidates")
            .update({
              values_score: valuesScore,
              scoring_details: newDetails,
              status: newStatus,
            })
            .eq("id", candidate.id);

          if (updateError) {
            console.error(`Update error for ${candidate.id}:`, updateError);
            failed++;
            continue;
          }

          scored++;
        } catch (err: any) {
          console.error(`Error scoring candidate ${candidate.id}:`, err);
          failed++;
        }
      }

      console.log(`score-cv-values batch complete: scored=${scored} failed=${failed} total=${candidates.length}`);
    };

    // @ts-ignore - EdgeRuntime is provided by the Supabase edge runtime
    EdgeRuntime.waitUntil(processCandidates());

    return new Response(
      JSON.stringify({
        success: true,
        queued: candidates.length,
        message: "Scoring started in the background. Poll candidates for updated values_score/status.",
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Score CV values error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to score CVs" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
