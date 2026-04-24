import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const getAppUrl = () => {
  const raw = (Deno.env.get("APP_URL") || "https://duncan-help.lovable.app").trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
};

serve(async (req) => {
  const appUrl = getAppUrl();

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const stateParam = url.searchParams.get("state");

    if (error || !code) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?gmail_error=${error || "no_code"}` },
      });
    }

    // Decode user_id from state
    let userId: string | null = null;
    if (stateParam) {
      try {
        const stateData = JSON.parse(atob(stateParam));
        userId = stateData.user_id;
      } catch {
        console.error("Failed to decode state parameter");
      }
    }

    if (!userId) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?gmail_error=invalid_state` },
      });
    }

    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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
      const errText = await tokenResponse.text();
      console.error("Token exchange failed:", errText);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?gmail_error=token_exchange_failed` },
      });
    }

    const tokens = await tokenResponse.json();
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    // Get the user's email address
    const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Check if first-time connect (for auto-training trigger)
    const { data: existingToken } = await supabaseAdmin
      .from("gmail_tokens")
      .select("id")
      .eq("connected_by", userId)
      .maybeSingle();
    const isFirstConnect = !existingToken;

    // Delete existing tokens for this user only
    await supabaseAdmin.from("gmail_tokens").delete().eq("connected_by", userId);

    const { error: insertError } = await supabaseAdmin.from("gmail_tokens").insert({
      connected_by: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: expiry.toISOString(),
      email_address: profile.emailAddress || null,
    });

    if (insertError) {
      console.error("Failed to store Gmail tokens:", insertError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?gmail_error=storage_failed` },
      });
    }

    const successUrl = isFirstConnect
      ? `${appUrl}/integrations?gmail_connected=true&gmail_first_connect=true`
      : `${appUrl}/integrations?gmail_connected=true`;
    return new Response(null, {
      status: 302,
      headers: { Location: successUrl },
    });
  } catch (error: any) {
    console.error("Gmail callback error:", error);
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?gmail_error=unknown` },
    });
  }
});
