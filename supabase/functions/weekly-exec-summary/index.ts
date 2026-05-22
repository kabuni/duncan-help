// Weekly Executive Summary orchestrator.
// Triggered by pg_cron every Monday at 08:00 UK time, or manually by an admin.
//
// Flow:
//   1. Resolve latest weekly folder under the configured parent Drive folder.
//   2. Read every Google Doc / DOCX inside, extract text.
//   3. Ask GPT-4o for a structured executive summary.
//   4. Call generate-exec-summary to produce a branded DOCX in Azure Blob.
//   5. Mint a signed download token and email it to the recipient.
//   6. Log the entire run in exec_summary_runs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PARENT_FOLDER_ID = "1R5JxrnLsSGPu4iRMqn02oCOHmGbRSW7G";
const RECIPIENT_EMAILS = ["simon@kabuni.com", "palash@kabuni.com"];
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
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    weekday: parts.weekday,
    hour: parseInt(parts.hour, 10),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

// ─── Google Drive helpers ──────────────────────────────────────────────────
async function refreshGoogleToken(refresh: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Drive token refresh failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function getDriveToken(admin: any): Promise<string> {
  const { data: row } = await admin
    .from("google_drive_tokens")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) throw new Error("Google Drive not connected");

  const expiry = new Date(row.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const fresh = await refreshGoogleToken(row.refresh_token);
    const newExpiry = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
    await admin
      .from("google_drive_tokens")
      .update({ access_token: fresh.access_token, token_expiry: newExpiry })
      .eq("id", row.id);
    return fresh.access_token;
  }
  return row.access_token;
}

