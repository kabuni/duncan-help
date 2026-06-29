// Weekly Executive Summary orchestrator.
// Triggered by pg_cron every Monday at 08:00 UK time, or manually by an admin.
//
// New flow (no Google Drive):
//   1. Determine "last week" window (previous Mon 00:00 → Sat 00:00 UK).
//   2. Pull Gemini/Plaud meetings whose meeting_date falls in that window.
//   3. Pull workstream_cards updated/created in that window (with task activity).
//   4. Ask GPT-4o for a structured executive summary grounded ONLY in that data.
//   5. Email it via duncan@kabuni.com Gmail.
//   6. Log the run in exec_summary_runs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const RECIPIENT_EMAILS = [
  "simon@kabuni.com",
  "nimesh@kabuni.com",
  "patrick@kabuni.com",
  "ellaine@kabuni.com",
  "matt@kabuni.com",
  "parmy@kabuni.com",
  "arzoo@kabuni.com",
  "aashrey@kabuni.com",
];
const SENDER_EMAIL = "duncan@kabuni.com";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── UK timing helper (DST safe) ───────────────────────────────────────────
function ukNowParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    hour: parseInt(parts.hour, 10),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// ─── Report week (previous Mon–Fri, UK) ────────────────────────────────────
interface ReportWeek {
  monday: Date;          // last week Monday 00:00 UTC (representing UK-day boundary)
  saturdayExcl: Date;    // exclusive upper bound (Saturday 00:00) — covers Mon–Fri
  friday: Date;          // last week Friday for labels
  year: number;
  label: string;         // "22nd June - 26th June"
  isoLabel: string;      // "2026-06-22/2026-06-26"
  todayLabel: string;    // "Monday 29 June 2026"
}

function ordinalNum(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function buildReportWeek(asOf?: Date): ReportWeek {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(
    fmt.formatToParts(asOf ?? new Date()).map((x) => [x.type, x.value]),
  );
  const ukToday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const dow = ukToday.getUTCDay();                  // 0=Sun..6=Sat
  const daysBackToMon = dow === 0 ? 6 : dow - 1;
  const thisMon = new Date(ukToday);
  thisMon.setUTCDate(ukToday.getUTCDate() - daysBackToMon);
  const monday = new Date(thisMon);
  monday.setUTCDate(thisMon.getUTCDate() - 7);      // last week Monday
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);       // last week Friday
  const saturdayExcl = new Date(monday);
  saturdayExcl.setUTCDate(monday.getUTCDate() + 5); // exclusive Sat 00:00

  const monMonth = monday.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const friMonth = friday.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const label = monMonth === friMonth
    ? `${ordinalNum(monday.getUTCDate())} ${monMonth} - ${ordinalNum(friday.getUTCDate())} ${friMonth}`
    : `${ordinalNum(monday.getUTCDate())} ${monMonth} - ${ordinalNum(friday.getUTCDate())} ${friMonth}`;
  const isoLabel = `${monday.toISOString().slice(0, 10)}/${friday.toISOString().slice(0, 10)}`;
  const todayLabel = ukToday.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return {
    monday, saturdayExcl, friday,
    year: monday.getUTCFullYear(),
    label, isoLabel, todayLabel,
  };
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max) + "\n…[truncated]";
}

// ─── Data fetch: meetings & workstreams in window ──────────────────────────
interface MeetingRow {
  id: string; title: string; meeting_date: string;
  source: string | null; summary: string | null;
  action_items: any; analysis: any;
  participants: string[] | null; attendee_emails: string[] | null;
  transcript: string | null;
}

async function fetchMeetings(admin: any, w: ReportWeek): Promise<MeetingRow[]> {
  const { data, error } = await admin
    .from("meetings")
    .select("id,title,meeting_date,source,summary,action_items,analysis,participants,attendee_emails,transcript")
    .gte("meeting_date", w.monday.toISOString())
    .lt("meeting_date", w.saturdayExcl.toISOString())
    .order("meeting_date", { ascending: true });
  if (error) {
    console.warn("[weekly-exec-summary] meetings fetch failed:", error.message);
    return [];
  }
  return (data ?? []) as MeetingRow[];
}

