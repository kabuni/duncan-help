import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const { file_id } = await req.json();
    if (!file_id || typeof file_id !== "string") {
      return new Response(JSON.stringify({ error: "file_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch file record (RLS enforces project ownership)
    const { data: fileRecord, error: fileError } = await supabase
      .from("project_files")
      .select("id, storage_path")
      .eq("id", file_id)
      .single();

    if (fileError || !fileRecord) {
      return new Response(JSON.stringify({ error: "File not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from("project-files")
      .remove([fileRecord.storage_path]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      // Continue — DB record should still be cleaned up
    }

    // Delete DB record (cascade removes chunks)
    const { error: deleteError } = await supabase
      .from("project_files")
      .delete()
      .eq("id", file_id);

    if (deleteError) {
      console.error("DB delete error:", deleteError);
      return new Response(JSON.stringify({ error: "Failed to delete file record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("delete-project-file error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
