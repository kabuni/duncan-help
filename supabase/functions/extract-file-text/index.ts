import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";
import { getEmbedding } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Split text into chunks of roughly `maxWords` words, preserving paragraph breaks. */
function chunkText(text: string, maxWords = 750): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean).length;
    if (currentWords + paraWords > maxWords && current.trim()) {
      chunks.push(current.trim());
      current = "";
      currentWords = 0;
    }
    current += para + "\n\n";
    currentWords += paraWords;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.trim()];
}

/** Generate embeddings sequentially via the centralised OpenAI helper. */
async function generateEmbeddings(
  texts: string[],
  _apiKey?: string,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await getEmbedding(t));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    const { file_id } = await req.json();
    if (!file_id) {
      return new Response(JSON.stringify({ error: "file_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch file record (RLS enforces ownership via project)
    const { data: fileRecord, error: fileError } = await supabase
      .from("project_files")
      .select("id, file_name, storage_path, extracted_text")
      .eq("id", file_id)
      .single();

    if (fileError || !fileRecord) {
      return new Response(JSON.stringify({ error: "File not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-indexing is always allowed — old chunks are deleted before new ones are inserted

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("project-files")
      .download(fileRecord.storage_path);

    if (downloadError || !fileData) {
      console.error("Download error:", downloadError);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileName = fileRecord.file_name.toLowerCase();
    let extractedText = "";

    // --- TEXT EXTRACTION ---
    if (fileName.endsWith(".pdf")) {
      const arrayBuffer = await fileData.arrayBuffer();
      const MAX_PDF_SIZE = 20 * 1024 * 1024;
      if (arrayBuffer.byteLength > MAX_PDF_SIZE) {
        return new Response(JSON.stringify({
          error: `PDF too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB). Maximum is 20MB.`,
        }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Try parser-based extraction first (fast + free)
      let parserSucceeded = false;
      try {
        const pdfParse = (await import("https://esm.sh/pdf-parse@1.1.1")).default;
        const buffer = new Uint8Array(arrayBuffer);
        const parsed = await pdfParse(buffer);
        if (parsed.text && parsed.text.trim().length > 50) {
          extractedText = parsed.text.trim();
          parserSucceeded = true;
          console.log(`PDF parsed locally: ${extractedText.length} chars`);
        }
      } catch (parseErr) {
        console.warn("Local PDF parse failed, falling back to AI:", parseErr);
      }

      // Fallback to OpenAI if parser failed or returned very little text
      if (!parserSucceeded) {
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        try {
          const aiData = await callLLMWithFallback({
            workflow: "extract-file-text",
            force_provider: "openai",
            max_tokens: 16000,
            messages: [
              {
                role: "system",
                content: "Extract ALL text content from this PDF document. Return the raw text only, preserving structure where possible. Do not summarize or interpret.",
              },
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    file: {
                      filename: fileRecord.file_name,
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
          console.error("AI extraction error:", aiErr?.status, aiErr?.message);
          return new Response(JSON.stringify({ error: "Failed to extract text from PDF" }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } else if (fileName.endsWith(".docx")) {
      const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
      const arrayBuffer = await fileData.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
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
    } else if (
      /\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(fileName)
    ) {
      extractedText = await fileData.text();
    } else {
      try {
        extractedText = await fileData.text();
        if (extractedText.includes("\0")) {
          return new Response(JSON.stringify({ error: `Unsupported file format: ${fileName.split('.').pop()}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: `Unsupported file format: ${fileName.split('.').pop()}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "No text could be extracted from the file" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- CHUNKING + EMBEDDING ---
    const chunks = chunkText(extractedText);
    console.log(`Chunked ${fileName} into ${chunks.length} chunks`);

    // Batch embeddings (OpenAI supports up to ~2048 inputs)
    const BATCH_SIZE = 50;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await generateEmbeddings(batch, OPENAI_API_KEY);
      allEmbeddings.push(...embeddings);
    }

    // Use service role client to insert chunks (bypasses RLS for server-side ops)
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Delete any existing chunks for this file (re-extraction scenario)
    await serviceClient
      .from("project_file_chunks")
      .delete()
      .eq("file_id", file_id);

    // Insert chunks with embeddings
    const chunkRows = chunks.map((content, idx) => ({
      file_id,
      chunk_index: idx,
      content,
      embedding: JSON.stringify(allEmbeddings[idx]),
    }));

    // Insert in batches of 25
    for (let i = 0; i < chunkRows.length; i += 25) {
      const batch = chunkRows.slice(i, i + 25);
      const { error: insertError } = await serviceClient
        .from("project_file_chunks")
        .insert(batch);
      if (insertError) {
        console.error("Chunk insert error:", insertError);
        return new Response(JSON.stringify({ error: "Failed to store file chunks" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Save extracted text to project_files (for status tracking)
    const { error: updateError } = await serviceClient
      .from("project_files")
      .update({ extracted_text: extractedText })
      .eq("id", file_id);

    if (updateError) {
      console.error("DB update error:", updateError);
    }

    return new Response(JSON.stringify({
      id: fileRecord.id,
      file_name: fileRecord.file_name,
      extracted: true,
      text_length: extractedText.length,
      chunks_created: chunks.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("extract-file-text error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
