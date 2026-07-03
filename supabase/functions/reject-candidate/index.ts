// Reject a candidate: flip status to 'rejected' and send a polite rejection
// email from duncan@kabuni.com (via duncan_gmail_tokens).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Body {
  candidate_id: string;
  subject?: string;
  body?: string;
  skip_email?: boolean;
}

async function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`token refresh failed: ${await r.text()}`);
  return await r.json();
}

async function getDuncanGmailAccess(admin: any): Promise<{ token: string; email: string }> {
  const { data: row, error } = await admin.from("duncan_gmail_tokens").select("*").limit(1).maybeSingle();
  if (error || !row) throw new Error("Duncan Gmail not connected");
  if (new Date(row.token_expiry).getTime() - Date.now() > 60_000) {
    return { token: row.access_token, email: row.google_account_email };
  }
  const refreshed = await refreshGoogleToken(
    row.refresh_token,
    Deno.env.get("GMAIL_CLIENT_ID")!,
    Deno.env.get("GMAIL_CLIENT_SECRET")!,
  );
  const expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await admin.from("duncan_gmail_tokens")
    .update({ access_token: refreshed.access_token, token_expiry: expiry })
    .eq("id", row.id);
  return { token: refreshed.access_token, email: row.google_account_email };
}

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const msg = [
    `From: Kabuni <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    body,
  ].join("\r\n");
  return btoa(unescape(encodeURIComponent(msg))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.candidate_id) {
      return new Response(JSON.stringify({ error: "candidate_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: candidate, error: cErr } = await admin
      .from("candidates")
      .select("id, name, email, status, job_roles(title)")
      .eq("id", body.candidate_id)
      .maybeSingle();
    if (cErr || !candidate) {
      return new Response(JSON.stringify({ error: "Candidate not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("candidates").update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      rejected_by: user.id,
    }).eq("id", candidate.id);

    let emailResult: any = { sent: false };
    if (body.skip_email) {
      emailResult = { sent: false, skipped: true };
    } else if (!candidate.email) {
      emailResult = { sent: false, error: "no candidate email on file" };
    } else {
      try {
        const { token, email: fromEmail } = await getDuncanGmailAccess(admin);
        const raw = buildRawEmail(
          fromEmail,
          candidate.email,
          body.subject || "Update on your application at Kabuni",
          body.body || defaultBody(candidate),
        );
        const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        if (!r.ok) {
          const t = await r.text();
          emailResult = { sent: false, error: `Gmail ${r.status}: ${t}` };
        } else {
          const j = await r.json();
          emailResult = { sent: true, messageId: j.id, from: fromEmail };
        }
      } catch (e: any) {
        emailResult = { sent: false, error: e?.message };
      }
    }

    return new Response(JSON.stringify({ success: true, email: emailResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("reject-candidate error", err);
    return new Response(JSON.stringify({ error: err?.message || "unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function defaultBody(c: any): string {
  const first = (c.name || "there").split(" ")[0];
  const role = c.job_roles?.title || "the role";
  return `Hi ${first},

Thank you for applying for the ${role} position at Kabuni, and for the time you invested in the process.

After careful consideration, we've decided not to move forward with your application on this occasion. The decision was a close one, and it's no reflection on your ability.

We'll keep your details on file and would welcome you applying again for future roles that match your experience.

Wishing you the very best with your search.

Kind regards,
The Kabuni Team`;
}
