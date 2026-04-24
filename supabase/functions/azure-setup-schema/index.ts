import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const client = getAzurePgClient();

  try {
    console.log("Attempting Azure PG connection...");
    await client.connect();
    console.log("Connected to Azure PG successfully");
    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS nda_submissions (
        id UUID PRIMARY KEY,
        submitter_id UUID NOT NULL,
        submitter_email TEXT,
        receiving_party_name TEXT NOT NULL,
        receiving_party_entity TEXT NOT NULL,
        date_of_agreement DATE NOT NULL,
        registered_address TEXT NOT NULL,
        purpose TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        internal_signer_name TEXT,
        internal_signer_email TEXT,
        docusign_envelope_id TEXT,
        google_doc_id TEXT,
        google_doc_url TEXT,
        notion_page_id TEXT,
        notion_page_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Create nda_chunks table with vector column
    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS nda_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nda_id UUID NOT NULL REFERENCES nda_submissions(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(nda_id, chunk_index)
      );
    `);

    // 3. Create HNSW index for fast cosine similarity search
    await client.queryArray(`
      CREATE INDEX IF NOT EXISTS idx_nda_chunks_embedding
      ON nda_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);

    // 4. Create index on nda_id for fast lookups
    await client.queryArray(`
      CREATE INDEX IF NOT EXISTS idx_nda_chunks_nda_id
      ON nda_chunks(nda_id);
    `);

    // 5. Create meetings mirror table (for future use)
    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS meetings (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        transcript TEXT,
        summary TEXT,
        meeting_date TIMESTAMPTZ,
        participants TEXT[],
        source TEXT NOT NULL DEFAULT 'plaud',
        status TEXT NOT NULL DEFAULT 'pending',
        analysis JSONB,
        action_items JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 6. Create meeting_chunks table for future vectorization
    await client.queryArray(`
      CREATE TABLE IF NOT EXISTS meeting_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(meeting_id, chunk_index)
      );
    `);

    await client.queryArray(`
      CREATE INDEX IF NOT EXISTS idx_meeting_chunks_embedding
      ON meeting_chunks
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `);

    await client.end();

    return new Response(
      JSON.stringify({
        success: true,
        tables_created: [
          "nda_submissions",
          "nda_chunks (with vector(1536))",
          "meetings",
          "meeting_chunks (with vector(1536))",
        ],
        indexes_created: [
          "idx_nda_chunks_embedding (HNSW cosine)",
          "idx_nda_chunks_nda_id",
          "idx_meeting_chunks_embedding (HNSW cosine)",
        ],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Azure schema setup error:", error);
    try { await client.end(); } catch (_) { /* ignore */ }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