interface CardRow {
  id: string; title: string; description: string | null;
  status: string | null; priority: string | null;
  project_tag: string | null; due_date: string | null;
  created_at: string; updated_at: string;
}

async function fetchWorkstreamCards(admin: any, w: ReportWeek): Promise<{ cards: CardRow[]; tasks: any[] }> {
  // Cards created or updated in the window.
  const { data: cards, error } = await admin
    .from("workstream_cards")
    .select("id,title,description,status,priority,project_tag,due_date,created_at,updated_at")
    .gte("updated_at", w.monday.toISOString())
    .lt("updated_at", w.saturdayExcl.toISOString())
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[weekly-exec-summary] cards fetch failed:", error.message);
    return { cards: [], tasks: [] };
  }
  const cardList = (cards ?? []) as CardRow[];
  if (!cardList.length) return { cards: [], tasks: [] };

  const ids = cardList.map((c) => c.id);
  const { data: tasks } = await admin
    .from("workstream_tasks")
    .select("id,card_id,title,status,completed,due_date,updated_at")
    .in("card_id", ids)
    .gte("updated_at", w.monday.toISOString())
    .lt("updated_at", w.saturdayExcl.toISOString());
  return { cards: cardList, tasks: tasks ?? [] };
}

// ─── Build source-data block for the model ─────────────────────────────────
function formatMeetingsBlock(meetings: MeetingRow[]): string {
  if (!meetings.length) return "No Gemini/Plaud meetings recorded in this window.";
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London",
    });
  return meetings.map((m) => {
    const parts: string[] = [];
    parts.push(`### ${fmtDate(m.meeting_date)} — ${m.title || "(untitled meeting)"}  [source: ${m.source ?? "unknown"}]`);
    const people = [
      ...(m.participants ?? []),
      ...(m.attendee_emails ?? []),
    ].filter(Boolean);
    if (people.length) parts.push(`Participants: ${Array.from(new Set(people)).slice(0, 12).join(", ")}`);
    if (m.summary) parts.push(`Summary: ${m.summary.trim()}`);
    if (m.action_items && Array.isArray(m.action_items) && m.action_items.length) {
      const items = m.action_items
        .map((a: any) => typeof a === "string" ? a : (a?.task ?? a?.title ?? JSON.stringify(a)))
        .slice(0, 20);
      parts.push(`Action items:\n- ${items.join("\n- ")}`);
    }
    if (!m.summary && m.transcript) {
      parts.push(`Transcript excerpt:\n${truncate(m.transcript.trim(), 4000)}`);
    }
    return parts.join("\n");
  }).join("\n\n");
}

function formatWorkstreamBlock(cards: CardRow[], tasks: any[]): string {
  if (!cards.length) return "No workstream card activity in this window.";
  const tasksByCard = new Map<string, any[]>();
  for (const t of tasks) {
    if (!tasksByCard.has(t.card_id)) tasksByCard.set(t.card_id, []);
    tasksByCard.get(t.card_id)!.push(t);
  }
  return cards.map((c) => {
    const lines: string[] = [];
    const created = new Date(c.created_at) >= new Date(c.updated_at) ? false : true;
    lines.push(`### ${c.title} [${c.status ?? "?"}${c.priority ? ` · ${c.priority}` : ""}]${c.project_tag ? ` (${c.project_tag})` : ""}`);
    lines.push(`Updated: ${new Date(c.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}${c.due_date ? ` · Due: ${c.due_date}` : ""}`);
    if (c.description) lines.push(truncate(c.description.replace(/\s+/g, " ").trim(), 600));
    const ts = tasksByCard.get(c.id) ?? [];
    if (ts.length) {
      lines.push(`Tasks updated this week:`);
      for (const t of ts.slice(0, 10)) {
        lines.push(`- [${t.completed ? "x" : " "}] ${t.title}${t.status ? ` (${t.status})` : ""}`);
      }
    }
    return lines.join("\n");
  }).join("\n\n");
}

