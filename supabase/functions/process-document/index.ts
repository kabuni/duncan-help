import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore
import pdfParse from "npm:pdf-parse@1.1.1";
import JSZip from "npm:jszip@3.10.1";
// @ts-ignore
import * as XLSX from "npm:xlsx@0.18.5";

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

// ~4 chars/token rough; 500 tokens ≈ 2000 chars; overlap 100 tok ≈ 400 chars
const CHUNK_CHARS = 2000;
const OVERLAP_CHARS = 400;
const EMBED_BATCH = 20;

async function extractText(bytes: Uint8Array, fileType: string): Promise<string> {
  const t = (fileType || "").toLowerCase();
  if (t === "txt" || t === "csv" || t === "md") {
    return new TextDecoder().decode(bytes);
  }
  if (t === "pdf") {
    const buf = Buffer.from(bytes);
    const res = await pdfParse(buf);
    return res.text || "";
  }
  if (t === "docx") {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "";
    // Strip XML tags; preserve paragraph breaks
    return xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }
  if (t === "xlsx" || t === "xls") {
    const wb = XLSX.read(bytes, { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      parts.push(`# Sheet: ${name}`);
      parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
    }
    return parts.join("\n\n");
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
      // Find sentence boundary within last 300 chars
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

async function process(document_id: string) {
  const { data: doc, error: docErr } = await supabase
    .from("documents").select("*").eq("id", document_id).single();
  if (docErr || !doc) throw new Error(`Document not found: ${document_id}`);

  try {
    // Download from Azure using SharedKey when available, because the container is private.
    const bytes = await downloadBlobBytes(doc);

    const text = await extractText(bytes, doc.file_type);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("No text content extracted");

    // Wipe any prior chunks
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
      .update({ status: "ready", chunk_count: inserted, error_message: null })
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
