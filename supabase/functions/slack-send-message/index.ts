import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_API_URL = "https://slack.com/api";

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function decryptToken(encryptedToken: string, secret: string) {
  if (!encryptedToken.startsWith("aes-256-gcm:")) return encryptedToken;
  const [, ivPart, ciphertextPart] = encryptedToken.split(":");
  if (!ivPart || !ciphertextPart) throw new Error("Invalid Slack token format");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, key, fromBase64Url(ciphertextPart));
  return new TextDecoder().decode(plaintext);
}

function validateBody(body: any) {
  const channelId = typeof body?.channel_id === "string" ? body.channel_id.trim() : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!/^C[A-Z0-9]+|G[A-Z0-9]+$/.test(channelId)) throw new Error("A valid Slack channel is required");
  if (!text) throw new Error("Message text is required");
  if (text.length > 4000) throw new Error("Message must be 4,000 characters or fewer");

  return { channelId, text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
    const authHeader = req.headers.get("Authorization");

    if (!clientSecret) throw new Error("Slack OAuth credentials are not configured");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { channelId, text } = validateBody(await req.json().catch(() => ({})));
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("slack_connections")
      .select("user_access_token, authed_user_id, team_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (connectionError) throw connectionError;
    if (!connection?.user_access_token) throw new Error("Reconnect Slack to grant user message permissions");

    const userToken = await decryptToken(connection.user_access_token, clientSecret);
    const slackResponse = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: channelId, text }),
    });
    const slackData = await slackResponse.json().catch(() => ({}));

    if (!slackResponse.ok || slackData.ok === false) {
      throw new Error(slackData.error || "Slack message failed");
    }

    return new Response(JSON.stringify({
      success: true,
      channel: slackData.channel,
      ts: slackData.ts,
      posted_as_user_id: connection.authed_user_id,
      workspace_name: connection.team_name,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Slack send message error:", error);
    const message = error instanceof Error ? error.message : "Slack message failed";
    const status = message.includes("required") || message.includes("valid") || message.includes("4,000") ? 400 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
