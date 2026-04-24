// Company-wide Slack pulse for the CEO briefing.
// Scans the last 24h of channel conversations the bot is a member of,
// runs a lightweight gpt-4o-mini extraction per channel, and surfaces
// commitments, escalations, confusion, customer issues, and silent channels.
//
// Mirrors ceo-email-pulse in shape so the briefing can treat email and
// slack as parallel "comms pulse" inputs.
//
// Privacy: raw Slack messages are sent to OpenAI for one-time extraction
// only. Nothing other than the structured JSON below is persisted.
// Read-only: bot only listens; it does not post, react, or DM.

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

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const WINDOW_SECONDS = 24 * 60 * 60;
const MAX_CHANNELS = 30;
const MAX_MESSAGES_PER_CHANNEL = 200;

interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
  is_archived?: boolean;
  is_private?: boolean;
  num_members?: number;
}

interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  reply_users_count?: number;
}

interface HistoryFetchResult {
  messages: SlackMessage[];
  history_ok: boolean;
  join_attempted: boolean;
  joined_channel: boolean;
  unresolved_membership: boolean;
  error_code: string | null;
  error_message: string | null;
  status: "ok" | "joined_then_scanned" | "join_failed" | "history_failed" | "history_failed_after_join";
}

interface SlackApiResponse {
  status: number;
  headers: Headers;
  data: any;
}

interface SlackAuthStatus {
  ok: boolean;
  user_id: string;
  team_id: string | null;
  scopes: string[];
  missingJoinScope: boolean;
}

