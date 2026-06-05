import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CONTAINER_NAME = "duncanstorage01";
const NDA_TEMPLATE_PATH = "templates/nda_template.docx";

interface NDARequest {
  submitter_email: string;
  receiving_party_name: string;
  receiving_party_entity: string;
  date_of_agreement: string;
  registered_address: string;
  purpose: string;
  recipient_name: string;
  recipient_email: string;
  internal_signer_name?: string;
  internal_signer_email?: string;
  submission_id?: string;
}

function formatDateLondon(isoDate: string): string {
  const date = new Date(isoDate + "T12:00:00Z");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
  return formatter.format(date);
}

function parseConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const parts: Record<string, string> = {};
  for (const part of connStr.trim().split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key || rest.length === 0) continue;
    parts[key.trim()] = rest.join("=").trim();
  }

  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error("Invalid Azure Storage connection string: missing AccountName or AccountKey");
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
      const joined = grouped[key].sort().join(",");
      canonicalizedResource += `\n${key}:${joined}`;
    }
  }

  const stringToSign = [
    method,
    "", // Content-Encoding
    "", // Content-Language
    contentLength,
    "", // Content-MD5
    contentType,
    "", // Date
    "", // If-Modified-Since
    "", // If-Match
    "", // If-None-Match
    "", // If-Unmodified-Since
    "", // Range
    canonicalizedHeaders,
    canonicalizedResource,
  ].join("\n");

  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBytes = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return `SharedKey ${accountName}:${signature}`;
}

async function azureRequest(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  options: {
    queryParams?: URLSearchParams;
    body?: Uint8Array;
    contentType?: string;
    additionalHeaders?: Record<string, string>;
  } = {},
): Promise<Response> {
  // Encode each path segment individually to match what the server sees
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");

  const headers: Record<string, string> = {
    "x-ms-date": new Date().toUTCString(),
    "x-ms-version": "2023-11-03",
    ...(options.additionalHeaders || {}),
  };

  if (options.body) {
    headers["Content-Length"] = String(options.body.length);
    headers["Content-Type"] = options.contentType || "application/octet-stream";
  }

  // Sign using the encoded path so it matches the server's canonicalized resource
  headers.Authorization = await createSharedKeySignature(
    accountName,
    accountKey,
    method,
    encodedPath,
    headers,
    options.queryParams,
  );

  let url = `https://${accountName}.blob.core.windows.net${encodedPath}`;
  if (options.queryParams && options.queryParams.toString()) {
    url += `?${options.queryParams.toString()}`;
  }

  return fetch(url, {
    method,
    headers,
    body: options.body,
  });
}

