import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function parseConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const parts: Record<string, string> = {};
  for (const part of connStr.trim().split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) throw new Error("Invalid Azure Storage connection string");
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

async function sharedKeyAuth(
  accountName: string,
  accountKey: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  contentLength: number,
  contentType: string,
): Promise<string> {
  const canonicalizedHeaders = Object.keys(headers)
    .filter((k) => k.toLowerCase().startsWith("x-ms-"))
    .sort()
    .map((k) => `${k.toLowerCase()}:${headers[k]}`)
    .join("\n");
  const stringToSign = [
    method,
    "", // Content-Encoding
    "", // Content-Language
    String(contentLength), // Content-Length
    "", // Content-MD5
    contentType, // Content-Type
    "", "", "", "", "", "",
    canonicalizedHeaders,
    `/${accountName}${path}`,
  ].join("\n");
  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  return `SharedKey ${accountName}:${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file_base64, document_id, user_id, scope, filename } = await req.json();
    if (!file_base64 || !document_id || !user_id || !scope || !filename) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (scope !== "public" && scope !== "private") {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const container = Deno.env.get("AZURE_STORAGE_CONTAINER");
    const connStr = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
    const accountEnv = Deno.env.get("AZURE_STORAGE_ACCOUNT");
    const sas = Deno.env.get("AZURE_STORAGE_SAS_TOKEN");

    if (!container || (!connStr && !sas)) {
      return new Response(JSON.stringify({ error: "Azure storage not configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = sanitize(filename);
    const blobPath = scope === "public"
      ? `public/${document_id}/${safeName}`
      : `private/${user_id}/${document_id}/${safeName}`;

    const bin = atob(file_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
    const contentType = "application/octet-stream";

    let url: string;
    let putHeaders: Record<string, string>;
    let account: string;

    if (connStr) {
      const parsed = parseConnectionString(connStr);
      account = parsed.accountName;
      const path = `/${container}/${encodedPath}`;
      const baseHeaders: Record<string, string> = {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-date": new Date().toUTCString(),
        "x-ms-version": "2023-11-03",
      };
      const auth = await sharedKeyAuth(parsed.accountName, parsed.accountKey, "PUT", path, baseHeaders, bytes.length, contentType);
      putHeaders = {
        ...baseHeaders,
        Authorization: auth,
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
      };
      url = `https://${account}.blob.core.windows.net${path}`;
    } else {
      account = accountEnv!;
      const sasClean = sas!.startsWith("?") ? sas!.slice(1) : sas!;
      url = `https://${account}.blob.core.windows.net/${container}/${encodedPath}?${sasClean}`;
      putHeaders = {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
      };
    }

    const putRes = await fetch(url, { method: "PUT", headers: putHeaders, body: bytes });

    if (!putRes.ok) {
      const txt = await putRes.text();
      console.error("Azure PUT failed", putRes.status, txt);
      return new Response(JSON.stringify({ error: `Azure upload failed: ${putRes.status}`, detail: txt }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blobUrl = `https://${account}.blob.core.windows.net/${container}/${encodedPath}`;
    return new Response(JSON.stringify({ blob_url: blobUrl, blob_path: blobPath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
