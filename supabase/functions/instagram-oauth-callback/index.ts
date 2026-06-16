// Instagram OAuth callback: exchanges code, resolves Page + IG Business account,
// stores long-lived page token. Admin-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const APP_ID = Deno.env.get("META_APP_ID");
    const APP_SECRET = Deno.env.get("META_APP_SECRET");
    if (!APP_ID || !APP_SECRET) {
      return json({ error: "Meta credentials not configured" }, 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "");
    const redirectUri = String(body.redirect_uri || "");
    if (!code || !redirectUri) return json({ error: "Missing code or redirect_uri" }, 400);

    // 1) Exchange code → short-lived user token
    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", APP_ID);
    tokenUrl.searchParams.set("client_secret", APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const shortRes = await fetch(tokenUrl);
    const shortJson = await shortRes.json();
    if (!shortRes.ok) return json({ error: "Token exchange failed", detail: shortJson }, 400);
    const shortToken = shortJson.access_token as string;

    // 2) Long-lived user token (60 days)
    const longUrl = new URL(`${GRAPH}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", APP_ID);
    longUrl.searchParams.set("client_secret", APP_SECRET);
    longUrl.searchParams.set("fb_exchange_token", shortToken);
    const longRes = await fetch(longUrl);
    const longJson = await longRes.json();
    if (!longRes.ok) return json({ error: "Long token exchange failed", detail: longJson }, 400);
    const longToken = longJson.access_token as string;
    const expiresIn = Number(longJson.expires_in || 0);

    // 3) List pages, get their (non-expiring) page tokens
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(longToken)}`);
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) return json({ error: "Failed to fetch pages", detail: pagesJson }, 400);
    const pages = pagesJson.data ?? [];

    // 4) Find the page that has an IG business account, prefer Kabuni.India
    let chosen: { page_id: string; page_token: string; ig_id: string; ig_username: string } | null = null;
    for (const p of pages) {
      const r = await fetch(
        `${GRAPH}/${p.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(p.access_token)}`,
      );
      const j = await r.json();
      const ig = j.instagram_business_account;
      if (!ig?.id) continue;
      const candidate = { page_id: p.id, page_token: p.access_token, ig_id: ig.id, ig_username: ig.username || "" };
      if ((ig.username || "").toLowerCase() === "kabuni.india") {
        chosen = candidate;
        break;
      }
      if (!chosen) chosen = candidate;
    }
    if (!chosen) return json({ error: "No Instagram Business account found on any of your Pages" }, 400);

    const expires_at = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const { error: upErr } = await admin
      .from("instagram_tokens")
      .upsert(
        {
          page_id: chosen.page_id,
          ig_business_id: chosen.ig_id,
          ig_username: chosen.ig_username,
          page_access_token: chosen.page_token,
          scope: "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management",
          expires_at,
          connected_by: userId,
        },
        { onConflict: "page_id" },
      );
    if (upErr) return json({ error: "Failed to store token", detail: upErr.message }, 500);

    // Trigger an initial sync (fire and forget)
    EdgeRuntime.waitUntil(
      fetch(`${SUPABASE_URL}/functions/v1/sync-instagram-insights`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE}` },
      }).catch(() => {}),
    );

    return json({ ok: true, ig_username: chosen.ig_username, ig_business_id: chosen.ig_id });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
