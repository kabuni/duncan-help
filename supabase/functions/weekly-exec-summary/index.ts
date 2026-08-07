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
import JSZip from "https://esm.sh/jszip@3.10.1";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

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
  "tim@kabuni.com",
  "palash@kabuni.com",
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

// ─── Report week (previous Mon–Sun, UK) ────────────────────────────────────
interface ReportWeek {
  monday: Date;          // last week Monday 00:00 UTC
  saturdayExcl: Date;    // EXCLUSIVE upper bound = next Monday 00:00 (kept name for compat; covers Mon–Sun)
  friday: Date;          // last week Friday (kept for label back-compat)
  sunday: Date;          // last week Sunday
  year: number;
  label: string;         // "29th June - 5th July"
  isoLabel: string;      // "2026-06-29/2026-07-05"
  todayLabel: string;    // "Monday 6 July 2026"
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
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);       // last week Sunday
  const saturdayExcl = new Date(monday);
  saturdayExcl.setUTCDate(monday.getUTCDate() + 7); // exclusive next-Mon 00:00 → covers Mon–Sun

  const monMonth = monday.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const sunMonth = sunday.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const label = monMonth === sunMonth
    ? `${ordinalNum(monday.getUTCDate())} - ${ordinalNum(sunday.getUTCDate())} ${sunMonth}`
    : `${ordinalNum(monday.getUTCDate())} ${monMonth} - ${ordinalNum(sunday.getUTCDate())} ${sunMonth}`;
  const isoLabel = `${monday.toISOString().slice(0, 10)}/${sunday.toISOString().slice(0, 10)}`;
  const todayLabel = ukToday.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return {
    monday, saturdayExcl, friday, sunday,
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

// ─── 90 Day Tracker (Plan 90) weekly change digest ─────────────────────────
async function fetchPlan90Changes(admin: any, w: ReportWeek): Promise<string> {
  const from = w.monday.toISOString();
  // Tracker updates are often entered retrospectively (after the reporting week
  // has closed). Extend the upper bound to "now" so late entries are captured
  // instead of silently falling outside the Mon–Sun window.
  const now = new Date();
  const to = new Date(Math.max(w.saturdayExcl.getTime(), now.getTime())).toISOString();


  const [{ data: wsRows }, { data: delRows }] = await Promise.all([
    admin.from("plan90_workstreams").select("id,name,archived").order("display_order"),
    admin.from("plan90_deliverables").select("id,workstream_id,title,status,priority,owner_display_name,due_date,updated_at,archived"),
  ]);

  const workstreams = ((wsRows ?? []) as any[]).filter((x) => !x.archived);
  if (!workstreams.length) return "No 90 Day Tracker workstreams configured.";

  const deliverables = ((delRows ?? []) as any[]).filter((d) => !d.archived);
  const delById = new Map(deliverables.map((d) => [d.id, d]));

  const { data: updRows } = await admin
    .from("plan90_deliverable_updates")
    .select("id,deliverable_id,author_name,message,ryg,created_at")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: true });
  const updates = (updRows ?? []) as any[];

  // Keep ONLY the most recent update per deliverable within the reporting period
  const latestByDeliverable = new Map<string, any>();
  for (const u of updates) {
    const d = delById.get(u.deliverable_id);
    if (!d) continue;
    const prev = latestByDeliverable.get(u.deliverable_id);
    if (!prev || u.created_at > prev.created_at) {
      latestByDeliverable.set(u.deliverable_id, { ...u, deliverable: d });
    }
  }

  if (!latestByDeliverable.size) {
    return "No 90-Day Tracker updates were recorded this week.";
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const byWs = new Map<string, any[]>();
  for (const u of latestByDeliverable.values()) {
    const arr = byWs.get(u.deliverable.workstream_id) ?? [];
    arr.push(u);
    byWs.set(u.deliverable.workstream_id, arr);
  }

  const clean = (s: string) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  const rygDot = (r?: string) => {
    const v = String(r ?? "").toLowerCase();
    if (v.startsWith("g")) return "🟢";
    if (v.startsWith("a") || v.startsWith("y")) return "🟡";
    if (v.startsWith("r")) return "🔴";
    return "⚪";
  };

  const sections: string[] = [];
  for (const ws of workstreams) {
    const ups = byWs.get(ws.id);
    if (!ups?.length) continue; // omit workstreams with no updates this week
    ups.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const lines: string[] = [
      `#### ${ws.name}`,
      ``,
      `| | Deliverable | Latest update | Updated by | Date |`,
      `| --- | --- | --- | --- | --- |`,
    ];
    for (const u of ups) {
      const msg = clean(u.message);
      lines.push(
        `| ${rygDot(u.ryg)} | **${clean(u.deliverable.title)}** | ${msg.length > 320 ? msg.slice(0, 317) + "…" : msg} | ${clean(u.author_name) || "Unknown"} | ${fmtDate(u.created_at)} |`,
      );
    }
    sections.push(lines.join("\n"));
  }


  if (!sections.length) return "No 90-Day Tracker updates were recorded this week.";
  return sections.join("\n\n");
}

