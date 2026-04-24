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
];

function isNonRetryableGraphQLError(message: string) {
  return NON_RETRYABLE_GRAPHQL_PATTERNS.some((pattern) => pattern.test(message || ""));
}

function isTransientHireflixError(message: string, httpStatus?: number) {
  if (httpStatus && (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500)) return true;
  return /timeout|timed out|network|fetch failed|connection reset|econnreset|enotfound|temporar/i.test(message || "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { job_role_id, title, competencies } = await req.json();
    if (!job_role_id || !title) {
      return new Response(JSON.stringify({ error: "job_role_id and title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const HIREFLIX_API_KEY = Deno.env.get("HIREFLIX_API_KEY");
    if (!HIREFLIX_API_KEY) {
      return new Response(JSON.stringify({ error: "HIREFLIX_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Generate a 5th question based on role competencies
    let competencyQuestion = `Based on your experience in this role, describe how you've demonstrated relevant technical or professional competencies in a real-world scenario.`;

    if (competencies && Array.isArray(competencies) && competencies.length > 0) {
      try {
        const competencyNames = competencies.map((c: any) => typeof c === "string" ? c : c.name || c.title).join(", ");
        const aiData = await callLLMWithFallback({
          workflow: "create-hireflix-position",
          max_tokens: 200,
          messages: [
            {
              role: "system",
              content: `You are an expert interviewer at Kabuni. Generate exactly ONE behavioural interview question that tests a candidate's competency in the given areas. The question should probe real behaviour and past experience, not hypotheticals. Keep it under 50 words. Return ONLY the question text, nothing else.`,
            },
            {
              role: "user",
              content: `Role: ${title}\nKey competencies: ${competencyNames}\n\nGenerate one behavioural interview question.`,
            },
          ],
        });
        const generated = aiData.choices?.[0]?.message?.content?.trim();
        if (generated && generated.length > 10) {
          competencyQuestion = generated;
        }
      } catch (err: any) {
        console.error("Failed to generate competency question:", err);
        // Falls back to default
      }
    }

    const allQuestions = [...DEFAULT_QUESTIONS, competencyQuestion];

    // Create position on Hireflix via GraphQL
    // Escape strings for GraphQL
    const escapedTitle = title.replace(/"/g, '\\"');
    const questionsGql = allQuestions
      .map((q) => `{ title: "${q.replace(/"/g, '\\"')}" }`)
      .join(", ");

    const mutation = `
      mutation {
        Position {
          save(position: {
            name: "${escapedTitle}"
            questions: [${questionsGql}]
          }) {
            id
            name
          }
        }
      }
    `;

    console.log("Creating Hireflix position:", escapedTitle);

    let hfRes: Response;
    let hfData: any;
    try {
      hfRes = await fetch("https://api.hireflix.com/me", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": HIREFLIX_API_KEY,
        },
        body: JSON.stringify({ query: mutation }),
      });
      hfData = await hfRes.json();
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Network error calling Hireflix";
      console.error("Hireflix network error (create position):", message);
      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          retryable: true,
          error_type: "transient",
          questions: allQuestions,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Hireflix create position full response:", JSON.stringify({ status: hfRes.status, body: hfData }));

    if (!hfRes.ok) {
      const message = hfData?.errors?.[0]?.message || `Hireflix HTTP ${hfRes.status}`;
      const retryable = isTransientHireflixError(message, hfRes.status);
      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          retryable,
          error_type: retryable ? "transient" : "schema_validation",
          questions: allQuestions,
          raw_errors: hfData?.errors || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (hfData?.errors?.length) {
      const message = hfData.errors[0]?.message || "Hireflix GraphQL error";
      const nonRetryable = isNonRetryableGraphQLError(message);
      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          retryable: !nonRetryable,
          error_type: nonRetryable ? "schema_validation" : "transient",
          questions: allQuestions,
          raw_errors: hfData.errors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const position = hfData?.data?.Position?.save;
    if (!position?.id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to create Hireflix position — no ID returned",
          retryable: false,
          error_type: "schema_validation",
          raw: hfData,
          questions: allQuestions,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update job role with hireflix_position_id
    const { error: updateError } = await supabaseAdmin
      .from("job_roles")
      .update({ hireflix_position_id: position.id })
      .eq("id", job_role_id);

    if (updateError) {
      console.error("Failed to update job role with Hireflix position ID:", updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        position_id: position.id,
        position_name: position.name,
        questions: allQuestions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Create Hireflix position error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to create Hireflix position" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
