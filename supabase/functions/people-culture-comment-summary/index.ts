// Summarises free-text employee survey comments into an executive read.
// Input: { comments: [{ question, answers: string[] }] }
// Output: { summary: { headline, themes[], risks[], actions[], perQuestion[] } }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { comments } = await req.json().catch(() => ({ comments: [] }));
    const list: { question: string; answers: string[] }[] = Array.isArray(comments) ? comments : [];
    const usable = list.filter((c) => c?.question && Array.isArray(c.answers) && c.answers.length);
    if (!usable.length) return json({ summary: null, reason: "no_comments" });

    const corpus = usable
      .map((c) => `QUESTION: ${c.question}\n${c.answers.slice(0, 80).map((a, i) => `- ${String(a).slice(0, 600)}`).join("\n")}`)
      .join("\n\n")
      .slice(0, 40000);

    const res = await callLLMWithFallback({
      workflow: "generate-exec-summary",
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Duncan, an operational intelligence system. Summarise anonymous employee survey free-text answers for leadership. " +
            "Be factual, never invent data, never name individuals. Reflect the weight of opinion (how many people said something). " +
            "Return STRICT JSON only with this shape: {\"headline\": string, \"sentiment\": \"positive\"|\"mixed\"|\"negative\", " +
            "\"themes\": [{\"title\": string, \"detail\": string, \"weight\": \"high\"|\"medium\"|\"low\", \"sentiment\": \"positive\"|\"mixed\"|\"negative\"}], " +
            "\"risks\": [string], \"actions\": [string], " +
            "\"perQuestion\": [{\"question\": string, \"summary\": string, \"sentiment\": \"positive\"|\"mixed\"|\"negative\", \"responses\": number}]}",
        },
        { role: "user", content: `Employee survey free-text answers:\n\n${corpus}` },
      ],
    });

    const raw = res?.choices?.[0]?.message?.content ?? "";
    let summary: any = null;
    try {
      summary = JSON.parse(raw);
    } catch {
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (m) summary = JSON.parse(m[0]);
    }
    if (!summary) return json({ error: "Could not parse summary" }, 502);

    return json({ ok: true, summary, generatedAt: new Date().toISOString() });
  } catch (e: any) {
    console.error("[people-culture-comment-summary]", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});
