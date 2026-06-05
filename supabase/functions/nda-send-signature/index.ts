import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONTAINER_NAME = "duncanstorage01";

// ── Azure Blob helpers ──────────────────────────────────────────────

function parseConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const parts: Record<string, string> = {};
  for (const part of connStr.trim().split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key || rest.length === 0) continue;
    parts[key.trim()] = rest.join("=").trim();
  }
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error("Invalid Azure Storage connection string");
  }
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

async function createSharedKeySignature(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  queryParams?: URLSearchParams,
): Promise<string> {
  const contentLength = headers["Content-Length"] || "";
  const contentType = headers["Content-Type"] || "";

  const msHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase().startsWith("x-ms-")) {
      msHeaders[k.toLowerCase()] = v.trim();
    }
  }

  const canonicalizedHeaders = Object.keys(msHeaders)
    .sort()
    .map((k) => `${k}:${msHeaders[k]}`)
    .join("\n");

  let canonicalizedResource = `/${accountName}${path}`;
  if (queryParams) {
    const grouped: Record<string, string[]> = {};
    for (const [k, v] of queryParams.entries()) {
      const key = k.toLowerCase();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(v);
    }
    for (const key of Object.keys(grouped).sort()) {
      canonicalizedResource += `\n${key}:${grouped[key].sort().join(",")}`;
    }
  }

  const stringToSign = [
    method, "", "", contentLength, "", contentType,
    "", "", "", "", "", "",
    canonicalizedHeaders, canonicalizedResource,
  ].join("\n");

  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return `SharedKey ${accountName}:${signature}`;
}

