// Stream MP3 speech for a sentence of Duncan's reply.
// Uses ElevenLabs eleven_turbo_v2_5 for low-latency streaming.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_VOICE_ID =
  Deno.env.get("ELEVENLABS_VOICE_ID") || "JBFqnCBsd6RMkjVDRZzb"; // George — warm British male, swap when Jack/John id confirmed

function sanitizeForSpeech(text: string): string {
  return text
    // strip code fences
    .replace(/```[\s\S]*?```/g, " ")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // markdown links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    // headings markers
    .replace(/^#{1,6}\s+/gm, "")
    // bold/italic markers
    .replace(/(\*\*|__|\*|_)/g, "")
    // table pipes / separators
    .replace(/\|/g, " ")
    .replace(/^[\s-]*[-:]{2,}[\s-:]*$/gm, " ")
    // bullet markers
    .replace(/^[\s>]*[-*+]\s+/gm, "")
    // numbered list markers
    .replace(/^\s*\d+\.\s+/gm, "")
    // emoji-like sequences (keep ascii punctuation)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawText = typeof body?.text === "string" ? body.text : "";
    const voiceId =
      typeof body?.voiceId === "string" && body.voiceId.trim()
        ? body.voiceId.trim()
        : DEFAULT_VOICE_ID;
    const speed =
      typeof body?.speed === "number" && body.speed >= 0.7 && body.speed <= 1.2
        ? body.speed
        : 1.0;

    const text = sanitizeForSpeech(rawText);
    if (!text) {
      return new Response(JSON.stringify({ error: "Empty text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const elevenResp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
            speed,
          },
        }),
      }
    );

    if (!elevenResp.ok || !elevenResp.body) {
      const errText = await elevenResp.text().catch(() => "");
      console.error("ElevenLabs TTS error", elevenResp.status, errText);
      return new Response(
        JSON.stringify({
          error: `TTS request failed (${elevenResp.status})`,
          details: errText,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(elevenResp.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("elevenlabs-tts unhandled error", err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
