import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AZURE_CONTAINER = "duncanstorage01";
const AZURE_CV_FOLDER = "cvs";

function parseAzureConnectionString(connStr: string): { accountName: string; accountKey: string } {
  const parts: Record<string, string> = {};
  for (const part of connStr.trim().split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const idx = seg.indexOf("=");
    if (idx > 0) parts[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) throw new Error("Invalid Azure connection string");
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

async function uploadToAzureBlob(
  accountName: string,
  accountKey: string,
  blobPath: string,
  data: Uint8Array,
  contentType: string
): Promise<string> {
  const now = new Date().toUTCString();
  const fullPath = `/${AZURE_CONTAINER}/${blobPath}`;
  const headers: Record<string, string> = {
    "x-ms-date": now,
    "x-ms-version": "2023-11-03",
    "x-ms-blob-type": "BlockBlob",
    "Content-Length": String(data.length),
    "Content-Type": contentType,
  };

  const msHeaders = Object.entries(headers)
    .filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}:${v}`)
    .join("\n");

  const stringToSign = [
    "PUT", "", "", String(data.length), "", contentType,
    "", "", "", "", "", "",
    msHeaders,
    `/${accountName}${fullPath}`,
  ].join("\n");

  const keyBytes = Uint8Array.from(atob(accountKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  headers["Authorization"] = `SharedKey ${accountName}:${signature}`;

  const url = `https://${accountName}.blob.core.windows.net${fullPath}`;
  const res = await fetch(url, { method: "PUT", headers, body: data });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Azure upload failed (${res.status}): ${errText}`);
  }
  return url;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// --- Normalization & matching ---
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

const RECRUITMENT_TERMS = [
  "cv",
  "resume",
  "application",
  "candidate",
  "applicant",
  "cover letter",
  "job application",
  "curriculum vitae",
];

const NON_CV_TERMS = [
  "agreement",
  "supplier",
  "tracker",
  "tournament",
  "consent form",
  "invoice",
  "framework",
  "purchase order",
  "legal",
  "contract",
  "school confirmations",
  "update",
];

const ROLE_FETCH_MAX_RESULTS_PER_PAGE = 100;
const ROLE_FETCH_MAX_PAGES = 20;

// Per-fetch processing limits to prevent edge-function timeout
const MAX_MESSAGES_PER_RUN = 50;
// Concurrency limit for parse-cv to avoid 429 rate-limit storms
const PARSE_CONCURRENCY = 2;
// Lock TTL: auto-expires after 15 minutes in case of crash
const LOCK_TTL_MINUTES = 15;

function stripFileExtension(filename: string): string {
  return filename.replace(/\.(pdf|docx?|rtf)$/i, "");
}

function looksLikeCandidateFilename(filename: string): boolean {
  const normalized = normalizeText(stripFileExtension(filename));
  if (!normalized) return false;

  if (includesAnyTerm(normalized, RECRUITMENT_TERMS)) {
    return true;
  }

  if (includesAnyTerm(normalized, NON_CV_TERMS)) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const alphaTokens = tokens.filter((token) => /^[a-z]+$/.test(token));

  return alphaTokens.length >= 2 && alphaTokens.length <= 5;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function generateRoleAliases(title: string): string[] {
  const normalizedTitle = normalizeText(title);
  const aliases = [normalizedTitle];

  if (normalizedTitle.includes("operations manager")) {
    aliases.push("ops manager", "operations mgr", "ops mgr");
  }

  const genericAliases = [
    normalizedTitle.replace(/\bmanager\b/g, "mgr"),
    normalizedTitle.replace(/\boperations\b/g, "ops"),
    normalizedTitle.replace(/\boperations\b/g, "ops").replace(/\bmanager\b/g, "mgr"),
  ];

  aliases.push(...genericAliases);
  return uniqueStrings(aliases);
}

function buildRoleAwareQuery(title: string): string {
  void title;
  return `has:attachment (filename:pdf OR filename:docx OR filename:doc)`;
}

function subjectMatchesRole(subject: string, roleTitle: string): boolean {
  const normalizedSubject = normalizeText(subject);
  if (!normalizedSubject) return false;

  return generateRoleAliases(roleTitle).some((alias) => {
    const aliasTokens = tokenize(alias);
    return aliasTokens.length > 0 && aliasTokens.every((token) => normalizedSubject.includes(token));
  });
}

function includesAnyTerm(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(normalizeText(term)));
}

function classifyAttachmentBatch(
  subject: string,
  snippet: string,
  filenames: string[],
  roleTitle?: string | null,
  options?: { selectedRoleMode?: boolean },
): { accepted: boolean; reason?: string; roleSignal: boolean; recruitmentSignal: boolean } {
  const combinedText = normalizeText([subject, snippet, ...filenames].join(" "));
  const recruitmentSignal = includesAnyTerm(combinedText, RECRUITMENT_TERMS);
  const exclusionSignal = includesAnyTerm(combinedText, NON_CV_TERMS);
  const roleSignal = roleTitle ? includesAnyTerm(combinedText, generateRoleAliases(roleTitle)) : false;
  const filenameSignal = filenames.some((filename) => looksLikeCandidateFilename(filename));
  const selectedRoleMode = options?.selectedRoleMode === true;

  if (selectedRoleMode) {
    if (exclusionSignal && !recruitmentSignal && !filenameSignal) {
      return { accepted: false, reason: "Excluded non-CV document pattern", roleSignal, recruitmentSignal };
    }

    if (!recruitmentSignal && !filenameSignal) {
      return { accepted: false, reason: "Missing CV or recruitment signal", roleSignal, recruitmentSignal };
    }

    return { accepted: true, roleSignal, recruitmentSignal };
  }

  if (roleTitle) {
    if (!roleSignal) {
      return { accepted: false, reason: "Missing role signal", roleSignal, recruitmentSignal };
    }
    if (!recruitmentSignal && filenames.length === 0) {
      return { accepted: false, reason: "Missing recruitment signal", roleSignal, recruitmentSignal };
    }
  } else if (!recruitmentSignal && exclusionSignal) {
    return { accepted: false, reason: "Looks like business document, not a CV", roleSignal, recruitmentSignal };
  }

  if (exclusionSignal && !recruitmentSignal) {
    return { accepted: false, reason: "Excluded non-CV document pattern", roleSignal, recruitmentSignal };
  }

  return { accepted: true, roleSignal, recruitmentSignal };
}

async function fetchMatchingMessages(
  query: string,
  headers: HeadersInit,
  selectedRoleMode: boolean,
): Promise<{ messages: { id: string; threadId?: string }[]; pagesFetched: number; exhausted: boolean }> {
  const messages: { id: string; threadId?: string }[] = [];
  let pageToken: string | null = null;
  let pagesFetched = 0;
  const maxPages = selectedRoleMode ? ROLE_FETCH_MAX_PAGES : 1;
  const maxResults = selectedRoleMode ? ROLE_FETCH_MAX_RESULTS_PER_PAGE : 50;

  while (pagesFetched < maxPages) {
    const searchUrl = new URL(`${GMAIL_API}/messages`);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("maxResults", String(maxResults));
    if (pageToken) {
      searchUrl.searchParams.set("pageToken", pageToken);
    }

    const searchRes = await fetch(searchUrl.toString(), { headers });
    if (!searchRes.ok) {
      throw new Error(`Gmail search failed: ${await searchRes.text()}`);
    }

    const searchData = await searchRes.json();
    messages.push(...(searchData.messages || []));
    pagesFetched += 1;
    pageToken = searchData.nextPageToken || null;

    if (!pageToken) {
      return { messages, pagesFetched, exhausted: true };
    }
  }

  return { messages, pagesFetched, exhausted: false };
}

function matchRoleToSubject(
  subject: string,
  roles: { id: string; title: string }[]
): { roleId: string; confidence: "exact" | "high" | "low" } | null {
  const normalizedSubject = normalizeText(subject);
  const subjectTokens = tokenize(subject);

   // Pass 1: Exact normalized alias match
   const exactMatches = roles.filter((r) =>
     generateRoleAliases(r.title).some((alias) => normalizedSubject.includes(alias))
   );

  if (exactMatches.length === 1) {
    return { roleId: exactMatches[0].id, confidence: "exact" };
  }

  if (exactMatches.length > 1) {
    exactMatches.sort((a, b) => b.title.length - a.title.length);
    return { roleId: exactMatches[0].id, confidence: "high" };
  }

  // Pass 2: Word-based matching across aliases
  const wordMatches: { role: typeof roles[0]; matchedWords: number; totalWords: number }[] = [];
  for (const role of roles) {
    const aliasTokenSets = generateRoleAliases(role.title)
      .map((alias) => tokenize(alias))
      .filter((tokens) => tokens.length > 0);

    for (const titleTokens of aliasTokenSets) {
      const matched = titleTokens.filter((t) => subjectTokens.includes(t));
      if (matched.length === titleTokens.length) {
        wordMatches.push({ role, matchedWords: matched.length, totalWords: titleTokens.length });
        break;
      }
    }
  }

  if (wordMatches.length === 1) {
    return { roleId: wordMatches[0].role.id, confidence: "high" };
  }
  if (wordMatches.length > 1) {
    wordMatches.sort((a, b) => b.totalWords - a.totalWords);
    return { roleId: wordMatches[0].role.id, confidence: "high" };
  }

  return null;
}

// --- Validation helpers ---
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

const GENERIC_FILENAMES = new Set([
  "resume", "cv", "curriculum vitae", "file", "document", "doc", "untitled",
  "my resume", "my cv", "cover letter", "application",
]);

function isGenericName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[0-9\s_\-\.]+/g, " ").trim();
  if (normalized.length < 3) return true;
  if (/^\d+$/.test(normalized)) return true;
  for (const g of GENERIC_FILENAMES) {
    if (normalized === g || normalized.startsWith(g + " ")) return true;
  }
  return false;
}

function candidateNameFromFilename(filename: string): string {
  return filename
    .replace(/\.(pdf|docx?|rtf)$/i, "")
    .replace(/[_\-\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSenderEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

interface CvAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
}

interface ProcessingDetail {
  gmail_message_id: string;
  filename: string;
  outcome: "ingested" | "skipped" | "unmatched" | "parse_failed" | "upload_failed" | "reprocessed" | "duplicate_email";
  reason?: string;
  candidate_id?: string;
  role_title?: string;
  confidence?: string;
}

async function getAccessToken(supabaseAdmin: any): Promise<{ token: string; email: string } | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const { data: tokenData, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !tokenData) return null;

  if (new Date(tokenData.token_expiry) <= new Date()) {
    const refreshRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!refreshRes.ok) {
      console.error("Gmail token refresh failed:", await refreshRes.text());
      return null;
    }

    const newTokens = await refreshRes.json();
    const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000);

    const { error: tokenUpdateError } = await supabaseAdmin
      .from("gmail_tokens")
      .update({
        access_token: newTokens.access_token,
        token_expiry: newExpiry.toISOString(),
      })
      .eq("id", tokenData.id);

    if (tokenUpdateError) {
      console.error("Failed to persist refreshed Gmail token:", tokenUpdateError);
    }

    return { token: newTokens.access_token, email: tokenData.email_address || "" };
  }

  return { token: tokenData.access_token, email: tokenData.email_address || "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const credentials = await getAccessToken(supabaseAdmin);

    if (!credentials) {
      return new Response(
        JSON.stringify({ error: "Gmail not connected. An admin needs to connect it first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gmailHeaders = { Authorization: `Bearer ${credentials.token}` };

    let filterRoleId: string | null = null;
    try {
      const body = await req.json();
      filterRoleId = body?.role_id || null;
    } catch {
      // no body
    }

    // Fetch active job roles for matching
    let roleQuery = supabaseAdmin
      .from("job_roles")
      .select("id, title")
      .eq("status", "active");

    if (filterRoleId) {
      roleQuery = roleQuery.eq("id", filterRoleId);
    }

    const { data: activeRoles } = await roleQuery;

    if (!activeRoles || activeRoles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No active job roles found. Create job roles first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Re-link orphaned candidates: if fetching for a specific role, update any
    // unmatched candidates whose email_subject matches the role title
    if (filterRoleId && activeRoles.length === 1) {
      const roleTitle = activeRoles[0].title;
      const normalizedTitle = normalizeText(roleTitle);
      const { data: orphaned } = await supabaseAdmin
        .from("candidates")
        .select("id, email_subject")
        .is("job_role_id", null);

      if (orphaned && orphaned.length > 0) {
        const toRelink = orphaned.filter((c: any) =>
          c.email_subject && normalizeText(c.email_subject).includes(normalizedTitle)
        );
        for (const c of toRelink) {
          await supabaseAdmin
            .from("candidates")
            .update({ job_role_id: filterRoleId, status: "parsed" })
            .eq("id", c.id)
            .is("job_role_id", null);
          console.log(`Re-linked orphaned candidate ${c.id} to role ${roleTitle}`);
        }
      }
    }

    const selectedRole = filterRoleId && activeRoles.length === 1 ? activeRoles[0] : null;
    const query = selectedRole
      ? buildRoleAwareQuery(selectedRole.title)
      : `has:attachment (filename:pdf OR filename:docx OR filename:doc)`;
    console.log("Gmail search query:", query);

    // (Gmail search executed inside the lock-protected block below.)

    // ---- Acquire per-role fetch lock ----
    const lockKey = `fetch-gmail-cvs:${filterRoleId ?? "all"}`;
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000).toISOString();

    // Clear any expired lock for this key
    await supabaseAdmin
      .from("fetch_locks")
      .delete()
      .eq("resource_key", lockKey)
      .lt("expires_at", nowIso);

    // Try to insert a fresh lock; unique constraint on resource_key prevents parallel runs
    const { error: lockErr } = await supabaseAdmin
      .from("fetch_locks")
      .insert({
        resource_key: lockKey,
        locked_by: claimsData.user.id,
        locked_at: nowIso,
        expires_at: expiresIso,
      });

    if (lockErr) {
      console.log("Fetch lock not acquired:", lockErr.message);
      return new Response(
        JSON.stringify({
          error: "Fetch already in progress for this role",
          already_running: true,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let ingested = 0;
    let skipped = 0;
    let unmatched = 0;
    let parseFailed = 0;
    let processedMessages = 0;
    let hasMore = false;
    const results: any[] = [];
    const details: ProcessingDetail[] = [];
    // Queue of parse tasks to run with throttled concurrency after the loop
    const parseQueue: { candidateId: string; storagePath: string }[] = [];

    try {
      const searchOutcome = await fetchMatchingMessages(query, gmailHeaders, Boolean(selectedRole));
      const allMessages = searchOutcome.messages;

      console.log("Gmail search coverage:", {
        selectedRole: selectedRole?.title ?? null,
        totalMessages: allMessages.length,
        pagesFetched: searchOutcome.pagesFetched,
        exhausted: searchOutcome.exhausted,
      });

      // Limit messages processed per run to avoid edge-function timeout
      const messages = allMessages.slice(0, MAX_MESSAGES_PER_RUN);
      hasMore = allMessages.length > MAX_MESSAGES_PER_RUN || !searchOutcome.exhausted;

      for (const msg of messages) {
        processedMessages++;
        const msgRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, { headers: gmailHeaders });
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();

        const msgHeaders = msgData.payload?.headers || [];
        const subject = msgHeaders.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
        const snippet = msgData.snippet || "";

        if (selectedRole && !subjectMatchesRole(subject, selectedRole.title)) {
          continue;
        }

        const roleMatch = selectedRole ? null : matchRoleToSubject(subject, activeRoles);
        const matchedRoleId = selectedRole
          ? selectedRole.id
          : (roleMatch && (roleMatch.confidence === "exact" || roleMatch.confidence === "high"))
            ? roleMatch.roleId
            : null;
        const matchedRoleTitle = matchedRoleId
          ? activeRoles.find((r: any) => r.id === matchedRoleId)?.title || null
          : null;

        const cvAttachments: CvAttachment[] = [];
        function isCvFile(name: string): boolean {
          return /\.(pdf|docx?)(\.pdf)?$/i.test(name.toLowerCase());
        }
        function collectAttachments(parts: any[]) {
          for (const part of parts) {
            if (part.body?.attachmentId && isCvFile(part.filename || "")) {
              cvAttachments.push({
                attachmentId: part.body.attachmentId,
                filename: part.filename,
                mimeType: part.mimeType,
              });
            }
            if (part.parts) collectAttachments(part.parts);
          }
        }
        collectAttachments(msgData.payload?.parts || []);

        if (cvAttachments.length === 0) continue;

        const attachmentGate = classifyAttachmentBatch(
          subject,
          snippet,
          cvAttachments.map((attachment) => attachment.filename),
          selectedRole?.title || matchedRoleTitle,
          { selectedRoleMode: Boolean(selectedRole) },
        );

        if (!attachmentGate.accepted) {
          skipped++;
          for (const cv of cvAttachments) {
            details.push({
              gmail_message_id: msg.id,
              filename: cv.filename,
              outcome: "skipped",
              reason: attachmentGate.reason,
              role_title: matchedRoleTitle || selectedRole?.title || undefined,
            });
          }
          continue;
        }

        for (const cv of cvAttachments) {
          // ---- DEDUP: gmail_message_id + attachment_filename ----
          const { data: existing } = await supabaseAdmin
            .from("candidates")
            .select("id, status, job_role_id")
            .eq("gmail_message_id", msg.id)
            .eq("attachment_filename", cv.filename)
            .maybeSingle();

          if (existing) {
            // Non-destructive retry path for prior parse failures
            if (existing.status === "parse_failed" || existing.status === "parse_retry_pending") {
              await supabaseAdmin
                .from("candidates")
                .update({
                  status: matchedRoleId ? "pending" : "unmatched",
                  job_role_id: existing.job_role_id ?? matchedRoleId,
                  failure_reason: null,
                })
                .eq("id", existing.id);

              const { data: cand } = await supabaseAdmin
                .from("candidates")
                .select("cv_storage_path")
                .eq("id", existing.id)
                .maybeSingle();
              if (cand?.cv_storage_path) {
                parseQueue.push({ candidateId: existing.id, storagePath: cand.cv_storage_path });
              }

              details.push({
                gmail_message_id: msg.id,
                filename: cv.filename,
                outcome: "reprocessed",
                candidate_id: existing.id,
                role_title: matchedRoleTitle || selectedRole?.title || undefined,
              });
              ingested++;
              continue;
            }

            // Already exists with a non-failed status -> skip
            skipped++;
            details.push({
              gmail_message_id: msg.id,
              filename: cv.filename,
              outcome: "skipped",
              reason: `Already exists with status ${existing.status}`,
              candidate_id: existing.id,
            });
            continue;
          }

          // Download attachment
          const attachRes = await fetch(
            `${GMAIL_API}/messages/${msg.id}/attachments/${cv.attachmentId}`,
            { headers: gmailHeaders }
          );
          if (!attachRes.ok) {
            details.push({ gmail_message_id: msg.id, filename: cv.filename, outcome: "parse_failed", reason: "Attachment download failed" });
            parseFailed++;
            continue;
          }
          const attachData = await attachRes.json();

          const base64Data = attachData.data.replace(/-/g, "+").replace(/_/g, "/");
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          const sanitizedFilename = cv.filename
            .normalize("NFKD")
            .replace(/[^a-zA-Z0-9\-_.]+/g, "-")
            .toLowerCase();
          const storagePath = `${Date.now()}_${sanitizedFilename}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from("cvs")
            .upload(storagePath, bytes, {
              contentType: cv.mimeType || "application/octet-stream",
              upsert: false,
            });

          if (uploadError) {
            await supabaseAdmin.from("candidates").insert({
              name: candidateNameFromFilename(cv.filename),
              gmail_message_id: msg.id,
              attachment_filename: cv.filename,
              email_subject: subject,
              job_role_id: matchedRoleId,
              cv_storage_path: storagePath,
              status: "parse_failed",
              failure_reason: `Storage upload failed: ${uploadError.message || "unknown"}`,
            });
            details.push({ gmail_message_id: msg.id, filename: cv.filename, outcome: "upload_failed", reason: uploadError.message });
            parseFailed++;
            continue;
          }

          // Azure Blob backup (best-effort)
          try {
            const azureConnStr = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
            if (azureConnStr) {
              const { accountName, accountKey } = parseAzureConnectionString(azureConnStr);
              const azureBlobPath = `${AZURE_CV_FOLDER}/${storagePath}`;
              await uploadToAzureBlob(accountName, accountKey, azureBlobPath, bytes, cv.mimeType || "application/octet-stream");
            }
          } catch (azureErr) {
            console.warn("Azure Blob upload failed (non-blocking):", azureErr);
          }

          const rawName = candidateNameFromFilename(cv.filename);
          const nameIsGeneric = isGenericName(rawName);
          const candidateStatus = matchedRoleId ? "pending" : "unmatched";
          if (!matchedRoleId) unmatched++;

          const { data: candidate, error: insertError } = await supabaseAdmin
            .from("candidates")
            .insert({
              name: nameIsGeneric ? `Unparsed (${cv.filename})` : rawName,
              email: null,
              gmail_message_id: msg.id,
              attachment_filename: cv.filename,
              email_subject: subject,
              cv_storage_path: storagePath,
              job_role_id: matchedRoleId,
              status: candidateStatus,
              failure_reason: nameIsGeneric ? "Filename too generic; requires CV parsing" : null,
            })
            .select()
            .single();

          if (insertError) {
            details.push({ gmail_message_id: msg.id, filename: cv.filename, outcome: "parse_failed", reason: `Insert failed: ${insertError.message}` });
            parseFailed++;
            continue;
          }

          parseQueue.push({ candidateId: candidate.id, storagePath: candidate.cv_storage_path });

          results.push(candidate);
          ingested++;
          details.push({
            gmail_message_id: msg.id,
            filename: cv.filename,
            outcome: matchedRoleId ? "ingested" : "unmatched",
            candidate_id: candidate.id,
            role_title: matchedRoleTitle || selectedRole?.title || undefined,
            confidence: selectedRole ? "selected_role" : roleMatch?.confidence,
          });
        }
      }

      // ---- Throttled parse-cv execution with retry/backoff ----
      const runParseTask = async (task: { candidateId: string; storagePath: string }) => {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/parse-cv`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                candidate_id: task.candidateId,
                storage_path: task.storagePath,
              }),
            });
            if (res.ok) return;
            if (res.status === 429 && attempt < maxAttempts) {
              const backoff = 1000 * Math.pow(2, attempt - 1);
              console.warn(`parse-cv 429 for ${task.candidateId}, retry ${attempt}/${maxAttempts - 1} in ${backoff}ms`);
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            // Non-retryable or attempts exhausted
            await supabaseAdmin
              .from("candidates")
              .update({
                status: res.status === 429 ? "parse_retry_pending" : "parse_failed",
                failure_reason: `parse-cv HTTP ${res.status}`,
              })
              .eq("id", task.candidateId);
            return;
          } catch (err: any) {
            if (attempt < maxAttempts) {
              const backoff = 1000 * Math.pow(2, attempt - 1);
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            await supabaseAdmin
              .from("candidates")
              .update({
                status: "parse_retry_pending",
                failure_reason: `parse-cv exception: ${err?.message || "unknown"}`,
              })
              .eq("id", task.candidateId);
          }
        }
      };

      const runParseQueue = async () => {
        let cursor = 0;
        const workers: Promise<void>[] = [];
        const next = async (): Promise<void> => {
          while (cursor < parseQueue.length) {
            const task = parseQueue[cursor++];
            await runParseTask(task);
          }
        };
        for (let i = 0; i < Math.min(PARSE_CONCURRENCY, parseQueue.length); i++) {
          workers.push(next());
        }
        await Promise.all(workers);
      };

      // Run the parse queue in the background; release the lock when done
      const background = (async () => {
        try {
          await runParseQueue();
        } finally {
          await supabaseAdmin.from("fetch_locks").delete().eq("resource_key", lockKey);
        }
      })();
      try { (globalThis as any).EdgeRuntime.waitUntil(background); } catch { /* fallback */ }

      return new Response(
        JSON.stringify({
          success: true,
          ingested,
          skipped,
          unmatched,
          parse_failed: parseFailed,
          total_messages: allMessages.length,
          processed_messages: processedMessages,
          has_more: hasMore,
          pages_fetched: searchOutcome.pagesFetched,
          search_exhausted: searchOutcome.exhausted,
          candidates: results,
          details,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (innerErr: any) {
      // Release lock on synchronous failure
      await supabaseAdmin.from("fetch_locks").delete().eq("resource_key", lockKey);
      throw innerErr;
    }
  } catch (error: any) {
    console.error("Fetch Gmail CVs error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to fetch CVs" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper to trigger parse-cv without blocking on failure
async function triggerParse(supabaseUrl: string, serviceKey: string, candidateId: string, storagePath: string) {
  try {
    // Fetch the actual storage path from the candidate record
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { data: cand } = await supabaseAdmin.from("candidates").select("cv_storage_path").eq("id", candidateId).single();
    if (!cand?.cv_storage_path) return;

    await fetch(`${supabaseUrl}/functions/v1/parse-cv`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        candidate_id: candidateId,
        storage_path: cand.cv_storage_path,
      }),
    });
  } catch (e: any) {
    console.error(`Failed to trigger parse for ${candidateId}:`, e);
  }
}
