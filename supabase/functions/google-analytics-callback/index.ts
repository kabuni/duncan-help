import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANALYTICS_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

async function fetchFirstProperty(accessToken: string) {
  const accountsResponse = await fetch(`${ANALYTICS_ADMIN_API}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!accountsResponse.ok) return null;
  const accounts = await accountsResponse.json();
  const firstAccount = accounts.accounts?.[0];
  if (!firstAccount?.name) return null;

  const propertiesResponse = await fetch(`${ANALYTICS_ADMIN_API}/properties?filter=parent:${firstAccount.name}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!propertiesResponse.ok) return { account_id: firstAccount.name.replace("accounts/", "") };
  const properties = await propertiesResponse.json();
  const firstProperty = properties.properties?.[0];

  return {
    account_id: firstAccount.name.replace("accounts/", ""),
    property_id: firstProperty?.name?.replace("properties/", null),
    property_name: firstProperty?.displayName ?? null,
  };
}

serve(async (req) => {
  const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) return Response.redirect(`${appUrl}/operations?ga_error=${encodeURIComponent(oauthError)}`);
    if (!code || !state) return Response.redirect(`${appUrl}/operations?ga_error=missing_params`);

    const clientId = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_ANALYTICS_CLIENT_SECRET") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GMAIL_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!clientId || !clientSecret) return Response.redirect(`${appUrl}/operations?ga_error=config_error`);

    let userId: string;
    try {
      userId = JSON.parse(atob(state)).user_id;
    } catch {
      return Response.redirect(`${appUrl}/operations?ga_error=invalid_state`);
    }
    if (!userId) return Response.redirect(`${appUrl}/operations?ga_error=invalid_state`);

    const redirectUri = `${supabaseUrl}/functions/v1/google-analytics-callback`;
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
      console.error("Google Analytics token exchange failed:", await tokenResponse.text());
      return Response.redirect(`${appUrl}/operations?ga_error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const property = await fetchFirstProperty(tokens.access_token);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { error: upsertError } = await supabaseAdmin.from("google_analytics_tokens").upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: expiryDate,
      account_id: property?.account_id ?? null,
      property_id: property?.property_id ?? null,
      property_name: property?.property_name ?? null,
    }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("Failed to store Google Analytics token:", upsertError);
      return Response.redirect(`${appUrl}/operations?ga_error=storage_failed`);
    }

    return Response.redirect(`${appUrl}/operations?ga_success=google_analytics`);
  } catch (error) {
    console.error("Google Analytics callback error:", error);
    return Response.redirect(`${appUrl}/operations?ga_error=unexpected`);
  }
});
