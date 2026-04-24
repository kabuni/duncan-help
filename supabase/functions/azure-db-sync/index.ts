import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface SyncRequest {
  table: string;
  operation: "INSERT" | "UPDATE" | "UPSERT";
  record: Record<string, unknown>;
}

async function syncNdaSubmission(client: Client, op: string, record: Record<string, unknown>) {
  const fields = [
    "id", "submitter_id", "submitter_email", "receiving_party_name",
    "receiving_party_entity", "date_of_agreement", "registered_address",
    "purpose", "recipient_name", "recipient_email", "internal_signer_name",
    "internal_signer_email", "docusign_envelope_id", "google_doc_id",
    "google_doc_url", "notion_page_id", "notion_page_url", "status",
    "last_error", "created_at", "updated_at",
  ];

  const values = fields.map((f) => record[f] ?? null);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
  const updateSet = fields
    .filter((f) => f !== "id")
    .map((f, i) => `${f} = EXCLUDED.${f}`)
    .join(", ");

  await client.queryArray(
    `INSERT INTO nda_submissions (${fields.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

async function syncMeeting(client: Client, op: string, record: Record<string, unknown>) {
  const fields = [
    "id", "title", "transcript", "summary", "meeting_date",
    "participants", "source", "status", "analysis", "action_items",
    "created_at", "updated_at",
  ];

  const values = fields.map((f) => {
    const v = record[f] ?? null;
    // Serialize arrays/objects for PG
    if (f === "participants" && Array.isArray(v)) return v;
    if ((f === "analysis" || f === "action_items") && v !== null) return JSON.stringify(v);
    return v;
  });

  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
  const updateSet = fields
    .filter((f) => f !== "id")
    .map((f) => `${f} = EXCLUDED.${f}`)
    .join(", ");

  await client.queryArray(
    `INSERT INTO meetings (${fields.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    values
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // This function is called internally by other edge functions, not directly by users.
    // Validate with service role key.
    const authHeader = req.headers.get("Authorization");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!authHeader || !authHeader.includes(serviceKey || "__never__")) {
      // Also accept calls from other edge functions via internal header
      const internalKey = req.headers.get("x-internal-key");
      if (internalKey !== serviceKey) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body: SyncRequest = await req.json();
    const { table, operation, record } = body;

    if (!table || !record) {
      return new Response(JSON.stringify({ error: "Missing table or record" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = getAzurePgClient();
    await client.connect();

    try {
      switch (table) {
        case "nda_submissions":
          await syncNdaSubmission(client, operation, record);
          break;
        case "meetings":
          await syncMeeting(client, operation, record);
          break;
        default:
          await client.end();
          return new Response(
            JSON.stringify({ error: `Unsupported table: ${table}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
      }

      await client.end();

      return new Response(
        JSON.stringify({ success: true, table, operation }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (dbError: any) {
      try { await client.end(); } catch (_) { /* ignore */ }
      throw dbError;
    }
  } catch (error: any) {
    console.error("Azure sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