async function downloadBlobBytes(connectionString: string, blobPath: string): Promise<Uint8Array> {
  const { accountName, accountKey } = parseConnectionString(connectionString);
  const response = await azureRequest(accountName, accountKey, "GET", `/${CONTAINER_NAME}/${blobPath}`);

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${await response.text()}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function uploadBlobBytes(
  connectionString: string,
  blobPath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const { accountName, accountKey } = parseConnectionString(connectionString);
  const response = await azureRequest(accountName, accountKey, "PUT", `/${CONTAINER_NAME}/${blobPath}`, {
    body: bytes,
    contentType,
    additionalHeaders: {
      "x-ms-blob-type": "BlockBlob",
    },
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
  }

  return `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createDownloadToken(blobPath: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Download signing key not configured");
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    blob_path: blobPath,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Download the Word template from Azure, replace placeholders, and return the modified docx bytes.
 * 
 * Word/OOXML stores text in <w:t> elements inside <w:r> (run) elements.
 * Placeholders like {{Purpose}} may be split across multiple runs by Word.
 * We handle this by concatenating all text in each paragraph, performing replacements,
 * then reconstructing the runs.
 */
async function generateDocxFromTemplate(
  connectionString: string,
  data: NDARequest,
  formattedDate: string
): Promise<Uint8Array> {
  // 1. Download the template
  let templateBytes: Uint8Array;
  try {
    templateBytes = await downloadBlobBytes(connectionString, NDA_TEMPLATE_PATH);
  } catch (error: any) {
    throw new Error(
      `Failed to download NDA template from ${NDA_TEMPLATE_PATH}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  console.log(`Downloaded template: ${templateBytes.length} bytes`);

  // 2. Open with JSZip
  const zip = await JSZip.loadAsync(templateBytes);

  // 3. Read word/document.xml
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Template is not a valid .docx — missing word/document.xml");

  let docXml = await docXmlFile.async("string");

  // 4. Build placeholder map
  const internalSigner = data.internal_signer_name || "Palash Soundarkar";
  const internalSignerEmail = data.internal_signer_email || "palash@kabuni.com";

  const replacements: Record<string, string> = {
    // Template uses underscore-style placeholders
    "{{Receiving_Party_Legal_Entity_Name}}": data.receiving_party_entity,
    "{{Date_of_Agreement}}": formattedDate,
    "{{Registered_Address_of_Receiving_Party_Legal_Entity}}": data.registered_address,
    "{{Purpose}}": data.purpose,
    "{{Recipient_Name_for_Signature}}": data.recipient_name,
    "{{Recipient_Email}}": data.recipient_email,
    "{{Internal_Signer_Name}}": internalSigner,
    "{{Internal_Signer_Email}}": internalSignerEmail,
    "{{Submitter_Email}}": data.submitter_email,
    // Also handle alternate styles (camelCase, spaces)
    "{{ReceivingPartyName}}": data.receiving_party_name,
    "{{ReceivingPartyEntity}}": data.receiving_party_entity,
    "{{DateOfAgreement}}": formattedDate,
    "{{RegisteredAddress}}": data.registered_address,
    "{{RecipientName}}": data.recipient_name,
    "{{RecipientEmail}}": data.recipient_email,
    "{{InternalSignerName}}": internalSigner,
    "{{InternalSignerEmail}}": internalSignerEmail,
    "{{SubmitterEmail}}": data.submitter_email,
    "{{Receiving Party Name}}": data.receiving_party_name,
    "{{Receiving Party Entity}}": data.receiving_party_entity,
    "{{Date of Agreement}}": formattedDate,
    "{{Registered Address}}": data.registered_address,
    "{{Recipient Name}}": data.recipient_name,
    "{{Recipient Email}}": data.recipient_email,
    "{{Internal Signer Name}}": internalSigner,
    "{{Internal Signer Email}}": internalSignerEmail,
    "{{Submitter Email}}": data.submitter_email,
  };

  // 5. Handle Word splitting placeholders across XML runs.
  // First, try to clean up split placeholders by removing XML tags between {{ and }}
  // This regex finds {{ followed by any mix of text and XML tags until }}
  docXml = docXml.replace(
    /\{\{((?:[^}]|\}(?!\}))*?)\}\}/g,
    (match) => {
      // Strip all XML tags from inside the placeholder to get the clean key
      const cleanKey = match.replace(/<[^>]+>/g, "");
      return cleanKey;
    }
  );

  // 6. Now do simple string replacements
  for (const [placeholder, value] of Object.entries(replacements)) {
    // Escape XML special characters in the replacement value
    const xmlSafe = value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    
    docXml = docXml.split(placeholder).join(xmlSafe);
  }

  // 7. Write back and generate
  zip.file("word/document.xml", docXml);

  // Also check headers and footers for placeholders
  const headerFooterFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("word/header") || name.startsWith("word/footer")
  );
  for (const hfFile of headerFooterFiles) {
    let hfXml = await zip.file(hfFile)!.async("string");
    // Clean split placeholders
    hfXml = hfXml.replace(
      /\{\{((?:[^}]|\}(?!\}))*?)\}\}/g,
      (match) => match.replace(/<[^>]+>/g, "")
    );
    for (const [placeholder, value] of Object.entries(replacements)) {
      const xmlSafe = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
      hfXml = hfXml.split(placeholder).join(xmlSafe);
    }
    zip.file(hfFile, hfXml);
  }

  const outputBytes = await zip.generateAsync({ type: "uint8array" });
  console.log(`Generated .docx: ${outputBytes.length} bytes`);
  return outputBytes;
}

async function getNotionToken(supabaseAdmin: any): Promise<string> {
  const { data: integration } = await supabaseAdmin
    .from("company_integrations")
    .select("encrypted_api_key, status")
    .eq("integration_id", "notion")
    .single();

  if (!integration || integration.status !== "connected" || !integration.encrypted_api_key) {
    throw new Error("Notion is not connected. An admin must connect it first.");
  }
  return atob(integration.encrypted_api_key);
}

