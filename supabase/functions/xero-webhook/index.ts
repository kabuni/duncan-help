import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const webhookKey = Deno.env.get("XERO_WEBHOOK_KEY");

    const body = await req.text();

    // Xero sends an Intent to Receive check with an empty payload
    // Must respond with 200 and the correct HMAC
    if (webhookKey) {
      const signature = req.headers.get("x-xero-signature");
      if (signature) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(webhookKey),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
        const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

        if (computed !== signature) {
          // Return 401 for invalid signature
          return new Response("", { status: 401 });
        }
      }
    }

    // Parse the payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      // Empty body = intent to receive check
      return new Response("", { status: 200 });
    }

    const events = payload.events || [];

    for (const event of events) {
      await supabaseAdmin.from("integration_audit_logs").insert({
        integration: "xero",
        action: `webhook:${event.eventType || "unknown"}`,
        details: event,
      });

      // If invoice or contact changed, trigger a re-sync could be added here
    }

    return new Response("", { status: 200 });
  } catch (error: any) {
    console.error("Xero webhook error:", error);
    return new Response("", { status: 200 }); // Xero expects 200 even on errors
  }
});
