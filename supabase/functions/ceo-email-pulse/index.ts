// Company-wide email pulse for the CEO briefing.
// Iterates every connected gmail_tokens row whose owner has opted in
// (gmail_writing_profiles.ceo_briefing_optin = true), pulls the last 24h
// of inbox + sent messages, and runs a lightweight gpt-4o-mini extraction
// to surface commitments, risks, escalations, board mentions, customer
// issues, vendor signals, and silent leaders.
//
// IMPORTANT: raw email content is sent to OpenAI for one-time extraction
// only. Nothing other than the structured JSON below is persisted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_MESSAGES_PER_MAILBOX = 50;
const WINDOW_HOURS = 24;

// ─── Leadership roster (kept in sync with ceo-briefing) ─────────────
const LEADERSHIP = [
  { name: "Nimesh", emails: ["nimesh@kabuni.com"] },
  { name: "Patrick", emails: ["patrick@kabuni.com"] },
  { name: "Ellaine", emails: ["ellaine@kabuni.com"] },
  { name: "Matt", emails: ["matt@kabuni.com"] },
  { name: "Alex", emails: ["alex@kabuni.com"] },
  { name: "Simon", emails: ["simon@kabuni.com"] },
  { name: "Palash", emails: ["palash@kabuni.com"] },
  { name: "Parmy", emails: ["parmy@kabuni.com"] },
];

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getValidToken(supabaseAdmin: any, tokenRow: any) {
  const expiry = new Date(tokenRow.token_expiry).getTime();
  if (expiry - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    if (!refreshed) return null;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("gmail_tokens")
      .update({ access_token: refreshed.access_token, token_expiry: newExpiry })
      .eq("id", tokenRow.id);
    return refreshed.access_token;
  }
  return tokenRow.access_token;
}

function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

async function fetchMailboxMessages(accessToken: string) {
  // Gmail query: last 24h, in inbox or sent
  const q = `newer_than:${WINDOW_HOURS}h (in:inbox OR in:sent) -category:promotions -category:social`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_MESSAGES_PER_MAILBOX}&q=${encodeURIComponent(q)}`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) return [];
  const listData = await listRes.json();
  const ids: string[] = (listData.messages || []).map((m: any) => m.id);
  if (ids.length === 0) return [];

  // Fetch metadata + snippets in parallel
  const messages = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!r.ok) return null;
      const m = await r.json();
      const headers = m.payload?.headers || [];
      return {
        id: m.id,
        threadId: m.threadId,
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        date: getHeader(headers, "Date"),
        snippet: m.snippet || "",
        labelIds: m.labelIds || [],
      };
    }),
  );
  return messages.filter((m): m is NonNullable<typeof m> => !!m);
}

// Tolerate LLM responses that wrap JSON in markdown code fences or include
// stray prose. Returns parsed object or throws.
function parseLLMJson(raw: string): any {
  let s = String(raw ?? "").trim();
  // Strip ```json ... ``` or ``` ... ``` fences (multi-line, anywhere).
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    // Second-chance: extract the first {...} or [...] block.
    const objMatch = s.match(/\{[\s\S]*\}/);
    const arrMatch = s.match(/\[[\s\S]*\]/);
    const candidate = objMatch?.[0] || arrMatch?.[0];
    if (candidate) return JSON.parse(candidate);
    throw new Error("No JSON object found in LLM response");
  }
}

async function extractSignals(
  mailboxOwner: string,
  messages: any[],
): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey || messages.length === 0) {
    return {
      commitments: [],
      risks: [],
      escalations: [],
      board_mentions: [],
      customer_issues: [],
      vendor_signals: [],
    };
  }

  const compact = messages.map((m) => ({
    id: m.id,
    direction: m.labelIds?.includes("SENT") ? "sent" : "received",
    from: m.from,
    to: m.to,
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
  }));

  const systemPrompt = `You are an executive intelligence extractor. Analyse a 24h slice of one mailbox (owner: ${mailboxOwner}) and surface ONLY high-signal items relevant to the CEO of Kabuni. Ignore newsletters, marketing, calendar invites, low-stakes chatter.

