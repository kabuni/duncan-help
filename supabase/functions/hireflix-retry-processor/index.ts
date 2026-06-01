import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_QUESTIONS = [
  "Kabuni is intentional about how technology shows up in people's lives. How do you personally manage your relationship with screen time, either for yourself or within your family, and what trade-offs have you consciously made?",
  "Tell us about a time you chose a harder path that genuinely changed behaviour or outcomes, even though an easier option would have looked better on paper.",
  "Describe a situation where a small detail made a disproportionate difference to the final outcome. Why did it matter, and how did you spot it?",
  "Tell us about a time you realised you were wrong and had to change your position publicly. What was difficult about that moment, and what did you learn?",
];

const NON_RETRYABLE_GRAPHQL_PATTERNS = [
  /cannot query field/i,
  /unknown argument/i,
  /unknown type/i,
  /field .* is required/i,
  /must not have a selection/i,
  /syntax error/i,
  /validation error/i,
  /positionnotfounderror/i,
  /positionnotreadytoacceptinviteserror/i,
  /interviewalreadyexistsinpositionerror/i,
  /interviewexternalidalreadyexistsinpositionerror/i,
  /exceededinvitesthisperioderror/i,
  // Hireflix's opaque 500 — retries with the same payload will just keep failing.
  // Treat as non-retryable so the queue stops looping; the job can be retried manually.
  /^unexpected error\.?$/i,
];

function isNonRetryableGraphQLError(message: string) {
  return NON_RETRYABLE_GRAPHQL_PATTERNS.some((pattern) => pattern.test(message || ""));
}

/** Look up an existing Hireflix position by exact name. Returns null if none. */
async function findHireflixPositionByName(apiKey: string, name: string): Promise<{ id: string; name: string } | null> {
  try {
    const query = `query { me { positions { id name } } }`;
    const res = await fetch("https://api.hireflix.com/me", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    const positions: Array<{ id: string; name: string }> = data?.data?.me?.positions || [];
    const target = name.trim().toLowerCase();
    const match = positions.find((p) => (p.name || "").trim().toLowerCase() === target);
    return match || null;
  } catch (err) {
    console.error("findHireflixPositionByName failed:", err);
    return null;
  }
}


function splitCandidateName(fullName: string) {
  const cleaned = (fullName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: "Candidate", lastName: "" };
  const [firstName, ...rest] = cleaned.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

async function createHireflixPosition(apiKey: string, title: string, competencies: any[]): Promise<{ id: string; name: string }> {
  // Generate competency question
  let competencyQuestion = "Based on your experience in this role, describe how you've demonstrated relevant technical or professional competencies in a real-world scenario.";

  if (competencies && competencies.length > 0) {
    try {
      const competencyNames = competencies.map((c: any) => typeof c === "string" ? c : c.name || c.title).join(", ");
      const aiData = await callLLMWithFallback({
        workflow: "hireflix-retry-processor",
        max_tokens: 200,
        messages: [
          { role: "system", content: "You are an expert interviewer at Kabuni. Generate exactly ONE behavioural interview question that tests a candidate's competency in the given areas. The question should probe real behaviour and past experience, not hypotheticals. Keep it under 50 words. Return ONLY the question text, nothing else." },
          { role: "user", content: `Role: ${title}\nKey competencies: ${competencyNames}\n\nGenerate one behavioural interview question.` },
        ],
      });
      const generated = aiData.choices?.[0]?.message?.content?.trim();
      if (generated && generated.length > 10) competencyQuestion = generated;
    } catch (err: any) {
      console.error("Failed to generate competency question:", err);
    }
  }

  const allQuestions = [...DEFAULT_QUESTIONS, competencyQuestion];

  // Hireflix's `title` field has a ~30 char limit and returns "Unexpected error" 500
  // for longer values. Full question text must live in `description`.
  const escapeGql = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
  const shortTitle = (full: string) => {
    const cleaned = full.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 30) return cleaned;
    const slice = cleaned.slice(0, 30);
    const lastSpace = slice.lastIndexOf(" ");
    return (lastSpace > 10 ? slice.slice(0, lastSpace) : slice).trim();
  };

  const escapedTitle = escapeGql(title);
  const questionsGql = allQuestions
    .map((q) => `{ title: "${escapeGql(shortTitle(q))}", description: "${escapeGql(q)}" }`)
    .join(", ");

  const mutation = `mutation { Position { save(position: { name: "${escapedTitle}", questions: [${questionsGql}] }) { id name } } }`;

  const hfRes = await fetch("https://api.hireflix.com/me", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ query: mutation }),
  });

  const hfData = await hfRes.json();
  console.log("Retry create_position full GraphQL response:", JSON.stringify({ status: hfRes.status, body: hfData }));
  if (!hfRes.ok) throw new Error(hfData?.errors?.[0]?.message || `Hireflix HTTP ${hfRes.status}`);
  if (hfData.errors) throw new Error(hfData.errors[0]?.message || "Hireflix API error");

  const position = hfData.data?.Position?.save;
  if (!position?.id) throw new Error("No position ID returned");
  
  return position;
}

