const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const slackApiKey = Deno.env.get("SLACK_API_KEY");

  if (!lovableApiKey || !slackApiKey) {
    return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY or SLACK_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const headers = {
    Authorization: `Bearer ${lovableApiKey}`,
    "X-Connection-Api-Key": slackApiKey,
    "Content-Type": "application/json",
  };

  try {
    const { slack_user_id, message } = await req.json();
    const targetUser = slack_user_id || "U0AFSM2HDL5"; // default: Palash
    const text = message || "👋 Hello from Duncan! This is a test message to confirm your Slack integration is working.";

    // Open DM channel
    const openRes = await fetch(`${SLACK_GATEWAY_URL}/conversations.open`, {
      method: "POST", headers, body: JSON.stringify({ users: targetUser }),
    });
    const openData = await openRes.json();
    if (!openData.ok) {
      return new Response(JSON.stringify({ error: `conversations.open failed: ${openData.error}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send message
    const msgRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST", headers,
      body: JSON.stringify({
        channel: openData.channel.id,
        text,
        username: "Duncan",
        icon_emoji: ":bell:",
      }),
    });
    const msgData = await msgRes.json();

    return new Response(JSON.stringify({ success: msgData.ok, data: msgData }), {
      status: msgData.ok ? 200 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
