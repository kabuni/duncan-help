// Send an arbitrary staged PDF for e-signature via DocuSign (JWT Service Account).
// Source PDF lives in the private `docusign-staging` storage bucket, keyed by user id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getDocuSignAccessToken(): Promise<string> {
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY");
  const userId = Deno.env.get("DOCUSIGN_USER_ID");
  const privateKeyPem = Deno.env.get("DOCUSIGN_PRIVATE_KEY");
  if (!integrationKey || !userId || !privateKeyPem) {
    throw new Error("DocuSign credentials not configured");
  }

  const basePath = Deno.env.get("DOCUSIGN_BASE_PATH") || "https://demo.docusign.net";
  const authServer = basePath.includes("demo") ? "account-d.docusign.com" : "account.docusign.com";

  const now = Math.floor(Date.now() / 1000);
  const enc = (o: any) =>
    btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const signingInput = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: integrationKey,
    sub: userId,
    aud: authServer,
    iat: now,
    exp: now + 3600,
    scope: "signature impersonation",
  })}`;

  const pemClean = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s/g, "");

  const keyBytes = Uint8Array.from(atob(pemClean), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch(`https://${authServer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error(`DocuSign token exchange failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      staging_path,
      recipient_name,
      recipient_email,
      subject,
      message,
      file_name,
    } = body || {};

    const errors: string[] = [];
    if (!staging_path || typeof staging_path !== "string") errors.push("staging_path is required");
    if (!recipient_name || typeof recipient_name !== "string" || recipient_name.trim().length < 2)
      errors.push("recipient_name is required");
    if (!recipient_email || !EMAIL_RE.test(String(recipient_email).trim()))
      errors.push("recipient_email must be a valid email");
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: errors.join("; ") }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enforce that staging_path belongs to caller (defence in depth on top of RLS).
    const expectedPrefix = `${user.id}/`;
    if (!staging_path.startsWith(expectedPrefix)) {
      return new Response(JSON.stringify({ error: "staging_path does not belong to caller" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { data: blob, error: dlErr } = await supabaseAdmin
      .storage.from("docusign-staging").download(staging_path);
    if (dlErr || !blob) {
      return new Response(JSON.stringify({ error: `Could not fetch staged PDF: ${dlErr?.message || "not found"}` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const docBase64 = btoa(binary);

    const accountId = Deno.env.get("DOCUSIGN_ACCOUNT_ID");
    const basePath = Deno.env.get("DOCUSIGN_BASE_PATH") || "https://demo.docusign.net";
    if (!accountId) throw new Error("DOCUSIGN_ACCOUNT_ID not configured");

    const dsToken = await getDocuSignAccessToken();
    const docName = (file_name || staging_path.split("/").pop() || "document.pdf").replace(/[^\w.\-]+/g, "_");
    const cleanSubject = (subject && String(subject).trim()) || `Please sign: ${docName}`;
    const cleanMessage = (message && String(message).trim()) ||
      `Hi ${recipient_name}, please review and sign the attached document. Thanks.`;

    const envelopeBody = {
      emailSubject: cleanSubject.slice(0, 100),
      emailBlurb: cleanMessage.slice(0, 10000),
      documents: [{
        documentBase64: docBase64,
        name: docName,
        fileExtension: "pdf",
        documentId: "1",
      }],
      recipients: {
        signers: [{
          email: String(recipient_email).trim(),
          name: String(recipient_name).trim(),
          recipientId: "1",
          routingOrder: "1",
          // Auto-place a signature + date + name tab on the last page at default coords.
          tabs: {
            signHereTabs: [{ documentId: "1", pageNumber: "1", recipientId: "1",
              anchorString: "/sig/", anchorUnits: "pixels", anchorIgnoreIfNotPresent: "true",
              xPosition: "100", yPosition: "600" }],
            dateSignedTabs: [{ documentId: "1", pageNumber: "1", recipientId: "1",
              xPosition: "100", yPosition: "670" }],
            fullNameTabs: [{ documentId: "1", pageNumber: "1", recipientId: "1",
              xPosition: "300", yPosition: "670" }],
          },
        }],
      },
      status: "sent",
    };

    const envRes = await fetch(
      `${basePath}/restapi/v2.1/accounts/${accountId}/envelopes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${dsToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelopeBody),
      },
    );
    if (!envRes.ok) {
      const t = await envRes.text();
      throw new Error(`DocuSign envelope creation failed: ${t}`);
    }
    const env = await envRes.json();

    // Best-effort cleanup so staged PDFs don't linger.
    supabaseAdmin.storage.from("docusign-staging").remove([staging_path]).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      envelope_id: env.envelopeId,
      recipient_name,
      recipient_email,
      file_name: docName,
      message: `Sent "${docName}" to ${recipient_name} <${recipient_email}> for e-signature.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("docusign-send-pdf error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
