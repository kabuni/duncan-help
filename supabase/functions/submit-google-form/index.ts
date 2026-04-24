import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { formActionUrl, entries } = await req.json();

    if (!formActionUrl || !entries || typeof entries !== "object") {
      return new Response(
        JSON.stringify({ error: "formActionUrl and entries (object) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build form data
    const formData = new URLSearchParams();
    for (const [entryId, value] of Object.entries(entries)) {
      formData.append(entryId, String(value));
    }

    const response = await fetch(formActionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    // Google Forms returns 200 on success (with an HTML page)
    const text = await response.text();
    console.log("Google Form response status:", response.status, "redirected:", response.redirected);
    console.log("Response snippet:", text.substring(0, 500));
    const success = response.ok || text.includes("freebirdFormviewerViewResponseConfirmationMessage");

    return new Response(
      JSON.stringify({ success, status: response.status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("submit-google-form error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