// ─── OpenAI summary ───────────────────────────────────────────────────────
async function buildSummaryMarkdown(
  meetingsBlock: string,
  workstreamsBlock: string,
  meetingsCount: number,
  cardsCount: number,
  reportWeek: ReportWeek,
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const dateGrounding =
    `\n\n=== AUTHORITATIVE DATE CONTEXT (USE EXACTLY — DO NOT ALTER) ===\n` +
    `TODAY (UK): ${reportWeek.todayLabel}\n` +
    `REPORT WEEK (Mon–Fri being summarised): ${reportWeek.label} ${reportWeek.year}\n` +
    `CURRENT YEAR: ${reportWeek.year}\n` +
    `RULES:\n` +
    `- The H1 MUST read exactly: "Weekly Executive Summary — ${reportWeek.label} ${reportWeek.year}".\n` +
    `- Do NOT invent or shift years. The only year that may appear is ${reportWeek.year}.\n` +
    `- Use ONLY the meetings and workstream activity provided below. Do not invent items.\n`;

  const system =
    "You are Duncan, Kabuni's executive intelligence engine. " +
    "Produce a board-ready weekly executive summary in clean Markdown, grounded strictly in the meetings (Gemini/Plaud) and workstream-card activity provided. " +
    "Use H1 for the report title, H2 for sections, bullets where useful, and Markdown tables when comparing items. " +
    "Sections (in order): Executive Snapshot, Meetings This Week (key discussions & decisions), " +
    "Workstream Progress (RYG table: card · status · update), Wins of the Week, Risks & Blockers (with mitigations), Action Items & Owners, Key Decisions Needed. " +
    "Be concise, factual, decision-oriented. Never invent figures or events. " +
    "If a section has no data, state 'No activity recorded this week.' instead of fabricating." +
    dateGrounding;

  const user =
    `Report week: ${reportWeek.label} ${reportWeek.year} (Monday–Friday)\n` +
    `Today: ${reportWeek.todayLabel}\n` +
    `Meetings ingested: ${meetingsCount} · Workstream cards with activity: ${cardsCount}\n\n` +
    `=== MEETINGS (Gemini / Plaud) ===\n${meetingsBlock}\n\n` +
    `=== WORKSTREAM CARD ACTIVITY ===\n${workstreamsBlock}\n`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 3500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: truncate(user, 110_000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI failed: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Gmail send ───────────────────────────────────────────────────────────
async function getGmailSenderToken(admin: any): Promise<string | null> {
  const { data: row } = await admin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", SENDER_EMAIL)
    .maybeSingle();
  if (!row) return null;
  const expiry = new Date(row.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
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
    const j = await res.json();
    const newExpiry = new Date(Date.now() + j.expires_in * 1000).toISOString();
    await admin
      .from("gmail_tokens")
      .update({ access_token: j.access_token, token_expiry: newExpiry })
      .eq("id", row.id);
    return j.access_token;
  }
  return row.access_token;
}

function b64url(s: string) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(token: string, to: string, subject: string, html: string) {
  const raw = [
    `From: Duncan <${SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(raw) }),
    },
  );
  const j = await res.json();
  if (!res.ok) throw new Error(`Gmail send failed: ${JSON.stringify(j)}`);
  return j.id as string;
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inlineMd(s: string) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:13px">$1</code>');
  return out;
}

function mdToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  const flushList = (tag: "ul" | "ol", items: string[]) => {
    out.push(
      `<${tag} style="margin:8px 0 14px 22px;padding:0;color:#334155;font-size:14px;line-height:1.6">` +
        items.map((it) => `<li style="margin:4px 0">${inlineMd(it)}</li>`).join("") +
      `</${tag}>`,
    );
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (t.startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s\-:|]+\|$/)) {
      const parseRow = (l: string) => l.trim().split("|").slice(1, -1).map((c) => c.trim());
      const headers = parseRow(t);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(parseRow(lines[j])); j++;
      }
      out.push(
        `<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px">` +
        `<thead><tr>` +
          headers.map((h) => `<th style="background:#0f172a;color:#fff;text-align:left;padding:8px 10px;border:1px solid #0f172a">${inlineMd(h)}</th>`).join("") +
        `</tr></thead><tbody>` +
          rows.map((r, idx) =>
            `<tr style="background:${idx % 2 ? "#f8fafc" : "#ffffff"}">` +
              r.map((c) => `<td style="padding:8px 10px;border:1px solid #e2e8f0;color:#334155;vertical-align:top">${inlineMd(c)}</td>`).join("") +
            `</tr>`,
          ).join("") +
        `</tbody></table>`,
      );
      i = j; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, "")); i++;
      }
      flushList("ul", items); continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, "")); i++;
      }
      flushList("ol", items); continue;
    }
    if (t.startsWith("### ")) {
      out.push(`<h3 style="margin:20px 0 8px;color:#1e293b;font-size:16px">${inlineMd(t.slice(4))}</h3>`);
    } else if (t.startsWith("## ")) {
      out.push(`<h2 style="margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:19px">${inlineMd(t.slice(3))}</h2>`);
    } else if (t.startsWith("# ")) {
      out.push(`<h1 style="margin:8px 0 14px;color:#0f172a;font-size:24px">${inlineMd(t.slice(2))}</h1>`);
    } else if (/^-{3,}$/.test(t)) {
      out.push(`<hr style="border:0;border-top:1px solid #e2e8f0;margin:18px 0"/>`);
    } else {
      out.push(`<p style="margin:8px 0;color:#334155;font-size:14px;line-height:1.6">${inlineMd(t)}</p>`);
    }
    i++;
  }
  return out.join("\n");
}

