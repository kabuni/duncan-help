import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { safeParseToolArguments } from "../_shared/json.ts";
import { extractCvText } from "../_shared/cv-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function clampScore(score: number): number {
  const n = Number(score);
  if (isNaN(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** Stable SHA-256 of the extracted CV text (lowercased, whitespace-collapsed). */
async function hashCvText(text: string): Promise<string> {
  const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Convert a competency name to a safe, semantic snake_case key.
 *   "Decision Making"          → "decision_making"
 *   "Cross-Cultural Collab."   → "cross_cultural_collab"
 *   "C++ Skills"               → "c_skills"
 * Falls back to `competency_<index>` if the slug is empty.
 */
function slugifyCompetencyName(name: string, index: number): string {
  const slug = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")           // strip accents
    .replace(/[^a-z0-9]+/g, "_")               // non-alphanumerics → _
    .replace(/^_+|_+$/g, "")                   // trim leading/trailing _
    .replace(/_{2,}/g, "_");                   // collapse repeats
  if (!slug) return `competency_${index}`;
  // Ensure key starts with a letter (JSON Schema property names are free-form
  // but some validators dislike leading digits).
  if (/^[0-9]/.test(slug)) return `c_${slug}`;
  return slug;
}

/** Build unique semantic keys for a list of competencies, deduping collisions. */
function buildCompetencyKeyMap(
  competencies: Array<{ name: string }>,
): Array<{ key: string; name: string; index: number }> {
  const used = new Set<string>();
  const out: Array<{ key: string; name: string; index: number }> = [];
  competencies.forEach((c, i) => {
    let base = slugifyCompetencyName(c?.name || "", i);
    let key = base;
    let n = 2;
    while (used.has(key)) {
      key = `${base}_${n++}`;
    }
    used.add(key);
    out.push({ key, name: c?.name || `Competency ${i + 1}`, index: i });
  });
  return out;
}

type EvidenceState = "demonstrated" | "partially_demonstrated" | "not_demonstrated" | "inaccessible";
interface CompetencyResult { score: number | null; justification: string; evidence_state?: EvidenceState; }

function buildToolSchema(keyMap: Array<{ key: string; name: string }>, portfolioMode: boolean) {
  const properties: Record<string, any> = {};
  for (const { key, name } of keyMap) {
    if (portfolioMode) {
      properties[key] = {
        type: "object",
        description: `Assessment for competency "${name}"`,
        properties: {
          evidence_state: {
            type: "string",
            enum: ["demonstrated", "partially_demonstrated", "not_demonstrated", "inaccessible"],
            description: "demonstrated = clear portfolio evidence; partially_demonstrated = indirect/inferred evidence (state this in justification); not_demonstrated = portfolio contains no relevant evidence; inaccessible = evidence could not be viewed (broken link, gated).",
          },
          score: {
            type: ["integer", "null"],
            minimum: 1,
            maximum: 5,
            description: "Integer 1–5 ONLY when evidence_state is demonstrated or partially_demonstrated. MUST be null for not_demonstrated or inaccessible. Weak demonstrated execution IS a valid low score (1 or 2). Absence of evidence is NOT a score of 1 — use not_demonstrated instead.",
          },
          justification: { type: "string", description: "1–2 sentences quoting the specific portfolio evidence used. If partially_demonstrated, explicitly say it is inferred." },
        },
        required: ["evidence_state", "score", "justification"],
        additionalProperties: false,
      };
    } else {
      properties[key] = {
        type: "object",
        description: `Score for competency "${name}"`,
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          justification: { type: "string", description: "Brief evidence-based justification (1–2 sentences quoting CV evidence)" },
        },
        required: ["score", "justification"],
        additionalProperties: false,
      };
    }
  }
  return {
    type: "function" as const,
    function: {
      name: "score_competencies",
      description: portfolioMode
        ? "Submit an evidence-aware competency assessment. Provide evidence_state for EVERY competency; score is 1–5 only when the portfolio actually demonstrates the competency, otherwise null."
        : "Submit competency scores for the candidate. You MUST provide a score and justification for every competency key listed in the schema.",
      parameters: {
        type: "object",
        properties,
        required: keyMap.map((k) => k.key),
        additionalProperties: false,
      },
    },
  };
}

function buildSystemPrompt(
  roleTitle: string,
  keyMap: Array<{ key: string; name: string }>,
  competencies: Array<{ name: string; description?: string }>,
  portfolioMode: boolean,
) {
  const list = keyMap
    .map(({ key, name }, i) => `${i + 1}. key: "${key}" — ${name}: ${competencies[i]?.description || "No description provided"}`)
    .join("\n");

  if (portfolioMode) {
    return `You are an expert design/portfolio assessor. Evaluate this candidate STRICTLY from the portfolio evidence provided for the "${roleTitle}" role.

CRITICAL RULES:
- Base every assessment ONLY on evidence in the provided text (portfolio case studies, project descriptions, artefacts).
- IGNORE any LinkedIn, recruiter notes, PPT context, hiring metadata, day rate, location, or availability — even if present.
- Do NOT invent a numeric score when the portfolio does not show the competency. Absence of evidence is NOT a score of 1.
- Do NOT inflate scores because a candidate worked at a prestigious company or shipped a product. Working somewhere ≠ demonstrated competency.
- Weak but demonstrated execution IS a valid low numeric score (1 or 2).

For EACH competency, return an evidence_state:
- demonstrated: portfolio directly shows this competency in a case study, artefact, or explicit description. Score 1–5.
    1 = evidence exists but the execution shown is weak
    3 = solid, competent evidence
    5 = exceptional, standout evidence
- partially_demonstrated: evidence is indirect/inferred (e.g. a shipped product implies SOME handoff work). Score 1–5, and the justification MUST explicitly say "inferred". Prefer this over demonstrated when the evidence is only proxy.
- not_demonstrated: portfolio contains no relevant evidence. score MUST be null.
- inaccessible: portfolio link/case study could not be accessed (paywalled, broken, gated). score MUST be null.

Competencies (use the exact key shown — do NOT invent new keys):
${list}

Call score_competencies ONCE with EVERY key: ${keyMap.map((k) => `"${k.key}"`).join(", ")}.`;
  }

  return `You are an expert recruitment assessor. Score this candidate's CV against the following competencies for the "${roleTitle}" role.

For EACH competency, score 1–5:
1 = No evidence
2 = Minimal evidence
3 = Some evidence
4 = Good evidence
5 = Exceptional evidence

Be CRITICAL. Only give high scores when the CV provides clear, specific evidence. Quote or reference concrete CV evidence in each justification.

Competencies (use the exact key shown — do NOT invent new keys):
${list}

Call score_competencies ONCE. The arguments object MUST contain EVERY key listed above (${keyMap.map((k) => `"${k.key}"`).join(", ")}). Each entry must have an integer score from 1 to 5 and a justification string. Do not omit any key.`;
}

function validateScoresPayload(
  raw: any,
  keyMap: Array<{ key: string; name: string }>,
  portfolioMode: boolean,
): { ok: true; scores: Record<string, CompetencyResult> } | { ok: false; missing: string[]; invalid: string[] } {
  const missing: string[] = [];
  const invalid: string[] = [];
  const scores: Record<string, CompetencyResult> = {};
  if (!raw || typeof raw !== "object") {
    return { ok: false, missing: keyMap.map((k) => k.key), invalid: [] };
  }
  for (const { key } of keyMap) {
    const entry = raw[key];
    if (!entry || typeof entry !== "object") { missing.push(key); continue; }
    const justif = typeof entry.justification === "string" ? entry.justification.trim() : "";
    if (!justif) { invalid.push(key); continue; }

    if (portfolioMode) {
      const state = entry.evidence_state as EvidenceState | undefined;
      if (!state || !["demonstrated", "partially_demonstrated", "not_demonstrated", "inaccessible"].includes(state)) {
        invalid.push(key);
        continue;
      }
      const rawScore = entry.score;
      const requiresScore = state === "demonstrated" || state === "partially_demonstrated";
      if (requiresScore) {
        const n = Number(rawScore);
        if (!Number.isFinite(n) || n < 1 || n > 5) { invalid.push(key); continue; }
        scores[key] = { score: clampScore(n), justification: justif, evidence_state: state };
      } else {
        // score must be null for not_demonstrated / inaccessible
        scores[key] = { score: null, justification: justif, evidence_state: state };
      }
    } else {
      const n = Number(entry.score);
      if (!Number.isFinite(n) || n < 1 || n > 5) { invalid.push(key); continue; }
      scores[key] = { score: clampScore(n), justification: justif };
    }
  }
  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return { ok: true, scores };
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

    const body = await req.json().catch(() => ({}));
    const candidateId = body?.candidate_id as string | undefined;
    const roleId = body?.role_id as string | undefined;
    const forceRescore = body?.force === true;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let query = supabaseAdmin
      .from("candidates")
      .select("*")
      .not("cv_storage_path", "is", null)
      .not("job_role_id", "is", null);

    if (candidateId) {
      query = query.eq("id", candidateId);
      // Even when targeting a specific candidate, refuse to overwrite a locked
      // score unless the caller explicitly forces it.
      if (!forceRescore) query = query.eq("is_score_locked", false);
    } else if (!forceRescore) {
      query = query.is("competency_score", null).eq("is_score_locked", false);
    }
    if (roleId) query = query.eq("job_role_id", roleId);
    query = query.not("status", "in", '("unmatched","parse_failed")');

    const { data: candidates, error: fetchError } = await query;

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message || "Failed to load candidates" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({
        scored: 0, skipped: 0, failed: 0,
        message: roleId ? "No eligible candidates remain for the selected role." : "No eligible candidates remain to score.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    const bodyPortfolioFlag = body?.portfolio_only === true;

    for (const candidate of candidates) {
      const role = roleMap.get(candidate.job_role_id);
      const competencies = role?.competencies;

      if (!competencies || !Array.isArray(competencies) || competencies.length === 0) {
        skipped++;
        continue;
      }

      // Portfolio-only evidence-normalized mode: opt-in per candidate (or by request body).
      // Never applied to standard CV candidates unless explicitly flagged.
      const portfolioMode = candidate.is_portfolio_only === true || bodyPortfolioFlag;

      try {
        const cv = await extractCvText(supabaseAdmin, candidate.cv_storage_path!);
        if (!cv) {
          console.error(`CV text extraction failed for ${candidate.id} (${candidate.cv_storage_path})`);
          failed++;
          continue;
        }

        const cvHash = await hashCvText(cv.text);

        // Cache hit: a candidate with the SAME cv_hash + role has already been
        // scored for competencies. Skip caching entirely for portfolio-mode runs
        // so evidence-normalized scoring is always recomputed from the current
        // portfolio evidence and coverage metadata is preserved per-candidate.
        if (!forceRescore && !portfolioMode) {
          const { data: cached } = await supabaseAdmin
            .from("candidates")
            .select("id, name, competency_score, scoring_details")
            .eq("cv_hash", cvHash)
            .eq("job_role_id", candidate.job_role_id)
            .eq("is_portfolio_only", false)
            .not("competency_score", "is", null)
            .neq("id", candidate.id)
            .limit(1)
            .maybeSingle();
          if (cached?.competency_score != null && (cached.scoring_details as any)?.competencies) {
            const existingDetails = (candidate.scoring_details as any) || {};
            const newDetails = {
              ...existingDetails,
              competencies: (cached.scoring_details as any).competencies,
              competencies_meta: {
                source: "cv_hash_cache",
                cached_from: cached.id,
                cached_from_name: cached.name,
                scored_at: new Date().toISOString(),
              },
            };
            const valuesScore = candidate.values_score;
            const newStatus = valuesScore != null ? "fully_scored" : "competency_scored";
            const isLocked = valuesScore != null;
            await supabaseAdmin.from("candidates").update({
              competency_score: cached.competency_score,
              scoring_details: newDetails,
              status: newStatus,
              cv_hash: cvHash,
              ...(isLocked ? { is_score_locked: true } : {}),
            }).eq("id", candidate.id);
            console.log(`[score-cv-competencies] candidate=${candidate.id} reused cached scores from ${cached.id}`);
            results.push({ id: candidate.id, name: candidate.name, competency_score: cached.competency_score, status: newStatus, source: "cache" });
            scored++;
            continue;
          }
        }

        const keyMap = buildCompetencyKeyMap(competencies);
        const toolDef = buildToolSchema(keyMap, portfolioMode);
        const systemPrompt = buildSystemPrompt(role.title, keyMap, competencies, portfolioMode);

        const userContent = portfolioMode
          ? `Portfolio evidence for ${candidate.name} (${cv.filename}):\n\n${cv.text}\n\nAssess this candidate against EVERY competency listed in the system prompt using the evidence-aware schema. Do NOT use LinkedIn, PPT/recruiter notes, rate, location, or availability even if referenced anywhere.`
          : `Candidate CV (${cv.filename}):\n\n${cv.text}\n\nScore this candidate against EVERY competency listed in the system prompt. Call score_competencies once with all required keys.`;

        const baseMessages: any[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ];

        const callOnce = async (extraMessages: any[] = []) => {
          return await callLLMWithFallback({
            workflow: "score-cv-competencies",
            force_provider: "claude",
            model_override: { claude: "claude-haiku-4-5" },
            temperature: 0,
            max_tokens: 4096,
            messages: [...baseMessages, ...extraMessages],
            tools: [toolDef],
            tool_choice: { type: "function", function: { name: "score_competencies" } },
          });
        };

        let aiData: any;
        let validated: ReturnType<typeof validateScoresPayload> | null = null;
        let lastRaw: any = null;

        try {
          aiData = await callOnce();
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
        if (toolCall?.function?.arguments) {
          lastRaw = safeParseToolArguments<Record<string, any>>(toolCall.function.arguments);
          validated = validateScoresPayload(lastRaw, keyMap, portfolioMode);
        } else {
          validated = { ok: false, missing: keyMap.map((k) => k.key), invalid: [] };
        }

        // Single corrective retry if the tool call was incomplete or malformed.
        if (!validated.ok) {
          const missing = (validated as any).missing as string[];
          const invalid = (validated as any).invalid as string[];
          console.warn(`[score-cv-competencies] candidate=${candidate.id} retrying — missing=[${missing.join(",")}] invalid=[${invalid.join(",")}]`);

          const correction = portfolioMode
            ? `Your previous score_competencies call was invalid.
${missing.length ? `Missing keys: ${missing.join(", ")}.` : ""}
${invalid.length ? `Invalid entries (bad evidence_state, bad score, or empty justification): ${invalid.join(", ")}.` : ""}
Call score_competencies again with EXACT keys: ${keyMap.map((k) => k.key).join(", ")}.
Every entry requires evidence_state (demonstrated | partially_demonstrated | not_demonstrated | inaccessible), score (integer 1–5 ONLY when demonstrated or partially_demonstrated, otherwise null), and a non-empty justification.`
            : `Your previous response to score_competencies was invalid.
${missing.length ? `Missing keys: ${missing.join(", ")}.` : ""}
${invalid.length ? `Invalid (bad score or empty justification) keys: ${invalid.join(", ")}.` : ""}
You MUST call score_competencies again with the EXACT keys: ${keyMap.map((k) => k.key).join(", ")}.
Each entry requires an integer score from 1 to 5 and a non-empty justification.`;

          let retryData: any;
          try {
            retryData = await callOnce([
              { role: "assistant", content: "I need to resubmit with all required keys." },
              { role: "user", content: correction },
            ]);
          } catch (err: any) {
            console.error(`Retry AI error for ${candidate.id}:`, err?.status, err?.message);
            failed++;
            continue;
          }

          const retryCall = retryData.choices?.[0]?.message?.tool_calls?.[0];
          if (!retryCall?.function?.arguments) {
            console.error(`Retry produced no tool call for ${candidate.id}`);
            failed++;
            continue;
          }
          lastRaw = safeParseToolArguments<Record<string, any>>(retryCall.function.arguments);
          validated = validateScoresPayload(lastRaw, keyMap, portfolioMode);
          if (!validated.ok) {
            const m2 = (validated as any).missing as string[];
            const i2 = (validated as any).invalid as string[];
            console.error(`Retry still invalid for ${candidate.id}: missing=[${m2.join(",")}] invalid=[${i2.join(",")}]`);
            failed++;
            continue;
          }
        }

        // Build the legacy-shaped competencyScores keyed by competency name (UI compatibility).
        // Portfolio-mode entries carry evidence_state and may have score=null.
        const competencyScores: Record<string, CompetencyResult> = {};
        for (const { key, name } of keyMap) {
          const entry = (validated.scores as Record<string, CompetencyResult>)[key];
          competencyScores[name] = portfolioMode
            ? { score: entry.score, justification: entry.justification, evidence_state: entry.evidence_state }
            : { score: entry.score, justification: entry.justification };
        }

        // Score computation:
        //  - CV mode (legacy): unweighted mean of ALL integer scores.
        //  - Portfolio mode: evidence-normalized — mean of ONLY demonstrated /
        //    partially_demonstrated scores. Never treat missing evidence as 1.
        let competencyScore: number | null = null;
        let portfolioMeta: Record<string, any> | null = null;
        if (portfolioMode) {
          const total = keyMap.length;
          const assessedEntries = Object.values(competencyScores).filter(
            (v) => (v.evidence_state === "demonstrated" || v.evidence_state === "partially_demonstrated") && typeof v.score === "number",
          );
          const assessed = assessedEntries.length;
          if (assessed > 0) {
            const sum = assessedEntries.reduce((a, b) => a + (b.score as number), 0);
            competencyScore = Math.round((sum / assessed) * 10) / 10;
          }
          portfolioMeta = {
            methodology: "evidence_normalized",
            assessed,
            total,
            coverage: total > 0 ? Math.round((assessed / total) * 100) / 100 : 0,
            portfolio_score: competencyScore,
            counts: {
              demonstrated: Object.values(competencyScores).filter((v) => v.evidence_state === "demonstrated").length,
              partially_demonstrated: Object.values(competencyScores).filter((v) => v.evidence_state === "partially_demonstrated").length,
              not_demonstrated: Object.values(competencyScores).filter((v) => v.evidence_state === "not_demonstrated").length,
              inaccessible: Object.values(competencyScores).filter((v) => v.evidence_state === "inaccessible").length,
            },
          };
        } else {
          const allScores = Object.values(competencyScores)
            .map((v) => v.score)
            .filter((s): s is number => typeof s === "number");
          if (allScores.length > 0) {
            const avg = allScores.reduce((a, b) => a + b, 0) / allScores.length;
            competencyScore = Math.round(avg * 10) / 10;
          }
        }

        const valuesScore = candidate.values_score;
        const newStatus = valuesScore != null && competencyScore != null ? "fully_scored" : "competency_scored";

        const existingDetails = (candidate.scoring_details as any) || {};
        const newDetails: Record<string, any> = {
          ...existingDetails,
          competencies: competencyScores,
          competencies_meta: {
            model: aiData?._model || "claude-haiku-4-5",
            provider: aiData?._provider || "claude",
            mode: portfolioMode ? "portfolio_only" : "cv",
            schema_keys: keyMap.map((k) => ({ key: k.key, name: k.name })),
            scored_at: new Date().toISOString(),
          },
        };
        if (portfolioMeta) newDetails.portfolio_meta = portfolioMeta;
        else if (existingDetails.portfolio_meta) delete newDetails.portfolio_meta;

        const { error: updateError } = await supabaseAdmin
          .from("candidates")
          .update({
            competency_score: competencyScore,
            scoring_details: newDetails,
            status: newStatus,
            cv_hash: cvHash,
            // Lock once both component scores are present (competency must be numeric).
            ...(newStatus === "fully_scored" ? { is_score_locked: true } : {}),
          })
          .eq("id", candidate.id);

        if (updateError) {
          console.error(`Update error for ${candidate.id}:`, updateError);
          failed++;
          continue;
        }

        results.push({
          id: candidate.id,
          name: candidate.name,
          competency_score: competencyScore,
          status: newStatus,
          ...(portfolioMeta ? { portfolio_meta: portfolioMeta } : {}),
        });
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
