import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
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

    const account = Deno.env.get("AZURE_STORAGE_ACCOUNT");
    const container = Deno.env.get("AZURE_STORAGE_CONTAINER");
    const sas = Deno.env.get("AZURE_STORAGE_SAS_TOKEN");
    if (!account || !container || !sas) {
      return new Response(JSON.stringify({ error: "Azure storage not configured. Set AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_CONTAINER, AZURE_STORAGE_SAS_TOKEN." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeName = sanitize(filename);
    const blobPath = scope === "public"
      ? `public/${document_id}/${safeName}`
      : `private/${user_id}/${document_id}/${safeName}`;

    // Decode base64 → bytes
    const bin = atob(file_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const sasClean = sas.startsWith("?") ? sas.slice(1) : sas;
    const encodedPath = blobPath.split("/").map(encodeURIComponent).join("/");
    const url = `https://${account}.blob.core.windows.net/${container}/${encodedPath}?${sasClean}`;

    const putRes = await fetch(url, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    });

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
