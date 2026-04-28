// Shared CV text extraction for scoring functions.
// Claude does not accept OpenAI-style file blocks, so we extract plain text
// from PDF/DOCX before sending. Keeps full content (no aggressive truncation).

import JSZip from "https://esm.sh/jszip@3.10.1";
import { getDocument, GlobalWorkerOptions } from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";

// Disable the worker (Deno edge runtime has no Web Worker support for pdfjs).
// pdfjs falls back to running parsing on the main thread.
// @ts-ignore
GlobalWorkerOptions.workerSrc = "";

const MAX_CV_CHARS = 120_000; // generous cap to keep prompt under model limits

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanDocxText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<w:cr\/>/g, "\n")
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const file = zip.file("word/document.xml");
    if (!file) return null;
    const xml = await file.async("string");
    const text = cleanDocxText(xml);
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error("DOCX extraction failed:", err);
    return null;
  }
}

async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const loadingTask = getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: false,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const parts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[])
        .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      if (pageText) parts.push(pageText);
    }
    const joined = parts.join("\n\n").trim();
    return joined.length > 0 ? joined : null;
  } catch (err) {
    console.error("PDF extraction failed:", err);
    return null;
  }
}

export interface ExtractedCv {
  filename: string;
  text: string;
  truncated: boolean;
}

/** Download from `cvs` bucket and extract plain text (PDF or DOCX). */
export async function extractCvText(
  supabaseAdmin: any,
  storagePath: string,
): Promise<ExtractedCv | null> {
  const { data: fileData, error } = await supabaseAdmin.storage.from("cvs").download(storagePath);
  if (error || !fileData) {
    console.error(`extractCvText: download failed for ${storagePath}:`, error);
    return null;
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());
  const filename = storagePath.split("/").pop() || "cv";
  const lower = filename.toLowerCase();

  let text: string | null = null;
  if (lower.endsWith(".docx")) {
    text = await extractDocxText(bytes);
  } else if (lower.endsWith(".pdf")) {
    text = await extractPdfText(bytes);
  } else if (lower.endsWith(".doc")) {
    // Legacy .doc: best-effort, treat as text
    try { text = new TextDecoder("utf-8", { fatal: false }).decode(bytes); } catch { text = null; }
  }

  if (!text || text.trim().length < 20) return null;

  const truncated = text.length > MAX_CV_CHARS;
  return {
    filename,
    text: truncated ? text.slice(0, MAX_CV_CHARS) : text,
    truncated,
  };
}
