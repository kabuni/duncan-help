import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const APP_URL = Deno.env.get("APP_URL") || "https://duncan.help";

type Kind = "requested" | "decided" | "proposed" | "counter_resolved";

async function sendSlackDM(slackUserId: string, text: string): Promise<boolean> {
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const slackKey = Deno.env.get("SLACK_API_KEY");
  if (!lovableApiKey || !slackKey) {
    console.error("Slack DM skipped: missing LOVABLE_API_KEY or SLACK_API_KEY");
    return false;
  }
  const headers = {
    Authorization: `Bearer ${lovableApiKey}`,
    "X-Connection-Api-Key": slackKey,
    "Content-Type": "application/json",
  };
  try {
    const openRes = await fetch(`${SLACK_GATEWAY_URL}/conversations.open`, {
      method: "POST",
      headers,
      body: JSON.stringify({ users: slackUserId }),
    });
    const openData = await openRes.json();
    if (!openData.ok) {
      console.error("conversations.open failed:", openData.error);
      return false;
    }
    const msgRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        channel: openData.channel.id,
        text,
        username: "Duncan",
        icon_emoji: ":bell:",
      }),
    });
    const msgData = await msgRes.json();
    if (!msgData.ok) {
      console.error("chat.postMessage failed:", msgData.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Slack DM error:", e);
    return false;
  }
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const approvalId = String(body?.approval_id || "").trim();
    const kind = String(body?.kind || "").trim() as Kind;
    if (!approvalId || !["requested", "decided", "proposed", "counter_resolved"].includes(kind)) {
      return new Response(JSON.stringify({ error: "approval_id and valid kind required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: approval, error: aErr } = await admin
      .from("key_event_approvals")
      .select("*")
      .eq("id", approvalId)
      .maybeSingle();
    if (aErr || !approval) throw new Error(aErr?.message || "Approval not found");

    const { data: event } = await admin
      .from("key_events")
      .select("id, title, start_at, end_at")
      .eq("id", approval.event_id)
      .maybeSingle();

    // Profiles + mappings
    const { data: requesterProfile } = await admin
      .from("profiles")
      .select("id, user_id, display_name")
      .eq("user_id", approval.requested_by)
      .maybeSingle();

    let approverProfile: any = null;
    if (approval.approver_profile_id) {
      const { data } = await admin
        .from("profiles")
        .select("id, user_id, display_name")
        .eq("id", approval.approver_profile_id)
        .maybeSingle();
      approverProfile = data;
    }

    async function slackIdFor(profileId: string | null | undefined) {
      if (!profileId) return null;
      const { data } = await admin
        .from("user_notification_mappings")
        .select("slack_user_identifier, is_active")
        .eq("duncan_user_id", profileId)
        .maybeSingle();
      return data?.is_active ? data.slack_user_identifier : null;
    }

    const eventTitle = event?.title || "Untitled event";
    const eventDate = fmtDate(event?.start_at);
    const linkPath = `/diary?event=${approval.event_id}`;
    const link = `${APP_URL}${linkPath}`;
    const requesterName = requesterProfile?.display_name || "A teammate";
    const approverName = approverProfile?.display_name || "the approver";
    const typeLabel = approval.label ? `${approval.approval_type} — ${approval.label}` : approval.approval_type;

    const notifications: Array<{ user_id: string; title: string; body: string; kind: string }> = [];
    const slackTargets: Array<{ slack_id: string; text: string }> = [];

    if (kind === "requested" && approverProfile) {
      const title = `Approval requested: ${typeLabel}`;
      const bodyText = `${requesterName} asked you to approve "${eventTitle}" on ${eventDate}.`;
      notifications.push({
        user_id: approverProfile.user_id,
        title,
        body: bodyText,
        kind: "approval_requested",
      });
      const slackId = await slackIdFor(approverProfile.id);
      if (slackId) {
        slackTargets.push({
          slack_id: slackId,
          text: `:bell: *Approval requested* — ${typeLabel}\n${requesterName} asked you to approve *${eventTitle}* on ${eventDate}.\n${link}`,
        });
      }
    }

    if (kind === "decided" && requesterProfile) {
      const status = approval.status as string;
      const verb = status === "approved" ? "approved" : "rejected";
      const title = `Approval ${verb}: ${typeLabel}`;
      const note = approval.decision_note ? `\nNote: ${approval.decision_note}` : "";
      const bodyText = `${approverName} ${verb} "${eventTitle}".${note}`;
      notifications.push({
        user_id: requesterProfile.user_id,
        title,
        body: bodyText,
        kind: "approval_decided",
      });
      const slackId = await slackIdFor(requesterProfile.id);
      if (slackId) {
        slackTargets.push({
          slack_id: slackId,
          text: `:${status === "approved" ? "white_check_mark" : "x"}: *Approval ${verb}* — ${typeLabel}\n${approverName} ${verb} *${eventTitle}*.${note}\n${link}`,
        });
      }
    }

    if (kind === "proposed" && requesterProfile) {
      const newDate = fmtDate(approval.proposed_date);
      const title = `New date proposed: ${typeLabel}`;
      const note = approval.proposed_note ? `\nNote: ${approval.proposed_note}` : "";
      const bodyText = `${approverName} suggested moving "${eventTitle}" to ${newDate}.${note}`;
      notifications.push({
        user_id: requesterProfile.user_id,
        title,
        body: bodyText,
        kind: "approval_proposed",
      });
      const slackId = await slackIdFor(requesterProfile.id);
      if (slackId) {
        slackTargets.push({
          slack_id: slackId,
          text: `:calendar: *New date suggested* — ${typeLabel}\n${approverName} suggested moving *${eventTitle}* to *${newDate}*.${note}\n${link}`,
        });
      }
    }

    if (kind === "counter_resolved" && approverProfile) {
      const status = approval.status as string;
      const outcome = status === "approved" ? "accepted your suggested date" : "declined your suggested date";
      const title = `Counter-proposal ${status === "approved" ? "accepted" : "declined"}`;
      const bodyText = `${requesterName} ${outcome} for "${eventTitle}".`;
      notifications.push({
        user_id: approverProfile.user_id,
        title,
        body: bodyText,
        kind: "approval_counter_resolved",
      });
      const slackId = await slackIdFor(approverProfile.id);
      if (slackId) {
        slackTargets.push({
          slack_id: slackId,
          text: `:arrows_counterclockwise: *Counter-proposal ${status === "approved" ? "accepted" : "declined"}*\n${requesterName} ${outcome} for *${eventTitle}*.\n${link}`,
        });
      }
    }

    // Insert notifications
    if (notifications.length) {
      const rows = notifications.map((n) => ({
        user_id: n.user_id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: linkPath,
        metadata: { approval_id: approvalId, event_id: approval.event_id },
      }));
      const { error: insErr } = await admin.from("notifications").insert(rows);
      if (insErr) console.error("notifications insert failed:", insErr);
    }

    // Send Slack DMs (best effort)
    const slackResults = await Promise.all(
      slackTargets.map((t) => sendSlackDM(t.slack_id, t.text)),
    );

    // Email + deletion side-effects for decided approvals
    let emailSent = false;
    let eventDeleted = false;
    if (kind === "decided" && requesterProfile) {
      const status = approval.status as string;
      const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const requesterAuth = (usersList?.users || []).find((u: any) => u.id === requesterProfile.user_id);
      const requesterEmail = requesterAuth?.email as string | undefined;

      if (requesterEmail) {
        try {
          const gmailToken = await getGmailSenderToken(admin);
          if (gmailToken) {
            const verb = status === "approved" ? "Approved" : "Declined";
            const subject = `${verb}: ${eventTitle}`;
            const html = buildDecisionHtml({
              status,
              eventTitle,
              eventDate,
              approverName,
              requesterName,
              decisionNote: approval.decision_note,
              typeLabel,
              link,
            });
            const raw = buildRFC2822(requesterEmail, subject, html, "duncan@kabuni.com");
            const encoded = base64url(raw);
            const sendRes = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: { Authorization: `Bearer ${gmailToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ raw: encoded }),
              },
            );
            if (sendRes.ok) emailSent = true;
            else console.error("decision email failed:", await sendRes.text());
          } else {
            console.warn("Gmail sender token unavailable — skipping decision email");
          }
        } catch (e) {
          console.error("decision email error:", e);
        }
      }

      // Rejection → delete the planner event entirely (after notifications + email)
      if (status === "rejected" && approval.event_id) {
        const { error: delErr } = await admin
          .from("key_events")
          .delete()
          .eq("id", approval.event_id);
        if (delErr) console.error("event delete after rejection failed:", delErr);
        else eventDeleted = true;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        notifications_inserted: notifications.length,
        slack_sent: slackResults.filter(Boolean).length,
        slack_attempted: slackTargets.length,
        email_sent: emailSent,
        event_deleted: eventDeleted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("notify-event-approval error:", error);
    return new Response(JSON.stringify({ error: error?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Native Deno.serve
Deno.serve(handler);

async function getGmailSenderToken(supabaseAdmin: any): Promise<string | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", "duncan@kabuni.com")
    .maybeSingle();
  if (error || !tokenRow) return null;

  const now = new Date();
  const expiry = new Date(tokenRow.token_expiry);
  if (expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    const clientId = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    if (!clientId || !clientSecret) return null;
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
      .update({ access_token: refreshed.access_token, token_expiry: newExpiry.toISOString() })
      .eq("id", tokenRow.id);
    return refreshed.access_token;
  }
  return tokenRow.access_token;
}

function buildRFC2822(to: string, subject: string, htmlBody: string, from: string): string {
  return [
    `From: Duncan <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    htmlBody,
  ].join("\r\n");
}

function base64url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function buildDecisionHtml(args: {
  status: string;
  eventTitle: string;
  eventDate: string;
  approverName: string;
  requesterName: string;
  decisionNote: string | null;
  typeLabel: string;
  link: string;
}): string {
  const { status, eventTitle, eventDate, approverName, requesterName, decisionNote, typeLabel, link } = args;
  const approved = status === "approved";
  const headline = approved ? "Your request was approved" : "Your request was declined";
  const colour = approved ? "#16a34a" : "#dc2626";
  const noteBlock = decisionNote
    ? `<tr><td style="padding:6px 0;color:#666;width:140px">Note</td><td style="padding:6px 0">${escapeHtml(decisionNote)}</td></tr>`
    : "";
  const removalNote = approved
    ? ""
    : `<p style="color:#666;font-size:13px;margin:16px 0 0">This event has been removed from your Planner.</p>`;
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 4px;color:${colour}">${headline}</h2>
  <p style="color:#555;margin:0 0 20px">Hi ${escapeHtml(requesterName)}, ${escapeHtml(approverName)} has reviewed your request.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#666;width:140px">Event</td><td style="padding:6px 0"><strong>${escapeHtml(eventTitle)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#666">Date</td><td style="padding:6px 0">${escapeHtml(eventDate)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Type</td><td style="padding:6px 0">${escapeHtml(typeLabel)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Decision</td><td style="padding:6px 0;color:${colour};text-transform:uppercase;font-weight:600">${approved ? "Approved" : "Declined"}</td></tr>
    ${noteBlock}
  </table>
  ${approved ? `<div style="margin:24px 0"><a href="${link}" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;display:inline-block">Open in Planner</a></div>` : ""}
  ${removalNote}
  <p style="color:#888;font-size:12px;margin-top:24px">Sent automatically by Duncan.</p>
</div>`;
}