// ─── Weekly Capacity Dashboard (Knowledge Base) ────────────────────────────
// Finds the most recently uploaded "Weekly Capacity Dashboard" (or Weekly
// Capacity & Delivery report) relevant to the reporting period and returns its
// extracted text. Returns "" when none exists → section is omitted entirely.
async function fetchCapacityDashboard(admin: any, w: ReportWeek): Promise<string> {
  const from = w.monday.toISOString();
  // Dashboards are frequently uploaded after the week closes, so accept
  // anything uploaded from the start of the reporting week up to now.
  const to = new Date(Math.max(w.saturdayExcl.getTime(), Date.now())).toISOString();

  const { data: docs, error } = await admin
    .from("documents")
    .select("id,title,file_name,created_at,status")
    .eq("status", "ready")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.warn("[weekly-exec-summary] capacity dashboard lookup failed:", error.message);
    return "";
  }

  const matches = ((docs ?? []) as any[]).filter((d) => {
    const hay = `${d.title ?? ""} ${d.file_name ?? ""}`.toLowerCase();
    return hay.includes("capacity") &&
      (hay.includes("dashboard") || hay.includes("weekly") || hay.includes("delivery"));
  });
  if (!matches.length) return "";

  const doc = matches[0]; // most recently uploaded
  const { data: chunks } = await admin
    .from("document_chunks")
    .select("content,chunk_index")
    .eq("document_id", doc.id)
    .order("chunk_index", { ascending: true });

  const text = ((chunks ?? []) as any[]).map((c) => c.content).join("\n").trim();
  if (!text) return "";

  const uploaded = new Date(doc.created_at).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
  return `Document: ${doc.file_name} (uploaded ${uploaded})\n\n${truncate(text, 30_000)}`;
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

