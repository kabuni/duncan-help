// Public, token-validated download endpoint for the weekly executive summary.
// Validates ?run_id + ?token against exec_summary_runs, then streams the DOCX
// directly from Azure Blob Storage using SharedKey HMAC (no end-user JWT needed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

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

function sign(method: string, path: string, accountName: string, accountKey: string, headers: Record<string,string>) {
  const date = new Date().toUTCString();
  const h = {
    "x-ms-date": date,
    "x-ms-version": "2021-12-02",
    ...headers,
  };
  const canonHeaders = Object.keys(h).filter((k) => k.startsWith("x-ms-"))
    .sort().map((k) => `${k.toLowerCase()}:${h[k]}`).join("\n");
  const canonResource = `/${accountName}${path}`;
  const stringToSign = [
    method, "", "", "", "", "", "", "", "", "", "", "",
    canonHeaders, canonResource,
  ].join("\n");
  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const sig = hmac("sha256", keyBytes, stringToSign, "utf8", "base64");
  return {
    headers: { ...h, Authorization: `SharedKey ${accountName}:${sig}` },
  };
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
    const { headers } = sign("GET", resourcePath, accountName, accountKey, {});

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