OUTPUT FORMAT: Return ONLY a single raw JSON object. No markdown, no code fences (no \`\`\`json), no prose, no explanation. Start your response with { and end with }.`;

  const userPrompt = `Mailbox owner: ${mailboxOwner}
Messages (max 50, last 24h):
${JSON.stringify(compact).slice(0, 60000)}

Return JSON with this exact shape:
{
  "commitments":   [{ "owner": string, "what": string, "due": string|null, "source_email_id": string }],
  "risks":         [{ "severity": "low"|"medium"|"high"|"critical", "summary": string, "who_flagged": string, "priority_match": string|null }],
  "escalations":   [{ "from": string, "to": string, "topic": string, "urgency": "low"|"medium"|"high" }],
  "board_mentions":[{ "topic": string, "sender": string }],
  "customer_issues":[{ "company": string, "issue": string, "severity": "low"|"medium"|"high" }],
  "vendor_signals":[{ "vendor": string, "signal": string, "amount": string|null }]
}

RULES:
- Empty arrays are fine — do NOT invent items.
- Commitments must be concrete (a person promising a specific action by a date or soon).
- Risks must be material to a 2026 priority (India launch, KPL registrations, trials, team selection, pre-orders, Duncan automation) or to finance/legal/customers.
- Board mentions = anything referring to investors, board members, or board materials.
- Do NOT include personal emails, marketing, recruiter spam, or social.
- Keep summaries under 20 words each.`;

  try {
    const data = await callLLMWithFallback({
      workflow: "ceo-email-pulse",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = parseLLMJson(raw);
    } catch (parseErr) {
      console.error(
        "extractSignals JSON parse failed for",
        mailboxOwner,
        "— raw[0..200]:",
        String(raw).slice(0, 200),
        "err:",
        parseErr,
      );
      throw parseErr;
    }
    return {
      commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      escalations: Array.isArray(parsed.escalations) ? parsed.escalations : [],
      board_mentions: Array.isArray(parsed.board_mentions) ? parsed.board_mentions : [],
      customer_issues: Array.isArray(parsed.customer_issues) ? parsed.customer_issues : [],
      vendor_signals: Array.isArray(parsed.vendor_signals) ? parsed.vendor_signals : [],
    };
  } catch (e: any) {
    console.error("extractSignals error for", mailboxOwner, ":", e);
    return {
      commitments: [],
      risks: [],
      escalations: [],
      board_mentions: [],
      customer_issues: [],
      vendor_signals: [],
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull all gmail tokens
    const { data: allTokens, error: tokErr } = await supabaseAdmin
      .from("gmail_tokens")
      .select("id, connected_by, email_address, access_token, refresh_token, token_expiry");
    if (tokErr) throw tokErr;

    // Pull opt-in profiles
    const { data: profiles } = await supabaseAdmin
      .from("gmail_writing_profiles")
      .select("user_id, ceo_briefing_optin");
    const optinSet = new Set(
      (profiles || []).filter((p: any) => p.ceo_briefing_optin === true).map((p: any) => p.user_id),
    );

    // CEO is always opted in
    const { data: ceoProfile } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .ilike("display_name", "%nimesh%")
      .maybeSingle();
    if (ceoProfile?.user_id) optinSet.add(ceoProfile.user_id);

    const eligible = (allTokens || []).filter((t: any) => optinSet.has(t.connected_by));
    const skipped = (allTokens || []).filter((t: any) => !optinSet.has(t.connected_by));

    // Process mailboxes in parallel (capped concurrency by Promise.all over modest list)
    const mailboxResults = await Promise.all(
      eligible.map(async (tokenRow: any) => {
        try {
          const accessToken = await getValidToken(supabaseAdmin, tokenRow);
          if (!accessToken) {
            return { mailbox: tokenRow.email_address, status: "auth_failed", emails_scanned: 0, signals: null };
          }
          const messages = await fetchMailboxMessages(accessToken);
          const sentCount = messages.filter((m) => m.labelIds?.includes("SENT")).length;
          const signals = await extractSignals(tokenRow.email_address || "unknown", messages);
          return {
            mailbox: tokenRow.email_address || "unknown",
            user_id: tokenRow.connected_by,
            status: "ok",
            emails_scanned: messages.length,
            sent_count: sentCount,
            signals,
          };
        } catch (e: any) {
          return {
            mailbox: tokenRow.email_address,
            status: "error",
            error: e?.message || String(e),
            emails_scanned: 0,
            signals: null,
          };
        }
      }),
    );

    // Aggregate
    const allCommitments: any[] = [];
    const allRisks: any[] = [];
    const allEscalations: any[] = [];
    const allBoardMentions: any[] = [];
    const allCustomerIssues: any[] = [];
    const allVendorSignals: any[] = [];
    let totalEmails = 0;

    for (const r of mailboxResults) {
      if (r.status !== "ok" || !r.signals) continue;
      totalEmails += r.emails_scanned;
      const tag = (arr: any[]) => arr.map((x) => ({ ...x, _mailbox: r.mailbox }));
      allCommitments.push(...tag(r.signals.commitments));
      allRisks.push(...tag(r.signals.risks));
      allEscalations.push(...tag(r.signals.escalations));
      allBoardMentions.push(...tag(r.signals.board_mentions));
      allCustomerIssues.push(...tag(r.signals.customer_issues));
      allVendorSignals.push(...tag(r.signals.vendor_signals));
    }

    // Helper: derive a friendly display name from an email local-part.
    const nameFromEmail = (email: string | null | undefined): string | null => {
      if (!email) return null;
      const local = email.split("@")[0] || "";
      if (!local) return null;
      return local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");
    };

    // Build a set of opted-in mailbox emails (lowercased) and a map of skipped (opted-out) emails.
    const eligibleEmails = new Set(
      (eligible || []).map((t: any) => (t.email_address || "").toLowerCase()).filter(Boolean),
    );
    const skippedEmailSet = new Set(
      (skipped || []).map((t: any) => (t.email_address || "").toLowerCase()).filter(Boolean),
    );
    const allConnectedEmails = new Set([...eligibleEmails, ...skippedEmailSet]);

    // Build per-leader status: silent | opted_out | not_connected | active | error
    type LeaderState = "silent" | "opted_out" | "not_connected" | "active" | "error";
    const leadershipStatus: Array<{ leader: string; email: string; state: LeaderState; reason: string }> = [];
    for (const leader of LEADERSHIP) {
      const primaryEmail = leader.emails[0] || "";
      const lowerEmails = leader.emails.map((e) => e.toLowerCase());

      const isConnected = lowerEmails.some((e) => allConnectedEmails.has(e));
      const isOptedOut = lowerEmails.some((e) => skippedEmailSet.has(e));
      const isOptedIn = lowerEmails.some((e) => eligibleEmails.has(e));

      if (!isConnected) {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "not_connected",
          reason: "Gmail not connected to Duncan",
        });
        continue;
      }
      if (isOptedOut && !isOptedIn) {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "opted_out",
          reason: "Connected but opted out of CEO briefing scan",
        });
        continue;
      }
      const mailboxMatch = mailboxResults.find((r) =>
        lowerEmails.includes((r.mailbox || "").toLowerCase()),
      );
      if (!mailboxMatch) {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "error",
          reason: "Opted in but mailbox not scanned",
        });
        continue;
      }
      if (mailboxMatch.status !== "ok") {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "error",
          reason: `Mailbox ${mailboxMatch.status}`,
        });
        continue;
      }
      if ((mailboxMatch.sent_count ?? 0) === 0) {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "silent",
          reason: "0 outbound emails in last 24h",
        });
      } else {
        leadershipStatus.push({
          leader: leader.name,
          email: primaryEmail,
          state: "active",
          reason: `${mailboxMatch.sent_count} sent in last 24h`,
        });
      }
    }

    // Backwards-compatible silent_leaders view — only true "silent" state.
    const silentLeaders = leadershipStatus
      .filter((l) => l.state === "silent")
      .map((l) => ({ leader: l.leader, reason: l.reason }));

    // Build a lightweight opted-out mailbox list (email + display name) so the
    // briefing UI can show *who* has opted out, not just the count.
    const skippedUserIds = Array.from(
      new Set((skipped || []).map((t: any) => t.connected_by).filter(Boolean)),
    );
    let optedOutMailboxes: Array<{ email: string | null; display_name: string | null; state: "opted_out" }> = [];
    if ((skipped || []).length > 0) {
      let nameByUser = new Map<string, string | null>();
      if (skippedUserIds.length > 0) {
        const { data: skippedProfiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", skippedUserIds);
        nameByUser = new Map(
          (skippedProfiles || []).map((p: any) => [p.user_id, p.display_name]),
        );
      }
      optedOutMailboxes = (skipped || []).map((t: any) => {
        const email = t.email_address || null;
        const profileName = t.connected_by ? nameByUser.get(t.connected_by) : null;
        const displayName = (profileName && profileName.trim()) || nameFromEmail(email);
        return {
          email,
          display_name: displayName,
          state: "opted_out" as const,
        };
      });
    }

    return json({
      ok: true,
      window_hours: WINDOW_HOURS,
      mailboxes_eligible: eligible.length,
      mailboxes_total: (allTokens || []).length,
      mailboxes_skipped_optout: skipped.length,
      opted_out_mailboxes: optedOutMailboxes,
      emails_analysed: totalEmails,
      per_mailbox: mailboxResults.map((r) => ({
        mailbox: r.mailbox,
        status: r.status,
        emails_scanned: r.emails_scanned,
        sent_count: (r as any).sent_count ?? 0,
        commitments: r.signals?.commitments?.length ?? 0,
        risks: r.signals?.risks?.length ?? 0,
      })),
      signals: {
        commitments: allCommitments,
        risks: allRisks,
        escalations: allEscalations,
        board_mentions: allBoardMentions,
        customer_issues: allCustomerIssues,
        vendor_signals: allVendorSignals,
      },
      silent_leaders: silentLeaders,
      leadership_status: leadershipStatus,
    });
  } catch (e: any) {
    console.error("ceo-email-pulse error:", e);
    return json({ error: e?.message || "ceo-email-pulse failed" }, 500);
  }
});
