import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEmbedding } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getAzurePgClient(): Client {
  const password = Deno.env.get("AZURE_PG_PASSWORD");
  if (!password) throw new Error("AZURE_PG_PASSWORD not configured");

  return new Client({
    hostname: "kabuni-dev-cin-postgresql-01.postgres.database.azure.com",
    port: 5432,
    user: "duncan_admin_dev",
    password,
    database: "postgres",
    tls: { enabled: true, enforce: false },
  });
}

// Approximate token count (1 token ≈ 4 chars for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Semantic chunking: split by NDA sections, then subdivide if needed
function chunkNdaText(text: string, minTokens = 500, maxTokens = 800, overlapTokens = 100): { content: string; tokenCount: number }[] {
  // Split by common NDA section markers
  const sectionPatterns = [
    /\n(?=\d+\.\s+[A-Z])/g,             // "1. DEFINITIONS"
    /\n(?=[A-Z][A-Z\s]{3,}:?\n)/g,      // "CONFIDENTIAL INFORMATION:"
    /\n(?=Article\s+\d+)/gi,             // "Article 1"
    /\n(?=Section\s+\d+)/gi,            // "Section 1"
    /\n(?=WHEREAS|NOW,?\s+THEREFORE)/gi, // Recitals
  ];

  let sections = [text];
  for (const pattern of sectionPatterns) {
    const newSections: string[] = [];
    for (const section of sections) {
      const parts = section.split(pattern).filter((s) => s.trim().length > 0);
      newSections.push(...parts);
    }
    if (newSections.length > sections.length) {
      sections = newSections;
      break; // Use the first pattern that produces meaningful splits
    }
  }

  // If no section markers found, fall back to paragraph splitting
  if (sections.length <= 1) {
    sections = text.split(/\n\n+/).filter((s) => s.trim().length > 0);
  }

  const chunks: { content: string; tokenCount: number }[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section);

    if (currentTokens + sectionTokens <= maxTokens) {
      currentChunk += (currentChunk ? "\n\n" : "") + section;
      currentTokens += sectionTokens;
    } else {
      // Flush current chunk if it meets minimum
      if (currentTokens >= minTokens) {
        chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });

        // Start new chunk with overlap from end of previous
        const overlapText = getOverlapText(currentChunk, overlapTokens);
        currentChunk = overlapText + "\n\n" + section;
        currentTokens = estimateTokens(currentChunk);
      } else if (sectionTokens > maxTokens) {
        // Section itself exceeds max — split by sentences
        if (currentChunk) {
          currentChunk += "\n\n" + section;
          currentTokens += sectionTokens;
        } else {
          currentChunk = section;
          currentTokens = sectionTokens;
        }
        // Force-split oversized chunk
        const subChunks = forceSplit(currentChunk, maxTokens, overlapTokens);
        chunks.push(...subChunks.slice(0, -1));
        const last = subChunks[subChunks.length - 1];
        currentChunk = last.content;
        currentTokens = last.tokenCount;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + section;
        currentTokens += sectionTokens;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });
  }

  return chunks;
}

function getOverlapText(text: string, overlapTokens: number): string {
  const chars = overlapTokens * 4;
  return text.slice(-chars);
}

