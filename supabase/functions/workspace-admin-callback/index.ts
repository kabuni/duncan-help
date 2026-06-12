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
      console.error("Directory verify failed:", verifyRes.status, errBody, "granted_scopes=", tokens.scope);
      let reason = "not_super_admin";
      try {
        const j = JSON.parse(errBody);
        const msg = (j?.error?.message || "").toString().toLowerCase();
        const status = (j?.error?.status || "").toString().toUpperCase();
        if (msg.includes("admin sdk") || msg.includes("has not been used") || msg.includes("disabled")) {
          reason = "admin_sdk_disabled";
        } else if (msg.includes("insufficient") || msg.includes("scope") || status === "PERMISSION_DENIED" && msg.includes("scope")) {
          reason = "insufficient_scope";
        } else if (verifyRes.status === 403) {
          reason = "not_super_admin";
        } else if (verifyRes.status === 401) {
          reason = "unauthorized";
        }
      } catch (_) { /* ignore */ }
      const detail = encodeURIComponent(errBody.slice(0, 300));
      return Response.redirect(
        `${appUrl}/settings?workspace_admin_error=${reason}&workspace_admin_status=${verifyRes.status}&workspace_admin_detail=${detail}`,
        302,
      );
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

    // First-connect seed: mark all currently-existing users as already welcomed
    // so we don't email the whole company on the first poll. Only seeds rows
    // that don't already exist in the log.
    try {
      const { count: existingLog } = await admin
        .from("workspace_welcome_log")
        .select("id", { count: "exact", head: true });
      if ((existingLog ?? 0) === 0) {
        const PRIMARY_DOMAIN = "kabuni.com";
        let pageToken: string | undefined;
        const rows: any[] = [];
        do {
          const u = new URL("https://admin.googleapis.com/admin/directory/v1/users");
          u.searchParams.set("domain", PRIMARY_DOMAIN);
          u.searchParams.set("maxResults", "200");
          u.searchParams.set("orderBy", "email");
          u.searchParams.set("projection", "basic");
          if (pageToken) u.searchParams.set("pageToken", pageToken);
          const r = await fetch(u.toString(), {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          if (!r.ok) break;
          const body = await r.json();
          for (const usr of body.users ?? []) {
            if (!usr.suspended && !usr.archived && typeof usr.primaryEmail === "string") {
              rows.push({
                google_user_id: usr.id,
                email: usr.primaryEmail.toLowerCase(),
                full_name: usr.name?.fullName ?? null,
                workspace_created_at: usr.creationTime ?? null,
                send_status: "seeded",
                error_message: "Pre-existing at connect time; not emailed",
              });
            }
          }
          pageToken = body.nextPageToken;
        } while (pageToken);
        if (rows.length > 0) {
          await admin.from("workspace_welcome_log").upsert(rows, { onConflict: "google_user_id" });
        }
      }
    } catch (seedErr) {
      console.error("workspace-admin-callback seed error:", seedErr);
    }

    return Response.redirect(`${appUrl}/settings?workspace_admin_connected=true`, 302);

  } catch (e: any) {
    console.error("workspace-admin-callback error:", e);
    return Response.redirect(`${appUrl}/settings?workspace_admin_error=server`, 302);
  }
});
