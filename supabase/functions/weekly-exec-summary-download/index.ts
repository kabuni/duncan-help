// Public, token-validated download endpoint for the weekly executive summary.
// Validates ?run_id + ?token against exec_summary_runs, then streams the DOCX
// directly from Azure Blob Storage using SharedKey HMAC (no end-user JWT needed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseConnString(s: string) {
  const map = Object.fromEntries(s.split(";").filter(Boolean).map((p) => {
    const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)];
  }));
  return { accountName: map["AccountName"], accountKey: map["AccountKey"] };
}

async function sign(method: string, path: string, accountName: string, accountKey: string) {
  const date = new Date().toUTCString();
  const h: Record<string, string> = { "x-ms-date": date, "x-ms-version": "2021-12-02" };
  const canonHeaders = Object.keys(h).sort().map((k) => `${k.toLowerCase()}:${h[k]}`).join("\n");
  const canonResource = `/${accountName}${path}`;
  const stringToSign = ["", "", "", "", "", "", "", "", "", "", "", ""].join("\n");
  const toSign = method + "\n" + stringToSign + "\n" + canonHeaders + "\n" + canonResource;
  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(toSign));
  const sig = encodeBase64(new Uint8Array(sigBuf));
  return { headers: { ...h, Authorization: `SharedKey ${accountName}:${sig}` } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("run_id");
    const token = url.searchParams.get("token");
    if (!runId || !token) {
      return new Response("Missing run_id or token", { status: 400, headers: corsHeaders });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: run } = await admin
      .from("exec_summary_runs")
      .select("id,download_token,blob_path,file_name,status")
      .eq("id", runId)
      .maybeSingle();

    if (!run || !run.download_token || run.download_token !== token || !run.blob_path) {
      return new Response("Invalid or expired link", { status: 403, headers: corsHeaders });
    }
    if (run.status !== "succeeded") {
      return new Response("This summary is not ready", { status: 409, headers: corsHeaders });
    }

    const connStr = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
    const container = Deno.env.get("AZURE_STORAGE_CONTAINER") || "duncan";
    if (!connStr) return new Response("Storage misconfigured", { status: 500, headers: corsHeaders });
    const { accountName, accountKey } = parseConnString(connStr);

    const encodedPath = run.blob_path.split("/").map(encodeURIComponent).join("/");
    const resourcePath = `/${container}/${encodedPath}`;
    const { headers } = await sign("GET", resourcePath, accountName, accountKey);

    const azureRes = await fetch(`https://${accountName}.blob.core.windows.net${resourcePath}`, {
      method: "GET", headers,
    });
    if (!azureRes.ok) {
      const body = await azureRes.text();
      console.error("Azure blob fetch failed:", azureRes.status, body);
      return new Response("Could not retrieve summary", { status: 502, headers: corsHeaders });
    }

    const fileName = run.file_name || "executive-summary.docx";
    return new Response(azureRes.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    console.error("Download error:", e);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});