function forceSplit(text: string, maxTokens: number, overlapTokens: number): { content: string; tokenCount: number }[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: { content: string; tokenCount: number }[] = [];
  let current = "";
  let tokens = 0;

  for (const sentence of sentences) {
    const st = estimateTokens(sentence);
    if (tokens + st > maxTokens && current) {
      chunks.push({ content: current.trim(), tokenCount: tokens });
      const overlap = getOverlapText(current, overlapTokens);
      current = overlap + " " + sentence;
      tokens = estimateTokens(current);
    } else {
      current += (current ? " " : "") + sentence;
      tokens += st;
    }
  }
  if (current.trim()) {
    chunks.push({ content: current.trim(), tokenCount: tokens });
  }
  return chunks;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await getEmbedding(t));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nda_id } = await req.json();
    if (!nda_id) {
      return new Response(JSON.stringify({ error: "Missing nda_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch NDA from Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: nda, error: ndaError } = await supabase
      .from("nda_submissions")
      .select("*")
      .eq("id", nda_id)
      .single();

    if (ndaError || !nda) {
      return new Response(JSON.stringify({ error: "NDA not found", details: ndaError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the text representation of the NDA for vectorization
    const ndaText = buildNdaText(nda);

    // Chunk the text
    const chunks = chunkNdaText(ndaText);
    console.log(`NDA ${nda_id}: ${chunks.length} chunks generated`);

    // Generate embeddings in batches of 20
    const batchSize = 20;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize).map((c) => c.content);
      const embeddings = await generateEmbeddings(batch);
      allEmbeddings.push(...embeddings);
    }

    // Write to Azure PostgreSQL
    const client = getAzurePgClient();
    await client.connect();

    try {
      // First sync the NDA record itself
      await client.queryArray(
        `INSERT INTO nda_submissions (id, submitter_id, submitter_email, receiving_party_name,
          receiving_party_entity, date_of_agreement, registered_address, purpose,
          recipient_name, recipient_email, internal_signer_name, internal_signer_email,
          docusign_envelope_id, google_doc_id, google_doc_url, notion_page_id,
          notion_page_url, status, last_error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
           docusign_envelope_id = EXCLUDED.docusign_envelope_id,
           google_doc_id = EXCLUDED.google_doc_id, google_doc_url = EXCLUDED.google_doc_url,
           notion_page_id = EXCLUDED.notion_page_id, notion_page_url = EXCLUDED.notion_page_url,
           last_error = EXCLUDED.last_error`,
        [
          nda.id, nda.submitter_id, nda.submitter_email, nda.receiving_party_name,
          nda.receiving_party_entity, nda.date_of_agreement, nda.registered_address,
          nda.purpose, nda.recipient_name, nda.recipient_email, nda.internal_signer_name,
          nda.internal_signer_email, nda.docusign_envelope_id, nda.google_doc_id,
          nda.google_doc_url, nda.notion_page_id, nda.notion_page_url, nda.status,
          nda.last_error, nda.created_at, nda.updated_at,
        ]
      );

      // Delete existing chunks for this NDA (re-vectorize)
      await client.queryArray(`DELETE FROM nda_chunks WHERE nda_id = $1`, [nda_id]);

      // Insert chunks with embeddings
      for (let i = 0; i < chunks.length; i++) {
        const embeddingStr = `[${allEmbeddings[i].join(",")}]`;
        await client.queryArray(
          `INSERT INTO nda_chunks (nda_id, chunk_index, content, token_count, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5::vector, $6)`,
          [
            nda_id,
            i,
            chunks[i].content,
            chunks[i].tokenCount,
            embeddingStr,
            JSON.stringify({
              receiving_party: nda.receiving_party_name,
              purpose: nda.purpose,
              status: nda.status,
              date: nda.date_of_agreement,
            }),
          ]
        );
      }

      await client.end();
    } catch (dbError: any) {
      try { await client.end(); } catch (_) { /* ignore */ }
      throw dbError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        nda_id,
        chunks_created: chunks.length,
        total_tokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("NDA vectorization error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function buildNdaText(nda: Record<string, unknown>): string {
  return [
    `NON-DISCLOSURE AGREEMENT`,
    `Date of Agreement: ${nda.date_of_agreement}`,
    ``,
    `PARTIES:`,
    `Disclosing Party: Kabuni Ltd`,
    `Receiving Party: ${nda.receiving_party_name}`,
    `Entity: ${nda.receiving_party_entity}`,
    `Registered Address: ${nda.registered_address}`,
    ``,
    `PURPOSE:`,
    `${nda.purpose}`,
    ``,
    `SIGNATORIES:`,
    `Internal Signer: ${nda.internal_signer_name || "Palash Soundarkar"} (${nda.internal_signer_email || "palash@kabuni.com"})`,
    `External Recipient: ${nda.recipient_name} (${nda.recipient_email})`,
    ``,
    `STATUS: ${nda.status}`,
    nda.docusign_envelope_id ? `DocuSign Envelope: ${nda.docusign_envelope_id}` : "",
    nda.google_doc_url ? `Document URL: ${nda.google_doc_url}` : "",
    nda.notion_page_url ? `Notion Page: ${nda.notion_page_url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
