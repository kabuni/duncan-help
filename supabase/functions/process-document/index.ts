import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";
// @ts-ignore
import * as XLSX from "npm:xlsx@0.18.5";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function parseConnectionString(connStr: string): { accountName: string; accountKey: string; containerName: string } {
  const parts: Record<string, string> = {};
  for (const part of connStr.trim().split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) throw new Error("Invalid Azure Storage connection string");
  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey,
    containerName: Deno.env.get("AZURE_STORAGE_CONTAINER") || "duncanstorage01",
  };
}

async function createSharedKeySignature(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<string> {
  const canonicalizedHeaders = Object.keys(headers)
    .filter((k) => k.toLowerCase().startsWith("x-ms-"))
    .sort()
    .map((k) => `${k.toLowerCase()}:${headers[k]}`)
    .join("\n");
  const stringToSign = [method, "", "", "", "", "", "", "", "", "", "", "", canonicalizedHeaders, `/${accountName}${path}`].join("\n");
  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return `SharedKey ${accountName}:${signature}`;
}

async function downloadBlobBytes(doc: any): Promise<Uint8Array> {
  const connectionString = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
  if (!connectionString || !doc.blob_path) {
    const dl = await fetch(doc.blob_url);
    if (!dl.ok) throw new Error(`Download failed ${dl.status}: ${await dl.text()}`);
    return new Uint8Array(await dl.arrayBuffer());
  }

  const { accountName, accountKey, containerName } = parseConnectionString(connectionString);
  const encodedPath = String(doc.blob_path).split("/").map(encodeURIComponent).join("/");
  const path = `/${containerName}/${encodedPath}`;
  const headers: Record<string, string> = {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2023-11-03",
  };
  headers.Authorization = await createSharedKeySignature(accountName, accountKey, "GET", path, headers);
  const dl = await fetch(`https://${accountName}.blob.core.windows.net${path}`, { method: "GET", headers });
  if (!dl.ok) throw new Error(`Azure download failed ${dl.status}: ${await dl.text()}`);
  return new Uint8Array(await dl.arrayBuffer());
}

const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 400;
const EMBED_BATCH = 20;

interface ExtractResult {
  text: string;
  pageCount: number | null;
}

async function extractText_(bytes: Uint8Array, fileType: string): Promise<ExtractResult> {
  const t = (fileType || "").toLowerCase();
  if (t === "txt" || t === "csv" || t === "md") {
    return { text: new TextDecoder().decode(bytes), pageCount: null };
  }
  if (t === "pdf") {
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const joined = (Array.isArray(text) ? text.join("\n\n") : String(text || "")).trim();
    return { text: joined, pageCount: totalPages ?? null };
  }
  if (t === "docx") {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return { text: "", pageCount: null };
    const text = xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
    return { text, pageCount: null };
  }
  if (t === "xlsx" || t === "xls") {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      parts.push(`# Sheet: ${name}`);
      parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
    }
    return { text: parts.join("\n\n"), pageCount: wb.SheetNames.length };
  }
  throw new Error(`Unsupported file type: ${fileType}`);
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastBreak = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
      if (lastBreak > CHUNK_CHARS * 0.5) end = i + lastBreak + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    if (end >= clean.length) break;
    i = end - OVERLAP_CHARS;
    if (i < 0) i = 0;
  }
  return chunks.filter(Boolean);
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: inputs, dimensions: 1024 }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data.map((d: any) => d.embedding);
}

/**
 * Quality gate. Returns null if OK, or a human-readable failure reason.
 * For PDFs, we require an average density of ≥200 chars/page AND at least
 * max(2, ceil(pages/10)) chunks. This catches scanned/image-only PDFs that
 * pdf-parse used to silently collapse into a handful of chunks.
 */
function qualityFailureReason(opts: {
  fileType: string;
  pageCount: number | null;
  charsExtracted: number;
  chunksGenerated: number;
}): string | null {
  const { fileType, pageCount, charsExtracted, chunksGenerated } = opts;
  if (charsExtracted < 20 || chunksGenerated === 0) {
    return `Extraction produced no usable text (chars=${charsExtracted}, chunks=${chunksGenerated}). The file may be image-only or scanned. OCR is not yet enabled.`;
  }
  if (fileType === "pdf" && pageCount && pageCount > 1) {
    const density = charsExtracted / pageCount;
    const minChunks = Math.max(2, Math.ceil(pageCount / 10));
    if (density < 200) {
      return `Low text density: only ${charsExtracted.toLocaleString()} chars across ${pageCount} pages (${density.toFixed(0)} chars/page, threshold 200). PDF is likely image-based or uses vector text without a text layer; OCR is required.`;
    }
    if (chunksGenerated < minChunks) {
      return `Too few chunks: ${chunksGenerated} generated from ${pageCount} pages (expected ≥${minChunks}). Extraction likely incomplete.`;
    }
  }
  return null;
}

async function process(document_id: string) {
  const { data: doc, error: docErr } = await supabase
    .from("documents").select("*").eq("id", document_id).single();
  if (docErr || !doc) throw new Error(`Document not found: ${document_id}`);

  // Mark when processing started (used by recover-stuck-documents)
  await supabase.from("documents")
    .update({ status: "processing", processing_started_at: new Date().toISOString(), error_message: null })
    .eq("id", document_id);

  try {
    const bytes = await downloadBlobBytes(doc);

    const { text, pageCount } = await extractText_(bytes, doc.file_type);
    const charsExtracted = text.length;
    const chunks = chunkText(text);
    const chunksGenerated = chunks.length;

    const reason = qualityFailureReason({
      fileType: (doc.file_type || "").toLowerCase(),
      pageCount,
      charsExtracted,
      chunksGenerated,
    });
    if (reason) {
      await supabase.from("documents").update({
        status: "failed",
        error_message: reason,
        page_count: pageCount,
        chars_extracted: charsExtracted,
        chunks_generated: chunksGenerated,
        chunk_count: 0,
      }).eq("id", document_id);
      // Make sure no stale chunks remain from a previous run
      await supabase.from("document_chunks").delete().eq("document_id", document_id);
      return;
    }

    // Wipe any prior chunks before re-inserting
    await supabase.from("document_chunks").delete().eq("document_id", document_id);

    let inserted = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const embeddings = await embedBatch(batch);
      const rows = batch.map((content, k) => ({
        document_id,
        content,
        embedding: embeddings[k] as any,
        chunk_index: i + k,
        token_count: Math.ceil(content.length / 4),
        metadata: {
          scope: doc.scope,
          owner_id: doc.owner_id,
          category: doc.category,
          subcategory: doc.subcategory,
          document_title: doc.title,
        },
      }));
      const { error: insErr } = await supabase.from("document_chunks").insert(rows);
      if (insErr) throw insErr;
      inserted += rows.length;
    }

    await supabase.from("documents")
      .update({
        status: "ready",
        chunk_count: inserted,
        error_message: null,
        page_count: pageCount,
        chars_extracted: charsExtracted,
        chunks_generated: chunksGenerated,
      })
      .eq("id", document_id);
  } catch (e: any) {
    console.error("process-document failed", e);
    await supabase.from("documents")
      .update({ status: "failed", error_message: String(e?.message ?? e).slice(0, 1000) })
      .eq("id", document_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(process(document_id));
    return new Response(JSON.stringify({ ok: true, document_id }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
