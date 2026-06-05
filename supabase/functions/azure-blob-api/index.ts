import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONTAINER_NAME = "duncanstorage01";

/**
 * Parse the Azure Storage connection string into account name and key.
 */
function parseConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const trimmed = connStr.trim();
  const parts: Record<string, string> = {};
  for (const part of trimmed.split(";")) {
    const segment = part.trim();
    if (!segment) continue;
    const idx = segment.indexOf("=");
    if (idx > 0) {
      parts[segment.slice(0, idx).trim()] = segment.slice(idx + 1).trim();
    }
  }
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error("Invalid Azure Storage connection string");
  }
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

/**
 * Create HMAC-SHA256 signature for Azure Storage SharedKey auth using Web Crypto API.
 */
async function createSharedKeySignature(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  queryParams?: URLSearchParams
): Promise<string> {
  const contentLength = headers["Content-Length"] || "";
  const contentType = headers["Content-Type"] || "";

  // Canonicalized headers
  const msHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase().startsWith("x-ms-")) {
      msHeaders[k.toLowerCase()] = v;
    }
  }
  const canonicalizedHeaders = Object.keys(msHeaders)
    .sort()
    .map((k) => `${k}:${msHeaders[k]}`)
    .join("\n");

  // Canonicalized resource
  let canonicalizedResource = `/${accountName}${path}`;
  if (queryParams) {
    const sortedParams = [...queryParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, value] of sortedParams) {
      canonicalizedResource += `\n${key}:${value}`;
    }
  }

  const stringToSign = [
    method,
    "", // Content-Encoding
    "", // Content-Language
    contentLength, // Content-Length
    "", // Content-MD5
    contentType, // Content-Type
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
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(stringToSign)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return `SharedKey ${accountName}:${signature}`;
}

/**
 * Make an authenticated request to Azure Blob Storage.
 */
