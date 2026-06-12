import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const getAppUrl = () => {
  const raw = (Deno.env.get("APP_URL") || "https://duncan.help").trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
};

serve(async (req) => {
  const appUrl = getAppUrl();
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error || !code) {
      return Response.redirect(`${appUrl}/settings?workspace_admin_error=${error || "no_code"}`, 302);
    }

    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const redirectUri = `${supabaseUrl}/functions/v1/workspace-admin-callback`;

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
      console.error("Token exchange failed:", await tokenRes.text());
      return Response.redirect(`${appUrl}/settings?workspace_admin_error=token_exchange`, 302);
    }
    const tokens = await tokenRes.json();
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileRes.ok) {
      return Response.redirect(`${appUrl}/settings?workspace_admin_error=userinfo`, 302);
    }
    const profile = await profileRes.json();
    const email = (profile.email || "").toLowerCase();
    if (!email) {
      return Response.redirect(`${appUrl}/settings?workspace_admin_error=no_email`, 302);
    }

    // Verify this account is actually a Super Admin by trying to list 1 user
    const verifyRes = await fetch(
      "https://admin.googleapis.com/admin/directory/v1/users?customer=my_customer&maxResults=1",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!verifyRes.ok) {
      const errBody = await verifyRes.text();
      console.error("Directory verify failed:", errBody);
      return Response.redirect(`${appUrl}/settings?workspace_admin_error=not_super_admin`, 302);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("workspace_admin_tokens").upsert(
      {
        google_account_email: email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: expiry.toISOString(),
        scopes: tokens.scope ?? null,
        last_poll_status: null,
        last_poll_error: null,
      },
      { onConflict: "google_account_email" },
    );

    // Clear any other rows (we only keep one Super Admin connection)
    await admin
      .from("workspace_admin_tokens")
      .delete()
      .neq("google_account_email", email);

    return Response.redirect(`${appUrl}/settings?workspace_admin_connected=true`, 302);
  } catch (e: any) {
    console.error("workspace-admin-callback error:", e);
    return Response.redirect(`${appUrl}/settings?workspace_admin_error=server`, 302);
  }
});