// ─── Inbox scan across all opted-in users (Mon–Sun) ────────────────────────
async function refreshGmailAccess(refreshToken: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  return r.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidUserGmailToken(admin: any, row: any): Promise<string | null> {
  const expiry = new Date(row.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const j = await refreshGmailAccess(row.refresh_token);
    if (!j) return null;
    const newExpiry = new Date(Date.now() + j.expires_in * 1000).toISOString();
    await admin.from("gmail_tokens")
      .update({ access_token: j.access_token, token_expiry: newExpiry })
      .eq("id", row.id);
    return j.access_token;
  }
  return row.access_token;
}

function gmailHeader(hs: any[], name: string): string {
  return hs?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

async function fetchMailboxLastWeek(accessToken: string, w: ReportWeek) {
  const after = Math.floor(w.monday.getTime() / 1000);
  const before = Math.floor(w.saturdayExcl.getTime() / 1000);
  const q = `after:${after} before:${before} (in:inbox OR in:sent) -category:promotions -category:social`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=80&q=${encodeURIComponent(q)}`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const ids: string[] = (listData.messages || []).map((m: any) => m.id).slice(0, 80);
  if (!ids.length) return [];
  const msgs = await Promise.all(ids.map(async (id) => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) return null;
    const m = await r.json();
    const h = m.payload?.headers || [];
    return {
      id: m.id,
      from: gmailHeader(h, "From"),
      to: gmailHeader(h, "To"),
      subject: gmailHeader(h, "Subject"),
      date: gmailHeader(h, "Date"),
      snippet: m.snippet || "",
      direction: (m.labelIds || []).includes("SENT") ? "sent" : "received",
    };
  }));
  return msgs.filter(Boolean) as any[];
}

async function extractSignalsLLM(owner: string, messages: any[]): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const empty = { commitments: [], risks: [], escalations: [], board_mentions: [], customer_issues: [], vendor_signals: [] };
  if (!apiKey || !messages.length) return empty;
  const compact = messages.map((m) => ({
    from: m.from, to: m.to, subject: m.subject, date: m.date, direction: m.direction, snippet: m.snippet,
  }));
  const sys = `You extract executive signals from one mailbox (owner: ${owner}) over a 7-day window. Return ONLY raw JSON, no markdown.`;
  const usr = `Messages (last week):
${JSON.stringify(compact).slice(0, 60000)}

Return JSON:
{
  "commitments":[{"owner":string,"what":string,"due":string|null}],
  "risks":[{"severity":"low"|"medium"|"high"|"critical","summary":string,"who_flagged":string}],
  "escalations":[{"from":string,"to":string,"topic":string,"urgency":"low"|"medium"|"high"}],
  "board_mentions":[{"topic":string,"sender":string}],
  "customer_issues":[{"company":string,"issue":string,"severity":"low"|"medium"|"high"}],
  "vendor_signals":[{"vendor":string,"signal":string,"amount":string|null}]
}
RULES: Empty arrays OK. Skip newsletters, calendar invites, recruiter spam, personal. Under 20 words each.`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      }),
    });
    if (!r.ok) return empty;
    const j = await r.json();
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return { ...empty, ...parsed };
  } catch { return empty; }
}

interface InboxAggregate {
  mailboxes_scanned: number;
  emails_scanned: number;
  per_mailbox: Array<{ mailbox: string; emails: number; status: string }>;
  signals: {
    commitments: any[]; risks: any[]; escalations: any[];
    board_mentions: any[]; customer_issues: any[]; vendor_signals: any[];
  };
}

async function scanAllOptedInInboxes(admin: any, w: ReportWeek): Promise<InboxAggregate> {
  const empty: InboxAggregate = {
    mailboxes_scanned: 0, emails_scanned: 0, per_mailbox: [],
    signals: { commitments: [], risks: [], escalations: [], board_mentions: [], customer_issues: [], vendor_signals: [] },
  };
  const { data: tokens } = await admin
    .from("gmail_tokens")
    .select("id, connected_by, email_address, access_token, refresh_token, token_expiry");
  if (!tokens?.length) return empty;
  const { data: profs } = await admin
    .from("gmail_writing_profiles")
    .select("user_id, ceo_briefing_optin");
  const optin = new Set((profs || []).filter((p: any) => p.ceo_briefing_optin).map((p: any) => p.user_id));
  const eligible = tokens.filter((t: any) => optin.has(t.connected_by));
  const per: any[] = [];
  const agg = { commitments: [] as any[], risks: [] as any[], escalations: [] as any[], board_mentions: [] as any[], customer_issues: [] as any[], vendor_signals: [] as any[] };
  let totalEmails = 0;
  const results = await Promise.all(eligible.map(async (t: any) => {
    try {
      const tok = await getValidUserGmailToken(admin, t);
      if (!tok) return { mailbox: t.email_address, emails: 0, status: "auth_failed", sig: null };
      const msgs = await fetchMailboxLastWeek(tok, w);
      const sig = await extractSignalsLLM(t.email_address || "unknown", msgs);
      return { mailbox: t.email_address || "unknown", emails: msgs.length, status: "ok", sig };
    } catch (e: any) {
      return { mailbox: t.email_address, emails: 0, status: `error:${e?.message || e}`, sig: null };
    }
  }));
  for (const r of results) {
    per.push({ mailbox: r.mailbox, emails: r.emails, status: r.status });
    totalEmails += r.emails;
    if (!r.sig) continue;
    const tag = (arr: any[]) => arr.map((x) => ({ ...x, _mailbox: r.mailbox }));
    agg.commitments.push(...tag(r.sig.commitments || []));
    agg.risks.push(...tag(r.sig.risks || []));
    agg.escalations.push(...tag(r.sig.escalations || []));
    agg.board_mentions.push(...tag(r.sig.board_mentions || []));
    agg.customer_issues.push(...tag(r.sig.customer_issues || []));
    agg.vendor_signals.push(...tag(r.sig.vendor_signals || []));
  }
  return { mailboxes_scanned: eligible.length, emails_scanned: totalEmails, per_mailbox: per, signals: agg };
}

function formatInboxSignalsBlock(agg: InboxAggregate): string {
  if (agg.mailboxes_scanned === 0) return "No opted-in mailboxes were scanned for inbox signals.";
  const parts: string[] = [];
  parts.push(`Scanned **${agg.mailboxes_scanned}** mailboxes · **${agg.emails_scanned}** emails.`);
  const s = agg.signals;
  const dump = (label: string, arr: any[]) => {
    if (!arr.length) return;
    parts.push(`\n**${label}** (${arr.length}):`);
    for (const item of arr.slice(0, 25)) {
      parts.push(`- ${JSON.stringify(item)}`);
    }
  };
  dump("Commitments", s.commitments);
  dump("Risks", s.risks);
  dump("Escalations", s.escalations);
  dump("Board mentions", s.board_mentions);
  dump("Customer issues", s.customer_issues);
  dump("Vendor signals", s.vendor_signals);
  if (parts.length === 1) parts.push("No material signals surfaced this week.");
  return parts.join("\n");
}

// ─── duncan@kabuni.com "weekly report" emails scan ─────────────────────────
function decodeBase64Url(s: string): string {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b.length % 4 ? b + "=".repeat(4 - (b.length % 4)) : b;
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch { return ""; }
}

interface AttachmentRef {
  name: string;
  mime: string;
  size: number;
  attachmentId: string;
}

function walkPartsForText(part: any, out: string[], attachments: AttachmentRef[]) {
  if (!part) return;
  const mime = part.mimeType || "";
  const filename = part.filename || "";
  if (filename && part.body?.attachmentId) {
    attachments.push({ name: filename, mime, size: part.body?.size ?? 0, attachmentId: part.body.attachmentId });
  }
  if (mime === "text/plain" && part.body?.data) {
    out.push(decodeBase64Url(part.body.data));
  } else if (mime === "text/html" && part.body?.data && out.length === 0) {
    const html = decodeBase64Url(part.body.data);
    out.push(html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  }
  if (Array.isArray(part.parts)) for (const p of part.parts) walkPartsForText(p, out, attachments);
}

function base64UrlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 ? b + "=".repeat(4 - (b.length % 4)) : b;
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "";
    return xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (e) { console.error("docx extract failed", e); return ""; }
}

async function extractPdfTextBytes(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n\n") : String(text || "")).trim();
  } catch (e) { console.error("pdf extract failed", e); return ""; }
}

async function fetchAndExtractAttachment(
  token: string, msgId: string, a: AttachmentRef,
): Promise<string> {
  const lower = a.name.toLowerCase();
  const isDocx = lower.endsWith(".docx");
  const isPdf = lower.endsWith(".pdf") || a.mime === "application/pdf";
  if (!isDocx && !isPdf) return "";
  // Skip huge attachments (>15MB) to stay in memory/time budget
  if (a.size > 15 * 1024 * 1024) return `[skipped ${a.name}: ${Math.round(a.size/1024/1024)}MB too large]`;
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${a.attachmentId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return `[failed to download ${a.name}: ${r.status}]`;
  const j = await r.json();
  if (!j.data) return `[no data for ${a.name}]`;
  const bytes = base64UrlToBytes(j.data);
  const text = isDocx ? await extractDocxText(bytes) : await extractPdfTextBytes(bytes);
  if (!text) return `[no text extracted from ${a.name}]`;
  return truncate(text, 20_000);
}

async function fetchDuncanWeeklyReports(admin: any, w: ReportWeek): Promise<string> {
  const token = await getGmailSenderToken(admin);
  if (!token) return "duncan@kabuni.com Gmail token unavailable — skipped weekly-report scan.";
  const after = Math.floor(w.monday.getTime() / 1000);
  const before = Math.floor(w.saturdayExcl.getTime() / 1000);
  const q = `after:${after} before:${before} ("weekly report" OR subject:"weekly report")`;
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!listRes.ok) return `Weekly-report scan failed (${listRes.status}).`;
  const listJson = await listRes.json();
  const ids: string[] = (listJson.messages || []).map((m: any) => m.id);
  if (!ids.length) return "No emails containing 'weekly report' found in duncan@kabuni.com for this window.";
  const blocks: string[] = [];
  for (const id of ids) {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) continue;
    const m = await r.json();
    const headers = m.payload?.headers || [];
    const from = gmailHeader(headers, "From");
    const subj = gmailHeader(headers, "Subject");
    const date = gmailHeader(headers, "Date");
    const textParts: string[] = [];
    const atts: AttachmentRef[] = [];
    walkPartsForText(m.payload, textParts, atts);
    const body = truncate(textParts.join("\n").trim(), 4000);

    // Download + extract text from docx/pdf attachments
    const attachmentSections: string[] = [];
    for (const a of atts) {
      const lower = a.name.toLowerCase();
      if (!(lower.endsWith(".docx") || lower.endsWith(".pdf") || a.mime === "application/pdf")) {
        attachmentSections.push(`#### Attachment: ${a.name} (${a.mime}, ${Math.round(a.size/1024)}KB)\n[unsupported format — metadata only]`);
        continue;
      }
      const extracted = await fetchAndExtractAttachment(token, id, a);
      attachmentSections.push(
        `#### Attachment: ${a.name} (${a.mime}, ${Math.round(a.size/1024)}KB)\n${extracted || "[no text]"}`
      );
    }

    const attLine = atts.length
      ? `\nAttachments: ${atts.map((a) => `${a.name} (${Math.round(a.size / 1024)}KB)`).join(" · ")}`
      : "";
    const attBlock = attachmentSections.length ? `\n\n${attachmentSections.join("\n\n")}` : "";
    blocks.push(`### ${date} — ${subj}\nFrom: ${from}${attLine}\n\n${body || "(no text body)"}${attBlock}`);
  }
  return blocks.join("\n\n---\n\n");
}

