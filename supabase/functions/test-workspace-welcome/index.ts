import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SENDER = "duncan@kabuni.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const recipients: string[] = body.recipients ?? ["palash@kabuni.com", "adit@kabuni.com"];
    const firstNames: Record<string, string> = body.firstNames ?? {
      "palash@kabuni.com": "Palash",
      "adit@kabuni.com": "Adit",
    };

    const token = await getDuncanGmailToken(admin);
    if (!token) return json({ error: "duncan_gmail_token_unavailable" }, 500);

    const results: any[] = [];
    for (const to of recipients) {
      try {
        const id = await sendWelcomeEmail(token, to, firstNames[to] ?? "");
        results.push({ to, ok: true, messageId: id });
      } catch (e: any) {
        results.push({ to, ok: false, error: String(e?.message ?? e) });
      }
    }
    return json({ results });
  } catch (e: any) {
    return json({ error: e?.message ?? "server_error" }, 500);
  }

  function json(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function getDuncanGmailToken(admin: any): Promise<string | null> {
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("id, access_token, refresh_token, token_expiry")
    .eq("email_address", SENDER)
    .maybeSingle();
  if (!row) return null;
  if (new Date(row.token_expiry).getTime() - Date.now() > 5 * 60 * 1000) return row.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const r = await res.json();
  const newExpiry = new Date(Date.now() + r.expires_in * 1000);
  await admin
    .from("gmail_tokens")
    .update({ access_token: r.access_token, token_expiry: newExpiry.toISOString() })
    .eq("id", row.id);
  return r.access_token;
}

async function sendWelcomeEmail(token: string, to: string, firstName: string): Promise<string> {
  const subject = "Welcome to Kabuni";
  const html = buildHtml(firstName);
  const raw = base64url(
    [
      `From: Duncan <${SENDER}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      html,
    ].join("\r\n"),
  );
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${JSON.stringify(data)}`);
  return data.id;
}

function base64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(v: string) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function buildHtml(firstName: string): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi there,";
  const body = "font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  const p = "margin:0 0 14px;font-size:15px;line-height:1.65;color:hsl(215,15%,30%)";
  const stepTitle = "margin:0 0 4px;font-size:15px;line-height:1.5;color:hsl(220,20%,12%);font-weight:600";
  const stepDesc = "margin:0 0 6px;font-size:14px;line-height:1.6;color:hsl(215,12%,44%)";
  const stepLink = "font-size:14px;color:hsl(174,72%,36%);text-decoration:none;font-weight:500";
  return `
<div style="${body};max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff;color:#1f2937">
  <div style="margin-bottom:24px">
    <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:hsl(174,50%,92%);color:hsl(174,60%,28%);font-size:12px;font-weight:600;letter-spacing:0.02em">Kabuni</div>
  </div>
  <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;color:hsl(220,20%,12%)">Welcome to Kabuni!</h1>
  <p style="${p}">${greeting}</p>
  <p style="${p}">We're building the future of sports technology — connecting fans, clubs, and athletes through innovative digital experiences. We're a fast-moving, ambitious team and we're genuinely thrilled to have you with us.</p>
  <p style="${p}">To get you up and running, here are a few things to complete as part of your onboarding:</p>

  <div style="margin:20px 0 18px">
    <p style="${stepTitle}">1. Duncan, our AI office assistant</p>
    <p style="${stepDesc}">Your go-to for workplace queries, documents, and day-to-day support.</p>
    <p style="margin:0">👉 <a href="https://duncan.help" style="${stepLink}">duncan.help</a></p>
  </div>

  <div style="margin:0 0 18px">
    <p style="${stepTitle}">2. Slack, our team communication hub</p>
    <p style="${stepDesc}">This is where the magic happens — join your relevant channels and say hello!</p>
    <p style="margin:0">👉 <a href="https://kabuni.slack.com" style="${stepLink}">kabuni.slack.com</a></p>
  </div>

  <div style="margin:0 0 18px">
    <p style="${stepTitle}">3. Payroll — Deel</p>
    <p style="${stepDesc}">Access your payslips, contracts, and payment details.</p>
    <p style="margin:0">👉 <a href="https://app.deel.com" style="${stepLink}">app.deel.com</a></p>
  </div>

  <div style="margin:0 0 22px">
    <p style="${stepTitle}">4. Our Company Values</p>
    <p style="${stepDesc}">Read the values that guide how we work and make decisions.</p>
    <p style="margin:0">👉 <a href="https://drive.google.com/file/d/1r53VS99sPLj3pUSpaqn7alNuF5QsuKPl/view?usp=sharing" style="${stepLink}">Kabuni Company Values</a></p>
  </div>

  <p style="${p}">We move fast, collaborate openly, and back each other up.</p>
  <p style="${p}">We're so excited to have you on board and can't wait to see what you bring to the team. Don't hesitate to reach out if you need anything as you settle in.</p>

  <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:hsl(220,20%,12%)">— The Kabuni team</p>
</div>`;
}
