import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getGmailAccessToken(supabaseAdmin: any): Promise<string | null> {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  // Always use Duncan's email for Plaud meeting sync
  const { data: tokenData, error } = await supabaseAdmin
    .from("gmail_tokens")
    .select("*")
    .eq("email_address", "duncan@kabuni.com")
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

    await supabaseAdmin
      .from("gmail_tokens")
      .update({
        access_token: newTokens.access_token,
        token_expiry: newExpiry.toISOString(),
      })
      .eq("id", tokenData.id);

    return newTokens.access_token;
  }

  return tokenData.access_token;
}

function extractSenderEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1] : fromHeader.trim();
}

function extractEmailList(headerVal: string): string[] {
  if (!headerVal) return [];
  // Split on commas at top level (good enough for most well-formed headers)
  return headerVal.split(",").map((part) => {
    const m = part.match(/<([^>]+)>/);
    return (m ? m[1] : part).trim().toLowerCase();
  }).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function base64UrlDecode(data: string): Uint8Array {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function extractHtmlBody(payload: any): string {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return new TextDecoder().decode(base64UrlDecode(payload.body.data));
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }
  return "";
}

function extractPlainTextBody(payload: any): string {
  // Recursively search for text/plain parts
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    const decoded = new TextDecoder().decode(base64UrlDecode(payload.body.data));
    return decoded;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainTextBody(part);
      if (text) return text;
    }
  }
  // Fallback to text/html
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const decoded = new TextDecoder().decode(base64UrlDecode(payload.body.data));
    return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function getJwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const base64Payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = base64Payload.padEnd(Math.ceil(base64Payload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(paddedPayload));

    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function extractPlaudLinks(text: string, html: string): string[] {
  const urls = new Set<string>();
  // Match Plaud-related URLs from both plain text and HTML
  const patterns = [
    /https?:\/\/[^\s"'<>]*plaud\.[^\s"'<>]*/gi,
    /https?:\/\/[^\s"'<>]*plaud[^\s"'<>]*/gi,
    /href=["'](https?:\/\/[^"']*plaud[^"']*)/gi,
  ];
  const combined = text + " " + html;
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(combined)) !== null) {
      const url = match[1] || match[0];
      // Clean up trailing punctuation
      const cleaned = url.replace(/[)}\].,;!?]+$/, "");
      if (cleaned.startsWith("http")) {
        urls.add(cleaned);
      }
    }
  }
  return Array.from(urls);
}

async function fetchPlaudWebpage(url: string): Promise<{ transcript: string; title?: string } | null> {
  try {
    // Convert /s/ URLs to /nshare/ URLs — the nshare variant returns server-rendered content
    // while /s/ is a SPA shell that yields nothing useful via fetch
    let fetchUrl = url;
    if (url.includes("/s/")) {
      fetchUrl = url.replace("/s/", "/nshare/");
      console.log(`Converted Plaud URL to nshare: ${fetchUrl}`);
    }

    console.log(`Fetching Plaud webpage: ${fetchUrl}`);
    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DuncanBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`Plaud page fetch failed (${res.status}): ${fetchUrl}`);
      return null;
    }
    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // Extract transcript from the page body — strip scripts/styles/nav and get text
    let transcript = "";
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      transcript = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (!transcript || transcript.length < 50) {
      console.log(`No meaningful content extracted from ${fetchUrl}`);
      return null;
    }

    // Trim to reasonable size
    transcript = transcript.slice(0, 60000);
    console.log(`Extracted ${transcript.length} chars from Plaud page`);
    return { transcript, title };
  } catch (e: any) {
    console.error(`Error fetching Plaud webpage ${url}:`, e);
    return null;
  }
}