async function driveFetch(token: string, url: string): Promise<Response> {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

async function findLatestWeeklyFolder(token: string) {
  // List subfolders ordered by createdTime desc — deterministic "latest".
  const q = encodeURIComponent(
    `'${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name,createdTime,modifiedTime)` +
    `&orderBy=createdTime%20desc&pageSize=10`;
  const res = await driveFetch(token, url);
  if (!res.ok) throw new Error(`Drive folder list failed: ${await res.text()}`);
  const data = await res.json();
  const folders = data.files ?? [];
  if (!folders.length) throw new Error("No weekly subfolders found in the configured parent folder");
  return folders[0] as { id: string; name: string; createdTime: string };
}

async function listFolderFiles(token: string, folderId: string) {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and (` +
      `mimeType = 'application/vnd.google-apps.document' or ` +
      `mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'` +
    `)`
  );
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=100`;
  const res = await driveFetch(token, url);
  if (!res.ok) throw new Error(`Drive file list failed: ${await res.text()}`);
  return (await res.json()).files ?? [];
}

async function extractGoogleDoc(token: string, fileId: string): Promise<string> {
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
  );
  if (!res.ok) throw new Error(`Doc export failed: ${await res.text()}`);
  return await res.text();
}

async function extractDocx(token: string, fileId: string): Promise<string> {
  const res = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  if (!res.ok) throw new Error(`DOCX download failed: ${await res.text()}`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) return "";
  // Insert newlines for paragraph breaks, then strip XML, then collapse spaces.
  const withBreaks = docXml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\b[^/]*\/>/g, "\t");
  const text = withBreaks.replace(/<[^>]+>/g, "");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max) + "\n…[truncated]";
}

// ─── Canonical reporting window (UK time, DST-safe) ───────────────────────
// One source of truth used by the subject, email subtitle, GPT prompt, and
// planner section. Never hardcode dates anywhere else in this file.
interface ReportingWindow {
  prevMonIso: string;
  prevFriIso: string;
  prevRangeShort: string;   // "11th May - 15th May"
  prevRangeLong: string;    // "Monday 11 May 2026 – Friday 15 May 2026"
  prevHeading: string;      // "Week of 11 May 2026"
  upcomingMonIso: string;
  upcomingSunIso: string;
  upcomingStartUtc: string;
  upcomingEndUtc: string;
  upcomingMondayLabel: string;
  upcomingSundayLabel: string;
  ukYear: number;
  generatedAtUk: string;
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function buildReportingWindow(): ReportingWindow {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const ukYear = +parts.year;
  const ukToday = new Date(Date.UTC(ukYear, +parts.month - 1, +parts.day));
  const dow = ukToday.getUTCDay();
  const daysBackToMon = dow === 0 ? 6 : dow - 1;
  const thisMon = new Date(ukToday); thisMon.setUTCDate(ukToday.getUTCDate() - daysBackToMon);
  const prevMon = new Date(thisMon); prevMon.setUTCDate(thisMon.getUTCDate() - 7);
  const prevFri = new Date(prevMon); prevFri.setUTCDate(prevMon.getUTCDate() + 4);
  const upcomingMon = thisMon;
  const upcomingSun = new Date(thisMon); upcomingSun.setUTCDate(thisMon.getUTCDate() + 6);
  const upcomingEndExclusive = new Date(thisMon); upcomingEndExclusive.setUTCDate(thisMon.getUTCDate() + 7);

  const isoDate = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const monthName = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const longDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const dayMonth = (d: Date) =>
    d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const nowFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return {
    prevMonIso: isoDate(prevMon),
    prevFriIso: isoDate(prevFri),
    prevRangeShort: `${ordinal(prevMon.getUTCDate())} ${monthName(prevMon)} - ${ordinal(prevFri.getUTCDate())} ${monthName(prevFri)}`,
    prevRangeLong: `${longDate(prevMon)} – ${longDate(prevFri)}`,
    prevHeading: `Week of ${prevMon.getUTCDate()} ${monthName(prevMon)} ${prevMon.getUTCFullYear()}`,
    upcomingMonIso: isoDate(upcomingMon),
    upcomingSunIso: isoDate(upcomingSun),
    upcomingStartUtc: upcomingMon.toISOString(),
    upcomingEndUtc: upcomingEndExclusive.toISOString(),
    upcomingMondayLabel: dayMonth(upcomingMon),
    upcomingSundayLabel: dayMonth(upcomingSun),
    ukYear,
    generatedAtUk: `${nowFmt.format(new Date())} UK`,
  };
}

interface PlannerEvent {
  weekday: string; day: string; title: string; category: string | null; description: string | null;
  startIso: string;
}

async function fetchUpcomingPlannerEvents(
  admin: any,
  window: ReportingWindow,
): Promise<PlannerEvent[]> {
  const { data, error } = await admin
    .from("key_events")
    .select("title, start_at, category, raw_description, status, deleted_in_google")
    .gte("start_at", window.upcomingStartUtc)
    .lt("start_at", window.upcomingEndUtc)
    .eq("deleted_in_google", false)
    .order("start_at", { ascending: true });
  if (error) {
    console.warn("[weekly-exec-summary] planner fetch failed:", error.message);
    return [];
  }
  const dayFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short",
  });
  const seen = new Set<string>();
  const events: PlannerEvent[] = [];
  for (const r of (data ?? [])) {
    if (!r.start_at) continue;
    const title = (r.title ?? "").trim();
    if (!title) continue;
    const status = (r.status ?? "").toLowerCase();
    if (["cancelled", "canceled", "archived", "draft"].includes(status)) continue;
    if (/^(tbc|tbd|placeholder|untitled|test)\b/i.test(title)) continue;

    const parts = Object.fromEntries(
      dayFmt.formatToParts(new Date(r.start_at)).map((p) => [p.type, p.value])
    );
    const weekday = parts.weekday;
    const dayLabel = `${parts.weekday} ${parts.day} ${parts.month}`;
    const desc = (r.raw_description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const shortDesc = desc ? (desc.length > 140 ? desc.slice(0, 137) + "…" : desc) : null;
    const dedupKey = `${weekday}::${title.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    events.push({
      weekday, day: dayLabel, title, category: r.category ?? null,
      description: shortDesc, startIso: r.start_at,
    });
  }
  return events;
}

function formatPlannerBlock(
  events: PlannerEvent[],
  window: ReportingWindow,
): string {
  if (!events.length) {
    return `Upcoming This Week (${range.mondayLabel} – ${range.sundayLabel}):\n- No planner events scheduled.`;
  }
  const lines = [`Upcoming This Week (${range.mondayLabel} – ${range.sundayLabel}):`];
  for (const e of events) {
    const cat = e.category ? ` [${e.category}]` : "";
    const desc = e.description ? ` — ${e.description}` : "";
    lines.push(`- ${e.day} — ${e.title}${cat}${desc}`);
  }
  return lines.join("\n");
}

function plannerHashInput(events: PlannerEvent[]): string {
  return events
    .map((e) => `${e.startIso}|${e.title}|${e.category ?? ""}`)
    .sort()
    .join("\n");
}

// ─── OpenAI summary ───────────────────────────────────────────────────────
async function buildSummaryMarkdown(
  folderName: string,
  fileBlocks: string,
  plannerBlock: string,
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const system =
    "You are Duncan, Kabuni's executive intelligence engine. " +
    "Produce a board-ready weekly executive summary in clean Markdown. " +
    "Use H1 for the report title, H2 for sections, bullets where useful, and Markdown tables when comparing items. " +
    "Sections (in order): Executive Snapshot, Performance Overview (RYG table), " +
    "Wins of the Week, Risks & Blockers (with mitigations), Key Decisions Needed, " +
    "Cross-Department Highlights, Upcoming This Week. " +
    "For the 'Upcoming This Week' section, use ONLY the planner schedule provided below — " +
    "group bullets by weekday in chronological order, keep it concise, and do not invent events. " +
    "Keep 'Upcoming This Week' to a short, scannable list; it must NOT dominate the report. " +
    "Be concise, factual, decision-oriented. Never invent figures.";

  const user =
    `Folder: ${folderName}\n\n` +
    `=== PLANNER SCHEDULE (upcoming week, UK time) ===\n${plannerBlock}\n\n` +
    `=== PREVIOUS WEEK SOURCE REPORTS ===\n` +
    `Source reports from the last week are below. Synthesise across them.\n\n` +
    fileBlocks;

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
    }
  );
  const j = await res.json();
  if (!res.ok) throw new Error(`Gmail send failed: ${JSON.stringify(j)}`);
  return j.id as string;
}

