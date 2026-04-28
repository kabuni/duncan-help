import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";
import { extractCvText } from "../_shared/cv-text.ts";

/** Stable SHA-256 of the extracted CV text (lowercased, whitespace-collapsed). */
async function hashCvText(text: string): Promise<string> {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  return "application/octet-stream";
}

// P8: Clamp score to valid range
function clampScore(score: number): number {
  const n = Number(score);
  if (isNaN(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

async function getCvContent(supabaseAdmin: any, storagePath: string): Promise<{ messages: any[] } | null> {
  const { data: fileData, error } = await supabaseAdmin.storage.from("cvs").download(storagePath);
  if (error || !fileData) return null;

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  const filename = storagePath.split("/").pop() || "cv.pdf";
  const mimeType = getMimeType(filename);
  const base64 = uint8ToBase64(bytes);

  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "file", file: { filename, file_data: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: "Score this candidate's CV against the Kabuni company values described in the system prompt." },
        ],
      },
    ],
  };
}

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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = body.candidate_id;
    const roleId = body.role_id;
    const forceRescore = body?.force === true;

    // P7: Only score candidates that need scoring
    let query = supabaseAdmin
      .from("candidates")
      .select("*")
      .not("cv_storage_path", "is", null)
      .not("job_role_id", "is", null); // Must have a valid role

    if (candidateId) {
      query = query.eq("id", candidateId);
      // Refuse to overwrite locked rows unless explicitly forced.
      if (!forceRescore) query = query.eq("is_score_locked", false);
    } else if (!forceRescore) {
      // Skip already values-scored AND already-locked candidates in batch mode.
      query = query.is("values_score", null).eq("is_score_locked", false);
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
      let cached = 0;

      for (const candidate of candidates) {
        try {
          // Compute cv_hash up-front so we can short-circuit on cache hits.
          // Falls back gracefully if text extraction fails — we still try the
          // OpenAI file-block path below for legacy/scanned PDFs.
          let cvHash: string | null = null;
          try {
            const cvText = await extractCvText(supabaseAdmin, candidate.cv_storage_path!);
            if (cvText?.text) cvHash = await hashCvText(cvText.text);
          } catch (err) {
            console.warn(`[score-cv-values] hash extraction failed for ${candidate.id}:`, err);
          }

          // Cache lookup: same CV + same role already scored → reuse deterministically.
          if (cvHash && !forceRescore) {
            const { data: cacheHit } = await supabaseAdmin
              .from("candidates")
              .select("id, name, values_score, scoring_details")
              .eq("cv_hash", cvHash)
              .eq("job_role_id", candidate.job_role_id)
              .not("values_score", "is", null)
              .neq("id", candidate.id)
              .limit(1)
              .maybeSingle();

            if (cacheHit?.values_score != null && (cacheHit.scoring_details as any)?.values) {
              const existingDetails = (candidate.scoring_details as any) || {};
              const newDetails = {
                ...existingDetails,
                values: (cacheHit.scoring_details as any).values,
                values_meta: {
                  source: "cv_hash_cache",
                  cached_from_candidate_id: cacheHit.id,
                  cached_from_name: cacheHit.name,
                  reused_at: new Date().toISOString(),
                },
              };
              const competencyScore = candidate.competency_score;
              const newStatus = competencyScore != null ? "fully_scored" : "values_scored";
              const isLocked = competencyScore != null;

              const { error: cacheUpdateError } = await supabaseAdmin
                .from("candidates")
                .update({
                  values_score: cacheHit.values_score,
                  scoring_details: newDetails,
                  status: newStatus,
                  cv_hash: cvHash,
                  ...(isLocked ? { is_score_locked: true } : {}),
                })
                .eq("id", candidate.id);

              if (cacheUpdateError) {
                console.error(`[score-cv-values] cache update error for ${candidate.id}:`, cacheUpdateError);
                failed++;
                continue;
              }

              console.log(`[score-cv-values] candidate=${candidate.id} reused values from ${cacheHit.id}`);
              cached++;
              scored++;
              continue;
            }
          }

          const cvContent = await getCvContent(supabaseAdmin, candidate.cv_storage_path!);
          if (!cvContent) {
            failed++;
            continue;
          }

          let aiData: any;
          try {
            // CV files use OpenAI file-content blocks; force OpenAI to avoid Claude shape mismatch.
            aiData = await callLLMWithFallback({
              workflow: "score-cv-values",
              force_provider: "openai",
              messages: [{ role: "system", content: systemPrompt }, ...cvContent.messages],
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
          const newDetails = {
            ...existingDetails,
            values: scores,
            values_meta: {
              source: "llm",
              provider: aiData?._provider || "openai",
              model: aiData?._model || null,
              scored_at: new Date().toISOString(),
            },
          };

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
              // Persist hash so future duplicates can hit the cache.
              ...(cvHash ? { cv_hash: cvHash } : {}),
              // Lock once both component scores are present.
              ...(newStatus === "fully_scored" ? { is_score_locked: true } : {}),
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

      console.log(`score-cv-values batch complete: scored=${scored} cached=${cached} failed=${failed} total=${candidates.length}`);
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
