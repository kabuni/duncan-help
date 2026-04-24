import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    const appUrl = Deno.env.get("APP_URL") || "https://duncan-help.lovable.app";

    if (error || !code) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=${error || "no_code"}` },
      });
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID")!;
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const redirectUri = `${supabaseUrl}/functions/v1/xero-callback`;

    // Exchange code for tokens
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const tokenResponse = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Xero token exchange failed:", errText);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=token_exchange_failed` },
      });
    }

    const tokens = await tokenResponse.json();
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    // Get Xero tenant ID from connections endpoint
    let tenantId = null;
    try {
      const connectionsRes = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (connectionsRes.ok) {
        const connections = await connectionsRes.json();
        if (connections.length > 0) {
          tenantId = connections[0].tenantId;
        }
      }
    } catch (e: any) {
      console.warn("Failed to get Xero tenant ID:", e);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Clear existing and insert new tokens
    await supabaseAdmin.from("xero_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error: insertError } = await supabaseAdmin.from("xero_tokens").insert({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: expiry.toISOString(),
      tenant_id: tenantId,
      connected_by: "00000000-0000-0000-0000-000000000001",
    });

    if (insertError) {
      console.error("Failed to store Xero tokens:", insertError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?error=storage_failed` },
      });
    }

    // Update company_integrations
    await supabaseAdmin.from("company_integrations").upsert(
      { integration_id: "xero", status: "connected", last_sync: new Date().toISOString() },
      { onConflict: "integration_id" }
    );

    // Audit log
    await supabaseAdmin.from("integration_audit_logs").insert({
      integration: "xero",
      action: "oauth_connected",
      details: { tenant_id: tenantId },
    });

    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?success=xero` },
    });
  } catch (error: any) {
    console.error("Xero callback error:", error);
    const appUrl = Deno.env.get("APP_URL") || "https://duncan-help.lovable.app";
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?error=unexpected` },
    });
  }
});