// ─── OpenAI summary ───────────────────────────────────────────────────────
async function buildSummaryMarkdown(
  meetingsBlock: string,
  workstreamsBlock: string,
  inboxBlock: string,
  weeklyReportEmailsBlock: string,
  plan90Block: string,
  capacityBlock: string,

  meetingsCount: number,
  cardsCount: number,
  reportWeek: ReportWeek,
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");


  const dateGrounding =
    `\n\n=== AUTHORITATIVE DATE CONTEXT (USE EXACTLY — DO NOT ALTER) ===\n` +
    `TODAY (UK): ${reportWeek.todayLabel}\n` +
    `REPORT WEEK (Mon–Sun being summarised): ${reportWeek.label} ${reportWeek.year}\n` +
    `CURRENT YEAR: ${reportWeek.year}\n` +
    `RULES:\n` +
    `- The H1 MUST read exactly: "Weekly Executive Summary — ${reportWeek.label} ${reportWeek.year}".\n` +
    `- Do NOT invent or shift years. The only year that may appear is ${reportWeek.year}.\n` +
    `- Use ONLY the meetings, workstream activity, 90 Day Tracker changes, inbox signals, and duncan@kabuni.com weekly-report emails provided below. Do not invent items.\n`;

  const system =
    "You are Duncan, Kabuni's executive intelligence engine. " +
    "Produce a board-ready weekly executive summary in clean Markdown, grounded strictly in: (1) Gemini/Plaud meeting notes, (2) workstream-card activity, (3) 90 Day Tracker changes, (4) inbox signals extracted from opted-in team mailboxes, and (5) any 'weekly report' emails sent to duncan@kabuni.com (including their attached documents). " +
    "Use H1 for the report title, H2 for sections, bullets where useful, and Markdown tables when comparing items. " +
    "Sections (in order): Executive Snapshot, Meetings This Week (key discussions & decisions), " +
    "Workstream Progress (RYG table: card · status · update), 90 Day Tracker Updates, Engineering Delivery Summary (ONLY if a capacity dashboard block is supplied), Team Signals from Inboxes (commitments, risks, escalations, board mentions, customer/vendor signals — with the mailbox that surfaced them), Weekly Reports Received (summarise each report email + its attachments), Wins of the Week, Risks & Blockers (with mitigations), Action Items & Owners, Key Decisions Needed. " +
    "ENGINEERING DELIVERY SUMMARY RULES: include this section ONLY when the '=== WEEKLY CAPACITY DASHBOARD ===' block is present below; if it is absent or empty, omit the section entirely (no heading, no placeholder). When present, title it exactly 'Engineering Delivery Summary', place it immediately after '90-Day Tracker Updates' and before 'Wins of the Week', and derive it EXCLUSIVELY from that block — never from meetings, workstreams, Azure DevOps, emails or any other data. Output 5–8 concise executive bullet points covering the most important KPIs and insights only: total capacity vs actual hours logged and utilisation %, stories closed, highest effort allocation, notable module/team utilisation (AI/ML, Backend, Frontend, QA, DevOps, Firmware), major engineering accomplishments, areas in progress or with no completed work, and overall delivery health. Do NOT reproduce tables, do NOT list every metric, do NOT copy the document. Never invent numbers not in the block. " +

    "90 DAY TRACKER SECTION RULES: the section MUST be titled '90-Day Tracker Updates' and MUST reproduce the supplied '90 DAY TRACKER' block VERBATIM — same workstream sub-headings and the same Markdown tables, rows, columns, cell text, RYG dot, author and date, in the same order. Do not add, merge, reorder, re-summarise, reformat into bullets, or infer entries, and never source it from meeting transcripts or workstream card comments. If the block says 'No 90-Day Tracker updates were recorded this week.', output exactly that line and nothing else in the section. " +
    "ABSOLUTE FINANCIAL EXCLUSION: the report must contain NO financial information from ANY source (emails, meetings, documents, attachments, OCR, transcripts). Omit entirely — never with a placeholder — anything about invoices, payments, outstanding/overdue payments, receipts, purchase orders, quotes, Revolut, bank transactions, cash flow, burn rate, revenue, profit/loss, budgets, spend, costs, pricing, funding, financial documents, vendor payment status, and any monetary amount or currency symbol (£, $, €). This applies to every section including Executive Snapshot, Meetings, Commitments, Risks, Board Mentions, Vendor Signals, Action Items, Decisions and any AI-generated summary. If an item's only substance is financial, drop the whole item. " +
    "Be concise, factual, decision-oriented. Never invent figures or events. " +
    "If a section has no data, state 'No activity recorded this week.' instead of fabricating." +
    dateGrounding;

  const user =
    `Report week: ${reportWeek.label} ${reportWeek.year} (Monday–Sunday)\n` +
    `Today: ${reportWeek.todayLabel}\n` +
    `Meetings ingested: ${meetingsCount} · Workstream cards with activity: ${cardsCount}\n\n` +
    `=== MEETINGS (Gemini / Plaud — all users incl. duncan@kabuni.com) ===\n${meetingsBlock}\n\n` +
    `=== WORKSTREAM CARD ACTIVITY ===\n${workstreamsBlock}\n\n` +
    `=== 90 DAY TRACKER — CHANGES THIS WEEK (per workstream) ===\n${plan90Block}\n\n` +
    (capacityBlock ? `=== WEEKLY CAPACITY DASHBOARD (Knowledge Base — sole source for Engineering Delivery Summary) ===\n${capacityBlock}\n\n` : "") +

    `=== TEAM INBOX SIGNALS (last 7 days, opted-in mailboxes) ===\n${inboxBlock}\n\n` +
    `=== WEEKLY-REPORT EMAILS TO duncan@kabuni.com ===\n${weeklyReportEmailsBlock}\n`;


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

    // Pull source data — meetings + workstreams + inbox signals + duncan weekly-report emails.
    const [meetings, ws, inboxAgg, weeklyReportEmailsBlock, plan90Block] = await Promise.all([
      fetchMeetings(admin, reportWeek),
      fetchWorkstreamCards(admin, reportWeek),
      scanAllOptedInInboxes(admin, reportWeek),
      fetchDuncanWeeklyReports(admin, reportWeek),
      fetchPlan90Changes(admin, reportWeek),
    ]);

    const meetingsBlock = formatMeetingsBlock(meetings);
    const workstreamsBlock = formatWorkstreamBlock(ws.cards, ws.tasks);
    const inboxBlock = formatInboxSignalsBlock(inboxAgg);

    await admin.from("exec_summary_runs").update({
      file_count: meetings.length + ws.cards.length,
      files_processed: {
        meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.meeting_date, source: m.source })),
        cards: ws.cards.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        inbox_mailboxes: inboxAgg.per_mailbox,
        inbox_emails_scanned: inboxAgg.emails_scanned,
      },
    }).eq("id", runId);

    if (meetings.length === 0 && ws.cards.length === 0 && inboxAgg.emails_scanned === 0 && weeklyReportEmailsBlock.startsWith("No emails")) {
      throw new Error(
        `No meetings, workstream activity, inbox signals, or weekly-report emails found between ${reportWeek.monday.toISOString().slice(0, 10)} and ${reportWeek.sunday.toISOString().slice(0, 10)}.`,
      );
    }

    const summaryMd = await buildSummaryMarkdown(
      meetingsBlock,
      workstreamsBlock,
      inboxBlock,
      weeklyReportEmailsBlock,
      plan90Block,
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

    // Dry-run mode: return the composed markdown without emailing.
    if (body?.dry_run === true) {
      await admin.from("exec_summary_runs").update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        error: "dry_run — email not sent",
      }).eq("id", runId);
      return json({
        success: true,
        dry_run: true,
        run_id: runId,
        subject,
        week_range: `${weekRange} ${reportWeek.year}`,
        meetings: meetings.length,
        workstream_cards: ws.cards.length,
        inbox_mailboxes_scanned: inboxAgg.mailboxes_scanned,
        inbox_emails_scanned: inboxAgg.emails_scanned,
        weekly_report_emails_preview: weeklyReportEmailsBlock.slice(0, 400),
        summary_markdown: summaryMd,
      });
    }

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
      inbox_mailboxes_scanned: inboxAgg.mailboxes_scanned,
      inbox_emails_scanned: inboxAgg.emails_scanned,
      recipients: effectiveRecipients,
      subject,
      week_range: `${weekRange} ${reportWeek.year}`,
    });
  } catch (e) {
    return fail(e);
  }
});
