import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const data = await callLLMWithFallback({
      workflow: "claude-test",
      messages: [{ role: "user", content: "Reply with exactly: Claude is connected and working." }],
      max_tokens: 64,
    });

    const text = data.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({
      ok: true,
      model: (data as any)._model,
      provider: (data as any)._provider,
      reply: text,
      usage: data.usage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, status: e?.status, code: e?.code, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
