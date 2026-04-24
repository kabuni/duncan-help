// Send per-owner action emails based on a CEO Briefing.
// CEO-only. Reuses duncan@kabuni.com Gmail token (same pattern as send-release-emails).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-authorization",
};

const CEO_EMAILS = ["nimesh@kabuni.com", "palash@kabuni.com"];

interface ActionItem {
  source: "coverage_gap" | "risk" | "workstream";
  severity: "red" | "yellow" | "info";
  title: string;
  why?: string;
  recommendation?: string;
  link?: string;
}

interface OwnerBundle {
  owner_key: string;
  display_name: string;
  email: string | null;
  items: ActionItem[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is CEO
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user || !CEO_EMAILS.includes((userData.user.email ?? "").toLowerCase())) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const briefingId: string = body.briefing_id;
    const subjectOverride: string | undefined = body.subject;
    const introOverride: string | undefined = body.intro;
    const dryRun: boolean = body.dry_run === true;
    const recipientFilter: string[] | undefined = body.recipients; // owner_keys to include

    if (!briefingId) {
      return new Response(JSON.stringify({ error: "briefing_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load briefing
    const { data: briefing, error: brErr } = await supabase
      .from("ceo_briefings")
      .select("*")
      .eq("id", briefingId)
      .maybeSingle();
    if (brErr || !briefing) {
      return new Response(JSON.stringify({ error: "Briefing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load routing
    const { data: routingRows } = await supabase.from("ceo_action_routing").select("*");
    const routing = routingRows ?? [];

    // Build per-owner bundles from briefing payload
    const bundles = buildBundles(briefing, routing);

    // Filter recipients if requested
    const selectedBundles = recipientFilter
      ? bundles.filter((b) => recipientFilter.includes(b.owner_key))
      : bundles.filter((b) => b.items.length > 0 && b.email);

    const unrouted = bundles.filter((b) => b.items.length > 0 && !b.email);

    // Dry run: just return the preview
    if (dryRun) {
      return new Response(
        JSON.stringify({
          bundles: bundles.filter((b) => b.items.length > 0),
          unrouted,
          briefing_date: briefing.briefing_date,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Send emails
    const gmailToken = await getGmailSenderToken(supabase);
    if (!gmailToken) {
      return new Response(
        JSON.stringify({ error: "duncan@kabuni.com Gmail not connected" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const appUrl = Deno.env.get("APP_URL") || "https://duncan.help";
    const dateLabel = new Date(briefing.briefing_date).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
    const subject = subjectOverride || `[Duncan · CEO Brief] Your actions — ${dateLabel}`;

    const results = { sent: 0, failed: 0, errors: [] as string[] };

    for (const bundle of selectedBundles) {
      try {
        const html = buildEmailHtml(bundle, briefing, introOverride, appUrl, dateLabel);
        const raw = base64url(buildRFC2822(bundle.email!, subject, html, "duncan@kabuni.com"));

        const send = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${gmailToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ raw }),
          },
        );
        const sendData = await send.json();
        const success = send.ok;

        await supabase.from("ceo_briefing_email_logs").insert({
          briefing_id: briefingId,
          owner_key: bundle.owner_key,
          recipient_email: bundle.email,
          action_count: bundle.items.length,
          status: success ? "sent" : "failed",
          error_message: success ? null : JSON.stringify(sendData),
          sent_at: success ? new Date().toISOString() : null,
          sent_by: userData.user.id,
        });

        if (success) results.sent++;
        else {
          results.failed++;
          results.errors.push(`${bundle.email}: ${JSON.stringify(sendData)}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      } catch (e: any) {
        results.failed++;
        const msg = e instanceof Error ? e.message : String(e);
        results.errors.push(`${bundle.email}: ${msg}`);
        await supabase.from("ceo_briefing_email_logs").insert({
          briefing_id: briefingId,
          owner_key: bundle.owner_key,
          recipient_email: bundle.email,
          action_count: bundle.items.length,
          status: "failed",
          error_message: msg,
          sent_by: userData.user.id,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: results.sent,
        failed: results.failed,
        unrouted_count: unrouted.length,
        errors: results.errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("send-ceo-briefing-actions error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ───────── Owner resolution ─────────

// Map common name/title tokens in expected_owner strings to owner_keys.
// "Alex (CMO)" → alex_cmo. Multiple tokens may match → multiple recipients.
function resolveOwnerKeys(ownerString: string | undefined | null): string[] {
  if (!ownerString) return [];
  const s = ownerString.toLowerCase();
  const keys = new Set<string>();
  const tokens: Array<[RegExp, string]> = [
    [/\balex\b|\bcmo\b/, "alex_cmo"],
    [/\bsimon\b|\bops director\b/, "simon_ops"],
    [/\bmatt\b|\bcpo\b/, "matt_cpo"],
    [/\bpatrick\b|\bcfo\b/, "patrick_cfo"],
    [/\bpalash\b|\bhead of duncan\b/, "palash_duncan"],
    [/\bellaine\b/, "ellaine_ops"],
    [/\bparmy\b|\bcto\b/, "parmy_cto"],
  ];
  for (const [re, key] of tokens) if (re.test(s)) keys.add(key);
  return [...keys];
}

function buildBundles(briefing: any, routing: any[]): OwnerBundle[] {
  const map = new Map<string, OwnerBundle>();
  for (const r of routing) {
    map.set(r.owner_key, {
      owner_key: r.owner_key,
      display_name: r.display_name,
      email: r.email || null,
      items: [],
    });
  }
  // Ensure unknown owners (not in routing) get a bucket too
  const ensure = (key: string, displayName?: string) => {
    if (!map.has(key)) {
      map.set(key, { owner_key: key, display_name: displayName || key, email: null, items: [] });
    }
    return map.get(key)!;
  };

  const payload = briefing.payload || {};
  const sevFromStatus = (s: string | undefined): "red" | "yellow" | "info" => {
    const v = (s || "").toLowerCase();
    if (v.includes("red")) return "red";
    if (v.includes("yellow") || v.includes("amber")) return "yellow";
    return "info";
  };

  // 1) Coverage gaps
  const gaps: any[] = Array.isArray(payload.coverage_gaps) ? payload.coverage_gaps : [];
  for (const g of gaps) {
    const keys = resolveOwnerKeys(g.recommended_owner || g.expected_owner);
    if (keys.length === 0) {
      ensure("__unrouted", "Unrouted").items.push({
        source: "coverage_gap",
        severity: "red",
        title: g.priority || g.title || "Untracked priority",
        why: g.why_it_matters || g.reason,
        recommendation: g.recommendation || "Create a workstream and assign an owner.",
      });
      continue;
    }
    for (const k of keys) {
      ensure(k).items.push({
        source: "coverage_gap",
        severity: "red",
        title: g.priority || g.title || "Untracked priority",
        why: g.why_it_matters || g.reason,
        recommendation: g.recommendation || "Create a workstream and own this priority.",
      });
    }
  }

  // 2) Risks
  const risks: any[] = Array.isArray(payload.risks) ? payload.risks : [];
  for (const r of risks) {
    const ownerStr = r.owner || r.expected_owner || r.team;
    const keys = resolveOwnerKeys(ownerStr);
    if (keys.length === 0) continue;
    for (const k of keys) {
      ensure(k).items.push({
        source: "risk",
        severity: sevFromStatus(r.severity),
        title: r.risk || r.title || "Risk flagged",
        why: r.consequence || r.impact,
        recommendation: r.mitigation || r.recommendation,
      });
    }
  }

  // 3) Workstream scores (Red/Yellow only)
  const ws: any[] = Array.isArray(briefing.workstream_scores) ? briefing.workstream_scores : [];
  for (const w of ws) {
    const rawStatus = w.status ?? w.risk ?? "";
    const status = (typeof rawStatus === "string" ? rawStatus : String(rawStatus)).toLowerCase();
    if (!status.includes("red") && !status.includes("yellow") && !status.includes("amber")) continue;
    const keys = resolveOwnerKeys(w.owner || w.expected_owner);
    if (keys.length === 0) continue;
    for (const k of keys) {
      ensure(k).items.push({
        source: "workstream",
        severity: sevFromStatus(status),
        title: `${w.name || "Workstream"} — ${status.includes("red") ? "Red" : "Yellow"}`,
        why: w.evidence || w.execution_quality,
        recommendation: w.recommended_action || "Unblock this week.",
      });
    }
  }

  return [...map.values()];
}

// ───────── Email rendering ─────────

function sevDot(s: ActionItem["severity"]): string {
  if (s === "red") return "🔴";
  if (s === "yellow") return "🟡";
  return "•";
}

function buildEmailHtml(
  bundle: OwnerBundle,
  briefing: any,
  introOverride: string | undefined,
  appUrl: string,
  dateLabel: string,
): string {
  const firstName = bundle.display_name.split(/[ (]/)[0];
  const intro = introOverride
    || `Nimesh reviewed today's CEO Briefing (${dateLabel}). The items below need you this week.`;

  const itemsHtml = bundle.items.map((it) => `
    <div style="border-left:3px solid ${it.severity === "red" ? "#dc2626" : it.severity === "yellow" ? "#ca8a04" : "#64748b"};padding:8px 12px;margin:10px 0;background:#fafafa">
      <div style="font-weight:600;color:#111;font-size:14px">${sevDot(it.severity)} ${escapeHtml(it.title)}</div>
      ${it.why ? `<div style="color:#555;font-size:13px;margin-top:4px"><strong>Why it matters:</strong> ${escapeHtml(it.why)}</div>` : ""}
      ${it.recommendation ? `<div style="color:#333;font-size:13px;margin-top:4px"><strong>Recommended next step:</strong> ${escapeHtml(it.recommendation)}</div>` : ""}
    </div>
  `).join("");

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#222">
  <p style="font-size:15px;margin:0 0 12px">Hi ${escapeHtml(firstName)},</p>
  <p style="font-size:14px;color:#444;line-height:1.5;margin:0 0 16px">${escapeHtml(intro)}</p>
  ${itemsHtml}
  <div style="margin-top:24px">
    <a href="${appUrl}/ceo" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:13px">Open CEO Briefing</a>
    <a href="${appUrl}/workstreams" style="display:inline-block;padding:10px 18px;margin-left:8px;background:#fff;color:#111;border:1px solid #ddd;text-decoration:none;border-radius:6px;font-size:13px">Open Workstreams</a>
  </div>
  <p style="color:#888;font-size:11px;margin-top:28px">— Duncan, on behalf of Nimesh</p>
</div>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ───────── Gmail helpers (mirrors send-release-emails) ─────────

async function getGmailSenderToken(supabaseAdmin: any): Promise<string | null> {
  const { data: tokenRow, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", "duncan@kabuni.com")
    .maybeSingle();
  if (error || !tokenRow) return null;

  const expiry = new Date(tokenRow.token_expiry);
  if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tokenRow.refresh_token,
        client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
        client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      console.error("Gmail token refresh failed:", await res.text());
      return null;
    }
    const refreshed = await res.json();
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
    await supabaseAdmin.from("gmail_tokens")
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
