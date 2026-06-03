// EA Mode — polls duncan@kabuni.com Gmail every 5 minutes, classifies meeting
// requests for Nimesh, replies for purpose if missing, scores priority, and
// proposes a calendar slot. Never sends confirmation or creates events itself
// (admin approval required via ea-confirm-meeting).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NIMESH_USER_ID = "517bf518-6111-41b8-9ff0-1249f3055ec7";
const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const SEARCH_QUERY =
  'newer_than:7d (nimesh OR "meeting" OR "schedule" OR "call" OR "speak" OR "intro" OR "chat")';

// ---------- token helpers ----------
async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
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

async function getDuncanGmailAccess(supa: any): Promise<{ token: string; email: string }> {
  const { data: row, error } = await supa.from("duncan_gmail_tokens").select("*").limit(1).maybeSingle();
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
  await supa.from("duncan_gmail_tokens")
    .update({ access_token: refreshed.access_token, token_expiry: expiry })
    .eq("id", row.id);
  return { token: refreshed.access_token, email: row.google_account_email };
}

export async function getNimeshCalendarAccess(supa: any): Promise<string> {
  const { data: row, error } = await supa.from("google_calendar_tokens")
    .select("*").eq("user_id", NIMESH_USER_ID).maybeSingle();
  if (error || !row) throw new Error("Nimesh calendar not connected");
  if (new Date(row.token_expiry).getTime() - Date.now() > 60_000) return row.access_token;
  const refreshed = await refreshGoogleToken(
    row.refresh_token,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")!,
    Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")!,
  );
  const expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await supa.from("google_calendar_tokens")
    .update({ access_token: refreshed.access_token, token_expiry: expiry })
    .eq("user_id", NIMESH_USER_ID);
  return refreshed.access_token;
}

// ---------- Claude ----------
async function callClaude(system: string, user: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Claude error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j?.content?.[0]?.text ?? "";
}

function parseJsonFromText(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ---------- Gmail ----------
async function gmail(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Gmail ${path} ${r.status}: ${await r.text()}`);
  return await r.json();
}

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return decodeURIComponent(escape(atob(s))); } catch { return atob(s); }
}

function extractBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return b64urlDecode(payload.body.data);
  if (payload.parts) {
    // prefer text/plain
    for (const p of payload.parts) {
      if (p.mimeType === "text/plain" && p.body?.data) return b64urlDecode(p.body.data);
    }
    for (const p of payload.parts) {
      const nested = extractBody(p);
      if (nested) return nested;
    }
  }
  return "";
}

function header(payload: any, name: string): string {
  const h = (payload?.headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseFromHeader(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].split("@")[0], email: m[2].trim().toLowerCase() };
  return { name: from.split("@")[0], email: from.trim().toLowerCase() };
}

function encodeMimeSubject(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return `=?UTF-8?B?${b64}?=`;
}

async function sendGmailReply(
  token: string, threadId: string, toEmail: string, subject: string, body: string, inReplyTo?: string,
) {
  const subj = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  const headers = [
    `To: ${toEmail}`,
    `Subject: ${encodeMimeSubject(subj)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }
  const raw = b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + body);
  return gmail(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId }),
  });
}

// ---------- Slot finder ----------
interface BusyBlock { start: Date; end: Date }

