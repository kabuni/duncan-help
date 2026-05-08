import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { po_id } = await req.json();
    if (!po_id) throw new Error("po_id required");

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("id", po_id)
      .single();
    if (poErr || !po) throw new Error("PO not found");

    if (po.status !== "pending_approval") {
      return new Response(JSON.stringify({ skipped: true, reason: "not pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Collect approver user IDs that still need to sign
    const approverIds: string[] = [];
    if (po.approver_user_id && !po.approved_at) approverIds.push(po.approver_user_id);
    if (po.secondary_approver_user_id && !po.secondary_approved_at) approverIds.push(po.secondary_approver_user_id);
    if (approverIds.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no approvers" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up requester profile name
    const { data: requesterProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", po.requester_id)
      .maybeSingle();
    const requesterName = requesterProfile?.display_name || "A team member";

    // Look up department name
    const { data: dept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", po.department_id)
      .maybeSingle();
    const deptName = dept?.name || "—";

    // Resolve approver emails via auth admin
    const { data: usersList, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const approverEmails = (usersList.users || [])
      .filter((u: any) => approverIds.includes(u.id) && u.email)
      .map((u: any) => ({ id: u.id, email: u.email as string }));

    if (approverEmails.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no approver emails" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gmailToken = await getGmailSenderToken(supabase);
    if (!gmailToken) throw new Error("Gmail sender token unavailable");

    const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    const amountFmt = `£${Number(po.total_amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
    const subject = `Approval needed: ${po.po_number} — ${po.vendor_name} (${amountFmt})`;
    const html = buildHtml({ po, requesterName, deptName, amountFmt, appUrl });

    const results = { sent: 0, failed: 0, errors: [] as string[] };
    for (const r of approverEmails) {
      try {
        const raw = buildRFC2822(r.email, subject, html, "duncan@kabuni.com");
        const encoded = base64url(raw);
        const sendRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${gmailToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ raw: encoded }),
          }
        );
        const sendData = await sendRes.json();
        if (sendRes.ok) results.sent++;
        else {
          results.failed++;
          results.errors.push(`${r.email}: ${JSON.stringify(sendData)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      } catch (e: any) {
        results.failed++;
        results.errors.push(`${r.email}: ${e?.message || String(e)}`);
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("send-po-approval-email error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

function buildHtml(args: { po: any; requesterName: string; deptName: string; amountFmt: string; approverName?: string; appUrl: string }): string {
  const { po, requesterName, deptName, amountFmt, appUrl } = args;
  const tier =
    po.approval_tier === "dual_exec" ? "Dual exec sign-off (above £5k)" :
    po.approval_tier === "simon" ? "Simon's approval (£500–£5k)" :
    po.approval_tier === "admin" ? "Admin approval" : "Department owner approval";
  const link = `${appUrl}/purchase-orders`;
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 4px">Approval needed</h2>
  <p style="color:#555;margin:0 0 20px">${requesterName} has submitted a purchase request requiring your approval.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#666;width:140px">PO Number</td><td style="padding:6px 0"><strong>${po.po_number}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#666">Vendor</td><td style="padding:6px 0">${escapeHtml(po.vendor_name)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Description</td><td style="padding:6px 0">${escapeHtml(po.description)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Amount</td><td style="padding:6px 0"><strong>${amountFmt}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#666">Department</td><td style="padding:6px 0">${escapeHtml(deptName)}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Routing</td><td style="padding:6px 0">${tier}</td></tr>
  </table>
  <div style="margin:24px 0">
    <a href="${link}" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;display:inline-block">Review & approve</a>
  </div>
  <p style="color:#888;font-size:12px;margin-top:24px">You're receiving this because you're listed as an approver in Duncan.</p>
</div>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
