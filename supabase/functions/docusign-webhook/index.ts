import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // DocuSign Connect sends XML by default, but can be configured to send JSON
  // We'll handle both
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const contentType = req.headers.get("content-type") || "";
    let envelopeId: string | null = null;
    let envelopeStatus: string | null = null;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      // Redacted log: only non-PII fields
      envelopeId = body.envelopeId || body.data?.envelopeId || body.EnvelopeStatus?.EnvelopeID;
      envelopeStatus = body.status || body.data?.envelopeSummary?.status || body.EnvelopeStatus?.Status;
      console.log("DocuSign webhook (JSON) received:", { envelopeId, envelopeStatus });
    } else if (contentType.includes("text/xml") || contentType.includes("application/xml")) {
      const xmlText = await req.text();
      // Simple XML parsing for envelope ID and status (do not log raw XML — may contain PII)
      const envelopeIdMatch = xmlText.match(/<EnvelopeID>([^<]+)<\/EnvelopeID>/i);
      const statusMatch = xmlText.match(/<Status>([^<]+)<\/Status>/i);
      envelopeId = envelopeIdMatch?.[1] || null;
      envelopeStatus = statusMatch?.[1] || null;
      console.log("DocuSign webhook (XML) received:", { envelopeId, envelopeStatus });
    } else {
      // Try as JSON
      try {
        const body = await req.json();
        envelopeId = body.envelopeId || body.data?.envelopeId;
        envelopeStatus = body.status || body.data?.envelopeSummary?.status;
      } catch {
        console.error("Could not parse webhook body");
        return new Response("OK", { status: 200 });
      }
    }

    if (!envelopeId) {
      console.log("No envelope ID found in webhook payload");
      return new Response("OK", { status: 200 });
    }

    console.log(`Processing webhook: envelopeId=${envelopeId}, status=${envelopeStatus}`);

    // Find the submission by envelope ID
    const { data: submission, error: subErr } = await supabaseAdmin
      .from("nda_submissions")
      .select("*")
      .eq("docusign_envelope_id", envelopeId)
      .maybeSingle();

    if (subErr || !submission) {
      console.log(`No submission found for envelope ${envelopeId}`);
      return new Response("OK", { status: 200 });
    }

    // Map DocuSign statuses
    const normalizedStatus = (envelopeStatus || "").toLowerCase();
    let newStatus = submission.status;

    if (normalizedStatus === "completed") {
      newStatus = "completed";
    } else if (normalizedStatus === "declined") {
      newStatus = "declined";
    } else if (normalizedStatus === "voided") {
      newStatus = "voided";
    } else if (normalizedStatus === "sent") {
      newStatus = "sent";
    } else if (normalizedStatus === "delivered") {
      newStatus = "delivered";
    }

    // Update submission
    await supabaseAdmin
      .from("nda_submissions")
      .update({ status: newStatus })
      .eq("id", submission.id);

    console.log(`Webhook processed: submission=${submission.id}, status=${newStatus}`);
    return new Response("OK", { status: 200 });

  } catch (e: any) {
    console.error("docusign-webhook error:", e);
    // Always return 200 to prevent DocuSign from retrying
    return new Response("OK", { status: 200 });
  }
});
