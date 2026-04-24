import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { projectId, collaboratorUserId } = await req.json();
    if (!projectId || typeof projectId !== "string") {
      throw new Error("projectId is required");
    }
    if (!collaboratorUserId || typeof collaboratorUserId !== "string") {
      throw new Error("collaboratorUserId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: authError,
    } = await authedClient.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("id, name, user_id")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      throw new Error("Project not found");
    }

    const isOwner = project.user_id === user.id;

    const { data: requesterMembership } = await adminClient
      .from("project_members")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!isOwner && !requesterMembership) {
      throw new Error("You do not have access to this project");
    }

    const { data: membership, error: membershipError } = await adminClient
      .from("project_members")
      .select("id, added_by")
      .eq("project_id", projectId)
      .eq("user_id", collaboratorUserId)
      .eq("added_by", user.id)
      .maybeSingle();

    if (membershipError || !membership) {
      throw new Error("Collaborator membership not found for this requester");
    }

    const {
      data: { user: collaborator },
      error: collaboratorError,
    } = await adminClient.auth.admin.getUserById(collaboratorUserId);

    if (collaboratorError || !collaborator?.email) {
      throw new Error("Collaborator email not found");
    }

    const { data: inviterProfile } = await adminClient
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const inviterName = inviterProfile?.display_name?.trim() || user.email || "A teammate";
    const collaboratorName = collaborator.user_metadata?.display_name || collaborator.user_metadata?.full_name || collaborator.email;
    const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    const projectUrl = `${appUrl.replace(/\/+$/, "")}/projects/${projectId}`;
    const gmailToken = await getGmailSenderToken(adminClient);

    if (!gmailToken) {
      throw new Error("Duncan Gmail sender token not found or refresh failed");
    }

    const subject = `You've been added to ${project.name} in Duncan`;
    const htmlBody = buildEmailHtml({
      collaboratorName,
      inviterName,
      projectName: project.name,
      projectUrl,
    });

    const rawMessage = buildRFC2822(
      collaborator.email,
      subject,
      htmlBody,
      "duncan@kabuni.com",
    );

    const encoded = base64url(rawMessage);

    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gmailToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    });

    const sendData = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok) {
      throw new Error(`Gmail API call failed [${sendRes.status}]: ${JSON.stringify(sendData)}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("project-member-added-email error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getGmailSenderToken(supabaseAdmin: any): Promise<string | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("email_address", "duncan@kabuni.com")
    .maybeSingle();

  if (error || !tokenRow) return null;

  const now = new Date();
  const expiry = new Date(tokenRow.token_expiry);

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

function buildEmailHtml({
  collaboratorName,
  inviterName,
  projectName,
  projectUrl,
}: {
  collaboratorName: string;
  inviterName: string;
  projectName: string;
  projectUrl: string;
}) {
  return `
<div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;color:#1f2937">
  <div style="margin-bottom:24px">
    <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:hsl(174, 50%, 92%);color:hsl(174, 60%, 28%);font-size:12px;font-weight:600;letter-spacing:0.02em">Duncan</div>
  </div>
  <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:hsl(220, 20%, 12%)">You’ve been added to a project</h1>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:hsl(215, 12%, 44%)">Hi ${escapeHtml(collaboratorName)},</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:hsl(215, 12%, 44%)"><strong style="color:hsl(220, 20%, 12%)">${escapeHtml(inviterName)}</strong> has given you access to <strong style="color:hsl(220, 20%, 12%)">${escapeHtml(projectName)}</strong> in Duncan.</p>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:hsl(215, 12%, 44%)">You can open the project now to review files, chats, and shared context.</p>
  <a href="${projectUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:hsl(174, 72%, 40%);color:hsl(0, 0%, 100%);text-decoration:none;font-size:14px;font-weight:600">Open project</a>
  <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:hsl(215, 12%, 44%)">If the button doesn’t work, copy and paste this link into your browser:<br /><a href="${projectUrl}" style="color:hsl(174, 72%, 40%);text-decoration:none">${projectUrl}</a></p>
</div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}