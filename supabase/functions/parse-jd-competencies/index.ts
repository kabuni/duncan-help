import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ZipReader, BlobReader, TextWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";
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

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const reader = new ZipReader(new BlobReader(new Blob([bytes as BlobPart])));
  const entries = await reader.getEntries();
  let text = "";
  for (const entry of entries) {
    if (entry.filename === "word/document.xml" && entry.getData) {
      const xml = await entry.getData(new TextWriter());
      text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      break;
    }
  }
  await reader.close();
  return text.slice(0, 15000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { job_role_id, storage_path } = await req.json();
    if (!job_role_id || !storage_path) {
      return new Response(JSON.stringify({ error: "job_role_id and storage_path required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Download JD
    const { data: fileData, error: dlError } = await supabaseAdmin.storage.from("job-descriptions").download(storage_path);
    if (dlError || !fileData) {
      return new Response(JSON.stringify({ error: "Failed to download JD file" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const ext = storage_path.split(".").pop()?.toLowerCase();

    let userContent: any;
    if (ext === "pdf") {
      // Extract text from PDF (OpenAI API doesn't accept PDF files directly)
      const textContent = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const cleanText = textContent.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").slice(0, 15000);
      if (!cleanText || cleanText.length < 20) {
        return new Response(JSON.stringify({ error: "Could not extract text from PDF" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userContent = `Extract all required competencies from this job description:\n\n${cleanText}`;
    } else {
      let text = "";
      if (ext === "docx") {
        text = await extractDocxText(bytes);
      } else {
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        text = text.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").slice(0, 8000);
      }
      if (!text || text.length < 20) {
        return new Response(JSON.stringify({ error: "Could not extract text from JD" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userContent = `Extract all required competencies from this job description:\n\n${text}`;
    }

    let aiData: any;
    try {
      aiData = await callLLMWithFallback({
        workflow: "parse-jd-competencies",
        messages: [
          {
            role: "system",
            content: `You are an expert HR analyst. Extract the key competencies required for this role from the job description. 
For each competency, provide a short name and a brief description of what it means in context.
Extract between 4-10 competencies. Focus on skills, knowledge areas, and capabilities — not generic traits.
Call the extract_competencies function with your results.`,
          },
          { role: "user", content: userContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "extract_competencies",
            description: "Return the extracted competencies from the job description",
            parameters: {
              type: "object",
              properties: {
                competencies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string", description: "Short competency name (2-5 words)" },
                      description: { type: "string", description: "Brief description of what this competency entails (1-2 sentences)" },
                    },
                    required: ["name", "description"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["competencies"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "extract_competencies" } },
      });
    } catch (err: any) {
      console.error("AI error:", err?.status, err?.message);
      const status = err?.status === 429 ? 429 : err?.status === 402 ? 402 : 500;
      return new Response(JSON.stringify({ error: "AI parsing failed" }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return competencies" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = safeParseToolArguments<{ competencies: any[] }>(toolCall.function.arguments);
    if (!parsed?.competencies) {
      return new Response(JSON.stringify({ error: "AI returned malformed competencies" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { competencies } = parsed;

    // Update job role with extracted competencies
    const { error: updateError } = await supabaseAdmin
      .from("job_roles")
      .update({ competencies })
      .eq("id", job_role_id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(JSON.stringify({ error: "Failed to save competencies" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, job_role_id, competencies }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Parse JD error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to parse JD" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
