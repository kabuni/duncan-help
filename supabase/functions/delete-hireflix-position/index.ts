import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { hireflix_position_id } = await req.json();
    if (!hireflix_position_id) {
      return new Response(JSON.stringify({ error: "hireflix_position_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const HIREFLIX_API_KEY = Deno.env.get("HIREFLIX_API_KEY");
    if (!HIREFLIX_API_KEY) {
      return new Response(JSON.stringify({ error: "HIREFLIX_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const escapedId = hireflix_position_id.replace(/"/g, '\\"');
    const mutation = `
      mutation {
        deletePosition(id: "${escapedId}") {
          id
        }
      }
    `;

    console.log("Deleting Hireflix position:", hireflix_position_id);

    const hfRes = await fetch("https://api.hireflix.com/me", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": HIREFLIX_API_KEY,
      },
      body: JSON.stringify({ query: mutation }),
    });

    const hfData = await hfRes.json();
    console.log("Hireflix delete response:", JSON.stringify(hfData));

    if (hfData.errors) {
      // If position not found, treat as success (already deleted)
      const errMsg = hfData.errors[0]?.message || "";
      if (errMsg.toLowerCase().includes("not found") || errMsg.toLowerCase().includes("does not exist")) {
        console.log("Position already deleted or not found — treating as success");
        return new Response(JSON.stringify({ success: true, already_deleted: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Hireflix API error: " + errMsg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Delete Hireflix position error:", error);
    return new Response(JSON.stringify({ error: error.message || "Failed to delete Hireflix position" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
