// Recovers Knowledge Base documents that have been stuck in "processing"
// for more than STUCK_THRESHOLD_MINUTES. Designed to be invoked by pg_cron
// hourly OR manually from the UI.
//
// Marks them as "failed" with a clear message so the user can hit Retry.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUCK_THRESHOLD_MINUTES = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString();

  // Use processing_started_at when present; fall back to updated_at for
  // older rows that pre-date the column.
  const { data: stuck, error } = await supabase
    .from("documents")
    .select("id,title,processing_started_at,updated_at")
    .eq("status", "processing")
    .or(`processing_started_at.lt.${cutoff},and(processing_started_at.is.null,updated_at.lt.${cutoff})`);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = (stuck || []).map((r: any) => r.id);
  if (ids.length === 0) {
    return new Response(JSON.stringify({ recovered: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updErr } = await supabase
    .from("documents")
    .update({
      status: "failed",
      error_message: `Processing stalled (>${STUCK_THRESHOLD_MINUTES} min). The extraction worker did not finish. Click Retry to try again.`,
    })
    .in("id", ids);

  if (updErr) {
    return new Response(JSON.stringify({ error: updErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ recovered: ids.length, ids }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
