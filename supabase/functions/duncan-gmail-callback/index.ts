import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const redirectBack = (status: string, reason?: string) => {
    const qs = new URLSearchParams({ duncan_gmail: status });
    if (reason) qs.set("reason", reason);
    return Response.redirect(`${APP_URL}/integrations?${qs.toString()}`, 302);
  };

  if (errorParam) return redirectBack("error", errorParam);
  if (!code || !stateRaw) return redirectBack("error", "missing_code");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const redirectUri = `${supabaseUrl}/functions/v1/duncan-gmail-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      throw new Error(`token exchange failed: ${t}`);
    }
    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token as string;
    const refreshToken = tokens.refresh_token as string | undefined;
    const expiresIn = tokens.expires_in as number;
    const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    const scopes = (tokens.scope as string) || null;

    if (!refreshToken) {
      // Google omits refresh_token if user previously consented without revoking.
      return redirectBack("error", "no_refresh_token_revoke_and_retry");
    }

    // Fetch the Google account email
    let email: string | null = null;
    try {
      const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (ui.ok) {
        const j = await ui.json();
        email = j.email || null;
      }
    } catch (_e) { /* ignore */ }

    if (!email) throw new Error("Could not read Google account email");

    const supaAdmin = createClient(supabaseUrl, serviceKey);

    // Singleton row
    await supaAdmin.from("duncan_gmail_tokens").delete().not("id", "is", null);

    const { error: insErr } = await supaAdmin.from("duncan_gmail_tokens").insert({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expiry: expiry,
      google_account_email: email,
      scopes,
    });
    if (insErr) throw insErr;

    return redirectBack("connected");
  } catch (err: any) {
    console.error("duncan-gmail-callback error", err);
    return redirectBack("error", err.message || "callback_failed");
  }
});
