import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
    if (!SLACK_API_KEY) throw new Error("SLACK_API_KEY is not configured — please connect Slack first");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!).auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("Only admins can send release notifications");

    const { releaseId } = await req.json();
    if (!releaseId) throw new Error("releaseId is required");

    // Fetch release
    const { data: release, error: releaseError } = await supabase
      .from("releases")
      .select("*")
      .eq("id", releaseId)
      .single();
    if (releaseError || !release) throw new Error("Release not found");

    // Fetch all mapped users with Slack IDs
    const { data: mappings, error: mappingsError } = await supabase
      .from("user_notification_mappings")
      .select("duncan_user_id, slack_user_identifier")
      .eq("is_active", true);
    if (mappingsError) throw mappingsError;

    const slackHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
      "Content-Type": "application/json",
    };

    const appUrl = Deno.env.get("APP_URL") || "https://duncan-help.lovable.app";
    const changes = (release.changes as any[]) || [];
    const messageText = buildSlackMessage(release, changes, appUrl);

    const results = { sent: 0, failed: 0, errors: [] as string[] };

    // ─── SLACK NOTIFICATIONS (disabled) ───
    // Slack notifications have been disabled per team decision.

    // ─── GMAIL NOTIFICATIONS (new) ───
    const gmailResults = { sent: 0, failed: 0, errors: [] as string[] };
    try {
      const gmailToken = await getGmailSenderToken(supabase);
      if (!gmailToken) {
        console.error("Gmail: duncan@kabuni.com token not found or refresh failed — skipping email notifications");
      } else {
        // Fetch all approved users' emails
        const { data: { users: allUsers }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        if (listError) throw listError;

        const { data: approvedProfiles } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("approval_status", "approved");

        const approvedUserIds = new Set((approvedProfiles ?? []).map((p: any) => p.user_id));
        const recipients = (allUsers ?? []).filter(
          (u: any) => u.email && approvedUserIds.has(u.id)
        );

        const htmlBody = buildEmailHtml(release, changes, appUrl);
        const subject = "Duncan Version Upgrade";

        for (const recipient of recipients) {
          try {
            const rawMessage = buildRFC2822(
              recipient.email!,
              subject,
              htmlBody,
              "duncan@kabuni.com"
            );
            const encoded = base64url(rawMessage);

            const sendRes = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${gmailToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ raw: encoded }),
              }
            );

            const sendData = await sendRes.json();
            const success = sendRes.ok;

            await supabase.from("release_email_logs").insert({
              release_id: releaseId,
              user_id: recipient.id,
              recipient_email: recipient.email,
              status: success ? "sent" : "failed",
              error_message: success ? null : JSON.stringify(sendData),
              sent_at: success ? new Date().toISOString() : null,
            });

            if (success) gmailResults.sent++;
            else {
              gmailResults.failed++;
              gmailResults.errors.push(`${recipient.email}: ${JSON.stringify(sendData)}`);
            }

            // Small delay to respect Gmail rate limits
            await new Promise((r) => setTimeout(r, 100));
          } catch (emailErr) {
            gmailResults.failed++;
            const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
            gmailResults.errors.push(`${recipient.email}: ${msg}`);
            await supabase.from("release_email_logs").insert({
              release_id: releaseId,
              user_id: recipient.id,
              recipient_email: recipient.email,
              status: "failed",
              error_message: msg,
            });
          }
        }
      }
    } catch (gmailErr) {
      console.error("Gmail notification block error:", gmailErr);
      gmailResults.errors.push(gmailErr instanceof Error ? gmailErr.message : String(gmailErr));
    }

    return new Response(JSON.stringify({
      success: true,
      slack: { sent: results.sent, failed: results.failed, errors: results.errors },
      gmail: gmailResults,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("send-release-notifications error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── GMAIL HELPERS ───

async function getGmailSenderToken(supabaseAdmin: any): Promise<string | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", "duncan@kabuni.com")
    .maybeSingle();

  if (error || !tokenRow) return null;

  const now = new Date();
  const expiry = new Date(tokenRow.token_expiry);

  // Refresh if expires within 5 minutes
  if (expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tokenRow.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("Gmail token refresh failed:", await res.text());
      return null;
    }

    const refreshed = await res.json();
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);

    await supabaseAdmin
      .from("gmail_tokens")
      .update({
        access_token: refreshed.access_token,
        token_expiry: newExpiry.toISOString(),
      })
      .eq("id", tokenRow.id);

    return refreshed.access_token;
  }

  return tokenRow.access_token;
}

function buildRFC2822(to: string, subject: string, htmlBody: string, from: string): string {
  const lines: string[] = [];
  lines.push(`From: Duncan <${from}>`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${subject}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push("");
  lines.push(htmlBody);
  return lines.join("\r\n");
}

function base64url(str: string): string {
  const encoded = btoa(unescape(encodeURIComponent(str)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildEmailHtml(release: any, changes: { type: string; description: string }[], appUrl: string): string {
  const features = changes.filter((c) => c.type === "feature");
  const improvements = changes.filter((c) => c.type === "improvement");
  const fixes = changes.filter((c) => c.type === "fix");

  const section = (title: string, emoji: string, items: { description: string }[]) =>
    items.length
      ? `<h3 style="color:#1a1a1a;margin:16px 0 8px">${emoji} ${title}</h3><ul style="margin:0;padding-left:20px">${items.map((i) => `<li style="margin:4px 0">${i.description}</li>`).join("")}</ul>`
      : "";

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333">
  <h2 style="color:#111;margin-bottom:4px">🚀 Duncan ${release.version} — ${release.title}</h2>
  <p style="color:#555;font-size:15px;line-height:1.5">${release.summary}</p>
  ${section("New Features", "🚀", features)}
  ${section("Improvements", "✨", improvements)}
  ${section("Bug Fixes", "🐛", fixes)}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <a href="${appUrl}/whats-new" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px">View What's New</a>
  <p style="color:#999;font-size:12px;margin-top:24px">You're receiving this because you're an active Duncan user.</p>
</div>`;
}

// ─── SLACK HELPERS (unchanged) ───

function buildSlackMessage(release: any, changes: { type: string; description: string }[], appUrl: string): string {
  const lines = [`🚀 *Duncan ${release.version} — ${release.title}*`, "", release.summary, ""];
  const features = changes.filter((c) => c.type === "feature");
  const improvements = changes.filter((c) => c.type === "improvement");
  const fixes = changes.filter((c) => c.type === "fix");

  if (features.length) { lines.push("*New Features*"); features.forEach((c) => lines.push(`• ${c.description}`)); lines.push(""); }
  if (improvements.length) { lines.push("*Improvements*"); improvements.forEach((c) => lines.push(`• ${c.description}`)); lines.push(""); }
  if (fixes.length) { lines.push("*Bug Fixes*"); fixes.forEach((c) => lines.push(`• ${c.description}`)); lines.push(""); }

  lines.push(`<${appUrl}/whats-new|View What's New>`);
  return lines.join("\n");
}

function buildSlackBlocks(release: any, changes: { type: string; description: string }[], appUrl: string): any[] {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `🚀 Duncan ${release.version} — ${release.title}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: release.summary } },
  ];

  const features = changes.filter((c) => c.type === "feature");
  const improvements = changes.filter((c) => c.type === "improvement");
  const fixes = changes.filter((c) => c.type === "fix");

  if (features.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*🚀 New Features*\n${features.map((c) => `• ${c.description}`).join("\n")}` } });
  }
  if (improvements.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*✨ Improvements*\n${improvements.map((c) => `• ${c.description}`).join("\n")}` } });
  }
  if (fixes.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*🐛 Bug Fixes*\n${fixes.map((c) => `• ${c.description}`).join("\n")}` } });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [{ type: "button", text: { type: "plain_text", text: "View What's New", emoji: true }, url: `${appUrl}/whats-new` }],
  });

  return blocks;
}