async function slackCallDetailed(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string,
  lovableKey: string,
): Promise<SlackApiResponse> {
  const qs = new URLSearchParams(params).toString();
  const url = `${GATEWAY_URL}/${endpoint}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
    },
  });
  const data = await res.json().catch(() => ({}));
  return {
    status: res.status,
    headers: res.headers,
    data,
  };
}

async function slackCall(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string,
  lovableKey: string,
): Promise<any> {
  const { status, data } = await slackCallDetailed(endpoint, params, apiKey, lovableKey);
  if (status < 200 || status >= 300) {
    throw new Error(`Slack ${endpoint} HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

function extractScopesFromHeaders(headers: Headers): string[] {
  const raw = headers.get("x-oauth-scopes") || headers.get("X-OAuth-Scopes") || "";
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function getSlackAuthStatus(apiKey: string, lovableKey: string): Promise<SlackAuthStatus> {
  try {
    const { status, headers, data } = await slackCallDetailed("auth.test", {}, apiKey, lovableKey);
    const scopes = Array.from(new Set([
      ...extractScopesFromHeaders(headers),
      ...(Array.isArray(data?.scopes) ? data.scopes : []),
      ...(typeof data?.scope === "string"
        ? data.scope.split(",").map((scope: string) => scope.trim()).filter(Boolean)
        : []),
    ]));

    console.info("[ceo-slack-pulse] auth.test", {
      http_status: status,
      user_id: data?.user_id || "",
      team_id: data?.team_id || null,
      scopes,
    });

    return {
      ok: status >= 200 && status < 300 && !!data?.ok,
      user_id: data?.user_id || "",
      team_id: data?.team_id || null,
      scopes,
      missingJoinScope: !scopes.includes("channels:join"),
    };
  } catch (e: any) {
    console.warn("[ceo-slack-pulse] auth.test failed", e);
    return {
      ok: false,
      user_id: "",
      team_id: null,
      scopes: [],
      missingJoinScope: true,
    };
  }
}

async function listAllChannels(
  apiKey: string,
  lovableKey: string,
): Promise<{ channels: SlackChannel[]; degraded: boolean; degraded_reason: string | null; degraded_codes: string[]; visibility_scope: "full_public" | "public_only" | "partial" | "not_configured" }> {
  const all: SlackChannel[] = [];
  let cursor = "";
  let pages = 0;
  let degraded = false;
  let degraded_reason: string | null = null;
  const degraded_codes = new Set<string>();
  let visibility_scope: "full_public" | "public_only" | "partial" | "not_configured" = "full_public";
  // Public channels only — `private_channel` requires `groups:read` scope which the
  // bot does not currently have. Including it causes Slack to throw `missing_scope`
  // and the whole pulse to fail. Private channel scanning is gated on an explicit
  // scope decision (see CEO briefing plan).
  do {
    const params: Record<string, string> = {
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;
    try {
      const data = await slackCall("conversations.list", params, apiKey, lovableKey);
      if (!data.ok) {
        const err = String(data.error || "unknown");
        if (err === "missing_scope" || err === "not_authed" || err === "invalid_auth") {
          degraded = true;
          visibility_scope = err === "missing_scope" ? "public_only" : "partial";
          degraded_codes.add(err === "missing_scope" ? "missing_scope" : "auth_failed");
          if (err === "missing_scope") degraded_codes.add("public_only_visibility");
          degraded_reason = `conversations.list returned ${err} — connector scopes insufficient`;
          break;
        }
        throw new Error(`conversations.list error: ${err}`);
      }
      for (const c of (data.channels || []) as SlackChannel[]) all.push(c);
      cursor = data.response_metadata?.next_cursor || "";
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/missing_scope|not_authed|invalid_auth|not_in_channel/i.test(msg)) {
        degraded = true;
        visibility_scope = /missing_scope/i.test(msg) ? "public_only" : "partial";
        degraded_codes.add(/missing_scope/i.test(msg) ? "missing_scope" : "auth_failed");
        if (/missing_scope/i.test(msg)) degraded_codes.add("public_only_visibility");
        degraded_reason = `conversations.list permission error — ${msg.slice(0, 200)}`;
        break;
      }
      throw e;
    }
    pages++;
    if (pages > 10) break; // safety
  } while (cursor);
  return { channels: all, degraded, degraded_reason, degraded_codes: Array.from(degraded_codes), visibility_scope };
}

function parseSlackApiError(errorLike: unknown): string {
  const message = String(errorLike ?? "");
  const known = [
    "not_in_channel",
    "bot_not_invited",
    "missing_scope",
    "channel_not_found",
    "is_archived",
    "restricted_action",
    "method_not_supported_for_channel_type",
    "not_authed",
    "invalid_auth",
  ];

  for (const code of known) {
    if (message.includes(code)) return code;
  }

  const quoted = message.match(/"error":"([^"]+)"/i)?.[1];
  if (quoted) return quoted;

  const slackError = message.match(/error:\s*([a-z_]+)/i)?.[1];
  return slackError || "unknown";
}

function filterHumanMessages(messages: SlackMessage[], botUserId: string): SlackMessage[] {
  return messages.filter((m) => {
    if (m.bot_id) return false;
    if (m.subtype && ["channel_join", "channel_leave", "bot_message", "channel_topic", "channel_purpose"].includes(m.subtype)) return false;
    if (m.user && m.user === botUserId) return false;
    if (!m.text || !m.text.trim()) return false;
    return true;
  });
}

async function fetchHistoryPage(
  channelId: string,
  oldest: number,
  apiKey: string,
  lovableKey: string,
  botUserId: string,
): Promise<{ ok: boolean; messages: SlackMessage[]; error_code: string | null; error_message: string | null }> {
  try {
    const data = await slackCall(
      "conversations.history",
      {
        channel: channelId,
        oldest: String(oldest),
        limit: String(MAX_MESSAGES_PER_CHANNEL),
        inclusive: "false",
      },
      apiKey,
      lovableKey,
    );

    if (!data.ok) {
      return {
        ok: false,
        messages: [],
        error_code: String(data.error || "unknown"),
        error_message: `conversations.history error: ${String(data.error || "unknown")}`,
      };
    }

    return {
      ok: true,
      messages: filterHumanMessages((data.messages || []) as SlackMessage[], botUserId),
      error_code: null,
      error_message: null,
    };
  } catch (e: any) {
    const error_code = parseSlackApiError(e);
    return {
      ok: false,
      messages: [],
      error_code,
      error_message: String(e),
    };
  }
}

async function joinPublicChannel(
  channelId: string,
  apiKey: string,
  lovableKey: string,
): Promise<{ ok: boolean; http_status: number | null; error_code: string | null; error_message: string | null }> {
  try {
    console.info("[ceo-slack-pulse] conversations.join attempt", { channel_id: channelId });
    const { status, data } = await slackCallDetailed("conversations.join", { channel: channelId }, apiKey, lovableKey);
    if (!data.ok) {
      const errorCode = String(data.error || "unknown");
      console.warn("[ceo-slack-pulse] conversations.join failed", {
        channel_id: channelId,
        http_status: status,
        error_code: errorCode,
      });
      return {
        ok: false,
        http_status: status,
        error_code: errorCode,
        error_message: `conversations.join error: ${errorCode}`,
      };
    }

    console.info("[ceo-slack-pulse] conversations.join succeeded", {
      channel_id: channelId,
      http_status: status,
    });

    return { ok: true, http_status: status, error_code: null, error_message: null };
  } catch (e: any) {
    const errorCode = parseSlackApiError(e);
    const message = String(e);
    const httpStatus = Number(message.match(/HTTP\s+(\d{3})/i)?.[1] || "") || null;
    console.warn("[ceo-slack-pulse] conversations.join failed", {
      channel_id: channelId,
      http_status: httpStatus,
      error_code: errorCode,
    });
    return {
      ok: false,
      http_status: httpStatus,
      error_code: errorCode,
      error_message: message,
    };
  }
}

async function fetchChannelHistory(
  channel: SlackChannel,
  oldest: number,
  apiKey: string,
  lovableKey: string,
  botUserId: string,
  autoJoinDisabledReason: string | null,
): Promise<HistoryFetchResult> {
  const initial = await fetchHistoryPage(channel.id, oldest, apiKey, lovableKey, botUserId);
  if (initial.ok) {
    return {
      messages: initial.messages,
      history_ok: true,
      join_attempted: false,
      joined_channel: false,
      unresolved_membership: false,
      error_code: null,
      error_message: null,
      status: "ok",
    };
  }

  const joinableError = initial.error_code === "bot_not_invited" || initial.error_code === "not_in_channel";
  if (!joinableError || channel.is_private) {
    console.warn(`history failed for ${channel.id}:`, initial.error_message || initial.error_code);
    return {
      messages: [],
      history_ok: false,
      join_attempted: false,
      joined_channel: false,
      unresolved_membership: false,
      error_code: initial.error_code,
      error_message: initial.error_message,
      status: "history_failed",
    };
  }

  if (autoJoinDisabledReason) {
    console.warn("[ceo-slack-pulse] auto-join skipped", {
      channel_id: channel.id,
      reason: autoJoinDisabledReason,
      history_error: initial.error_code,
    });
    return {
      messages: [],
      history_ok: false,
      join_attempted: false,
      joined_channel: false,
      unresolved_membership: true,
      error_code: autoJoinDisabledReason,
      error_message: `auto-join skipped: ${autoJoinDisabledReason}`,
      status: "join_failed",
    };
  }

  const joinResult = await joinPublicChannel(channel.id, apiKey, lovableKey);
  if (!joinResult.ok) {
    return {
      messages: [],
      history_ok: false,
      join_attempted: true,
      joined_channel: false,
      unresolved_membership: true,
      error_code: joinResult.error_code,
      error_message: joinResult.error_message,
      status: "join_failed",
    };
  }

  const retry = await fetchHistoryPage(channel.id, oldest, apiKey, lovableKey, botUserId);
  if (!retry.ok) {
    const unresolvedMembership = retry.error_code === "bot_not_invited" || retry.error_code === "not_in_channel";
    console.warn(`history retry failed for ${channel.id}:`, retry.error_message || retry.error_code);
    return {
      messages: [],
      history_ok: false,
      join_attempted: true,
      joined_channel: true,
      unresolved_membership: unresolvedMembership,
      error_code: retry.error_code,
      error_message: retry.error_message,
      status: "history_failed_after_join",
    };
  }

  return {
    messages: retry.messages,
    history_ok: true,
    join_attempted: true,
    joined_channel: true,
    unresolved_membership: false,
    error_code: null,
    error_message: null,
    status: "joined_then_scanned",
  };
}

async function getBotUserId(apiKey: string, lovableKey: string): Promise<string> {
  try {
    const data = await slackCall("auth.test", {}, apiKey, lovableKey);
    return data?.user_id || "";
  } catch {
    return "";
  }
}

async function resolveUsernames(
  userIds: string[],
  apiKey: string,
  lovableKey: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  // Batch via users.info one-at-a-time (no bulk endpoint), capped to avoid runaway.
  const capped = unique.slice(0, 100);
  await Promise.all(
    capped.map(async (uid) => {
      try {
        const data = await slackCall("users.info", { user: uid }, apiKey, lovableKey);
        if (data?.ok && data.user) {
          const name =
            data.user.profile?.display_name ||
            data.user.real_name ||
            data.user.name ||
            uid;
          map.set(uid, name);
        }
      } catch {
        // ignore individual lookup failures
      }
    }),
  );
  return map;
}

function parseLLMJson(raw: string): any {
  let s = String(raw ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const objMatch = s.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    throw new Error("No JSON object found in LLM response");
  }
}

function replaceUserMentions(text: string, nameMap: Map<string, string>): string {
  return text.replace(/<@(U[A-Z0-9]+)>/g, (_, uid) => `@${nameMap.get(uid) || uid}`);
}

async function extractChannelSignals(
  channelName: string,
  messages: Array<{ author: string; text: string; ts: string; thread_ts?: string }>,
): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey || messages.length === 0) {
    return {
      commitments: [],
      escalations: [],
      confusion: [],
      customer_issues: [],
      risks: [],
    };
  }

  const compact = messages.slice(0, MAX_MESSAGES_PER_CHANNEL).map((m) => ({
    author: m.author,
    text: m.text.slice(0, 500),
    thread: m.thread_ts || null,
  }));

  const systemPrompt = `You are an executive intelligence extractor analysing a 24h slice of one Slack channel (#${channelName}) for the CEO of Kabuni. Surface ONLY high-signal items. Ignore casual chatter, gifs, social, and routine acknowledgements.

OUTPUT FORMAT: Return ONLY a single raw JSON object. No markdown, no code fences, no prose. Start with { and end with }.`;

  const userPrompt = `Channel: #${channelName}
Messages (last 24h, oldest first):
${JSON.stringify(compact).slice(0, 60000)}

Return JSON with this exact shape:
{
  "commitments":   [{ "owner": string, "what": string, "due": string|null }],
  "escalations":   [{ "topic": string, "people": string[], "urgency": "low"|"medium"|"high", "reason": string }],
  "confusion":     [{ "topic": string, "people": string[], "what_is_unclear": string }],
  "customer_issues":[{ "company": string, "issue": string, "severity": "low"|"medium"|"high" }],
  "risks":         [{ "severity": "low"|"medium"|"high"|"critical", "summary": string, "who_flagged": string }]
}

RULES:
- Empty arrays are fine — do NOT invent items.
- Commitments: a person promising a specific action by a date or soon. Owner must be a real person mentioned (use the @name as written).
- Escalations: a thread where ≥3 messages from ≥2 people show repeated follow-ups WITHOUT resolution.
- Confusion: messages showing ownership ambiguity ("who owns this?", "is X or Y doing this?", "wait, I thought…").
- Customer issues: a named customer/company has a problem.
- Risks: material risks for 2026 priorities (India launch, KPL, trials, Duncan automation) or finance/legal/customers.
- Keep summaries under 20 words each.`;

  try {
    const data = await callLLMWithFallback({
      workflow: "generic",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });
    const raw = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = parseLLMJson(raw);
    return {
      commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
      escalations: Array.isArray(parsed.escalations) ? parsed.escalations : [],
      confusion: Array.isArray(parsed.confusion) ? parsed.confusion : [],
      customer_issues: Array.isArray(parsed.customer_issues) ? parsed.customer_issues : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    };
  } catch (e: any) {
    console.error(`extractChannelSignals error for #${channelName}:`, e);
    return {
      commitments: [],
      escalations: [],
      confusion: [],
      customer_issues: [],
      risks: [],
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!SLACK_API_KEY || !LOVABLE_API_KEY) {
      return json({
        ok: true,
        error: "Slack connector not configured",
        degraded: true,
        visibility_scope: "not_configured",
        degraded_codes: ["connector_not_configured"],
        channels_total: 0,
        channels_eligible: 0,
        channels_scanned: 0,
        not_member_channels_count: 0,
        inaccessible_private_channels_count: 0,
        history_failures_count: 0,
        channels_with_errors: [],
        per_channel: [],
        signals: emptySignals(),
      });
    }

    const oldest = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
    const authStatus = await getSlackAuthStatus(SLACK_API_KEY, LOVABLE_API_KEY);
    const missingJoinScopeReason = authStatus.missingJoinScope ? "missing_scope: channels:join" : null;
    const botUserId = authStatus.user_id || await getBotUserId(SLACK_API_KEY, LOVABLE_API_KEY);

    // 1. Discover channels
    let allChannels: SlackChannel[] = [];
    let degraded = false;
    let degraded_reason: string | null = null;
    let degraded_codes: string[] = [];
    let visibility_scope: "full_public" | "public_only" | "partial" | "not_configured" = "full_public";
    try {
      const listed = await listAllChannels(SLACK_API_KEY, LOVABLE_API_KEY);
      allChannels = listed.channels;
      degraded = listed.degraded;
      degraded_reason = listed.degraded_reason;
      degraded_codes = listed.degraded_codes;
      visibility_scope = listed.visibility_scope;
    } catch (e: any) {
      console.error("listAllChannels failed:", e);
      return json({
        ok: true,
        degraded: true,
        visibility_scope: "partial",
        degraded_codes: ["history_partial_failure"],
        degraded_reason: `channel listing failed: ${e?.message || String(e)}`,
        window_hours: 24,
        channels_total: 0,
        channels_member: 0,
        channels_eligible: 0,
        channels_scanned: 0,
        messages_analysed: 0,
        not_member_channels_count: 0,
        inaccessible_private_channels_count: 0,
        history_failures_count: 0,
        channels_with_errors: [],
        not_member_channels: [],
        per_channel: [],
        silent_channels: [],
        signals: emptySignals(),
        generated_at: new Date().toISOString(),
      });
    }
    const publicChannels = allChannels.filter((c) => !c.is_archived);
    const memberChannels = publicChannels.filter((c) => c.is_member);

    // Cap to top N by member count as a proxy for activity
    const eligible = [...publicChannels]
      .sort((a, b) => (b.num_members || 0) - (a.num_members || 0))
      .slice(0, MAX_CHANNELS);

    // 2. Pull history per channel (in parallel, capped concurrency)
    const channelResults = await Promise.all(
      eligible.map(async (ch) => {
        try {
          const history = await fetchChannelHistory(
            ch,
            oldest,
            SLACK_API_KEY,
            LOVABLE_API_KEY,
            botUserId,
            missingJoinScopeReason,
          );
          return { channel: ch, ...history };
        } catch (e: any) {
          return {
            channel: ch,
            messages: [] as SlackMessage[],
            history_ok: false,
            join_attempted: false,
            joined_channel: false,
            unresolved_membership: false,
            error_code: "unknown",
            error_message: e?.message || String(e),
            status: "history_failed" as const,
          };
        }
      }),
    );

    // 3. Resolve user IDs across all messages
    const allUserIds = new Set<string>();
    for (const r of channelResults) {
      for (const m of r.messages) if (m.user) allUserIds.add(m.user);
      // also collect mentioned users in text
      for (const m of r.messages) {
        const matches = (m.text || "").matchAll(/<@(U[A-Z0-9]+)>/g);
        for (const mm of matches) allUserIds.add(mm[1]);
      }
    }
    const nameMap = await resolveUsernames(Array.from(allUserIds), SLACK_API_KEY, LOVABLE_API_KEY);

    // 4. Extract signals per channel
    const perChannelOutput = await Promise.all(
      channelResults.map(async (r) => {
        const enriched = r.messages.map((m) => ({
          author: nameMap.get(m.user || "") || m.user || "unknown",
          text: replaceUserMentions(m.text || "", nameMap),
          ts: m.ts,
          thread_ts: m.thread_ts,
        }));

        if (!r.history_ok) {
          return {
            channel_id: r.channel.id,
            channel_name: r.channel.name,
            is_member: !!r.channel.is_member,
            joined_channel: r.joined_channel,
            join_attempted: r.join_attempted,
            messages_scanned: 0,
            signals: emptySignals(),
            status: r.status,
            status_reason: r.status === "join_failed"
              ? `join_failed: ${r.error_code || "unknown"}`
              : r.status === "history_failed_after_join"
                ? `history_failed_after_join: ${r.error_code || "unknown"}`
                : r.status,
            error_code: r.error_code,
            error_message: r.error_message,
          };
        }

        if (enriched.length === 0) {
          return {
            channel_id: r.channel.id,
            channel_name: r.channel.name,
            is_member: !!r.channel.is_member,
            joined_channel: r.joined_channel,
            join_attempted: r.join_attempted,
            messages_scanned: 0,
            signals: emptySignals(),
            status: r.status === "joined_then_scanned" ? "joined_then_scanned" : "ok",
            status_reason: r.status === "joined_then_scanned" ? "joined_then_scanned" : "no_recent_messages",
            error_code: null,
            error_message: null,
          };
        }
        const signals = await extractChannelSignals(r.channel.name, enriched);
        return {
          channel_id: r.channel.id,
          channel_name: r.channel.name,
          is_member: !!r.channel.is_member,
          joined_channel: r.joined_channel,
          join_attempted: r.join_attempted,
          messages_scanned: enriched.length,
          signals,
          status: r.status === "joined_then_scanned" ? "joined_then_scanned" : "ok",
          status_reason: r.status === "joined_then_scanned" ? "joined_then_scanned" : null,
          error_code: null,
          error_message: null,
        };
      }),
    );

    // 5. Aggregate
    const allCommitments: any[] = [];
    const allEscalations: any[] = [];
    const allConfusion: any[] = [];
    const allCustomerIssues: any[] = [];
    const allRisks: any[] = [];
    const silentChannels: Array<{ channel: string; reason: string }> = [];
    const channelsWithErrors: Array<{ channel: string; reason: string }> = [];
    const joinFailureCodes: string[] = [];
    let totalMessages = 0;
    let historyFailures = 0;
    let joinedChannels = 0;
    let effectiveAccessibleChannels = 0;
    let inaccessibleAfterJoin = 0;

    for (const r of perChannelOutput) {
      totalMessages += r.messages_scanned;
      if (["ok", "joined_then_scanned"].includes(r.status)) {
        effectiveAccessibleChannels += 1;
      }
      if (r.status === "joined_then_scanned") joinedChannels += 1;

      if (["join_failed", "history_failed_after_join", "history_failed"].includes(r.status)) {
        historyFailures += 1;
        const unresolvedMembership = r.status === "join_failed" || (r.status === "history_failed_after_join" && r.error_code && ["bot_not_invited", "not_in_channel"].includes(r.error_code));
        if (unresolvedMembership) inaccessibleAfterJoin += 1;
        if (r.status === "join_failed" && r.error_code) joinFailureCodes.push(r.error_code);
        channelsWithErrors.push({
          channel: r.channel_name,
          reason: r.status === "join_failed"
            ? `join_failed: ${r.error_code || "unknown"}`
            : r.status === "history_failed_after_join"
              ? `history_failed_after_join: ${r.error_code || "unknown"}`
              : "History fetch failed",
        });
        continue;
      }

      if (r.messages_scanned === 0) {
        silentChannels.push({ channel: r.channel_name, reason: "0 human messages in last 24h" });
        continue;
      }
      const tag = (arr: any[]) => arr.map((x) => ({ ...x, _channel: r.channel_name }));
      allCommitments.push(...tag(r.signals.commitments));
      allEscalations.push(...tag(r.signals.escalations));
      allConfusion.push(...tag(r.signals.confusion));
      allCustomerIssues.push(...tag(r.signals.customer_issues));
      allRisks.push(...tag(r.signals.risks));
    }

    // Channels the bot is NOT a member of (so the team can invite Duncan)
    const notMember = perChannelOutput
      .filter((r) => r.status === "join_failed" || (r.status === "history_failed_after_join" && r.error_code && ["bot_not_invited", "not_in_channel"].includes(r.error_code)))
      .map((r) => ({ id: r.channel_id, name: r.channel_name, is_private: false }));
    const inaccessiblePrivateChannelsCount = allChannels.filter((c) => !!c.is_private && !c.is_member && !c.is_archived).length;
    if (notMember.length > 0) degraded_codes.push("bot_not_invited");
    if (inaccessiblePrivateChannelsCount > 0) degraded_codes.push("private_channels_inaccessible");
    if (historyFailures > 0) degraded_codes.push("history_partial_failure");
    if (missingJoinScopeReason) degraded_codes.push("missing_scope");
    const uniqueCodes = Array.from(new Set(degraded_codes));
    const isDegraded = degraded || uniqueCodes.length > 0;
    if (isDegraded && visibility_scope === "full_public") visibility_scope = "partial";

    const uniqueJoinFailureCodes = Array.from(new Set(joinFailureCodes));
    const degradedSummaryParts: string[] = [];
    if (joinedChannels > 0) degradedSummaryParts.push(`${joinedChannels} public channels auto-joined`);
    degradedSummaryParts.push(`${effectiveAccessibleChannels}/${eligible.length} public channels scanned`);
    if (inaccessibleAfterJoin > 0) degradedSummaryParts.push(`${inaccessibleAfterJoin} still inaccessible after join attempt`);
    if (inaccessiblePrivateChannelsCount > 0) degradedSummaryParts.push(`${inaccessiblePrivateChannelsCount} private channels remain gated`);
    const computedDegradedReason = missingJoinScopeReason
      ? missingJoinScopeReason
      : uniqueJoinFailureCodes.length === 1 && joinFailureCodes.length > 0
        ? `join_failed: ${uniqueJoinFailureCodes[0]}`
        : degradedSummaryParts.join("; ");

    return json({
      ok: true,
      degraded: isDegraded,
      visibility_scope,
      degraded_codes: uniqueCodes,
      degraded_reason: computedDegradedReason || degraded_reason,
      window_hours: 24,
      channels_total: allChannels.length,
      channels_member: effectiveAccessibleChannels,
      channels_eligible: eligible.length,
      channels_scanned: effectiveAccessibleChannels,
      messages_analysed: totalMessages,
      not_member_channels_count: notMember.length,
      inaccessible_private_channels_count: inaccessiblePrivateChannelsCount,
      history_failures_count: historyFailures,
      channels_joined: joinedChannels,
      channels_with_errors: channelsWithErrors,
      not_member_channels: notMember.slice(0, 50),
      per_channel: perChannelOutput.map((r) => ({
        channel: r.channel_name,
        status: r.status,
        status_reason: r.status_reason,
        join_attempted: r.join_attempted,
        joined_channel: r.joined_channel,
        messages_scanned: r.messages_scanned,
        commitments: r.signals.commitments.length,
        escalations: r.signals.escalations.length,
        confusion: r.signals.confusion.length,
        customer_issues: r.signals.customer_issues.length,
        risks: r.signals.risks.length,
      })),
      silent_channels: silentChannels,
      signals: {
        commitments: allCommitments,
        escalations: allEscalations,
        confusion: allConfusion,
        customer_issues: allCustomerIssues,
        risks: allRisks,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("ceo-slack-pulse error:", e);
    return json({ ok: false, error: e?.message || "ceo-slack-pulse failed" }, 500);
  }
});

function emptySignals() {
  return {
    commitments: [],
    escalations: [],
    confusion: [],
    customer_issues: [],
    risks: [],
  };
}
