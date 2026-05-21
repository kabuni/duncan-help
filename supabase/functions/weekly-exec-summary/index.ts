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
const RECIPIENT_EMAIL = "simon@kabuni.com";
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

// ─── OpenAI summary ───────────────────────────────────────────────────────
async function buildSummaryMarkdown(folderName: string, fileBlocks: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const system =
    "You are Duncan, Kabuni's executive intelligence engine. " +
    "Produce a board-ready weekly executive summary in clean Markdown. " +
    "Use H1 for the report title, H2 for sections, bullets where useful, and Markdown tables when comparing items. " +
    "Sections (in order): Executive Snapshot, Performance Overview (RYG table), " +
    "Wins of the Week, Risks & Blockers (with mitigations), Key Decisions Needed, " +
    "Cross-Department Highlights, Forward Look (next 7 days). " +
    "Be concise, factual, decision-oriented. Never invent figures.";

  const user =
    `Folder: ${folderName}\n\n` +
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

function emailHtml(folderName: string, downloadUrl: string, fileCount: number, dateStr: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="margin:0 0 6px;color:#0f172a">Weekly Executive Summary</h2>
  <p style="margin:0 0 18px;color:#64748b;font-size:14px">${dateStr} • synthesised from <strong>${fileCount}</strong> source report${fileCount === 1 ? "" : "s"} in <em>${folderName}</em></p>
  <p style="font-size:15px;line-height:1.55;color:#334155">
    Your branded weekly executive summary is ready. It consolidates the latest departmental
    reports into a single board-ready view — performance, wins, risks, and decisions needed.
  </p>
  <p style="margin:24px 0">
    <a href="${downloadUrl}"
       style="display:inline-block;padding:12px 22px;background:#0f172a;color:#fff;
              text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
      Download Word document
    </a>
  </p>
  <p style="font-size:12px;color:#94a3b8;line-height:1.5">
    Secure link, single-recipient. Generated automatically by Duncan.
  </p>
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

  // DST-safe gate: cron fires at 07:00 and 08:00 UTC every Monday; only run at 08:00 UK local.
  if (authz.source === "cron") {
    const uk = ukNowParts();
    if (uk.weekday !== "Mon" || uk.hour !== 8) {
      return json({ skipped: true, reason: `Not 08:00 UK Mon (got ${uk.weekday} ${uk.hour}:00)` });
    }
  }

  const uk = ukNowParts();
  const runKey = authz.source === "cron"
    ? `weekly-${uk.isoDate}`
    : `manual-${uk.isoDate}-${Date.now()}`;

  // Idempotency: refuse duplicate cron runs for the same day unless forced.
  if (authz.source === "cron" || !force) {
    const { data: existing } = await admin
      .from("exec_summary_runs")
      .select("id,status,run_key")
      .eq("run_key", runKey)
      .maybeSingle();
    if (existing && authz.source === "cron") {
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
      recipient: RECIPIENT_EMAIL,
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
    if (!files.length) throw new Error(`No Google Docs or DOCX files in folder "${folder.name}"`);

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

    if (!processed.length) {
      throw new Error("All file extractions failed — nothing to summarise");
    }

    await admin.from("exec_summary_runs").update({
      files_processed: processed,
      file_count: processed.length,
      failed_files: failed,
    }).eq("id", runId);

    // 4. GPT-4o summary
    const summaryMd = await buildSummaryMarkdown(folder.name, blocks.join("\n"));
    if (!summaryMd) throw new Error("OpenAI returned empty summary");

    // 5. Render branded DOCX via generate-exec-summary (service-role call)
    const title = `Weekly Executive Summary — ${folder.name}`;
    const weekRange = new Date().toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });
    const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-exec-summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        title, week_range: weekRange, content: summaryMd, company_name: "Kabuni",
      }),
    });
    const genJson = await genRes.json();
    if (!genRes.ok || !genJson.success) {
      throw new Error(`generate-exec-summary failed: ${JSON.stringify(genJson)}`);
    }

    // 6. Secure download token
    const downloadToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const downloadUrl =
      `${supabaseUrl}/functions/v1/weekly-exec-summary-download` +
      `?run_id=${runId}&token=${downloadToken}`;

    await admin.from("exec_summary_runs").update({
      blob_path: genJson.blob_path,
      file_name: genJson.file_name,
      download_token: downloadToken,
      summary_chars: summaryMd.length,
    }).eq("id", runId);

    // 7. Email
    const gmailToken = await getGmailSenderToken(admin);
    if (!gmailToken) throw new Error("Gmail sender token (duncan@kabuni.com) unavailable");

    const subject = `Weekly Executive Summary — ${folder.name}`;
    const html = emailHtml(folder.name, downloadUrl, processed.length, weekRange);
    const messageId = await sendEmail(gmailToken, RECIPIENT_EMAIL, subject, html);

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
      blob_path: genJson.blob_path,
      recipient: RECIPIENT_EMAIL,
      download_url: downloadUrl,
    });
  } catch (e) {
    return fail(e);
  }
});