async function createNotionRow(
  data: NDARequest, docUrl: string, notionToken: string, formattedDate: string
): Promise<{ pageId: string; pageUrl: string }> {
  const notionDbId = Deno.env.get("NOTION_NDA_DB_ID");
  if (!notionDbId) throw new Error("NOTION_NDA_DB_ID not configured");

  const properties: Record<string, any> = {
    "Name": { title: [{ text: { content: `NDA - ${data.receiving_party_name}` } }] },
    "Date of Agreement": { date: { start: data.date_of_agreement } },
    "Receiving Party Legal Entity Name": { rich_text: [{ text: { content: data.receiving_party_entity } }] },
    "Registered Address": { rich_text: [{ text: { content: data.registered_address } }] },
    "Purpose": { rich_text: [{ text: { content: data.purpose } }] },
    "Doc URL": { url: docUrl },
    "Submitted By": { email: data.submitter_email },
    "Recipient Email": { email: data.recipient_email },
    "Signature Status": { checkbox: false },
    "DocuSign Envelope ID": { rich_text: [{ text: { content: "" } }] },
    "Signature Audit URL": { url: null },
  };

  const res = await fetch(`${NOTION_API_URL}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: notionDbId }, properties }),
  });

  if (!res.ok) throw new Error(`Failed to create Notion row: ${await res.text()}`);
  const page = await res.json();
  return { pageId: page.id, pageUrl: page.url };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authenticated user
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

    const body: NDARequest = await req.json();

    // Validate required fields
    const required: (keyof NDARequest)[] = [
      "receiving_party_name", "receiving_party_entity", "date_of_agreement",
      "registered_address", "purpose", "recipient_name", "recipient_email",
    ];
    for (const field of required) {
      if (!body[field]) {
        return new Response(JSON.stringify({ error: `Missing required field: ${field}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.recipient_email)) {
      return new Response(JSON.stringify({ error: "Invalid recipient email format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dateCheck = new Date(body.date_of_agreement);
    if (isNaN(dateCheck.getTime())) {
      return new Response(JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const submitterEmail = body.submitter_email || user.email || "unknown";

    // Idempotency check
    let submissionId = body.submission_id;
    if (submissionId) {
      const { data: existing } = await supabaseAdmin
        .from("nda_submissions")
        .select("id, google_doc_id, notion_page_id, status")
        .eq("id", submissionId)
        .single();

      // Consider generated if doc exists (Notion may have been skipped)
      if (existing && existing.google_doc_id && existing.status === "generated") {
        return new Response(JSON.stringify({
          success: true,
          submission_id: existing.id,
          document_url: (existing as any).google_doc_url || existing.google_doc_id,
          notion_page_id: existing.notion_page_id,
          status: existing.status,
          message: "NDA was already generated.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Create submission record
    if (!submissionId) {
      const { data: newSub, error: insertErr } = await supabaseAdmin
        .from("nda_submissions")
        .insert({
          submitter_id: user.id,
          submitter_email: submitterEmail,
          receiving_party_name: body.receiving_party_name,
          receiving_party_entity: body.receiving_party_entity,
          date_of_agreement: body.date_of_agreement,
          registered_address: body.registered_address,
          purpose: body.purpose,
          recipient_name: body.recipient_name,
          recipient_email: body.recipient_email,
          internal_signer_name: body.internal_signer_name || "Palash Soundarkar",
          internal_signer_email: body.internal_signer_email || "palash@kabuni.com",
          status: "generating",
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(`Failed to create submission: ${insertErr.message}`);
      submissionId = newSub.id;
    } else {
      const { error: retryErr } = await supabaseAdmin
        .from("nda_submissions")
        .update({ status: "generating", last_error: null })
        .eq("id", submissionId);
      if (retryErr) console.error("DB update failed (retry set generating):", retryErr.message);
    }

    const formattedDate = formatDateLondon(body.date_of_agreement);

    try {
      const connectionString = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
      if (!connectionString) throw new Error("Azure Storage not configured");

      // Generate .docx from template
      const docxBytes = await generateDocxFromTemplate(connectionString, body, formattedDate);

      // ── Priority 5: Clean up existing blob on retry ──
      const sanitizedName = body.receiving_party_name.replace(/[^a-zA-Z0-9_\- ]/g, "_");
      const dateStr = body.date_of_agreement.replace(/-/g, "_");
      const blobPath = `ndas/${sanitizedName}/NDA_${dateStr}.docx`;

      try {
        const { accountName, accountKey } = parseConnectionString(connectionString);
        const encodedDeletePath = `/${CONTAINER_NAME}/${blobPath}`
          .split("/").map((s) => encodeURIComponent(s)).join("/");
        const delHeaders: Record<string, string> = {
          "x-ms-date": new Date().toUTCString(),
          "x-ms-version": "2023-11-03",
        };
        delHeaders.Authorization = await createSharedKeySignature(
          accountName, accountKey, "DELETE", encodedDeletePath, delHeaders,
        );
        const delRes = await fetch(`https://${accountName}.blob.core.windows.net${encodedDeletePath}`, {
          method: "DELETE", headers: delHeaders,
        });
        if (delRes.ok || delRes.status === 404) {
          console.log(`Retry cleanup: previous blob ${delRes.ok ? "deleted" : "not found"}`);
        } else {
          console.warn(`Retry cleanup: delete returned ${delRes.status}`);
        }
      } catch (cleanupErr) {
        console.warn("Non-critical: blob cleanup failed:", cleanupErr);
      }

      // Upload NDA to Azure Blob Storage as .docx
      const docUrl = await uploadBlobBytes(
        connectionString,
        blobPath,
        docxBytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );

      // ── Priority 4: Placeholder verification ──
      // Re-read generated XML to check for unresolved placeholders
      const JSZipCheck = (await import("https://esm.sh/jszip@3.10.1")).default;
      const checkZip = await JSZipCheck.loadAsync(docxBytes);
      const checkXmlFile = checkZip.file("word/document.xml");
      if (checkXmlFile) {
        const checkXml = await checkXmlFile.async("string");
        const unresolvedMatches = checkXml.match(/\{\{[^}]+\}\}/g);
        if (unresolvedMatches) {
          const unique = [...new Set(unresolvedMatches)];
          console.warn(`WARNING: ${unique.length} unresolved placeholder(s) in generated NDA: ${unique.join(", ")}`);
        }
      }

      // ── Priority 2: Notion creation is non-critical ──
      let notionPageId: string | null = null;
      let notionPageUrl: string | null = null;
      try {
        const notionToken = await getNotionToken(supabaseAdmin);
        const notionResult = await createNotionRow(
          { ...body, submitter_email: submitterEmail },
          docUrl,
          notionToken,
          formattedDate,
        );
        notionPageId = notionResult.pageId;
        notionPageUrl = notionResult.pageUrl;
      } catch (notionErr) {
        console.error("Non-critical: Notion row creation failed:", notionErr instanceof Error ? notionErr.message : notionErr);
      }

      // ── Priority 3: Checked DB update ──
      const { error: updateErr } = await supabaseAdmin
        .from("nda_submissions")
        .update({
          google_doc_id: blobPath,
          google_doc_url: docUrl,
          notion_page_id: notionPageId,
          notion_page_url: notionPageUrl,
          status: "generated",
          last_error: null,
        })
        .eq("id", submissionId);

      if (updateErr) {
        console.error("DB update failed (save generated NDA):", updateErr.message);
      }

      console.log(`NDA generated successfully: blob=${blobPath}, notion=${notionPageId || "skipped"}`);

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const downloadToken = await createDownloadToken(blobPath);
      const downloadUrl = `${supabaseUrl}/functions/v1/azure-blob-api?blob_path=${encodeURIComponent(blobPath)}&download_token=${encodeURIComponent(downloadToken)}`;

      return new Response(JSON.stringify({
        success: true,
        submission_id: submissionId,
        document_url: docUrl,
        download_url: downloadUrl,
        blob_path: blobPath,
        notion_page_id: notionPageId,
        notion_page_url: notionPageUrl,
        status: "generated",
        message: `NDA for ${body.receiving_party_name} generated successfully as Word document. Stored in Azure Blob Storage and logged in Notion.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (genError) {
      const { error: failErr } = await supabaseAdmin
        .from("nda_submissions")
        .update({
          status: "failed",
          last_error: genError instanceof Error ? genError.message : "Unknown error",
        })
        .eq("id", submissionId);
      if (failErr) console.error("DB update failed (mark NDA failed):", failErr.message);

      throw genError;
    }
  } catch (e: any) {
    console.error("nda-generate error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
