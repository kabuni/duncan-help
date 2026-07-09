// Every minute: send queued auto-outbox replies whose undo window has passed.
// A row can also be marked "undone" by the user via the UI; those are skipped.

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
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidToken(supabaseAdmin: any, userId: string) {
  const { data: tokenRow } = await supabaseAdmin
    .from("gmail_tokens").select("*").eq("connected_by", userId).maybeSingle();
  if (!tokenRow) return null;
  const expiry = new Date(tokenRow.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const r = await refreshAccessToken(tokenRow.refresh_token);
    if (!r) return null;
    const newExpiry = new Date(Date.now() + r.expires_in * 1000).toISOString();
    await supabaseAdmin.from("gmail_tokens")
      .update({ access_token: r.access_token, token_expiry: newExpiry })
      .eq("id", tokenRow.id);
    return { access: r.access_token, email: tokenRow.email_address };
  }
  return { access: tokenRow.access_token, email: tokenRow.email_address };
}

function base64url(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchOriginalHeaders(headers: any, messageId: string) {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From`,
    { headers },
  );
  if (!r.ok) return null;
  const j = await r.json();
  const hs = j.payload?.headers || [];
  const get = (n: string) => hs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "";
  return {
    subject: get("Subject"), messageId: get("Message-ID"),
    references: get("References"), from: get("From"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: due } = await supabaseAdmin
    .from("gmail_auto_outbox")
    .select("*")
    .eq("status", "queued")
    .lte("send_after", new Date().toISOString())
    .limit(50);

  const results: any[] = [];
  for (const row of due || []) {
    try {
      const tok = await getValidToken(supabaseAdmin, row.user_id);
      if (!tok) {
        await supabaseAdmin.from("gmail_auto_outbox")
          .update({ status: "failed", error: "no_token" }).eq("id", row.id);
        continue;
      }
      const headers = { Authorization: `Bearer ${tok.access}` };
      const orig = await fetchOriginalHeaders(headers, row.gmail_message_id);
      if (!orig) {
        await supabaseAdmin.from("gmail_auto_outbox")
          .update({ status: "failed", error: "orig_headers_missing" }).eq("id", row.id);
        continue;
      }
      const replySubject = orig.subject.startsWith("Re:") ? orig.subject : `Re: ${orig.subject}`;
      const newRefs = orig.references ? `${orig.references} ${orig.messageId}`.trim() : orig.messageId;
      const mime = [
        `From: ${tok.email}`,
        `To: ${orig.from}`,
        `Subject: ${replySubject}`,
        orig.messageId ? `In-Reply-To: ${orig.messageId}` : "",
        newRefs ? `References: ${newRefs}` : "",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        row.body,
      ].filter(Boolean).join("\r\n");

      const sendRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: base64url(mime), threadId: row.gmail_thread_id }) },
      );
      if (!sendRes.ok) {
        const t = await sendRes.text();
        await supabaseAdmin.from("gmail_auto_outbox")
          .update({ status: "failed", error: t.slice(0, 500) }).eq("id", row.id);
        continue;
      }
      const sent = await sendRes.json();
      await supabaseAdmin.from("gmail_auto_outbox").update({
        status: "sent", sent_at: new Date().toISOString(), sent_message_id: sent.id,
      }).eq("id", row.id);

      // Bump trust: auto-sent counts as approved
      await supabaseAdmin.rpc("noop_query", {}).catch(() => {});
      const { data: trust } = await supabaseAdmin.from("gmail_sender_trust")
        .select("*").eq("user_id", row.user_id).eq("sender_email", row.sender_email).maybeSingle();
      const approved = (trust?.sends_approved || 0) + 1;
      const edited = trust?.sends_edited || 0;
      const rejected = trust?.sends_rejected || 0;
      const total = approved + edited + rejected;
      const confidence = Math.round((approved * 100 - rejected * 200) / Math.max(total, 1));
      await supabaseAdmin.from("gmail_sender_trust").upsert({
        user_id: row.user_id,
        sender_email: row.sender_email,
        sender_domain: row.sender_email.split("@")[1] || null,
        sends_approved: approved, sends_edited: edited, sends_rejected: rejected,
        confidence: Math.max(0, Math.min(100, confidence)),
        auto_send_enabled: confidence >= 90 && approved >= 10,
        last_updated: new Date().toISOString(),
      }, { onConflict: "user_id,sender_email" });

      results.push({ id: row.id, status: "sent" });
    } catch (e: any) {
      await supabaseAdmin.from("gmail_auto_outbox")
        .update({ status: "failed", error: String(e?.message || e).slice(0, 500) })
        .eq("id", row.id);
      results.push({ id: row.id, status: "failed", error: e?.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