async function deleteHireflixPosition(apiKey: string, positionId: string): Promise<void> {
  const escapedId = positionId.replace(/"/g, '\\"');
  const mutation = `mutation { deletePosition(id: "${escapedId}") { id } }`;

  const hfRes = await fetch("https://api.hireflix.com/me", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ query: mutation }),
  });

  const hfData = await hfRes.json();
  if (hfData.errors) {
    const errMsg = hfData.errors[0]?.message || "";
    // Not found = already deleted = success
    if (errMsg.toLowerCase().includes("not found") || errMsg.toLowerCase().includes("does not exist")) {
      console.log("Position already deleted");
      return;
    }
    throw new Error(errMsg);
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch pending retries that are due
    const { data: retries, error: fetchErr } = await supabaseAdmin
      .from("hireflix_retry_queue")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!retries || retries.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No pending retries" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const retry of retries) {
      // Mark as processing
      await supabaseAdmin
        .from("hireflix_retry_queue")
        .update({ status: "processing" })
        .eq("id", retry.id);

      try {
        if (retry.operation === "create_position") {
          const { job_role_id, title, competencies } = retry.payload as any;

          // Idempotency check 1: job_role already linked to a Hireflix position
          const { data: existingRole } = await supabaseAdmin
            .from("job_roles")
            .select("hireflix_position_id")
            .eq("id", job_role_id)
            .maybeSingle();

          if (existingRole?.hireflix_position_id) {
            await supabaseAdmin
              .from("hireflix_retry_queue")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", retry.id);
            console.log(`Retry skipped (role ${job_role_id} already linked to Hireflix position ${existingRole.hireflix_position_id})`);
            succeeded++;
            processed++;
            continue;
          }

          // Idempotency check 2: a position with this exact name already exists on Hireflix
          // (the earlier create call likely succeeded server-side even though Hireflix returned 500)
          const existingPosition = await findHireflixPositionByName(HIREFLIX_API_KEY, title);
          let position: { id: string; name: string };
          if (existingPosition) {
            console.log(`Reusing existing Hireflix position '${title}' → ${existingPosition.id}`);
            position = existingPosition;
          } else {
            position = await createHireflixPosition(HIREFLIX_API_KEY, title, competencies || []);
          }

          await supabaseAdmin
            .from("job_roles")
            .update({ hireflix_position_id: position.id })
            .eq("id", job_role_id);

          await supabaseAdmin
            .from("hireflix_retry_queue")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", retry.id);

          console.log(`Retry succeeded: position ${position.id} for role ${job_role_id}`);
          succeeded++;



        } else if (retry.operation === "delete_position") {
          const { hireflix_position_id } = retry.payload as any;

          await deleteHireflixPosition(HIREFLIX_API_KEY, hireflix_position_id);

          await supabaseAdmin
            .from("hireflix_retry_queue")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", retry.id);

          console.log(`Retry succeeded: deleted position ${hireflix_position_id}`);
          succeeded++;

        } else if (retry.operation === "send_invite") {
          const { candidate_id, candidate_name, candidate_email, position_id } = retry.payload as any;

          // Dedup: check if candidate was already invited (e.g. manual retry succeeded)
          const { data: candidate } = await supabaseAdmin
            .from("candidates")
            .select("hireflix_status")
            .eq("id", candidate_id)
            .maybeSingle();

          if (candidate?.hireflix_status === "invited" || candidate?.hireflix_status === "completed") {
            // Already invited — mark retry as completed, skip API call
            await supabaseAdmin
              .from("hireflix_retry_queue")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", retry.id);
            console.log(`Retry skipped (already ${candidate.hireflix_status}): candidate ${candidate_id}`);
            succeeded++;
          } else {
            const { firstName, lastName } = splitCandidateName(candidate_name || "");
            const escapedFirstName = firstName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const escapedLastName = lastName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const email = candidate_email.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

            const mutation = `
              mutation InviteCandidate {
                inviteCandidateToInterview(input: {
                  positionId: "${position_id}",
                  candidate: {
                    firstName: "${escapedFirstName}",
                    ${escapedLastName ? `lastName: "${escapedLastName}",` : ""}
                    email: "${email}"
                  }
                }) {
                  __typename
                  ... on InterviewType {
                    id
                    url { private public short }
                  }
                  ... on PositionNotFoundError { positionNotFoundMessage: message name code }
                  ... on PositionNotReadyToAcceptInvitesError { positionNotReadyMessage: message name code }
                  ... on InterviewAlreadyExistsInPositionError { interviewAlreadyExistsMessage: message name code }
                  ... on InterviewExternalIdAlreadyExistsInPositionError { interviewExternalIdExistsMessage: message name code }
                  ... on ExceededInvitesThisPeriodError { exceededInvitesMessage: message name code }
                  ... on ValidationError { validationMessage: message name code }
                }
              }
            `;

            const gqlResponse = await fetch("https://api.hireflix.com/me", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-API-KEY": HIREFLIX_API_KEY },
              body: JSON.stringify({ query: mutation }),
            });

            const gqlData = await gqlResponse.json();
            console.log(`Retry send_invite full GraphQL response for candidate ${candidate_id}:`, JSON.stringify({ status: gqlResponse.status, body: gqlData }));
            if (!gqlResponse.ok) throw new Error(gqlData?.errors?.[0]?.message || `Hireflix HTTP ${gqlResponse.status}`);
            if (gqlData.errors) throw new Error(gqlData.errors[0]?.message || "Hireflix API error");

            const inviteResult = gqlData?.data?.inviteCandidateToInterview;
            if (!inviteResult) throw new Error("Hireflix returned empty invite payload");
            if (inviteResult.__typename !== "InterviewType") {
              throw new Error(`${inviteResult.__typename || "InviteError"}: ${
                inviteResult.positionNotFoundMessage ||
                inviteResult.positionNotReadyMessage ||
                inviteResult.interviewAlreadyExistsMessage ||
                inviteResult.interviewExternalIdExistsMessage ||
                inviteResult.exceededInvitesMessage ||
                inviteResult.validationMessage ||
                "Invite rejected by Hireflix"
              }`);
            }

            const interview = inviteResult;
            const interviewUrl = interview?.url?.short || interview?.url?.public || null;
            const hireflixCandidateId = interview?.id || null;

            if (!hireflixCandidateId) {
              throw new Error("Hireflix returned no candidate/interview ID");
            }

            await supabaseAdmin
              .from("candidates")
              .update({
                hireflix_status: "invited",
                hireflix_interview_url: interviewUrl,
                hireflix_candidate_id: hireflixCandidateId,
                hireflix_interview_id: hireflixCandidateId,
                hireflix_invited_at: new Date().toISOString(),
                failure_reason: null,
              })
              .eq("id", candidate_id);

            await supabaseAdmin
              .from("hireflix_retry_queue")
              .update({ status: "completed", completed_at: new Date().toISOString() })
              .eq("id", retry.id);

            console.log(`Retry succeeded: invited candidate ${candidate_id}`);
            succeeded++;
          }
        } else {
          throw new Error(`Unknown operation: ${retry.operation}`);
        }

        processed++;
      } catch (err: any) {
        const newAttempts = (retry.attempts || 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        const isExhausted = isNonRetryableGraphQLError(message) || newAttempts >= (retry.max_attempts || 5);

        // Exponential backoff: 1min, 4min, 9min, 16min, 25min
        const delayMinutes = newAttempts * newAttempts;
        const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

        await supabaseAdmin
          .from("hireflix_retry_queue")
          .update({
            status: isExhausted ? "failed" : "pending",
            attempts: newAttempts,
            last_error: message || "Unknown error",
            next_retry_at: isExhausted ? retry.next_retry_at : nextRetry,
          })
          .eq("id", retry.id);

        console.error(`Retry failed for ${retry.id} (attempt ${newAttempts}):`, message);
        failed++;
        processed++;
      }
    }

    return new Response(JSON.stringify({ processed, succeeded, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Retry processor error:", error);
    return new Response(JSON.stringify({ error: error.message || "Retry processor failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
