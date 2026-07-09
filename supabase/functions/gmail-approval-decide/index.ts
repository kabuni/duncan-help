// Client-invoked: applies the user's decision on a pending approval or a
// queued auto-send. Actions:
//   approve  — send `final_reply` (or original proposed_reply) now
//   edit     — save edited body, send it, record edit_distance for retraining
//   discard  — mark discarded, do nothing on Gmail
//   undo     — mark a queued outbox row as "undone" (before send_after)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json() as any;
}

async function getValidToken(supabaseAdmin: any, userId: string) {
  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens").select("*").eq("connected_by", userId).maybeSingle();
  if (!tokenRow) return null;
  const expiry = new Date(tokenRow.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const r = await refreshAccessToken(tokenRow.refresh_token);
    if (!r) return null;
    await supabaseAdmin.from("gmail_tokens").update({
      access_token: r.access_token,
      token_expiry: new Date(Date.now() + r.expires_in * 1000).toISOString(),
    }).eq("id", tokenRow.id);
    return { access: r.access_token, email: tokenRow.email_address };
  }
  return { access: tokenRow.access_token, email: tokenRow.email_address };
}

function base64url(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}

async function updateTrust(
  supabaseAdmin: any, userId: string, senderEmail: string,
  outcome: "approved" | "edited" | "rejected",
) {
  const { data: trust } = await supabaseAdmin.from("gmail_sender_trust")
    .select("*").eq("user_id", userId).eq("sender_email", senderEmail).maybeSingle();
  const approved = (trust?.sends_approved || 0) + (outcome === "approved" ? 1 : 0);
  const edited = (trust?.sends_edited || 0) + (outcome === "edited" ? 1 : 0);
  const rejected = (trust?.sends_rejected || 0) + (outcome === "rejected" ? 1 : 0);
  const total = approved + edited + rejected;
  const raw = (approved * 100 + edited * 40 - rejected * 200) / Math.max(total, 1);
  const confidence = Math.max(0, Math.min(100, Math.round(raw)));
  await supabaseAdmin.from("gmail_sender_trust").upsert({
    user_id: userId,
    sender_email: senderEmail,
    sender_domain: senderEmail.split("@")[1] || null,
    sends_approved: approved, sends_edited: edited, sends_rejected: rejected,
    confidence,
    auto_send_enabled: confidence >= 90 && approved >= 10,
    last_updated: new Date().toISOString(),
  }, { onConflict: "user_id,sender_email" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "no auth" }), { status: 401, headers: corsHeaders });

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { action, approval_id, outbox_id, edited_body } = await req.json();

    // ---- Undo a queued auto-send ---------------------------------------
    if (action === "undo") {
      const { data: row } = await supabaseAdmin.from("gmail_auto_outbox")
        .select("*").eq("id", outbox_id).eq("user_id", user.id).maybeSingle();
      if (!row) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
      if (row.status !== "queued") return new Response(JSON.stringify({ error: "already_processed" }), { status: 400, headers: corsHeaders });
      await supabaseAdmin.from("gmail_auto_outbox").update({
        status: "undone", undone_at: new Date().toISOString(),
      }).eq("id", row.id);
      // Move to pending_approvals so the user can decide manually
      await supabaseAdmin.from("gmail_pending_approvals").upsert({
        user_id: user.id,
        gmail_message_id: row.gmail_message_id,
        gmail_thread_id: row.gmail_thread_id,
        sender_email: row.sender_email,
        subject: row.subject,
        proposed_reply: row.body,
        ai_confidence: 50,
        status: "pending",
      }, { onConflict: "user_id,gmail_message_id" });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- All other actions apply to a pending approval -----------------
    const { data: approval } = await supabaseAdmin.from("gmail_pending_approvals")
      .select("*").eq("id", approval_id).eq("user_id", user.id).maybeSingle();
    if (!approval) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
    if (approval.status !== "pending") return new Response(JSON.stringify({ error: "already_decided" }), { status: 400, headers: corsHeaders });

    if (action === "discard") {
      await supabaseAdmin.from("gmail_pending_approvals").update({
        status: "discarded", decided_at: new Date().toISOString(), decided_via: "bell",
      }).eq("id", approval.id);
      await updateTrust(supabaseAdmin, user.id, approval.sender_email, "rejected");
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // For approve/edit we send via Gmail
    const finalBody = (action === "edit" ? String(edited_body || "") : approval.proposed_reply).trim();
    if (!finalBody) return new Response(JSON.stringify({ error: "empty_body" }), { status: 400, headers: corsHeaders });

    const tok = await getValidToken(supabaseAdmin, user.id);
    if (!tok) return new Response(JSON.stringify({ error: "no_gmail_token" }), { status: 400, headers: corsHeaders });
    const headers = { Authorization: `Bearer ${tok.access}` };

    // Fetch original message headers for threading
    const origRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${approval.gmail_message_id}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From`,
      { headers });
    if (!origRes.ok) return new Response(JSON.stringify({ error: "gmail_headers_failed" }), { status: 500, headers: corsHeaders });
    const orig = await origRes.json();
    const hs = orig.payload?.headers || [];
    const get = (n: string) => hs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "";
    const subject = get("Subject");
    const messageId = get("Message-ID");
    const references = get("References");
    const from = get("From");
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const newRefs = references ? `${references} ${messageId}`.trim() : messageId;
    const mime = [
      `From: ${tok.email}`, `To: ${from}`, `Subject: ${replySubject}`,
      messageId ? `In-Reply-To: ${messageId}` : "",
      newRefs ? `References: ${newRefs}` : "",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      finalBody,
    ].filter(Boolean).join("\r\n");

    const sendRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: base64url(mime), threadId: approval.gmail_thread_id }) },
    );
    if (!sendRes.ok) {
      const err = await sendRes.text();
      return new Response(JSON.stringify({ error: "gmail_send_failed", details: err.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sent = await sendRes.json();

    const outcome = action === "edit" ? "edited" : "approved";
    const editDistance = action === "edit"
      ? levenshtein(approval.proposed_reply.slice(0, 4000), finalBody.slice(0, 4000))
      : 0;

    await supabaseAdmin.from("gmail_pending_approvals").update({
      status: outcome === "approved" ? "sent" : "edited",
      final_reply: finalBody,
      sent_message_id: sent.id,
      decided_at: new Date().toISOString(),
      decided_via: "bell",
    }).eq("id", approval.id);

    // Feedback log (also feeds retraining)
    await supabaseAdmin.from("gmail_draft_feedback").insert({
      user_id: user.id,
      gmail_thread_id: approval.gmail_thread_id,
      recipient_email: approval.sender_email,
      recipient_domain: approval.sender_email.split("@")[1] || null,
      original_draft: approval.proposed_reply,
      final_sent: finalBody,
      outcome: action === "edit" ? "edited" : "sent_as_is",
      edit_distance: editDistance,
    });

    // If edited, store the correction as a high-weight style sample
    if (action === "edit") {
      await supabaseAdmin.from("gmail_style_samples").upsert({
        user_id: user.id,
        gmail_message_id: `edit-${sent.id}`,
        recipient_email: approval.sender_email,
        recipient_domain: approval.sender_email.split("@")[1] || null,
        subject: approval.subject,
        sample_text: finalBody.slice(0, 2000),
        word_count: finalBody.split(/\s+/).length,
        sent_at: new Date().toISOString(),
        weight: 3.0,
        source: "edit_correction",
      }, { onConflict: "user_id,gmail_message_id" });
    }

    await updateTrust(supabaseAdmin, user.id, approval.sender_email, outcome);

    return new Response(JSON.stringify({ ok: true, gmail_message_id: sent.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("gmail-approval-decide error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
