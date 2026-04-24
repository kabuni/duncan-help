import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Strip quoted replies, signatures, PII
function cleanSample(body: string): string {
  if (!body) return "";
  let text = body
    // Remove quoted reply blocks ("On ... wrote:")
    .replace(/On\s+.+?wrote:[\s\S]*$/gi, "")
    // Remove lines starting with > (quoted)
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    // Strip common signature delimiters
    .split(/^--\s*$/m)[0]
    // Redact emails
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    // Redact phone numbers
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Cap each sample
  if (text.length > 2000) text = text.slice(0, 2000);
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const maxResults = Math.min(Number(body.maxResults) || 300, 500);

    // 1. Fetch sent samples via gmail-api
    const sentRes = await fetch(`${supabaseUrl}/functions/v1/gmail-api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ action: "learn_from_sent", maxResults }),
    });
    if (!sentRes.ok) {
      const err = await sentRes.text();
      throw new Error(`Failed to fetch sent emails: ${err}`);
    }
    const { samples } = await sentRes.json();
    if (!samples || samples.length === 0) {
      return new Response(
        JSON.stringify({ error: "No sent emails found to train on" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Clean & redact samples
    const cleaned = samples
      .map((s: any) => cleanSample(s.body))
      .filter((s: string) => s.length > 50 && s.length < 2000)
      .slice(0, 200); // cap input to LLM

    if (cleaned.length === 0) {
      return new Response(
        JSON.stringify({ error: "No usable email content after cleaning" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Send to GPT-4o for style analysis
    const concat = cleaned.map((s: string, i: number) => `--- EMAIL ${i + 1} ---\n${s}`).join("\n\n");
    const prompt = `You are analysing how a person writes emails. Below are ${cleaned.length} emails they sent. Extract their writing style profile.

EMAILS:
${concat.slice(0, 60000)}

Output STRICT JSON matching this schema:
{
  "style_summary": "200-400 word natural-language description of how they write — tone, formality, sentence rhythm, vocabulary, structural habits, sign-off patterns",
  "common_phrases": {
    "openers": ["...", "..."],
    "closers": ["...", "..."],
    "transitions": ["...", "..."],
    "sign_offs": ["...", "..."]
  },
  "tone_metrics": {
    "avg_sentence_length_words": <number>,
    "formality_1_to_5": <number>,
    "uses_emoji": <boolean>,
    "uses_bullet_points": <boolean>,
    "typical_length_words": <number>
  },
  "sample_replies": ["3-5 short representative snippets, each <200 chars, redacted of any names/personal details"]
}

Respond with ONLY the JSON, no markdown fences.`;

    const llmData = await callLLMWithFallback({
      workflow: "gmail-train-style",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4096,
    });
    const rawContent = llmData.choices?.[0]?.message?.content || "{}";
    // Strip optional markdown fences from Claude/OpenAI responses
    const cleaned = rawContent.replace(/^```json\s*|\s*```$/g, "").trim();
    const profileJson = JSON.parse(cleaned);

    // 4. Persist
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { error: upsertError } = await supabaseAdmin
      .from("gmail_writing_profiles")
      .upsert(
        {
          user_id: user.id,
          style_summary: profileJson.style_summary || "",
          common_phrases: profileJson.common_phrases || {},
          sample_replies: profileJson.sample_replies || [],
          tone_metrics: profileJson.tone_metrics || {},
          sample_count: cleaned.length,
          last_trained_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (upsertError) throw new Error(`Failed to save profile: ${upsertError.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        sample_count: cleaned.length,
        style_summary: profileJson.style_summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("gmail-train-style error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
