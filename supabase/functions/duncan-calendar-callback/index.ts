import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";
const TARGET_CALENDAR_NAME = "Duncan | Planner";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return Response.redirect(`${APP_URL}/diary?duncan_calendar=error&reason=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code || !stateRaw) {
    return Response.redirect(`${APP_URL}/diary?duncan_calendar=error&reason=missing_code`, 302);
  }

  try {
    const state = JSON.parse(atob(stateRaw));
    const userId: string = state.uid;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!;
    const redirectUri = `${supabaseUrl}/functions/v1/duncan-calendar-callback`;

    // Exchange code for tokens
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
    const refreshToken = tokens.refresh_token as string;
    const expiresIn = tokens.expires_in as number;
    const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Fetch user email
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

    // Find the "Duncan | Planner" calendar
    let calendarId: string | null = null;
    const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const list = await listRes.json();
      const match = (list.items || []).find((c: any) =>
        (c.summary || "").trim().toLowerCase() === TARGET_CALENDAR_NAME.toLowerCase()
      );
      if (match) calendarId = match.id;
    }

    const supaAdmin = createClient(supabaseUrl, serviceKey);

    // Replace any existing token row (only one allowed)
    await supaAdmin.from("duncan_calendar_tokens").delete().not("id", "is", null);

    const { error: insErr } = await supaAdmin.from("duncan_calendar_tokens").insert({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expiry: expiry,
      google_account_email: email,
      calendar_id: calendarId,
      calendar_name: TARGET_CALENDAR_NAME,
      connected_by: userId,
    });
    if (insErr) throw insErr;

    const status = calendarId ? "connected" : "connected_no_calendar";
    return Response.redirect(`${APP_URL}/diary?duncan_calendar=${status}`, 302);
  } catch (err: any) {
    console.error("duncan-calendar-callback error", err);
    return Response.redirect(`${APP_URL}/diary?duncan_calendar=error&reason=${encodeURIComponent(err.message || "callback_failed")}`, 302);
  }
});
