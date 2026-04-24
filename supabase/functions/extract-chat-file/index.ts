import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_BASE64_SIZE = 10 * 1024 * 1024; // ~10MB base64
const MAX_EXTRACTED_CHARS = 50_000; // Cap text sent to chat context

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file_name, file_type, base64 } = await req.json();

    if (!file_name || !base64) {
      return new Response(JSON.stringify({ error: "file_name and base64 are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (base64.length > MAX_BASE64_SIZE) {
      return new Response(JSON.stringify({ error: "File too large for chat extraction (max ~7.5MB)" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileName = file_name.toLowerCase();
    let extractedText = "";

    // Decode base64 to binary
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // --- TEXT EXTRACTION (reuses logic from extract-file-text) ---
    if (fileName.endsWith(".pdf")) {
      // Try local parser first
      let parserSucceeded = false;
      try {
        const pdfParse = (await import("https://esm.sh/pdf-parse@1.1.1")).default;
        const parsed = await pdfParse(bytes);
        if (parsed.text && parsed.text.trim().length > 50) {
          extractedText = parsed.text.trim();
          parserSucceeded = true;
        }
      } catch (parseErr) {
        console.warn("Local PDF parse failed:", parseErr);
      }

      // Fallback to OpenAI vision
      if (!parserSucceeded) {
        const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_API_KEY) {
          return new Response(JSON.stringify({ error: "AI service not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        try {
          const aiData = await callLLMWithFallback({
            workflow: "extract-chat-file",
            force_provider: "openai",
            max_tokens: 16000,
            messages: [
              {
                role: "system",
                content: "Extract ALL text content from this PDF. Return raw text only, preserving structure. Do not summarize.",
              },
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    file: {
                      filename: file_name,
                      file_data: `data:application/pdf;base64,${base64}`,
                    },
                  },
                  { type: "text", text: "Extract all text from this document." },
                ],
              },
            ],
          });
          extractedText = aiData.choices?.[0]?.message?.content || "";
        } catch (aiErr: any) {
          console.error("AI PDF extraction failed:", aiErr?.status, aiErr?.message);
          return new Response(JSON.stringify({ error: "Failed to extract text from PDF" }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } else if (fileName.endsWith(".docx")) {
      const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
      const zip = await JSZip.loadAsync(bytes);
      const documentXml = await zip.file("word/document.xml")?.async("string");

      if (documentXml) {
        extractedText = documentXml
          .replace(/<w:br[^>]*\/>/g, "\n")
          .replace(/<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#x[0-9A-Fa-f]+;/g, (match) => {
            const code = parseInt(match.slice(3, -1), 16);
            return String.fromCharCode(code);
          })
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      // Extract from Excel via JSZip (xlsx is a ZIP of XML)
      try {
        const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
        const zip = await JSZip.loadAsync(bytes);
        
        // Get shared strings
        const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string");
        const sharedStrings: string[] = [];
        if (sharedStringsXml) {
          const matches = sharedStringsXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
          for (const m of matches) {
            sharedStrings.push(m[1]);
          }
        }

        // Get sheet1
        const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
        if (sheetXml) {
          const rows = sheetXml.matchAll(/<row[^>]*>(.*?)<\/row>/gs);
          const lines: string[] = [];
          for (const row of rows) {
            const cells = row[1].matchAll(/<c[^>]*(?:t="s"[^>]*)?>(.*?)<\/c>/gs);
            const values: string[] = [];
            for (const cell of cells) {
              const valMatch = cell[1].match(/<v>([^<]*)<\/v>/);
              if (valMatch) {
                const cellTag = cell[0];
                if (cellTag.includes('t="s"')) {
                  values.push(sharedStrings[parseInt(valMatch[1])] || valMatch[1]);
                } else {
                  values.push(valMatch[1]);
                }
              }
            }
            if (values.length > 0) lines.push(values.join("\t"));
          }
          extractedText = lines.join("\n");
        }
      } catch {
        extractedText = "";
      }
    } else if (/\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(fileName)) {
      // Plain text — decode directly
      const decoder = new TextDecoder();
      extractedText = decoder.decode(bytes);
    } else {
      // Try as text, reject if binary
      const decoder = new TextDecoder();
      const text = decoder.decode(bytes);
      if (text.includes("\0")) {
        return new Response(JSON.stringify({ 
          error: `Unsupported format: .${fileName.split('.').pop()}. Supported: PDF, DOCX, XLSX, TXT, MD, CSV, JSON, XML, YAML.`
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      extractedText = text;
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "No text could be extracted from the file" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate if too long
    let truncated = false;
    if (extractedText.length > MAX_EXTRACTED_CHARS) {
      extractedText = extractedText.slice(0, MAX_EXTRACTED_CHARS);
      truncated = true;
    }

    return new Response(JSON.stringify({
      text: extractedText,
      file_name: file_name,
      char_count: extractedText.length,
      truncated,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("extract-chat-file error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Extraction failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
