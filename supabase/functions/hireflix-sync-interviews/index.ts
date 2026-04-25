import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HIREFLIX_GQL_URL = "https://api.hireflix.com/me";

async function hireflixQuery(apiKey: string, query: string) {
  const res = await fetch(HIREFLIX_GQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || "Hireflix API error");
  return data.data;
}

async function fetchPositionInterviews(apiKey: string, positionId: string) {
  const query = `
    query {
      position(id: "${positionId}") {
        interviews {
          id
          status
          candidate {
            email
            fullName
          }
          url {
            private
            public
            short
          }
          externalLink {
            url
          }
          questions {
            id
            answer {
              transcription {
                text
              }
            }
          }
        }
      }
    }
  `;
  const data = await hireflixQuery(apiKey, query);
  return data?.position?.interviews || [];
}

// Hireflix InterviewUrlType has exactly 3 fields: private, public, short
// - "private" = admin dashboard link (admin.hireflix.com/...) ← correct recruiter playback
// - "public"  = hosted recording playback page (no login) — used only as fallback
// - "short"   = candidate recorder link (hflx.io/c/...) — NEVER use for playback
// We prefer `private`, fall back to `public`, and never use `short`.
function extractReviewerPlaybackUrl(interview: any): string | null {
  // Admin playback link (admin.hireflix.com/...) — the only correct link for recruiters.
  const privateUrl = interview?.url?.private;
  if (typeof privateUrl === "string" && privateUrl.trim()) {
    console.log(`Found admin playback URL (url.private): ${privateUrl}`);
    return privateUrl.trim();
  }
  // Fallback: hosted public playback page (no login). Never fall back to url.short (candidate link).
  const publicUrl = interview?.url?.public;
  if (typeof publicUrl === "string" && publicUrl.trim()) {
    console.warn(`Falling back to url.public for interview ${interview?.id} — url.private missing`);
    return publicUrl.trim();
  }
  console.log(`No reviewer playback URL found for interview ${interview?.id}. url object:`, JSON.stringify(interview?.url));
  return null;
}

