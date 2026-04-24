import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

function getAppUrl() {
  const raw = (Deno.env.get("APP_URL") || "https://duncan.help").trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function signState(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

async function validateState(state: string, secret: string, expectedUserId: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return false;
  const expectedSignature = await signState(payload, secret);
  if (signature !== expectedSignature) return false;

  const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  return decoded.user_id === expectedUserId && typeof decoded.exp === "number" && decoded.exp > Date.now();
}

async function encryptToken(token: string, secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  return `aes-256-gcm:${base64Url(iv)}:${base64Url(new Uint8Array(ciphertext))}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("SLACK_CLIENT_ID");
    const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");

    if (!clientId || !clientSecret) throw new Error("Slack OAuth credentials are not configured");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, state } = await req.json().catch(() => ({}));
    if (!code || !state) {
      return new Response(JSON.stringify({ error: "Missing OAuth code or state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stateValid = await validateState(String(state), clientSecret, user.id);
    if (!stateValid) {
      return new Response(JSON.stringify({ error: "Invalid OAuth state" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectUri = `${getAppUrl()}/auth/slack/callback`;
    const tokenResponse = await fetch(SLACK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.ok || !tokenData.access_token) {
      console.error("Slack token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: tokenData.error || "Slack token exchange failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const encryptedToken = await encryptToken(tokenData.access_token, clientSecret);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error: upsertError } = await supabaseAdmin
      .from("slack_connections")
      .upsert({
        user_id: user.id,
        access_token: encryptedToken,
        team_id: tokenData.team?.id,
        team_name: tokenData.team?.name ?? null,
        authed_user_id: tokenData.authed_user?.id ?? null,
        scope: tokenData.scope ?? null,
      }, { onConflict: "user_id" })
      .select("id, user_id, team_id, team_name, authed_user_id, scope, created_at, updated_at")
      .single();

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({ success: true, connection: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Slack callback error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Slack OAuth callback failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
