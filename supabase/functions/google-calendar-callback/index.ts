import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Get the origin for redirects - use the referring app URL
    const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";

    if (error) {
      console.error("OAuth error from Google:", error);
      return Response.redirect(`${appUrl}/integrations?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      console.error("Missing code or state");
      return Response.redirect(`${appUrl}/integrations?error=missing_params`);
    }

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!clientId || !clientSecret) {
      console.error("Missing Google Calendar credentials");
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
    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`;
    
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Token exchange failed:", errorText);
      return Response.redirect(`${appUrl}/integrations?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    console.log("Successfully exchanged code for tokens");

    // Calculate token expiry
    const expiryDate = new Date(Date.now() + (tokens.expires_in * 1000));

    // Store tokens using service role
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { error: upsertError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .upsert(
        {
          user_id: user.id,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: expiryDate.toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertError) {
      console.error("Failed to store tokens:", upsertError);
      return Response.redirect(`${appUrl}/integrations?error=storage_failed`);
    }

    console.log("Successfully stored Google Calendar tokens for user:", user.id);
    return Response.redirect(`${appUrl}/integrations?success=google_calendar`);
  } catch (error: any) {
    console.error("Callback error:", error);
    const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    return Response.redirect(`${appUrl}/integrations?error=unexpected`);
  }
});
