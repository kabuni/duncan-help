import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const getAppUrl = () => {
  const raw = (Deno.env.get("APP_URL") || "https://duncan-help.lovable.app").trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
};

Deno.serve(async (req) => {
  const appUrl = getAppUrl();

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const stateParam = url.searchParams.get("state");

    if (error || !code) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?drive_error=${error || "no_code"}` },
      });
    }

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
        headers: { Location: `${appUrl}/integrations?drive_error=invalid_state` },
      });
    }

    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const redirectUri = `${supabaseUrl}/functions/v1/google-drive-callback`;

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
        headers: { Location: `${appUrl}/integrations?drive_error=token_exchange_failed` },
      });
    }

    const tokens = await tokenResponse.json();
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);

    let accountEmail: string | null = null;
    let accountName: string | null = null;
    try {
      const aboutRes = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (aboutRes.ok) {
        const about = await aboutRes.json();
        accountEmail = about?.user?.emailAddress ?? null;
        accountName = about?.user?.displayName ?? null;
      }
    } catch (metadataError) {
      console.warn("Unable to read Google Drive account metadata:", metadataError);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Delete ALL existing tokens (singleton table) then insert fresh
    await supabaseAdmin.from("google_drive_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error: insertError } = await supabaseAdmin.from("google_drive_tokens").insert({
      connected_by: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || "",
      token_expiry: expiry.toISOString(),
    });

    if (!insertError && (accountEmail || accountName)) {
      console.info("Google Drive connected", { accountEmail, accountName });
    }

    if (insertError) {
      console.error("Failed to store Google Drive tokens:", insertError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${appUrl}/integrations?drive_error=storage_failed` },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?drive_connected=true` },
    });
  } catch (error: any) {
    console.error("Google Drive callback error:", error);
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/integrations?drive_error=unknown` },
    });
  }
});
