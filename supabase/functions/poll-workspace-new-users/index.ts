import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRIMARY_DOMAIN = "kabuni.com";
const SENDER = "duncan@kabuni.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: tokenRow } = await admin
      .from("workspace_admin_tokens")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!tokenRow) {
      return json({ error: "Workspace Super Admin not connected" }, 400);
    }

    const accessToken = await refreshIfNeeded(admin, tokenRow);

    // Pull all users in the primary domain. Page through if needed.
    const allUsers: any[] = [];
    let pageToken: string | undefined;
    do {
      const u = new URL("https://admin.googleapis.com/admin/directory/v1/users");
      u.searchParams.set("domain", PRIMARY_DOMAIN);
      u.searchParams.set("maxResults", "200");
      u.searchParams.set("orderBy", "email");
      u.searchParams.set("projection", "basic");
      if (pageToken) u.searchParams.set("pageToken", pageToken);

      const r = await fetch(u.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        const errText = await r.text();
        await admin
          .from("workspace_admin_tokens")
          .update({
            last_polled_at: new Date().toISOString(),
            last_poll_status: "error",
            last_poll_error: `directory_list_${r.status}: ${errText.slice(0, 300)}`,
          })
          .eq("id", tokenRow.id);
        return json({ error: "directory_list_failed", status: r.status, body: errText }, 500);
      }
      const body = await r.json();
      for (const user of body.users ?? []) allUsers.push(user);
      pageToken = body.nextPageToken;
    } while (pageToken);

    // Filter out suspended/archived and non-primary-domain users
    const candidates = allUsers.filter(
      (u) =>
        !u.suspended &&
        !u.archived &&
        typeof u.primaryEmail === "string" &&
        u.primaryEmail.toLowerCase().endsWith(`@${PRIMARY_DOMAIN}`),
    );

    if (candidates.length === 0) {
      await admin
        .from("workspace_admin_tokens")
        .update({
          last_polled_at: new Date().toISOString(),
          last_poll_status: "ok",
          last_poll_error: null,
        })
        .eq("id", tokenRow.id);
      return json({ checked: 0, sent: 0, skipped: 0 });
    }

    // Look up which ones we've already emailed
    const googleIds = candidates.map((u) => u.id);
    const { data: alreadyLogged } = await admin
      .from("workspace_welcome_log")
      .select("google_user_id")
      .in("google_user_id", googleIds);
    const seen = new Set((alreadyLogged ?? []).map((r) => r.google_user_id));

    const toEmail = candidates.filter((u) => !seen.has(u.id));

    let sent = 0;
    let failed = 0;
    if (toEmail.length > 0) {
      const gmailToken = await getDuncanGmailToken(admin);
      if (!gmailToken) {
        return json({ error: "duncan_gmail_token_unavailable" }, 500);
      }
      for (const user of toEmail) {
        const name = user.name?.givenName || user.name?.fullName || "";
        try {
          const { messageId } = await sendWelcomeEmail({
            gmailToken,
            toEmail: user.primaryEmail,
            firstName: name,
          });
          await admin.from("workspace_welcome_log").insert({
            google_user_id: user.id,
            email: user.primaryEmail.toLowerCase(),
            full_name: user.name?.fullName ?? null,
            workspace_created_at: user.creationTime ?? null,
            send_status: "sent",
            gmail_message_id: messageId,
          });
          sent++;
        } catch (e: any) {
          failed++;
          await admin.from("workspace_welcome_log").insert({
            google_user_id: user.id,
            email: user.primaryEmail.toLowerCase(),
            full_name: user.name?.fullName ?? null,
            workspace_created_at: user.creationTime ?? null,
            send_status: "failed",
            error_message: String(e?.message ?? e).slice(0, 500),
          });
        }
      }
    }

    await admin
      .from("workspace_admin_tokens")
      .update({
        last_polled_at: new Date().toISOString(),
        last_poll_status: failed > 0 ? "partial" : "ok",
        last_poll_error: null,
      })
      .eq("id", tokenRow.id);

    return json({ checked: candidates.length, sent, failed, skipped: candidates.length - toEmail.length });
  } catch (e: any) {
    console.error("poll-workspace-new-users error:", e);
    return json({ error: e?.message ?? "server_error" }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function refreshIfNeeded(admin: any, row: any): Promise<string> {
  const expiry = new Date(row.token_expiry).getTime();
  if (expiry - Date.now() > 5 * 60 * 1000) return row.access_token;

  const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Workspace admin token refresh failed: ${await res.text()}`);
  const refreshed = await res.json();
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
  await admin
    .from("workspace_admin_tokens")
    .update({ access_token: refreshed.access_token, token_expiry: newExpiry.toISOString() })
    .eq("id", row.id);
  return refreshed.access_token;
}

async function getDuncanGmailToken(admin: any): Promise<string | null> {
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("email_address", SENDER)
    .maybeSingle();
  if (!row) return null;
  if (new Date(row.token_expiry).getTime() - Date.now() > 5 * 60 * 1000) {
    return row.access_token;
  }
  const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const refreshed = await res.json();
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
  await admin
    .from("gmail_tokens")
    .update({ access_token: refreshed.access_token, token_expiry: newExpiry.toISOString() })
    .eq("id", row.id);
  return refreshed.access_token;
}

async function sendWelcomeEmail(opts: {
  gmailToken: string;
  toEmail: string;
  firstName: string;
}): Promise<{ messageId: string }> {
  const subject = "Welcome to Kabuni";
  const html = buildHtml(opts.firstName);
  const raw = base64url(buildRFC2822(opts.toEmail, subject, html));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.gmailToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail send ${res.status}: ${JSON.stringify(data)}`);
  return { messageId: data.id };
}

function buildRFC2822(to: string, subject: string, html: string): string {
  return [
    `From: Duncan <${SENDER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
}

function base64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildHtml(firstName: string): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  return `
<div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;color:#1f2937">
  <div style="margin-bottom:24px">
    <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:hsl(174,50%,92%);color:hsl(174,60%,28%);font-size:12px;font-weight:600;letter-spacing:0.02em">Kabuni</div>
  </div>
  <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:hsl(220,20%,12%)">Welcome to Kabuni</h1>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:hsl(215,12%,44%)">${greeting}</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:hsl(215,12%,44%)">Your Kabuni Google Workspace account is live. You can now sign in to your @kabuni.com email and the rest of the workspace tools.</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:hsl(215,12%,44%)">When you're ready, head to Duncan — our internal operating system — to access company knowledge, projects, and workflows in one place.</p>
  <a href="https://duncan.help" style="display:inline-block;margin-top:8px;padding:12px 20px;border-radius:8px;background:hsl(174,72%,40%);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600">Open Duncan</a>
  <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:hsl(215,12%,44%)">If you have any questions, just reply to this email.</p>
  <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:hsl(220,20%,12%)">— The Kabuni team</p>
</div>`;
}

function escapeHtml(v: string) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
