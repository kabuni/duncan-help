import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanDocxText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<w:cr\/>/g, "\n")
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getCvContent(supabaseAdmin: any, storagePath: string): Promise<any[] | null> {
  const { data: fileData, error } = await supabaseAdmin.storage.from("cvs").download(storagePath);
  if (error || !fileData) return null;

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  const filename = storagePath.split("/").pop() || "cv.pdf";
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename.endsWith(".docx")) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const documentXmlFile = zip.file("word/document.xml");
      if (documentXmlFile) {
        const xml = await documentXmlFile.async("string");
        const extractedText = cleanDocxText(xml).slice(0, 120000);
        if (extractedText.length > 0) {
          return [
            {
              role: "user",
              content: `Candidate CV (${filename}):\n\n${extractedText}\n\nScore this candidate's CV against the competencies listed in the system prompt.`,
            },
          ];
        }
      }
    } catch (docxError) {
      console.error(`DOCX extraction failed for ${storagePath}:`, docxError);
    }
  }

  const mimeType = getMimeType(filename);
  const base64 = uint8ToBase64(bytes);

  return [
    {
      role: "user",
      content: [
        { type: "file", file: { filename, file_data: `data:${mimeType};base64,${base64}` } },
        { type: "text", text: "Score this candidate's CV against the competencies listed in the system prompt." },
      ],
    },
  ];
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

    const body = await req.json().catch(() => ({}));
    const candidateId = body?.candidate_id as string | undefined;
    const roleId = body?.role_id as string | undefined;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // P7: Only score candidates that need competency scoring
    let query = supabaseAdmin
      .from("candidates")
      .select("*")
      .not("cv_storage_path", "is", null)
      .not("job_role_id", "is", null);

    if (candidateId) {
      query = query.eq("id", candidateId);
    } else {
      // P7: Skip already competency-scored candidates unless explicitly targeting one
      query = query.is("competency_score", null);
    }

    if (roleId) {
      query = query.eq("job_role_id", roleId);
    }

    // P7: Exclude unmatched and parse_failed candidates
    query = query.not("status", "in", '("unmatched","parse_failed")');

    const { data: candidates, error: fetchError } = await query;

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message || "Failed to load candidates" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({
        scored: 0,
        skipped: 0,
        failed: 0,
        message: roleId
          ? "No eligible candidates remain for the selected role."
          : "No eligible candidates remain to score.",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const roleIds = [...new Set(candidates.map((c: any) => c.job_role_id))];
    const { data: roles } = await supabaseAdmin
      .from("job_roles")
      .select("id, title, competencies")
      .in("id", roleIds);

    const roleMap = new Map((roles || []).map((r: any) => [r.id, r]));

    let scored = 0;
    let failed = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const candidate of candidates) {
      const role = roleMap.get(candidate.job_role_id);
      const competencies = role?.competencies;

      if (!competencies || !Array.isArray(competencies) || competencies.length === 0) {
        skipped++;
        continue;
      }

      try {
        const cvMessages = await getCvContent(supabaseAdmin, candidate.cv_storage_path!);
        if (!cvMessages) {
          failed++;
          continue;
        }

        const properties: any = {};
        const required: string[] = [];
        competencies.forEach((_: any, i: number) => {
          const key = `competency_${i}`;
          properties[key] = {
            type: "object",
            properties: {
              score: { type: "number", minimum: 1, maximum: 5 },
              justification: { type: "string", description: "Brief evidence-based justification" },
            },
            required: ["score", "justification"],
            additionalProperties: false,
          };
          required.push(key);
        });

        const competencyList = competencies.map((c: any, i: number) =>
          `${i + 1}. ${c?.name || `Competency ${i + 1}`}: ${c?.description || "No description provided"}`
        ).join("\n");

        const systemPrompt = `You are an expert recruitment assessor. Score this candidate's CV against the following competencies for the "${role.title}" role.

For EACH competency, score 1-5:
1 = No evidence
2 = Minimal evidence
3 = Some evidence
4 = Good evidence
5 = Exceptional evidence

Be CRITICAL. Only give high scores with clear CV evidence.

Competencies:
${competencyList}

Call score_competencies with your assessment. Use keys competency_0, competency_1, etc. matching the order above.`;

        let aiData: any;
        try {
          // DOCX path produces plain-text user messages (Claude-safe); PDF path uses OpenAI file blocks.
          // Force OpenAI to keep file-content compatibility consistent.
          aiData = await callLLMWithFallback({
            workflow: "score-cv-competencies",
            force_provider: "openai",
            messages: [{ role: "system", content: systemPrompt }, ...cvMessages],
            tools: [{
              type: "function",
              function: {
                name: "score_competencies",
                description: "Submit competency scores for the candidate",
                parameters: { type: "object", properties, required, additionalProperties: false },
              },
            }],
            tool_choice: { type: "function", function: { name: "score_competencies" } },
          });
        } catch (err: any) {
          console.error(`AI error for ${candidate.id}:`, err?.status, err?.message);
          if (err?.status === 429) {
            return new Response(JSON.stringify({ error: "Rate limited. Try again shortly.", scored, failed }), {
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
        if (!toolCall?.function?.arguments) {
          failed++;
          continue;
        }

        const rawScores = safeParseToolArguments<Record<string, any>>(toolCall.function.arguments);
        if (!rawScores) {
          failed++;
          continue;
        }

        // P8: Clamp scores and build competency map
        const competencyScores: any = {};
        competencies.forEach((comp: any, i: number) => {
          const key = `competency_${i}`;
          const raw = rawScores[key] || { score: 0, justification: "Not scored" };
          competencyScores[comp.name] = {
            score: clampScore(raw.score),
            justification: raw.justification || "Not scored",
          };
        });

        const allScores = Object.values(competencyScores).map((v: any) => Number(v.score) || 0).filter((s) => s > 0);
        if (allScores.length === 0) {
          console.error(`All competency scores were 0 for candidate ${candidate.id}`);
          failed++;
          continue;
        }
        const avg = allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length;
        const competencyScore = Math.round(avg * 10) / 10;

        // P3: Only calculate total_score if BOTH scores exist
        const valuesScore = candidate.values_score;
        let totalScore: number | null = null;
        if (valuesScore != null && competencyScore != null) {
          totalScore = Math.round(((valuesScore + competencyScore) / 2) * 10) / 10;
        }

        // P4: Determine correct status
        let newStatus: string;
        if (valuesScore != null) {
          newStatus = "fully_scored";
        } else {
          newStatus = "competency_scored";
        }

        const existingDetails = (candidate.scoring_details as any) || {};
        const newDetails = { ...existingDetails, competencies: competencyScores };

        const { error: updateError } = await supabaseAdmin
          .from("candidates")
          .update({
            competency_score: competencyScore,
            total_score: totalScore,
            scoring_details: newDetails,
            status: newStatus,
          })
          .eq("id", candidate.id);

        if (updateError) {
          console.error(`Update error for ${candidate.id}:`, updateError);
          failed++;
          continue;
        }

        results.push({ id: candidate.id, name: candidate.name, competency_score: competencyScore, total_score: totalScore, status: newStatus });
        scored++;
      } catch (err: any) {
        console.error(`Error scoring ${candidate.id}:`, err);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, scored, failed, skipped, total: candidates.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Score competencies error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to score competencies" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
