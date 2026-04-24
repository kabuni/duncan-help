import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
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
    connection: { attempts: 1 },
  });
}

async function generateEmbedding(text: string): Promise<number[]> {
  return await getEmbedding(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, top_k = 5, threshold = 0.3 } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Search Azure PostgreSQL using cosine similarity
    const client = getAzurePgClient();
    await client.connect();

    try {
      const result = await client.queryObject<{
        chunk_id: string;
        nda_id: string;
        chunk_index: number;
        content: string;
        token_count: number;
        metadata: Record<string, unknown>;
        similarity: number;
        receiving_party_name: string;
        purpose: string;
        status: string;
        date_of_agreement: string;
      }>(
        `SELECT
          c.id AS chunk_id,
          c.nda_id,
          c.chunk_index,
          c.content,
          c.token_count,
          c.metadata,
          1 - (c.embedding <=> $1::vector) AS similarity,
          n.receiving_party_name,
          n.purpose,
          n.status,
          n.date_of_agreement::text
        FROM nda_chunks c
        JOIN nda_submissions n ON c.nda_id = n.id
        WHERE 1 - (c.embedding <=> $1::vector) >= $2
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3`,
        [embeddingStr, threshold, top_k]
      );

      await client.end();

      return new Response(
        JSON.stringify({
          success: true,
          query,
          results: result.rows.map((r) => ({
            nda_id: r.nda_id,
            chunk_index: r.chunk_index,
            content: r.content,
            similarity: Number(r.similarity).toFixed(4),
            nda_meta: {
              receiving_party: r.receiving_party_name,
              purpose: r.purpose,
              status: r.status,
              date: r.date_of_agreement,
            },
          })),
          total_results: result.rows.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (dbError: any) {
      try { await client.end(); } catch (_) { /* ignore */ }
      throw dbError;
    }
  } catch (error: any) {
    console.error("NDA search error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