async function downloadBlobBytes(connectionString: string, blobPath: string): Promise<Uint8Array> {
  const { accountName, accountKey } = parseConnectionString(connectionString);
  const encodedPath = `/${CONTAINER_NAME}/${blobPath}`
    .split("/").map((s) => encodeURIComponent(s)).join("/");

  const headers: Record<string, string> = {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2023-11-03",
  };
  headers.Authorization = await createSharedKeySignature(
    accountName, accountKey, "GET", encodedPath, headers,
  );

  const res = await fetch(`https://${accountName}.blob.core.windows.net${encodedPath}`, {
    method: "GET", headers,
  });
  if (!res.ok) throw new Error(`Azure blob download failed (${res.status}): ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── DocuSign helpers ────────────────────────────────────────────────

async function getDocuSignAccessToken(): Promise<string> {
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY");
  const userId = Deno.env.get("DOCUSIGN_USER_ID");
  const privateKeyPem = Deno.env.get("DOCUSIGN_PRIVATE_KEY");

  if (!integrationKey || !userId || !privateKeyPem) {
    throw new Error("DocuSign credentials not configured (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY)");
  }

  const basePath = Deno.env.get("DOCUSIGN_BASE_PATH") || "https://demo.docusign.net";
  const authServer = basePath.includes("demo") ? "account-d.docusign.com" : "account.docusign.com";

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: integrationKey, sub: userId, aud: authServer,
    iat: now, exp: now + 3600, scope: "signature impersonation",
  };

  const encode = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemClean = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemClean), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
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

  if (!tokenRes.ok) {
    throw new Error(`DocuSign token exchange failed: ${await tokenRes.text()}`);
  }

  return (await tokenRes.json()).access_token;
}


// ── Checked DB update helper ────────────────────────────────────────

async function checkedUpdate(
  supabaseAdmin: any,
  table: string,
  values: Record<string, any>,
  matchCol: string,
  matchVal: string,
  context: string,
): Promise<void> {
  const { error, count } = await supabaseAdmin
    .from(table)
    .update(values)
    .eq(matchCol, matchVal)
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error(`DB update failed (${context}):`, error.message);
  } else if (count === 0) {
    console.warn(`DB update matched 0 rows (${context}) for ${matchCol}=${matchVal}`);
  }
}

// ── Main handler ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authenticated admin user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { submission_id, dry_run } = await req.json();
    if (!submission_id) {
      return new Response(JSON.stringify({ error: "submission_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get submission
    const { data: submission, error: subErr } = await supabaseAdmin
      .from("nda_submissions")
      .select("*")
      .eq("id", submission_id)
      .single();

    if (subErr || !submission) {
      return new Response(JSON.stringify({ error: "Submission not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: already has an envelope?
    if (submission.docusign_envelope_id) {
      return new Response(JSON.stringify({
        success: true,
        envelope_id: submission.docusign_envelope_id,
        message: "Envelope already created for this submission.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // google_doc_id now stores the Azure blob path
    const blobPath = submission.google_doc_id;
    if (!blobPath) {
      return new Response(JSON.stringify({ error: "NDA document not generated yet" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status
    await checkedUpdate(supabaseAdmin, "nda_submissions",
      { status: "sending_signature", last_error: null },
      "id", submission_id, "set sending_signature");

    try {
      // Step 1: Download .docx from Azure Blob Storage
      const connectionString = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
      if (!connectionString) throw new Error("Azure Storage not configured");

      const docxBytes = await downloadBlobBytes(connectionString, blobPath);
      console.log(`Downloaded .docx from Azure: ${docxBytes.length} bytes`);

      // Encode .docx as base64 for DocuSign (DocuSign accepts .docx natively)
      let binary = "";
      for (let i = 0; i < docxBytes.length; i++) {
        binary += String.fromCharCode(docxBytes[i]);
      }
      const docBase64 = btoa(binary);

      // Dry run mode
      if (dry_run) {
        await checkedUpdate(supabaseAdmin, "nda_submissions",
          { status: "generated", last_error: "Dry run — envelope not sent" },
          "id", submission_id, "dry run reset");

        return new Response(JSON.stringify({
          success: true,
          dry_run: true,
          message: `Dry run complete. Document downloaded (${docxBytes.length} bytes). Would send to: signer1=${submission.internal_signer_email || "palash@kabuni.com"}, signer2=${submission.recipient_email}`,
          doc_size_bytes: docxBytes.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Step 2: Get DocuSign access token
      const dsAccessToken = await getDocuSignAccessToken();
      const accountId = Deno.env.get("DOCUSIGN_ACCOUNT_ID");
      const basePath = Deno.env.get("DOCUSIGN_BASE_PATH") || "https://demo.docusign.net";

      if (!accountId) throw new Error("DOCUSIGN_ACCOUNT_ID not configured");

      const kabSigner = {
        email: submission.internal_signer_email || "palash@kabuni.com",
        name: submission.internal_signer_name || "Palash Soundarkar",
        recipientId: "1",
        routingOrder: "1",
        tabs: {
          signHereTabs: [{ documentId: "1", anchorString: "/sig1/", anchorUnits: "pixels" }],
          fullNameTabs: [{ documentId: "1", anchorString: "/name1/", anchorUnits: "pixels" }],
          titleTabs: [{ documentId: "1", anchorString: "/title1/", anchorUnits: "pixels" }],
          dateSignedTabs: [{ documentId: "1", anchorString: "/date1/", anchorUnits: "pixels" }],
        },
      };

      const recipientSigner = {
        email: submission.recipient_email,
        name: submission.recipient_name,
        recipientId: "2",
        routingOrder: "2",
        tabs: {
          signHereTabs: [{ documentId: "1", anchorString: "/sig2/", anchorUnits: "pixels" }],
          fullNameTabs: [{ documentId: "1", anchorString: "/name2/", anchorUnits: "pixels" }],
          titleTabs: [{ documentId: "1", anchorString: "/title2/", anchorUnits: "pixels" }],
          dateSignedTabs: [{ documentId: "1", anchorString: "/date2/", anchorUnits: "pixels" }],
        },
      };

      // Step 3: Create envelope — send .docx directly (DocuSign converts to PDF internally)
      const docFileName = blobPath.split("/").pop() || "NDA.docx";
      const envelopeBody = {
        emailSubject: `NDA - ${submission.receiving_party_name} — Please sign`,
        documents: [
          {
            documentBase64: docBase64,
            name: docFileName,
            fileExtension: "docx",
            documentId: "1",
          },
        ],
        recipients: {
          signers: [kabSigner, recipientSigner],
        },
        status: "sent",
      };

      const envelopeRes = await fetch(
        `${basePath}/restapi/v2.1/accounts/${accountId}/envelopes`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dsAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(envelopeBody),
        },
      );

      if (!envelopeRes.ok) {
        const errText = await envelopeRes.text();
        throw new Error(`DocuSign envelope creation failed: ${errText}`);
      }

      const envelope = await envelopeRes.json();
      const envelopeId = envelope.envelopeId;
      console.log(`DocuSign envelope created: ${envelopeId}`);

      // Step 4: Update submission
      await checkedUpdate(supabaseAdmin, "nda_submissions", {
        docusign_envelope_id: envelopeId,
        status: "sent",
        last_error: null,
      }, "id", submission_id, "save envelope_id");


      return new Response(JSON.stringify({
        success: true,
        envelope_id: envelopeId,
        submission_id,
        message: `NDA sent for signature. Envelope ID: ${envelopeId}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (sendError) {
      await checkedUpdate(supabaseAdmin, "nda_submissions", {
        status: "failed",
        last_error: sendError instanceof Error ? sendError.message : "Unknown error",
      }, "id", submission_id, "mark failed");

      throw sendError;
    }
  } catch (e: any) {
    console.error("nda-send-signature error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
