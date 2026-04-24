import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASECAMP_TOKEN_URL = "https://launchpad.37signals.com/authorization/token";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    let appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    if (!appUrl.startsWith("http")) appUrl = `https://${appUrl}`;

    if (error) {
      console.error("OAuth error from Basecamp:", error);
      return Response.redirect(`${appUrl}/integrations?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.error("Missing code or state");
      return Response.redirect(`${appUrl}/integrations?error=missing_params`);
    }

    const clientId = Deno.env.get("BASECAMP_CLIENT_ID");
    const clientSecret = Deno.env.get("BASECAMP_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!clientId || !clientSecret) {
      console.error("Missing Basecamp credentials");
      return Response.redirect(`${appUrl}/integrations?error=config_error`);
    }

    // Decode state to get user token
    let userToken: string;
    try {
      const decoded = JSON.parse(atob(state));
      userToken = decoded.token;
    } catch {
      console.error("Failed to decode state");
      return Response.redirect(`${appUrl}/integrations?error=invalid_state`);
    }

    // Verify the user
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("Failed to verify user:", userError);
      return Response.redirect(`${appUrl}/integrations?error=unauthorized`);
    }

    // Exchange code for tokens
    const redirectUri = `${supabaseUrl}/functions/v1/basecamp-callback`;

    const tokenResponse = await fetch(BASECAMP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "web_server",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(`${appUrl}/integrations?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    console.log("Successfully exchanged Basecamp code for tokens");

    // Basecamp tokens expire in 2 weeks
    const expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Fetch the user's Basecamp account ID
    let accountId: string | null = null;
    try {
      const authCheck = await fetch("https://launchpad.37signals.com/authorization.json", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (authCheck.ok) {
        const authData = await authCheck.json();
        // Get first Basecamp 4 (or 3) account
        const bcAccount = authData.accounts?.find(
          (a: any) => a.product === "bc3" || a.product === "bc4"
        );
        if (bcAccount) {
          accountId = String(bcAccount.id);
          console.log("Found Basecamp account:", accountId);
        }
      }
    } catch (e: any) {
      console.warn("Could not fetch Basecamp account ID:", e);
    }

    // Store tokens using service role (upsert — only one row needed)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Delete existing tokens and insert fresh
    await supabaseAdmin.from("basecamp_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error: insertError } = await supabaseAdmin
      .from("basecamp_tokens")
      .insert({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: expiryDate.toISOString(),
        connected_by: user.id,
        account_id: accountId,
      });

    if (insertError) {
      console.error("Failed to store tokens:", insertError);
      return Response.redirect(`${appUrl}/integrations?error=storage_failed`);
    }

    console.log("Successfully stored Basecamp tokens for user:", user.id);
    return Response.redirect(`${appUrl}/integrations?success=basecamp`);
  } catch (error: any) {
    console.error("Basecamp callback error:", error);
    let appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    if (!appUrl.startsWith("http")) appUrl = `https://${appUrl}`;
    return Response.redirect(`${appUrl}/integrations?error=unexpected`);
  }
});