// ─── Markdown → HTML (lightweight, email-safe) ────────────────────────────
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
      `</${tag}>`
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    // Table
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
            `</tr>`
          ).join("") +
        `</tbody></table>`
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
  title: string; weekRange: string; folderName: string;
  fileCount: number; summaryMd: string;
}): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:0 auto;padding:28px;color:#1a1a1a;background:#ffffff">
  <div style="border-bottom:2px solid #0f172a;padding-bottom:14px;margin-bottom:20px">
    <h1 style="margin:0 0 4px;color:#0f172a;font-size:24px">${escapeHtml(opts.title)}</h1>
    <div style="color:#64748b;font-size:13px">${escapeHtml(opts.weekRange)} &nbsp;·&nbsp; synthesised from <strong>${opts.fileCount}</strong> source report${opts.fileCount === 1 ? "" : "s"} in <em>${escapeHtml(opts.folderName)}</em></div>
  </div>
  ${mdToHtml(opts.summaryMd)}
  <div style="margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;text-align:center">
    Confidential — Kabuni — Generated automatically by Duncan
  </div>
</div>`;
}

// ─── Week range "11th May - 15th May" (last Mon–Fri in UK time) ───────────
function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function lastWeekRangeLabel(): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const ukToday = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  const dow = ukToday.getUTCDay();
  const daysBackToMon = dow === 0 ? 6 : dow - 1;
  const thisMon = new Date(ukToday); thisMon.setUTCDate(ukToday.getUTCDate() - daysBackToMon);
  const lastMon = new Date(thisMon); lastMon.setUTCDate(thisMon.getUTCDate() - 7);
  const lastFri = new Date(lastMon); lastFri.setUTCDate(lastMon.getUTCDate() + 4);
  const monthName = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${ordinal(lastMon.getUTCDate())} ${monthName(lastMon)} - ${ordinal(lastFri.getUTCDate())} ${monthName(lastFri)}`;
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
    { global: { headers: { Authorization: authHeader } } }
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

  // Parse body
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body fine */ }
  const force = body?.force === true;
  const skipDedup = body?.skip_dedup === true;
  const allowEmptyFolder = body?.allow_empty_folder === true;
  // Optional one-off recipient override. Accepts string, comma-separated list, or array.
  // Production cron always emails RECIPIENT_EMAILS unless explicitly overridden.
  const overrideRaw: unknown = body?.recipient_override;
  const overrideList: string[] = Array.isArray(overrideRaw) ? overrideRaw.map((x) => String(x)) : typeof overrideRaw === "string" ? overrideRaw.split(",") : [];
  const validRecipients = overrideList.map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  const effectiveRecipients = validRecipients.length ? validRecipients : [...RECIPIENT_EMAILS];
  const recipientHeader = effectiveRecipients.join(", ");

  // DST-safe gate: cron fires at 07:00 and 08:00 UTC every Monday; only run at 08:00 UK local.
  // `force: true` bypasses the time gate (used for admin-triggered test runs over the cron channel).
  if (authz.source === "cron" && !force) {
    const uk = ukNowParts();
    if (uk.weekday !== "Mon" || uk.hour !== 8) {
      return json({ skipped: true, reason: `Not 08:00 UK Mon (got ${uk.weekday} ${uk.hour}:00)` });
    }
  }

  const uk = ukNowParts();
  const baseKey = `weekly-${uk.isoDate}`;
  // For cron-source forced runs (admin test sends via cron-secret), append a suffix
  // so we never collide with the real weekly idempotency key.
  const runKey = authz.source === "cron"
    ? (force ? `${baseKey}-force-${Date.now()}` : baseKey)
    : `manual-${uk.isoDate}-${Date.now()}`;

  // Idempotency: refuse duplicate real cron runs for the same day.
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


  // Create run row
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
    // 1. Drive token
    const driveToken = await getDriveToken(admin);

    // 2. Latest weekly folder
    const folder = await findLatestWeeklyFolder(driveToken);
    await admin.from("exec_summary_runs").update({
      folder_id: folder.id, folder_name: folder.name,
    }).eq("id", runId);

    // 3. List + extract
    const files = await listFolderFiles(driveToken, folder.id);
    if (!files.length && !allowEmptyFolder) throw new Error(`No Google Docs or DOCX files in folder "${folder.name}"`);

    const processed: Array<{ id: string; name: string; chars: number; type: string }> = [];
    const failed: Array<{ id: string; name: string; error: string }> = [];
    const blocks: string[] = [];

    for (const f of files) {
      try {
        const isGdoc = f.mimeType === "application/vnd.google-apps.document";
        const text = isGdoc
          ? await extractGoogleDoc(driveToken, f.id)
          : await extractDocx(driveToken, f.id);
        const clean = truncate(text.trim(), 25_000);
        if (!clean) {
          failed.push({ id: f.id, name: f.name, error: "Empty after extraction" });
          continue;
        }
        processed.push({ id: f.id, name: f.name, chars: clean.length, type: isGdoc ? "gdoc" : "docx" });
        blocks.push(`\n\n=== ${f.name} (${isGdoc ? "Google Doc" : "DOCX"}) ===\n${clean}`);
      } catch (e) {
        failed.push({ id: f.id, name: f.name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const emptyFallback = processed.length === 0;
    if (emptyFallback && !allowEmptyFolder) {
      throw new Error("All file extractions failed — nothing to summarise");
    }
    if (emptyFallback) {
      blocks.push(
        `\n\n=== NO WEEKLY SOURCE REPORTS AVAILABLE ===\n` +
        `The Drive folder "${folder.name}" contained no readable Google Docs or DOCX files for the previous week. ` +
        `Generate a brief fallback Executive Snapshot that explicitly notes "No weekly source reports were available for this period", ` +
        `omit RYG/Wins/Risks tables that would require source data (or render them with a single 'No data' row), ` +
        `and still produce the full 'Upcoming This Week' section from the planner schedule below.`
      );
    }

    // Fetch upcoming planner events (Mon → Sun, UK) before hashing/synthesis.
    const { events: plannerEvents, range: plannerRange } = await fetchUpcomingPlannerEvents(admin);
    const plannerBlock = formatPlannerBlock(plannerEvents, plannerRange);

    // Compute deterministic content hash from processed files + planner schedule.
    // Planner data participates in the hash so that planner-only changes still
    // regenerate the email even when Drive docs are unchanged.
    const fingerprintInput = files
      .map((f: any) => `${f.id}|${f.modifiedTime ?? ""}|${f.size ?? ""}`)
      .sort()
      .join("\n")
      + `\n#count=${processed.length}\n#chars=${processed.reduce((a, p) => a + p.chars, 0)}`
      + `\n#planner_range=${plannerRange.startUtc}..${plannerRange.endUtc}`
      + `\n#planner=\n${plannerHashInput(plannerEvents)}`;
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintInput));
    const contentHash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    await admin.from("exec_summary_runs").update({
      files_processed: processed,
      file_count: processed.length,
      failed_files: failed,
      content_hash: contentHash,
    }).eq("id", runId);

    // Duplicate-content protection: skip if an earlier successful run for the same folder
    // produced the same hash. `skip_dedup: true` (or `force: true`) bypasses this gate.
    if (!skipDedup && !force) {
      const { data: prior } = await admin
        .from("exec_summary_runs")
        .select("id,started_at,email_message_id")
        .eq("folder_id", folder.id)
        .eq("content_hash", contentHash)
        .eq("status", "succeeded")
        .neq("id", runId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prior) {
        await admin.from("exec_summary_runs").update({
          status: "skipped_no_changes",
          finished_at: new Date().toISOString(),
          error: `Identical content already sent in run ${prior.id}`,
        }).eq("id", runId);
        return json({
          skipped: true,
          reason: "skipped_no_changes",
          run_id: runId,
          previous_run_id: prior.id,
          folder: folder.name,
          content_hash: contentHash,
        });
      }
    }

    // 4. GPT-4o summary
    const summaryMd = await buildSummaryMarkdown(folder.name, blocks.join("\n"), plannerBlock);
    if (!summaryMd) throw new Error("OpenAI returned empty summary");

    const weekRange = lastWeekRangeLabel();
    const title = "Weekly Executive Summary";
    // ASCII-only subject — uses " | " and "-" (no em dashes) so Gmail/Outlook
    // render it cleanly without MIME encoded-word wrapping.
    const subject = `Weekly Executive Summary | ${weekRange}`;

    await admin.from("exec_summary_runs").update({
      summary_chars: summaryMd.length,
    }).eq("id", runId);

    // 5. Email — full summary embedded in HTML body (no attachments, no link)
    const gmailToken = await getGmailSenderToken(admin);
    if (!gmailToken) throw new Error("Gmail sender token (duncan@kabuni.com) unavailable");

    const html = emailHtml({
      title, weekRange, folderName: folder.name,
      fileCount: processed.length, summaryMd,
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
      folder: folder.name,
      files_processed: processed.length,
      failed_files: failed.length,
      recipients: effectiveRecipients,
      content_hash: contentHash,
      subject,
      week_range: weekRange,
    });
  } catch (e) {
    return fail(e);
  }
});
