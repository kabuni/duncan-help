import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_APP_URL = "https://duncan-help.lovable.app";

function getAppUrl() {
  const rawAppUrl = (Deno.env.get("APP_URL") || "").trim();
  if (!rawAppUrl) return DEFAULT_APP_URL;

  const normalized = rawAppUrl.startsWith("http://") || rawAppUrl.startsWith("https://")
    ? rawAppUrl
    : `https://${rawAppUrl}`;

  try {
    const parsed = new URL(normalized);
    if (parsed.hostname.endsWith("supabase.co")) return DEFAULT_APP_URL;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return DEFAULT_APP_URL;
  }
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    console.log("Azure DevOps callback params:", { 
      hasCode: !!code, 
      error, 
      errorDescription,
      fullUrl: req.url 
    });

    const appUrl = getAppUrl();

    if (error || !code) {
      console.error("Azure DevOps OAuth error:", { error, errorDescription });
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=${error || "no_code"}&error_description=${encodeURIComponent(errorDescription || "")}` },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const orgUrl = Deno.env.get("AZURE_DEVOPS_ORG_URL") || "";
    const clientId = Deno.env.get("AZURE_DEVOPS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("AZURE_DEVOPS_CLIENT_SECRET")!;
    const redirectUri = `${supabaseUrl}/functions/v1/azure-devops-callback/`;
    console.log("Token exchange config:", { clientId, redirectUri, orgUrl, hasSecret: !!clientSecret });

    // Exchange code for tokens
    const tenantId = Deno.env.get("AZURE_TENANT_ID") || "53e795b0-6f86-4e93-b619-32b5f5850f07";
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access",
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Token exchange failed:", errText);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=token_exchange_failed` },
      });
    }

    const tokens = await tokenResponse.json();
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Clear existing tokens and insert new
    await supabaseAdmin.from("azure_devops_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error: insertError } = await supabaseAdmin.from("azure_devops_tokens").insert({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || "",
      token_expiry: expiry.toISOString(),
      org_url: orgUrl,
      connected_by: "00000000-0000-0000-0000-000000000001",
    });

    if (insertError) {
      console.error("Failed to store Azure DevOps tokens:", insertError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=storage_failed` },
      });
    }

    // Update company_integrations status
    await supabaseAdmin.from("company_integrations").upsert(
      {
        integration_id: "azure-devops",
        status: "connected",
        last_sync: new Date().toISOString(),
      },
      { onConflict: "integration_id" }
    );

    // Log audit
    await supabaseAdmin.from("integration_audit_logs").insert({
      integration: "azure-devops",
      action: "oauth_connected",
      details: { org_url: orgUrl },
    });

    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?success=azure_devops` },
    });
  } catch (error: any) {
    console.error("Azure DevOps callback error:", error);
    const appUrl = getAppUrl();
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?error=unexpected` },
    });
  }
});