interface Attachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let requestingUserId: string | null = null;

    // Auth check — allow service role key for cron invocations
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isServiceRole = token === supabaseServiceKey.trim() || getJwtRole(token) === "service_role";

    if (!isServiceRole) {
      // Validate as user token
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requestingUserId = user.id;
    }

    console.log(`Invoked by: ${isServiceRole ? "cron/service-role" : "user"}`);


    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const gmailToken = await getGmailAccessToken(supabaseAdmin);

    if (!gmailToken) {
      return new Response(
        JSON.stringify({ error: "Gmail not connected. An admin needs to connect it first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = { Authorization: `Bearer ${gmailToken}` };

    // Search 1: Plaud AI emails - sharing invites, plaud sender
    const plaudQuery = `(subject:"invited you to view" OR subject:plaud OR from:plaud OR from:noreply@plaud.ai) newer_than:60d`;
    // Search 2: Emails from known meeting-note senders (Nimesh, Patrick) — filter by DD-MM or Plaud pattern in code
    const nimeshQuery = `from:nimesh newer_than:60d`;
    const patrickQuery = `from:patrick newer_than:60d`;
    // Search 3: Google Meet meeting notes from Gemini — subject starts with "notes -"
    const geminiNotesQuery = `subject:"notes -" (from:gemini OR from:google OR from:workspace) newer_than:60d`;

    console.log("Gmail search queries - Plaud:", plaudQuery, "| Nimesh:", nimeshQuery, "| Patrick:", patrickQuery, "| Gemini:", geminiNotesQuery);

    const plaudSearchUrl = new URL(`${GMAIL_API}/messages`);
    plaudSearchUrl.searchParams.set("q", plaudQuery);
    plaudSearchUrl.searchParams.set("maxResults", "30");

    const nimeshSearchUrl = new URL(`${GMAIL_API}/messages`);
    nimeshSearchUrl.searchParams.set("q", nimeshQuery);
    nimeshSearchUrl.searchParams.set("maxResults", "50");

    const patrickSearchUrl = new URL(`${GMAIL_API}/messages`);
    patrickSearchUrl.searchParams.set("q", patrickQuery);
    patrickSearchUrl.searchParams.set("maxResults", "50");

    const geminiSearchUrl = new URL(`${GMAIL_API}/messages`);
    geminiSearchUrl.searchParams.set("q", geminiNotesQuery);
    geminiSearchUrl.searchParams.set("maxResults", "50");

    // Fetch all four searches in parallel
    const [plaudSearchRes, nimeshSearchRes, patrickSearchRes, geminiSearchRes] = await Promise.all([
      fetch(plaudSearchUrl.toString(), { headers }),
      fetch(nimeshSearchUrl.toString(), { headers }),
      fetch(patrickSearchUrl.toString(), { headers }),
      fetch(geminiSearchUrl.toString(), { headers }),
    ]);

    if (!plaudSearchRes.ok) {
      throw new Error(`Gmail plaud search failed: ${await plaudSearchRes.text()}`);
    }

    const plaudSearchData = await plaudSearchRes.json();
    const plaudMessages = plaudSearchData.messages || [];
    console.log(`Found ${plaudMessages.length} Plaud-related emails`);

    // Process Gemini meeting notes — these go directly to the main message list (no pattern filtering needed)
    const geminiMessages: any[] = [];
    if (geminiSearchRes.ok) {
      const geminiData = await geminiSearchRes.json();
      const msgs = geminiData.messages || [];
      console.log(`Found ${msgs.length} Gemini meeting notes emails`);
      geminiMessages.push(...msgs);
    } else {
      console.error("Gemini notes search failed:", await geminiSearchRes.text());
    }

    // Collect candidate messages from Nimesh and Patrick searches, then filter by meeting patterns
    const allCandidateMsgs: any[] = [];
    const directIds = new Set([
      ...plaudMessages.map((m: any) => m.id),
      ...geminiMessages.map((m: any) => m.id),
    ]);

    for (const [label, res] of [["Nimesh", nimeshSearchRes], ["Patrick", patrickSearchRes]] as const) {
      if (res.ok) {
        const data = await res.json();
        const msgs = data.messages || [];
        console.log(`Found ${msgs.length} emails from ${label} search`);
        for (const m of msgs) {
          if (!directIds.has(m.id)) {
            allCandidateMsgs.push(m);
          }
        }
      }
    }

    // Deduplicate candidates
    const candidateIds = new Set<string>();
    const uniqueCandidates = allCandidateMsgs.filter((m) => {
      if (candidateIds.has(m.id)) return false;
      candidateIds.add(m.id);
      return true;
    });
    console.log(`${uniqueCandidates.length} unique candidate emails to check for DD-MM pattern`);

    // Check each candidate for meeting-related patterns
    // DD-MM anywhere in subject, or Plaud-related keywords
    const DD_MM_PATTERN = /\d{2}-\d{2}/;
    const PLAUD_PATTERN = /plaud|invited you to view|meeting|recording/i;
    let dateMessages: any[] = [];

    // Log first 5 candidate subjects for debugging
    let debugCount = 0;

    for (const candidate of uniqueCandidates) {
      try {
        const metaRes = await fetch(
          `${GMAIL_API}/messages/${candidate.id}?format=metadata&metadataHeaders=Subject`,
          { headers }
        );
        if (!metaRes.ok) continue;
        const metaData = await metaRes.json();
        const subjectHeader = (metaData.payload?.headers || []).find(
          (h: any) => h.name.toLowerCase() === "subject"
        );
        const subjectVal = subjectHeader?.value || "";

        if (debugCount < 10) {
          console.log(`Candidate subject [${debugCount}]: "${subjectVal}"`);
          debugCount++;
        }

        // Match: DD-MM pattern, Plaud keywords, empty subject (likely transcript share),
        // or "Fwd:" / "Notes" patterns (forwarded meeting notes)
        const isEmpty = subjectVal.trim() === "";
        const FWD_NOTES_PATTERN = /fwd:|notes|transcript|stand.?up/i;
        if (DD_MM_PATTERN.test(subjectVal) || PLAUD_PATTERN.test(subjectVal) || isEmpty || FWD_NOTES_PATTERN.test(subjectVal)) {
          dateMessages.push(candidate);
          console.log(`Pattern match: "${subjectVal}" (empty=${isEmpty})`);
        }
      } catch (e: any) {
        console.error(`Failed to check subject for ${candidate.id}:`, e);
      }
    }
    console.log(`Found ${dateMessages.length} emails matching meeting patterns`);

    // Merge and deduplicate all results
    const seenIds = new Set<string>();
    const messages: any[] = [];
    for (const msg of [...plaudMessages, ...geminiMessages, ...dateMessages]) {
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        messages.push(msg);
      }
    }
    console.log(`Total unique emails to process: ${messages.length}`);

    let fetched = 0;
    let skipped = 0;
    const results: any[] = [];

    for (const msg of messages) {
      // Check if already fetched
      const { data: existing } = await supabaseAdmin
        .from("meetings")
        .select("id")
        .eq("gmail_message_id", msg.id)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Fetch full message
      const msgRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, { headers });
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();

      const msgHeaders = msgData.payload?.headers || [];
      const subject = msgHeaders.find((h: any) => h.name.toLowerCase() === "subject")?.value || "";
      const from = msgHeaders.find((h: any) => h.name.toLowerCase() === "from")?.value || "";
      const toHeader = msgHeaders.find((h: any) => h.name.toLowerCase() === "to")?.value || "";
      const ccHeader = msgHeaders.find((h: any) => h.name.toLowerCase() === "cc")?.value || "";
      const dateHeader = msgHeaders.find((h: any) => h.name.toLowerCase() === "date")?.value || "";
      const senderEmail = extractSenderEmail(from);
      const attendeeEmails = Array.from(new Set([
        ...extractEmailList(toHeader),
        ...extractEmailList(ccHeader),
      ]));

      // Extract email body text (may contain transcript)
      const bodyText = extractPlainTextBody(msgData.payload);

      // Collect attachments - transcripts (.txt, .docx, .pdf) and audio (.mp3, .m4a, .wav, .webm)
      const transcriptAttachments: Attachment[] = [];
      const audioAttachments: Attachment[] = [];

      function collectAttachments(parts: any[]) {
        for (const part of parts) {
          const filename = (part.filename || "").toLowerCase();
          if (part.body?.attachmentId) {
            if (filename.endsWith(".txt") || filename.endsWith(".docx") || filename.endsWith(".pdf")) {
              transcriptAttachments.push({
                attachmentId: part.body.attachmentId,
                filename: part.filename,
                mimeType: part.mimeType,
              });
            } else if (
              filename.endsWith(".mp3") || filename.endsWith(".m4a") ||
              filename.endsWith(".wav") || filename.endsWith(".webm") ||
              filename.endsWith(".ogg") || filename.endsWith(".aac")
            ) {
              audioAttachments.push({
                attachmentId: part.body.attachmentId,
                filename: part.filename,
                mimeType: part.mimeType,
              });
            }
          }
          if (part.parts) collectAttachments(part.parts);
        }
      }
      collectAttachments(msgData.payload?.parts || []);

      // Download and store transcript attachments
      let transcriptText = "";
      for (const att of transcriptAttachments) {
        try {
          const attachRes = await fetch(
            `${GMAIL_API}/messages/${msg.id}/attachments/${att.attachmentId}`,
            { headers }
          );
          if (!attachRes.ok) continue;
          const attachData = await attachRes.json();
          const bytes = base64UrlDecode(attachData.data);

          if (att.filename.toLowerCase().endsWith(".txt")) {
            transcriptText = new TextDecoder().decode(bytes);
          } else {
            // For .docx/.pdf, store and we'll parse later
            transcriptText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
            // Clean up binary noise for non-txt files
            transcriptText = transcriptText.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").slice(0, 50000);
          }
        } catch (e: any) {
          console.error(`Failed to download transcript attachment ${att.filename}:`, e);
        }
      }

      // If no transcript from attachments, try Plaud webpage links
      if (!transcriptText && transcriptAttachments.length === 0 && audioAttachments.length === 0) {
        const htmlBody = extractHtmlBody(msgData.payload);
        const plaudLinks = extractPlaudLinks(bodyText, htmlBody);
        console.log(`No attachments found. Detected ${plaudLinks.length} Plaud link(s):`, plaudLinks);

        for (const link of plaudLinks) {
          const pageData = await fetchPlaudWebpage(link);
          if (pageData?.transcript) {
            transcriptText = pageData.transcript;
            console.log(`Got transcript from Plaud page: ${link} (${transcriptText.length} chars)`);
            break;
          }
        }
      }

      // If still no transcript, use email body
      if (!transcriptText && bodyText.length > 100) {
        transcriptText = bodyText;
      }

      // Download and store audio attachments
      let audioStoragePath: string | null = null;
      for (const att of audioAttachments) {
        try {
          const attachRes = await fetch(
            `${GMAIL_API}/messages/${msg.id}/attachments/${att.attachmentId}`,
            { headers }
          );
          if (!attachRes.ok) continue;
          const attachData = await attachRes.json();
          const bytes = base64UrlDecode(attachData.data);

          const storagePath = `${Date.now()}_${att.filename}`;
          const { error: uploadError } = await supabaseAdmin.storage
            .from("meeting-audio")
            .upload(storagePath, bytes, {
              contentType: att.mimeType || "audio/mpeg",
              upsert: false,
            });

          if (!uploadError) {
            audioStoragePath = storagePath;
            console.log(`Uploaded audio: ${storagePath}`);
          } else {
            console.error("Audio upload error:", uploadError);
          }
        } catch (e: any) {
          console.error(`Failed to download audio ${att.filename}:`, e);
        }
      }

      // Parse meeting date from email date header
      let meetingDate: string | null = null;
      try {
        meetingDate = new Date(dateHeader).toISOString();
      } catch {
        meetingDate = new Date().toISOString();
      }

      // Determine source: Gemini meeting notes vs Plaud
      const isGeminiNotes = subject.toLowerCase().startsWith("notes -") || subject.toLowerCase().startsWith("notes -");
      const source = isGeminiNotes ? "google_meet" : "plaud";

      // Generate a title from the subject
      const title = subject || (isGeminiNotes ? "Google Meet Notes" : "Plaud Meeting Recording");

      // Insert meeting record
      const { data: meeting, error: insertError } = await supabaseAdmin
        .from("meetings")
        .insert({
          title,
          meeting_date: meetingDate,
          transcript: transcriptText || null,
          audio_storage_path: audioStoragePath,
          gmail_message_id: msg.id,
          email_subject: subject,
          sender_email: senderEmail,
          attendee_emails: attendeeEmails.length > 0 ? attendeeEmails : null,
          source,
          status: transcriptText ? "transcribed" : (audioStoragePath ? "audio_only" : "pending"),
          fetched_by: requestingUserId,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Insert meeting error:", insertError);
        continue;
      }

      results.push({
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        has_transcript: !!transcriptText,
        has_audio: !!audioStoragePath,
      });
      fetched++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        fetched,
        skipped,
        total_emails: messages.length,
        meetings: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Fetch Plaud meetings error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to fetch Plaud meetings" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
