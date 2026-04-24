import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
];

function isNonRetryableGraphQLError(message: string) {
  return NON_RETRYABLE_GRAPHQL_PATTERNS.some((pattern) => pattern.test(message || ""));
}

function isTransientHireflixError(message: string, httpStatus?: number) {
  if (httpStatus && (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500)) return true;
  return /timeout|timed out|network|fetch failed|connection reset|econnreset|enotfound|temporar/i.test(message || "");
}

function splitCandidateName(fullName: string) {
  const cleaned = (fullName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: "Candidate", lastName: "" };
  const [firstName, ...rest] = cleaned.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

async function queueInviteRetry(supabaseAdmin: any, candidate: any, positionId: string) {
  const { data: existingRetry } = await supabaseAdmin
    .from("hireflix_retry_queue")
    .select("id")
    .eq("operation", "send_invite")
    .eq("status", "pending")
    .contains("payload", { candidate_id: candidate.id })
    .maybeSingle();

  if (!existingRetry) {
    await supabaseAdmin.from("hireflix_retry_queue").insert({
      operation: "send_invite",
      payload: {
        candidate_id: candidate.id,
        candidate_name: candidate.name,
        candidate_email: candidate.email,
        position_id: positionId,
      },
      status: "pending",
      next_retry_at: new Date(Date.now() + 60 * 1000).toISOString(),
    });
  }

  return !existingRetry;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const HIREFLIX_API_KEY = Deno.env.get("HIREFLIX_API_KEY");

    if (!HIREFLIX_API_KEY) {
      return new Response(JSON.stringify({ error: "HIREFLIX_API_KEY not configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: use getUser() instead of broken getClaims()
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { candidate_ids } = body;

    if (!candidate_ids || !Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      return new Response(JSON.stringify({ error: "candidate_ids array is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch candidates
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from("candidates")
      .select("id, name, email, hireflix_status, job_role_id")
      .in("id", candidate_ids);

    if (fetchError || !candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ error: "No candidates found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get role → hireflix_position_id mapping (NO fuzzy matching)
    const roleIds = [...new Set(candidates.map((c: any) => c.job_role_id).filter(Boolean))];
    const { data: roles } = await supabaseAdmin
      .from("job_roles")
      .select("id, title, hireflix_position_id")
      .in("id", roleIds);

    const roleMap = new Map((roles || []).map((r: any) => [r.id, r]));

    let invited = 0;
    let failed = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const candidate of candidates) {
      // Skip if no email
      if (!candidate.email) {
        failed++;
        results.push({ id: candidate.id, name: candidate.name, status: "failed", reason: "Candidate email missing" });
        continue;
      }

      // Skip already invited/completed
      if (candidate.hireflix_status === "invited" || candidate.hireflix_status === "completed") {
        skipped++;
        results.push({ id: candidate.id, name: candidate.name, status: "skipped", reason: `Already ${candidate.hireflix_status}` });
        continue;
      }

      // Check role mapping - MUST have hireflix_position_id
      if (!candidate.job_role_id) {
        failed++;
        results.push({ id: candidate.id, name: candidate.name, status: "failed", reason: "No job role assigned" });
        continue;
      }

      const role = roleMap.get(candidate.job_role_id);
      const positionId = role?.hireflix_position_id;

      if (!positionId) {
        failed++;
        results.push({
          id: candidate.id,
          name: candidate.name,
          status: "failed",
          reason: `Role "${role?.title || "unknown"}" not linked to Hireflix. Link it first in Job Roles.`,
        });
        continue;
      }

      // Send invite via GraphQL (new API shape)
      try {
        const { firstName, lastName } = splitCandidateName(candidate.name || "");
        const escapedFirstName = firstName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const escapedLastName = lastName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const email = candidate.email.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

        const mutation = `
          mutation InviteCandidate {
            inviteCandidateToInterview(input: {
              positionId: "${positionId}",
              candidate: {
                firstName: "${escapedFirstName}",
                ${escapedLastName ? `lastName: "${escapedLastName}",` : ""}
                email: "${email}"
              }
            }) {
              __typename
              ... on InterviewType {
                id
                url {
                  private
                  public
                  short
                }
                candidate {
                  email
                  fullName
                }
              }
              ... on PositionNotFoundError {
                positionNotFoundMessage: message
                code
                name
              }
              ... on PositionNotReadyToAcceptInvitesError {
                positionNotReadyMessage: message
                code
                name
              }
              ... on InterviewAlreadyExistsInPositionError {
                interviewAlreadyExistsMessage: message
                code
                name
              }
              ... on InterviewExternalIdAlreadyExistsInPositionError {
                interviewExternalIdExistsMessage: message
                code
                name
              }
              ... on ExceededInvitesThisPeriodError {
                exceededInvitesMessage: message
                code
                name
              }
              ... on ValidationError {
                validationMessage: message
                code
                name
              }
            }
          }
        `;

        const gqlResponse = await fetch("https://api.hireflix.com/me", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": HIREFLIX_API_KEY,
          },
          body: JSON.stringify({ query: mutation }),
        });

        let gqlData: any = null;
        try {
          gqlData = await gqlResponse.json();
        } catch {
          gqlData = null;
        }
        console.log(`Hireflix invite full response for ${candidate.id}:`, JSON.stringify({ status: gqlResponse.status, body: gqlData }));

        if (!gqlResponse.ok) {
          const reason = gqlData?.errors?.[0]?.message || `Hireflix HTTP ${gqlResponse.status}`;
          const retryable = isTransientHireflixError(reason, gqlResponse.status);
          failed++;
          await supabaseAdmin
            .from("candidates")
            .update({ failure_reason: reason })
            .eq("id", candidate.id);

          const retryQueued = retryable ? await queueInviteRetry(supabaseAdmin, candidate, positionId) : false;
          results.push({ id: candidate.id, name: candidate.name, status: "failed", reason, retryQueued });
          continue;
        }

        if (gqlData?.errors?.length) {
          console.error(`Hireflix API GraphQL errors for ${candidate.id}:`, JSON.stringify(gqlData.errors));
          const reason = gqlData.errors[0]?.message || "Unknown Hireflix GraphQL error";
          const retryable = !isNonRetryableGraphQLError(reason) && isTransientHireflixError(reason);
          failed++;
          await supabaseAdmin
            .from("candidates")
            .update({ failure_reason: reason })
            .eq("id", candidate.id);

          const retryQueued = retryable ? await queueInviteRetry(supabaseAdmin, candidate, positionId) : false;
          results.push({
            id: candidate.id,
            name: candidate.name,
            status: "failed",
            reason,
            retryQueued,
          });
          continue;
        }

        const inviteResult = gqlData?.data?.inviteCandidateToInterview;

        if (!inviteResult) {
          failed++;
          const reason = "Hireflix returned empty invite payload";
          await supabaseAdmin
            .from("candidates")
            .update({ failure_reason: reason })
            .eq("id", candidate.id);
          const retryQueued = await queueInviteRetry(supabaseAdmin, candidate, positionId);
          results.push({ id: candidate.id, name: candidate.name, status: "failed", reason, retryQueued });
          continue;
        }

        if (inviteResult.__typename !== "InterviewType") {
          failed++;
          const reason = `${inviteResult.__typename || "InviteError"}: ${
            inviteResult.positionNotFoundMessage ||
            inviteResult.positionNotReadyMessage ||
            inviteResult.interviewAlreadyExistsMessage ||
            inviteResult.interviewExternalIdExistsMessage ||
            inviteResult.exceededInvitesMessage ||
            inviteResult.validationMessage ||
            "Invite rejected by Hireflix"
          }`;
          await supabaseAdmin
            .from("candidates")
            .update({ failure_reason: reason })
            .eq("id", candidate.id);
          results.push({ id: candidate.id, name: candidate.name, status: "failed", reason, retryQueued: false });
          continue;
        }

        const interview = inviteResult;
        const interviewUrl = interview?.url?.short || interview?.url?.public || null;
        const hireflixCandidateId = interview?.id || null;

        // CRITICAL: hireflix_candidate_id MUST be stored — treat missing as failure
        if (!hireflixCandidateId) {
          console.error(`Hireflix returned no candidate ID for ${candidate.id}. Full response:`, JSON.stringify(gqlData));
          failed++;
          const reason = "Hireflix returned no candidate ID — invite may have failed silently";
          await supabaseAdmin
            .from("candidates")
            .update({ failure_reason: reason })
            .eq("id", candidate.id);

          const retryQueued = await queueInviteRetry(supabaseAdmin, candidate, positionId);
          results.push({ id: candidate.id, name: candidate.name, status: "failed", reason, retryQueued });
          continue;
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
          .eq("id", candidate.id);

        invited++;
        results.push({
          id: candidate.id,
          name: candidate.name,
          status: "invited",
          url: interviewUrl,
          hireflix_candidate_id: hireflixCandidateId,
        });
      } catch (err: any) {
        console.error(`Error inviting candidate ${candidate.id}:`, err);
        failed++;
        const reason = err instanceof Error ? err.message : "Unknown error during invite";
        const retryable = isTransientHireflixError(reason);
        // Store failure reason in DB
        await supabaseAdmin
          .from("candidates")
          .update({ failure_reason: reason })
          .eq("id", candidate.id);

        const retryQueued = retryable ? await queueInviteRetry(supabaseAdmin, candidate, positionId) : false;
        if (retryQueued) console.log(`Queued retry for candidate ${candidate.id}`);

        results.push({ id: candidate.id, name: candidate.name, status: "failed", reason, retryQueued });
      }
    }

    return new Response(
      JSON.stringify({ success: true, invited, failed, skipped, total: candidates.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Hireflix send invite error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to send Hireflix invites" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