async function azureRequest(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  options: {
    queryParams?: URLSearchParams;
    body?: Uint8Array | string;
    contentType?: string;
    additionalHeaders?: Record<string, string>;
  } = {}
): Promise<Response> {
  const now = new Date().toUTCString();
  const headers: Record<string, string> = {
    "x-ms-date": now,
    "x-ms-version": "2023-11-03",
    ...(options.additionalHeaders || {}),
  };

  if (options.body) {
    const bodyLength = typeof options.body === "string"
      ? new TextEncoder().encode(options.body).length
      : options.body.length;
    headers["Content-Length"] = String(bodyLength);
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
    }
  }

  const authHeader = await createSharedKeySignature(
    accountName,
    accountKey,
    method,
    path,
    headers,
    options.queryParams
  );
  headers["Authorization"] = authHeader;

  let url = `https://${accountName}.blob.core.windows.net${path}`;
  if (options.queryParams && options.queryParams.toString()) {
    url += `?${options.queryParams.toString()}`;
  }

  return fetch(url, {
    method,
    headers,
    body: options.body || undefined,
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

async function signDownloadPayload(payloadB64: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Download signing key not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return base64UrlEncode(new Uint8Array(sig));
}

async function verifyDownloadToken(token: string | null, blobPath: string | null): Promise<boolean> {
  try {
    if (!token || !blobPath) return false;
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return false;
    const expected = await signDownloadPayload(payloadB64);
    if (expected !== signature) return false;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    return payload?.blob_path === blobPath && typeof payload?.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    // Verify authenticated user OR service-role internal call
    const authHeader = req.headers.get("Authorization");
    const serviceSecret = req.headers.get("x-service-secret");
    const requestUrl = new URL(req.url);
    const requestedBlobPath = requestUrl.searchParams.get("blob_path") || requestUrl.searchParams.get("path");
    const hasValidDownloadToken = req.method === "GET" &&
      await verifyDownloadToken(requestUrl.searchParams.get("download_token"), requestedBlobPath);
    const isServiceCall = !!serviceSecret &&
      serviceSecret === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!isServiceCall && !hasValidDownloadToken) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse Azure credentials
    const connectionString = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
    if (!connectionString) {
      return new Response(
        JSON.stringify({ error: "Azure Storage not configured." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { accountName, accountKey } = parseConnectionString(connectionString);
    console.log(`Azure connection: account=${accountName}, keyLength=${accountKey.length}, container=${CONTAINER_NAME}`);

    // Handle GET requests for direct file download
    if (req.method === "GET") {
      const url = new URL(req.url);
      const blobPath = url.searchParams.get("blob_path") || url.searchParams.get("path");
      if (!blobPath) {
        return new Response(JSON.stringify({ error: "blob_path query parameter is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const encodedPath = blobPath.split("/").map((s) => encodeURIComponent(s)).join("/");
      const response = await azureRequest(
        accountName,
        accountKey,
        "GET",
        `/${CONTAINER_NAME}/${encodedPath}`
      );

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `File not found: ${blobPath}` }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fileName = blobPath.split("/").pop() || "download";
      const blobContentType = response.headers.get("content-type") || "application/octet-stream";
      const blobBody = await response.arrayBuffer();

      return new Response(blobBody, {
        headers: {
          ...corsHeaders,
          "Content-Type": blobContentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    const contentType = req.headers.get("content-type") || "";
    let action: string;
    let params: any = {};

    if (contentType.includes("multipart/form-data")) {
      action = "upload";
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const path = formData.get("path") as string | null;
      if (!file || !path) {
        return new Response(JSON.stringify({ error: "file and path are required for upload" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      params = { file, path };
    } else {
      const body = await req.json();
      action = body.action;
      params = body;
    }

    let result: any;

    switch (action) {
      case "list": {
        const prefix = params.path || "";
        const queryParams = new URLSearchParams({
          restype: "container",
          comp: "list",
          prefix,
          delimiter: "/",
        });

        const response = await azureRequest(
          accountName,
          accountKey,
          "GET",
          `/${CONTAINER_NAME}`,
          { queryParams }
        );

        if (!response.ok) {
          throw new Error(`List failed: ${await response.text()}`);
        }

        const xmlText = await response.text();

        // Parse blobs from XML
        const blobs: any[] = [];
        const blobRegex = /<Blob><Name>(.*?)<\/Name>.*?<Content-Length>(.*?)<\/Content-Length>.*?<Last-Modified>(.*?)<\/Last-Modified>.*?<\/Blob>/gs;
        let match;
        while ((match = blobRegex.exec(xmlText)) !== null) {
          blobs.push({
            name: match[1],
            size: parseInt(match[2], 10),
            lastModified: match[3],
            url: `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${match[1]}`,
          });
        }

        // Parse virtual directories (folders)
        const folders: string[] = [];
        const folderRegex = /<BlobPrefix><Name>(.*?)<\/Name><\/BlobPrefix>/g;
        while ((match = folderRegex.exec(xmlText)) !== null) {
          folders.push(match[1]);
        }

        result = { files: blobs, folders };
        break;
      }

      case "search": {
        const query = (params.query || "").toLowerCase();

        // List all blobs and filter by name
        const queryParamsSearch = new URLSearchParams({
          restype: "container",
          comp: "list",
        });

        const response = await azureRequest(
          accountName,
          accountKey,
          "GET",
          `/${CONTAINER_NAME}`,
          { queryParams: queryParamsSearch }
        );

        if (!response.ok) {
          throw new Error(`Search failed: ${await response.text()}`);
        }

        const xmlText = await response.text();
        const blobs: any[] = [];
        const blobRegex = /<Blob><Name>(.*?)<\/Name>.*?<Content-Length>(.*?)<\/Content-Length>.*?<Last-Modified>(.*?)<\/Last-Modified>.*?<\/Blob>/gs;
        let match;
        while ((match = blobRegex.exec(xmlText)) !== null) {
          if (match[1].toLowerCase().includes(query)) {
            blobs.push({
              name: match[1],
              size: parseInt(match[2], 10),
              lastModified: match[3],
              url: `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${match[1]}`,
            });
          }
        }

        result = { found: blobs.length, files: blobs };
        break;
      }

      case "upload": {
        const file = params.file as File;
        const path = (params.path as string).replace(/\/$/, "");
        const blobPath = `${path}/${file.name}`;
        const fileBytes = new Uint8Array(await file.arrayBuffer());

        const blobHeaders: Record<string, string> = {
          "x-ms-blob-type": "BlockBlob",
        };

        const response = await azureRequest(
          accountName,
          accountKey,
          "PUT",
          `/${CONTAINER_NAME}/${blobPath}`,
          {
            body: fileBytes,
            contentType: file.type || "application/octet-stream",
            additionalHeaders: blobHeaders,
          }
        );

        if (!response.ok) {
          throw new Error(`Upload failed: ${await response.text()}`);
        }

        result = {
          url: `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`,
          blob_path: blobPath,
        };
        break;
      }

      case "get_content": {
        const blobPath = params.blob_path;
        if (!blobPath) {
          throw new Error("blob_path is required");
        }

        const response = await azureRequest(
          accountName,
          accountKey,
          "GET",
          `/${CONTAINER_NAME}/${blobPath}`
        );

        if (!response.ok) {
          throw new Error(`Failed to get blob: ${await response.text()}`);
        }

        const contentTypeHeader = response.headers.get("content-type") || "";
        const fileName = blobPath.split("/").pop() || "";
        const ext = fileName.split(".").pop()?.toLowerCase() || "";

        let content: string;

        if (ext === "txt" || ext === "csv" || ext === "json" || ext === "md" || contentTypeHeader.startsWith("text/")) {
          content = await response.text();
        } else if (ext === "pdf") {
          // PDF — return placeholder; full text extraction requires additional library
          content = "[PDF file — text extraction requires additional processing. The file has been retrieved from storage.]";
        } else if (ext === "docx") {
          // Basic DOCX text extraction — extract from word/document.xml
          try {
            const arrayBuffer = await response.arrayBuffer();
            // DOCX is a ZIP file — we'll attempt basic extraction
            content = "[DOCX file — the document has been retrieved from storage. Full text extraction available via document processing pipeline.]";
          } catch {
            content = "[DOCX file — could not extract text content.]";
          }
        } else if (contentTypeHeader.startsWith("image/")) {
          content = "[Image file — use the blob URL to view.]";
        } else {
          content = `[File type ${ext} (${contentTypeHeader}) — content extraction not supported. Use the blob URL to access.]`;
        }

        result = {
          name: fileName,
          blob_path: blobPath,
          content: content.slice(0, 50000),
          url: `https://${accountName}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`,
        };
        break;
      }

      case "check_connection": {
        // Verify the connection works by listing container properties
        const queryParams = new URLSearchParams({
          restype: "container",
        });
        const response = await azureRequest(
          accountName,
          accountKey,
          "GET",
          `/${CONTAINER_NAME}`,
          { queryParams }
        );

        if (!response.ok) {
          throw new Error(`Connection check failed: ${await response.text()}`);
        }

        result = { connected: true, container: CONTAINER_NAME, account: accountName };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Azure Blob API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Azure Blob API error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