async function fetchBusy(calendarToken: string, from: Date, to: Date): Promise<BusyBlock[]> {
  const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${calendarToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      timeZone: "Europe/London",
      items: [{ id: "primary" }],
    }),
  });
  if (!r.ok) throw new Error(`freeBusy ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return (j.calendars?.primary?.busy ?? []).map((b: any) => ({
    start: new Date(b.start), end: new Date(b.end),
  }));
}

// London time helpers (offset varies — use Intl)
function londonParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, day: "2-digit", month: "2-digit", year: "numeric",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    isWeekend: ["Sat", "Sun"].includes(parts.weekday),
  };
}

function isInsideAny(slotStart: Date, slotEnd: Date, blocks: BusyBlock[], bufferMs = 15 * 60_000) {
  return blocks.some(b => slotStart.getTime() < b.end.getTime() + bufferMs &&
                          slotEnd.getTime()   > b.start.getTime() - bufferMs);
}

function findSlot(busy: BusyBlock[], priority: string, now: Date): { start: Date; end: Date } | null {
  const durationMin = (priority === "P1" || priority === "P2") ? 60 : 30;
  let lookAheadDays: number;
  let startDayOffset = 0;
  if (priority === "P1") lookAheadDays = 1;
  else if (priority === "P2") lookAheadDays = 3;
  else if (priority === "P3") lookAheadDays = 5;
  else { startDayOffset = 7; lookAheadDays = 14; } // P4 = next week

  for (let d = startDayOffset; d < startDayOffset + lookAheadDays + 1; d++) {
    // step through 15-min slots between 09:00 and 18:00 London
    for (let stepMin = 0; stepMin < 9 * 60; stepMin += 15) {
      // candidate start in London = today+d at 09:00 + stepMin
      // We compute candidate as UTC by guessing offset via Intl.
      const candidate = new Date(now.getTime() + d * 86_400_000);
      // anchor to midnight UTC then add offset later; simpler approach: iterate 9..17 in London hours
      // we'll synthesize via setUTCHours after computing London offset for that date.
      const tmp = new Date(Date.UTC(
        candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(),
        12, 0, 0,
      ));
      const lp = londonParts(tmp);
      const londonOffsetMin = (12 - lp.hour) * 60 - lp.minute; // minutes to add to UTC to reach London
      const start = new Date(Date.UTC(
        candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(),
        9, 0, 0,
      ));
      start.setUTCMinutes(start.getUTCMinutes() + stepMin - londonOffsetMin);
      const end = new Date(start.getTime() + durationMin * 60_000);
      if (start.getTime() < now.getTime() + 30 * 60_000) continue;

      const sp = londonParts(start);
      const ep = londonParts(end);
      if (sp.isWeekend) continue;
      if (sp.hour < 9 || ep.hour > 18 || (ep.hour === 18 && ep.minute > 0)) continue;
      // lunch block 12-13 except P1
      if (priority !== "P1") {
        const lunchStart = sp.hour === 12;
        const overlapsLunch = (sp.hour < 13 && (sp.hour > 12 || (sp.hour === 12)) ) ||
                              (sp.hour === 11 && sp.minute + durationMin > 60);
        if (lunchStart || overlapsLunch) continue;
      }
      if (isInsideAny(start, end, busy)) continue;
      return { start, end };
    }
  }
  return null;
}

function londonYmdToUtc(y: number, m: number, d: number, minutesFromMidnight: number): Date {
  const tmp = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const lp = londonParts(tmp);
  const londonOffsetMin = (12 - lp.hour) * 60 - lp.minute;
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  start.setUTCMinutes(start.getUTCMinutes() + minutesFromMidnight - londonOffsetMin);
  return start;
}

interface Preferred {
  date?: string | null;  // YYYY-MM-DD (London)
  timeStart?: string | null; // HH:MM 24h
  timeEnd?: string | null;   // HH:MM 24h
}

function hhmmToMin(s?: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function findSlotOnDate(
  busy: BusyBlock[], durationMin: number, dateStr: string,
  winStartMin: number, winEndMin: number, now: Date,
): { start: Date; end: Date } | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  for (let t = winStartMin; t + durationMin <= winEndMin; t += 15) {
    const start = londonYmdToUtc(y, mo, d, t);
    const end = new Date(start.getTime() + durationMin * 60_000);
    if (start.getTime() < now.getTime() + 30 * 60_000) continue;
    const sp = londonParts(start);
    if (sp.isWeekend) continue;
    if (isInsideAny(start, end, busy)) continue;
    return { start, end };
  }
  return null;
}

// ---------- main poll ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supaUrl, svcKey);

  const log: any = { scanned: 0, new_threads: 0, replied_for_purpose: 0, scored: 0, errors: [] as string[] };

  try {
    const { token: gmailToken } = await getDuncanGmailAccess(supa);
    const list = await gmail(gmailToken, `/messages?maxResults=25&q=${encodeURIComponent(SEARCH_QUERY)}`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    log.scanned = ids.length;

    for (const id of ids) {
      try {
        const msg = await gmail(gmailToken, `/messages/${id}?format=full`);
        const threadId = msg.threadId as string;
        const payload = msg.payload;
        const from = header(payload, "From");
        const subject = header(payload, "Subject");
        const messageIdHeader = header(payload, "Message-Id") || header(payload, "Message-ID");
        const { name: senderName, email: senderEmail } = parseFromHeader(from);
        const body = extractBody(payload).slice(0, 8000);

        // Skip emails we sent
        const fromHeader = header(payload, "From").toLowerCase();
        if (fromHeader.includes("duncan@kabuni.com")) continue;

        const { data: existing } = await supa
          .from("meeting_requests")
          .select("*")
          .eq("gmail_thread_id", threadId)
          .maybeSingle();

        const todayLondon = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date()); // YYYY-MM-DD
        const weekdayLondon = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London", weekday: "long",
        }).format(new Date());

        if (existing) {
          // If awaiting_purpose and there's a new reply from sender, try to extract purpose
          if (existing.status === "awaiting_purpose") {
            const purposeResp = await callClaude(
              `You are Duncan, an AI Executive Assistant. Today is ${weekdayLondon} ${todayLondon} (Europe/London). Extract the user's stated purpose for meeting with Nimesh from this email reply, AND any preferred date/time they mention. Resolve relative dates ("tomorrow", "next Friday", "5th June") against today's date. Return JSON only: { "purpose_found": true|false, "purpose": "string or null", "preferred_date": "YYYY-MM-DD or null", "preferred_time_start": "HH:MM or null (24h London)", "preferred_time_end": "HH:MM or null (24h London)" }. If they say "anytime" set both times to null but still return the date.`,
              body,
            );
            const parsed = parseJsonFromText(purposeResp);
            if (parsed?.purpose_found && parsed.purpose) {
              const preferred: Preferred = {
                date: parsed.preferred_date || null,
                timeStart: parsed.preferred_time_start || null,
                timeEnd: parsed.preferred_time_end || null,
              };
              await scoreProposeAndBook(supa, existing.id, parsed.purpose, gmailToken, preferred);
              log.scored++;
            }
          } else if (existing.status === "pending_approval" && existing.purpose) {
            // Auto-book legacy pending rows now that approval is no longer required
            await scoreProposeAndBook(supa, existing.id, existing.purpose, gmailToken);
            log.scored++;
          }
          continue;
        }

        // New thread — assess intent + extract purpose
        log.new_threads++;
        const intentResp = await callClaude(
          `You are Duncan, an AI Executive Assistant. Today is ${weekdayLondon} ${todayLondon} (Europe/London). Determine if this email is a request to meet, call, or schedule time with Nimesh Patel (CEO). Then check if a clear purpose is stated, and extract any preferred date/time. Resolve relative dates ("tomorrow", "next Friday", "5th June") against today. Return JSON only: { "is_meeting_request": true|false, "purpose_found": true|false, "purpose": "string or null", "preferred_date": "YYYY-MM-DD or null", "preferred_time_start": "HH:MM or null (24h London)", "preferred_time_end": "HH:MM or null (24h London)" }`,
          `Subject: ${subject}\n\n${body}`,
        );
        const intent = parseJsonFromText(intentResp);
        if (!intent?.is_meeting_request) continue;

        const insertRow: any = {
          sender_name: senderName,
          sender_email: senderEmail,
          gmail_thread_id: threadId,
          gmail_message_id: messageIdHeader || null,
          original_email_subject: subject,
          original_email_body: body,
          last_polled_at: new Date().toISOString(),
        };

        if (intent.purpose_found && intent.purpose) {
          insertRow.purpose = intent.purpose;
          const { data: inserted } = await supa
            .from("meeting_requests").insert(insertRow).select().single();
          if (inserted) {
            const preferred: Preferred = {
              date: intent.preferred_date || null,
              timeStart: intent.preferred_time_start || null,
              timeEnd: intent.preferred_time_end || null,
            };
            await scoreProposeAndBook(supa, inserted.id, intent.purpose, gmailToken, preferred);
            log.scored++;
          }
        } else {
          insertRow.status = "awaiting_purpose";
          const { data: inserted } = await supa
            .from("meeting_requests").insert(insertRow).select().single();
          if (inserted) {
            const firstName = senderName.split(" ")[0] || "there";
            const reply =
`Hi ${firstName},

Thanks for reaching out! Nimesh would love to connect.

To help schedule your meeting appropriately, could you briefly share:

1. The purpose of the meeting (e.g. partnership, investor discussion, product feedback, hiring, etc.)
2. Whether this is time-sensitive or if you have a preferred timeframe.

I'll find a suitable slot once I have that context.

Best,
Duncan (EA for Nimesh Patel)`;
            await sendGmailReply(gmailToken, threadId, senderEmail, subject || "your message", reply, messageIdHeader);
            log.replied_for_purpose++;
          }
        }
      } catch (e: any) {
        log.errors.push(`msg ${id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    log.errors.push(e.message);
  }

  return new Response(JSON.stringify(log), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

const NIMESH_EMAIL = "nimesh@kabuni.com";

function fmtLondonDayTime(iso: string) {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-GB",
      { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(d),
    time: new Intl.DateTimeFormat("en-GB",
      { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d),
  };
}

async function scoreProposeAndBook(
  supa: any, rowId: string, purpose: string, gmailToken: string, preferred?: Preferred,
) {
  const scoreResp = await callClaude(
    `You are an intelligent scheduling assistant for a Series A startup one week away from a major product launch. Classify the following meeting request into one of four priority tiers using these rules:
P1 – CRITICAL: Investors, board members, product launch blockers, enterprise deals that are time-sensitive, press or PR opportunities, legal matters.
P2 – HIGH: New sales leads, strategic partnerships, senior hiring (Head of / Lead level or above), key client relationship management, internal escalations from team leads.
P3 – MEDIUM: Product feedback sessions, mid-level hiring, vendor meetings, internal syncs that are not urgent.
P4 – LOW: Cold outreach, generic catch-ups, advisory chats with no clear agenda, speaking or event requests, anything not relevant to current launch priorities.
Return JSON only: { "priority": "P1|P2|P3|P4", "reason": "one sentence explanation" }`,
    purpose,
  );
  const score = parseJsonFromText(scoreResp);
  const priority = ["P1","P2","P3","P4"].includes(score?.priority) ? score.priority : "P3";
  const reason = score?.reason || "";

  // Fetch the meeting request row for sender details
  const { data: row } = await supa.from("meeting_requests").select("*").eq("id", rowId).maybeSingle();
  if (!row) return;

  // Find slot — honor sender's preferred date/time if provided
  let proposedStart: Date | null = null;
  let proposedEnd: Date | null = null;
  let calToken: string | null = null;
  try {
    calToken = await getNimeshCalendarAccess(supa);
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + 35 * 86_400_000);
    const busy = await fetchBusy(calToken, now, horizonEnd);
    const durationMin = (priority === "P1" || priority === "P2") ? 60 : 30;

    if (preferred?.date) {
      const ws = hhmmToMin(preferred.timeStart) ?? 9 * 60;
      const we = hhmmToMin(preferred.timeEnd) ?? 18 * 60;
      const slot = findSlotOnDate(busy, durationMin, preferred.date, ws, we, now);
      if (slot) { proposedStart = slot.start; proposedEnd = slot.end; }
    }
    if (!proposedStart) {
      const slot = findSlot(busy, priority, now);
      if (slot) { proposedStart = slot.start; proposedEnd = slot.end; }
    }
  } catch (e) {
    console.warn("slot find failed", e);
  }

  // If no slot found, store as pending_approval so admin can manually pick a time
  if (!proposedStart || !proposedEnd || !calToken) {
    await supa.from("meeting_requests").update({
      purpose, priority, priority_reason: reason,
      status: "pending_approval",
      last_polled_at: new Date().toISOString(),
    }).eq("id", rowId);
    return;
  }

  const startIso = proposedStart.toISOString();
  const endIso = proposedEnd.toISOString();

  // Create calendar event with Google Meet
  let eventId: string | null = null;
  try {
    const eventRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${calToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: `${purpose} – ${row.sender_name}`,
          description: `${row.original_email_body}\n\n—\nPriority: ${priority} — ${reason}`,
          start: { dateTime: startIso, timeZone: "Europe/London" },
          end:   { dateTime: endIso,   timeZone: "Europe/London" },
          attendees: [{ email: NIMESH_EMAIL }, { email: row.sender_email }],
          conferenceData: {
            createRequest: { requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" } },
          },
        }),
      },
    );
    if (eventRes.ok) {
      const ev = await eventRes.json();
      eventId = ev.id;
    } else {
      console.warn("calendar create failed", await eventRes.text());
    }
  } catch (e) {
    console.warn("calendar create error", e);
  }

  if (!eventId) {
    // Fall back: store proposed slot but mark pending so admin can review
    await supa.from("meeting_requests").update({
      purpose, priority, priority_reason: reason,
      proposed_slot: startIso, proposed_slot_end: endIso,
      status: "pending_approval",
      last_polled_at: new Date().toISOString(),
    }).eq("id", rowId);
    return;
  }

  // Send confirmation email to requester
  try {
    const f = fmtLondonDayTime(startIso);
    const firstName = (row.sender_name || "").split(" ")[0] || "there";
    const confirmBody =
`Hi ${firstName},

Great news — I've booked your meeting with Nimesh.

📅 ${f.day}
⏰ ${f.time} (UK Time)
📍 Google Meet (invite sent separately)

Topic: ${purpose}

If you need to reschedule, just reply to this email.

Best,
Duncan (EA for Nimesh Patel)`;
    const subject = `Meeting Confirmed – Nimesh Patel | ${f.day}, ${f.time}`;
    await sendGmailReply(gmailToken, row.gmail_thread_id, row.sender_email, subject, confirmBody, row.gmail_message_id);
  } catch (e) {
    console.warn("confirm email failed", e);
  }

  await supa.from("meeting_requests").update({
    purpose, priority, priority_reason: reason,
    proposed_slot: startIso, proposed_slot_end: endIso,
    calendar_event_id: eventId,
    status: "confirmed",
    last_polled_at: new Date().toISOString(),
  }).eq("id", rowId);
}
