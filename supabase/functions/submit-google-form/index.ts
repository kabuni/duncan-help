import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ENTRIES = 100;
const MAX_VALUE_LENGTH = 10_000;
const MAX_TOTAL_PAYLOAD = 200_000;
const ALLOWED_HOSTS = new Set(["docs.google.com", "forms.gle"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { formActionUrl, entries } = await req.json();

    if (!formActionUrl || !entries || typeof entries !== "object") {
      return new Response(
        JSON.stringify({ error: "formActionUrl and entries (object) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate URL host (only Google Forms targets allowed)
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(formActionUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid formActionUrl" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: "formActionUrl host is not allowed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const entryEntries = Object.entries(entries);
    if (entryEntries.length > MAX_ENTRIES) {
      return new Response(
        JSON.stringify({ error: `Too many entries (max ${MAX_ENTRIES})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalSize = 0;
    const formData = new URLSearchParams();
    for (const [entryId, value] of entryEntries) {
      const strValue = String(value ?? "");
      if (strValue.length > MAX_VALUE_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Value too long for ${entryId} (max ${MAX_VALUE_LENGTH})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      totalSize += entryId.length + strValue.length;
      if (totalSize > MAX_TOTAL_PAYLOAD) {
        return new Response(
          JSON.stringify({ error: "Payload too large" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      formData.append(entryId, strValue);
    }

    const response = await fetch(formActionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    const text = await response.text();
    console.log("Google Form response status:", response.status, "redirected:", response.redirected);
    const success = response.ok || text.includes("freebirdFormviewerViewResponseConfirmationMessage");

    return new Response(
      JSON.stringify({ success, status: response.status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("submit-google-form error:", e instanceof Error ? e.message : "unknown");
    return new Response(
      JSON.stringify({ error: "Submission failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