function emailHtml(opts: {
  title: string;
  weekRange: string;
  meetingsCount: number;
  cardsCount: number;
  summaryMd: string;
}): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:0 auto;padding:28px;color:#1a1a1a;background:#ffffff">
  <div style="border-bottom:2px solid #0f172a;padding-bottom:14px;margin-bottom:20px">
    <h1 style="margin:0 0 4px;color:#0f172a;font-size:24px">${escapeHtml(opts.title)}</h1>
    <div style="color:#64748b;font-size:13px">${escapeHtml(opts.weekRange)} &nbsp;·&nbsp; <strong>${opts.meetingsCount}</strong> meeting${opts.meetingsCount === 1 ? "" : "s"} &nbsp;·&nbsp; <strong>${opts.cardsCount}</strong> workstream card${opts.cardsCount === 1 ? "" : "s"}</div>
  </div>
  ${mdToHtml(opts.summaryMd)}
  <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;text-align:center">
    Confidential — Kabuni — Generated automatically by Duncan
  </div>
</div>`;
}

// ─── Auth: admin or cron ──────────────────────────────────────────────────
async function authorize(req: Request, admin: any): Promise<
  { ok: true; source: "cron" | "admin"; userId: string | null } | { ok: false; res: Response }
> {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret === "duncan-weekly-exec") {
    return { ok: true, source: "cron", userId: null };
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, res: json({ error: "Unauthorized" }, 401) };
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return { ok: false, res: json({ error: "Admin only" }, 403) };
  return { ok: true, source: "admin", userId: user.id };
}

// ─── Main handler ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const authz = await authorize(req, admin);
  if (!authz.ok) return authz.res;

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body fine */ }
  const force = body?.force === true;
  const overrideRaw: unknown = body?.recipient_override;
  const overrideList: string[] = Array.isArray(overrideRaw)
    ? overrideRaw.map((x) => String(x))
    : typeof overrideRaw === "string" ? overrideRaw.split(",") : [];
  const validRecipients = overrideList
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  const effectiveRecipients = validRecipients.length ? validRecipients : [...RECIPIENT_EMAILS];
  const recipientHeader = effectiveRecipients.join(", ");

  // DST-safe gate: cron fires Monday 08:00 UK only.
  if (authz.source === "cron" && !force) {
    const uk = ukNowParts();
    if (uk.weekday !== "Mon" || uk.hour !== 8) {
      return json({ skipped: true, reason: `Not 08:00 UK Mon (got ${uk.weekday} ${uk.hour}:00)` });
    }
  }

  const uk = ukNowParts();
  const baseKey = `weekly-${uk.isoDate}`;
  const runKey = authz.source === "cron"
    ? (force ? `${baseKey}-force-${Date.now()}` : baseKey)
    : `manual-${uk.isoDate}-${Date.now()}`;

  if (authz.source === "cron" && !force) {
    const { data: existing } = await admin
      .from("exec_summary_runs")
      .select("id,status,run_key")
      .eq("run_key", runKey)
      .maybeSingle();
    if (existing) {
      return json({ skipped: true, reason: "Already ran today", run_id: existing.id });
    }
  }

  const { data: runRow, error: insErr } = await admin
    .from("exec_summary_runs")
    .insert({
      run_key: runKey,
      status: "running",
      trigger_source: authz.source,
      triggered_by: authz.userId,
      recipient: recipientHeader,
    })
    .select()
    .single();
  if (insErr || !runRow) {
    return json({ error: `Failed to create run row: ${insErr?.message}` }, 500);
  }
  const runId = runRow.id;

  const fail = async (err: unknown, details?: Record<string, unknown>) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[weekly-exec-summary ${runId}]`, msg, details);
    await admin.from("exec_summary_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: msg,
      error_details: details ?? null,
    }).eq("id", runId);
    return json({ error: msg, run_id: runId }, 500);
  };

  try {
    const asOfRaw = typeof body?.as_of === "string" ? body.as_of : null;
    const asOfDate = asOfRaw ? new Date(asOfRaw) : undefined;
    const reportWeek = buildReportWeek(asOfDate && !isNaN(asOfDate.getTime()) ? asOfDate : undefined);
    const weekRange = reportWeek.label;

    // Pull source data — meetings + workstreams in last-week window.
    const [meetings, ws] = await Promise.all([
      fetchMeetings(admin, reportWeek),
      fetchWorkstreamCards(admin, reportWeek),
    ]);

    const meetingsBlock = formatMeetingsBlock(meetings);
    const workstreamsBlock = formatWorkstreamBlock(ws.cards, ws.tasks);

    await admin.from("exec_summary_runs").update({
      file_count: meetings.length + ws.cards.length,
      files_processed: {
        meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.meeting_date, source: m.source })),
        cards: ws.cards.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      },
    }).eq("id", runId);

    if (meetings.length === 0 && ws.cards.length === 0) {
      throw new Error(
        `No meetings or workstream activity found between ${reportWeek.monday.toISOString().slice(0, 10)} and ${reportWeek.friday.toISOString().slice(0, 10)}.`,
      );
    }

    const summaryMd = await buildSummaryMarkdown(
      meetingsBlock,
      workstreamsBlock,
      meetings.length,
      ws.cards.length,
      reportWeek,
    );
    if (!summaryMd) throw new Error("OpenAI returned empty summary");

    const title = "Weekly Executive Summary";
    const subject = `Weekly Executive Summary | ${weekRange} ${reportWeek.year}`;

    await admin.from("exec_summary_runs").update({
      summary_chars: summaryMd.length,
    }).eq("id", runId);

    const gmailToken = await getGmailSenderToken(admin);
    if (!gmailToken) throw new Error("Gmail sender token (duncan@kabuni.com) unavailable");

    const html = emailHtml({
      title,
      weekRange: `${weekRange} ${reportWeek.year}`,
      meetingsCount: meetings.length,
      cardsCount: ws.cards.length,
      summaryMd,
    });
    const messageId = await sendEmail(gmailToken, recipientHeader, subject, html);

    await admin.from("exec_summary_runs").update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      email_message_id: messageId,
    }).eq("id", runId);

    return json({
      success: true,
      run_id: runId,
      meetings: meetings.length,
      workstream_cards: ws.cards.length,
      recipients: effectiveRecipients,
      subject,
      week_range: `${weekRange} ${reportWeek.year}`,
    });
  } catch (e) {
    return fail(e);
  }
});