async function scoreTranscript(transcript: string): Promise<any> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const systemPrompt = `You are a supportive and encouraging hiring evaluator for Kabuni, a purpose-driven company.

## FORMAT CONTEXT — READ THIS FIRST

These are ONE-WAY asynchronous video interviews. Candidates record answers to pre-set questions with NO interviewer present. They cannot:

- Ask follow-up questions or get clarification
- Gauge whether they're on the right track
- Adjust their answer based on feedback
- Re-record (in most cases)

This format is stressful and unnatural. You MUST give candidates the benefit of the doubt on delivery, structure, and specificity. Judge them on the SUBSTANCE and INTENT of what they said, not how polished it was.

## Kabuni's Core Values

- Sweat the Detail: Precision, quality, reliability
- Integrity Always: Honesty, accountability, no ego
- Behaviour Over Attention: Real impact over noise
- Progress Is Collective: Helping individuals and communities move forward
- Health, Family and Happiness: Wellbeing and family-first
- Build for the Long Term: Purposeful, lasting work

## SCORING PHILOSOPHY — THE ANCHOR RULE

Every answer where the candidate makes a genuine attempt starts at 5. You then adjust:

- Add points for: specific examples, relevant experience, self-awareness, values alignment, clarity, enthusiasm, depth
- Subtract points only for: completely off-topic answers, factual errors about the role, or near-zero effort

Most candidates who try should land between 5-7. A score below 5 means "this answer had almost nothing usable." A score of 8+ means "this was genuinely impressive and would stand out."

DO NOT penalise for:
- Filler words, pauses, or verbal stumbles (it's a recorded video)
- Slightly rambling structure (no interviewer to guide them)
- General answers without extreme specificity (they don't know what depth you want)
- Repeating themselves or circling back to a point
- Nervousness or hedging language ("I think," "maybe," "I hope")
- Not covering every possible angle of a question

DO give credit for:
- Any relevant experience mentioned, even briefly
- Showing they researched or thought about the role/company
- Honest self-reflection (even about weaknesses)
- Enthusiasm or genuine interest
- Answers that touch on Kabuni's values, even indirectly
- Trying to give concrete examples, even if imperfect

## PER-METRIC RUBRICS

### communication_clarity
What you're measuring: Can you understand what they're trying to say?
- 8-10: Exceptionally clear, well-articulated, easy to follow throughout
- 6-7: You understand their points. Some rambling or filler is fine. This is the expected range.
- 5: You can mostly follow them even if it's a bit disorganised. Still a pass.
- 3-4: Genuinely hard to follow — major confusion about what they mean
- 0-2: Incoherent or no meaningful communication

### structured_thinking
What you're measuring: Do their answers have some logical flow?
- 8-10: Clear framework or logical progression, impressive organisation
- 6-7: Has a beginning, middle, and end. Makes connected points. Normal good answer.
- 5: Jumps around a bit but you can piece together their thinking. Fine for this format.
- 3-4: Completely scattered with no discernible thread
- 0-2: No structure whatsoever

### role_knowledge
What you're measuring: Do they show awareness of what the role involves?
- 8-10: Deep, specific understanding with relevant industry knowledge
- 6-7: Shows reasonable understanding of the role and mentions relevant skills/experience
- 5: General awareness — they know roughly what the job is about. Acceptable baseline.
- 3-4: Significant misunderstanding of the role
- 0-2: No evidence they understand the role at all

### problem_solving
What you're measuring: Do they show they can think through challenges?
- 8-10: Describes a clear, impressive approach to solving problems with strong examples
- 6-7: Gives at least one example or describes a reasonable approach to challenges
- 5: Shows some awareness that problem-solving is needed, even without a detailed example
- 3-4: No real engagement with how they'd handle challenges
- 0-2: Nothing related to problem-solving

### confidence_professionalism
What you're measuring: Do they come across as someone you'd want to work with?
- 8-10: Poised, professional, and confident — stands out
- 6-7: Comes across as professional and reasonably confident. Normal nerves are fine.
- 5: A bit nervous or uncertain but still professional. Totally normal for this format.
- 3-4: Unprofessional behaviour or extreme disengagement
- 0-2: Concerning lack of professionalism

### culture_alignment
What you're measuring: Do their values/attitudes fit Kabuni's culture?
- 8-10: Explicitly references values that map to Kabuni's, with strong examples
- 6-7: Shows attitudes consistent with Kabuni's values (teamwork, integrity, impact, etc.)
- 5: Doesn't conflict with Kabuni's values and shows some positive alignment
- 3-4: Attitudes that seem misaligned (e.g., ego-driven, short-term focused)
- 0-2: Clear conflict with Kabuni's values

### conciseness_focus
What you're measuring: Do they stay reasonably on-topic?
- 8-10: Tight, focused answers that address the question directly — impressive discipline
- 6-7: Mostly on-topic with some tangents. Gets to the point eventually. Normal.
- 5: Wanders a bit but the core answer is there. Expected in one-way format.
- 3-4: Mostly off-topic or excessive padding with very little substance
- 0-2: Doesn't address the questions at all`;

  const userPrompt = `Evaluate the following one-way video interview transcript for Kabuni.

REMEMBER THE ANCHOR RULE: Every genuine attempt at an answer starts at 5. Adjust up for strengths, down only for significant issues. Most thoughtful candidates should average 5.5–7.5 across metrics.

BEFORE scoring each metric, briefly consider: "What did the candidate do WELL here?" Start from their strengths, then note gaps.

Score each metric 0-10 using the rubrics in your instructions.

For final_score: calculate the simple average of all 7 metric scores, rounded to one decimal place.

Return ONLY valid JSON in this exact structure:

{
  "communication_clarity": {
    "score": <number>,
    "strength": "<what they did well>",
    "gap": "<what could improve, or 'None notable' if strong>",
    "evidence_quote": "<a quote showing their ability>"
  },
  "structured_thinking": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "role_knowledge": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "problem_solving": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "confidence_professionalism": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "culture_alignment": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "conciseness_focus": { "score": <number>, "strength": "...", "gap": "...", "evidence_quote": "..." },
  "final_score": <number>,
  "overall_impression": "<2-3 sentences: lead with strengths, then mention 1-2 areas for growth>"
}

Transcript:
"""
\${transcript}
"""

Do not include any explanation outside JSON.`;

  let aiData: any;
  try {
    aiData = await callLLMWithFallback({
      workflow: "hireflix-sync-interviews",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
    });
  } catch (err: any) {
    console.error("AI scoring error:", err?.status, err?.message);
    throw new Error(`AI scoring failed: ${err?.status || "unknown"}`);
  }

  const content = aiData.choices?.[0]?.message?.content || "";
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
  const jsonStr = (jsonMatch[1] || content).trim();

  try {
    const scores = JSON.parse(jsonStr);
    const metrics = [
      "communication_clarity", "structured_thinking", "role_knowledge",
      "problem_solving", "confidence_professionalism", "culture_alignment", "conciseness_focus"
    ];
    const avg = metrics.reduce((sum, k) => sum + (scores[k]?.score || 0), 0) / metrics.length;
    scores.final_score = Math.round(avg * 100) / 100;
    return scores;
  } catch (e: any) {
    console.error("Failed to parse AI scores:", jsonStr);
    throw new Error("AI returned invalid JSON");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const HIREFLIX_API_KEY = Deno.env.get("HIREFLIX_API_KEY");

    if (!HIREFLIX_API_KEY) {
      return new Response(JSON.stringify({ error: "HIREFLIX_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Support both authenticated (manual) and unauthenticated (cron) calls
    let forceRescore = false;
    let isCronCall = false;

    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      // Try to authenticate — if it's the anon key from cron, user will be null
      const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Anon key call (from cron) — allow it
        isCronCall = true;
      }
    } else {
      isCronCall = true;
    }

    try {
      const body = await req.json();
      forceRescore = body?.force_rescore === true;
    } catch { /* no body is fine */ }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get candidates with invited or completed status
    let candidateQuery = supabaseAdmin
      .from("candidates")
      .select("id, name, email, job_role_id, hireflix_status, hireflix_interview_id, hireflix_candidate_id, interview_final_score");

    if (forceRescore) {
      candidateQuery = candidateQuery.in("hireflix_status", ["invited", "completed"]);
    } else {
      candidateQuery = candidateQuery.eq("hireflix_status", "invited");
    }

    const { data: candidates, error: candErr } = await candidateQuery;
    if (candErr) throw candErr;

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ synced: 0, scored: 0, message: "No candidates to sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get role → position mapping
    const roleIds = [...new Set(candidates.map((c: any) => c.job_role_id).filter(Boolean))];
    const { data: roles } = await supabaseAdmin
      .from("job_roles")
      .select("id, hireflix_position_id")
      .in("id", roleIds);

    const rolePositionMap = new Map((roles || []).map((r: any) => [r.id, r.hireflix_position_id]));

    // Group candidates by position
    const positionCandidates = new Map<string, any[]>();
    for (const c of candidates) {
      const posId = rolePositionMap.get(c.job_role_id);
      if (!posId) continue;
      if (!positionCandidates.has(posId)) positionCandidates.set(posId, []);
      positionCandidates.get(posId)!.push(c);
    }

    let synced = 0;
    let scored = 0;
    let failed = 0;
    const results: any[] = [];

    for (const [positionId, posCandidates] of positionCandidates) {
      let interviews: any[];
      try {
        interviews = await fetchPositionInterviews(HIREFLIX_API_KEY, positionId);
      } catch (e: any) {
        console.error(`Failed to fetch interviews for position ${positionId}:`, e);
        failed += posCandidates.length;
        for (const c of posCandidates) {
          results.push({ id: c.id, name: c.name, status: "failed", reason: `API error: ${e.message}` });
        }
        continue;
      }

      for (const candidate of posCandidates) {
        let interview = null;

        if (candidate.hireflix_interview_id || candidate.hireflix_candidate_id) {
          interview = interviews.find(
            (i: any) => [candidate.hireflix_interview_id, candidate.hireflix_candidate_id].filter(Boolean).includes(i.id) &&
              (i.status === "finished" || i.status === "completed")
          );
        }

        if (!interview && candidate.email) {
          interview = interviews.find(
            (i: any) => i.candidate?.email?.toLowerCase() === candidate.email?.toLowerCase() &&
              (i.status === "finished" || i.status === "completed")
          );
        }

        if (!interview) {
          if (candidate.hireflix_status !== "completed" || !forceRescore) {
            continue;
          }
        }

        let transcript = "";
        let interviewId = candidate.hireflix_interview_id;
        let playbackUrl: string | null = null;
        let hireflixCandidateId = candidate.hireflix_candidate_id;

        if (interview) {
          console.log(`Hireflix interview object for candidate ${candidate.id}:\n${JSON.stringify(interview, null, 2)}`);
          transcript = (interview.questions || [])
            .map((q: any) => q.answer?.transcription?.text || "")
            .filter((t: string) => t.length > 0)
            .join("\n\n");
          interviewId = interview.id;
          playbackUrl = extractReviewerPlaybackUrl(interview);
          console.log("SYNC PLAYBACK URL:", { candidate_id: candidate.id, playbackUrl });
          console.log(`Extracted reviewer playback URL for candidate ${candidate.id}:`, playbackUrl);
          // Hireflix InterviewType exposes interview.id (not candidate.id); persist this stable ID
          hireflixCandidateId = interview.id || hireflixCandidateId;
        }

        if (!transcript && forceRescore) {
          const { data: existing } = await supabaseAdmin
            .from("candidates")
            .select("interview_transcript")
            .eq("id", candidate.id)
            .single();
          transcript = existing?.interview_transcript || "";
        }

        if (!transcript) {
          // Even without a transcript, ALWAYS overwrite the latest playback URL / interview ID
          // so stale (incorrect) playback URLs cannot persist in the DB.
          if (interview) {
            await supabaseAdmin
              .from("candidates")
              .update({
                hireflix_interview_id: interviewId,
                hireflix_candidate_id: hireflixCandidateId,
                hireflix_playback_url: playbackUrl,
              })
              .eq("id", candidate.id);
          }
          results.push({ id: candidate.id, name: candidate.name, status: "skipped", reason: "No transcript available", has_playback: !!playbackUrl });
          continue;
        }

        synced++;

        // DO NOT mark as "completed" if playback_url is NULL — keep as "invited" until video accessible
        const shouldMarkCompleted = !!playbackUrl;

        try {
          const scores = await scoreTranscript(transcript);

          await supabaseAdmin
            .from("candidates")
            .update({
              hireflix_status: shouldMarkCompleted ? "completed" : "invited",
              hireflix_interview_id: interviewId,
              hireflix_candidate_id: hireflixCandidateId,
              hireflix_playback_url: playbackUrl,
              interview_transcript: transcript,
              interview_scores: scores,
              interview_final_score: scores.final_score,
              interview_scored_at: new Date().toISOString(),
            })
            .eq("id", candidate.id);

          scored++;
          results.push({ id: candidate.id, name: candidate.name, status: shouldMarkCompleted ? "scored" : "scored_no_video", final_score: scores.final_score, has_playback: !!playbackUrl });
        } catch (e: any) {
          console.error(`Failed to score candidate ${candidate.id}:`, e);
          await supabaseAdmin
            .from("candidates")
            .update({
              hireflix_status: shouldMarkCompleted ? "completed" : "invited",
              hireflix_interview_id: interviewId,
              hireflix_candidate_id: hireflixCandidateId,
              hireflix_playback_url: playbackUrl,
              interview_transcript: transcript,
            })
            .eq("id", candidate.id);
          failed++;
          results.push({ id: candidate.id, name: candidate.name, status: "transcript_saved", error: e.message });
        }
      }
    }

    // Also process retry queue while we're at it
    try {
      const { data: retries } = await supabaseAdmin
        .from("hireflix_retry_queue")
        .select("id")
        .eq("status", "pending")
        .lte("next_retry_at", new Date().toISOString())
        .limit(1);

      if (retries && retries.length > 0) {
        // Trigger retry processor
        const retryUrl = `${supabaseUrl}/functions/v1/hireflix-retry-processor`;
        fetch(retryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({}),
        }).catch(err => console.error("Failed to trigger retry processor:", err));
      }
    } catch (err: any) {
      console.error("Failed to check retry queue:", err);
    }

    // Top 3 candidates
    const { data: topCandidates } = await supabaseAdmin
      .from("candidates")
      .select("id, name, email, interview_final_score, hireflix_playback_url, interview_scores")
      .not("interview_final_score", "is", null)
      .order("interview_final_score", { ascending: false })
      .limit(3);

    // FIX 6: Write to sync_logs
    try {
      await supabaseAdmin.from("sync_logs").insert({
        integration: "hireflix",
        sync_type: "interviews",
        status: failed > 0 ? "partial" : "success",
        records_synced: synced,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: failed > 0 ? `${failed} candidate(s) failed` : null,
      });
    } catch (logErr) {
      console.error("Failed to write sync_log:", logErr);
    }

    return new Response(JSON.stringify({
      success: true,
      synced,
      scored,
      failed,
      results,
      top_3: topCandidates || [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Hireflix sync error:", error);

    // Log failure to sync_logs
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabaseAdmin.from("sync_logs").insert({
        integration: "hireflix",
        sync_type: "interviews",
        status: "failed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: error.message || "Unknown sync error",
      });
    } catch { /* best effort */ }

    return new Response(JSON.stringify({ error: error.message || "Failed to sync interviews" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
