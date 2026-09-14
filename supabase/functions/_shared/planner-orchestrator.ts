// ─────────────────────────────────────────────────────────────────────────────
// Duncan — Destination Decision & Orchestration Layer
//
// ONE place decides whether a user's intent belongs in Duncan Planner, Google
// Calendar, or BOTH. Every surface (main Duncan chat, Planner UI, future
// integrations) MUST route writes through `executePlannerAction` so the rules,
// linking, duplicate detection and conflict detection are identical everywhere.
//
// The AI interprets intent (what the user means). It NEVER decides which system
// to write to — that is `decideDestination` below.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type Destination = "PLANNER" | "GOOGLE_CALENDAR";
export type PlannerIntent =
  | "CREATE_EVENT"
  | "UPDATE_EVENT"
  | "CANCEL_EVENT"
  | "CHECK_AVAILABILITY";

export type EventType =
  | "MEETING"
  | "AVAILABILITY"
  | "OUT_OF_OFFICE"
  | "ANNUAL_LEAVE"
  | "SICK_LEAVE"
  | "COMPANY_EVENT"
  | "PROJECT_MILESTONE"
  | "TRAVEL"
  | "OTHER";

export interface Decision {
  intent: PlannerIntent;
  event_type: EventType;
  destination: Destination[];
  source_of_truth: Destination;
  requires_approval: boolean;
  reason: string;
}

interface TypeRule {
  destination: Destination[];
  source_of_truth: Destination;
  requires_approval: boolean;
  planner_category?: string;
  reason: string;
}

// Source-of-truth matrix. Adding a new event type = one entry here, nothing else.
export const EVENT_TYPE_RULES: Record<EventType, TypeRule> = {
  MEETING: {
    destination: ["GOOGLE_CALENDAR"],
    source_of_truth: "GOOGLE_CALENDAR",
    requires_approval: false,
    reason: "Meetings carry attendees, availability and Meet links — Google Calendar owns them.",
  },
  AVAILABILITY: {
    destination: ["GOOGLE_CALENDAR"],
    source_of_truth: "GOOGLE_CALENDAR",
    requires_approval: false,
    reason: "Availability is read from Google Calendar.",
  },
  OUT_OF_OFFICE: {
    destination: ["GOOGLE_CALENDAR"],
    source_of_truth: "GOOGLE_CALENDAR",
    requires_approval: false,
    planner_category: "Holiday",
    reason: "Out-of-office blocks live on the Google Calendar.",
  },
  ANNUAL_LEAVE: {
    destination: ["PLANNER", "GOOGLE_CALENDAR"],
    source_of_truth: "PLANNER",
    requires_approval: true,
    planner_category: "Holiday",
    reason: "Leave is a Planner record of record and also blocks the Google Calendar.",
  },
  SICK_LEAVE: {
    destination: ["PLANNER", "GOOGLE_CALENDAR"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Holiday",
    reason: "Sick leave is recorded in Planner and blocks the Google Calendar.",
  },
  COMPANY_EVENT: {
    destination: ["PLANNER"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Event",
    reason: "Company events are Planner records.",
  },
  PROJECT_MILESTONE: {
    destination: ["PLANNER"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Product",
    reason: "Milestones and deadlines are Planner records.",
  },
  TRAVEL: {
    destination: ["PLANNER", "GOOGLE_CALENDAR"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Travel",
    reason: "Travel is tracked in Planner and blocks the Google Calendar.",
  },
  OTHER: {
    destination: ["PLANNER"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Event",
    reason: "Unclassified entries default to the Planner.",
  },
};

// Company configuration can widen destinations (e.g. push company events to
// Google Calendar too). Read from app_settings so it is not hardcoded in the UI.
export async function loadDestinationConfig(supabaseAdmin: any): Promise<Record<string, Destination[]>> {
  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "planner_destination_overrides")
      .maybeSingle();
    const v = (data as any)?.value;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const TYPE_PATTERNS: [EventType, RegExp][] = [
  ["ANNUAL_LEAVE", /\b(annual leave|holiday|vacation|taking .* off|day off|days off|time off|pto|book(ing)? leave|i'?m off)\b/i],
  ["SICK_LEAVE", /\b(sick|unwell|ill|doctor'?s? appointment|medical leave)\b/i],
  ["OUT_OF_OFFICE", /\b(out of office|ooo|away from desk|unavailable all day)\b/i],
  ["TRAVEL", /\b(flight|flying|travel(ling)?|trip to|train to|offsite travel)\b/i],
  ["PROJECT_MILESTONE", /\b(deadline|milestone|due (by|on)|go[- ]live|launch date|ship(ping)? date|cut ?off)\b/i],
  ["COMPANY_EVENT", /\b(all hands|company (event|party|away ?day)|christmas party|town hall|social|team social|conference|summit)\b/i],
  ["AVAILABILITY", /\b(am i free|what am i free for|availability|free slots?|when (am|are) .* free|find (me )?time)\b/i],
  ["MEETING", /\b(meeting|call|sync|catch ?up|1:1|one[- ]to[- ]one|interview|invite|standup|review with|book .* with)\b/i],
];

/** Heuristic fallback when the caller did not supply an explicit event_type. */
export function classifyEventType(text: string): EventType {
  const t = text || "";
  for (const [type, re] of TYPE_PATTERNS) if (re.test(t)) return type;
  return "OTHER";
}

/** THE decision engine. Pure — same inputs always give the same routing. */
export function decideDestination(
  intent: PlannerIntent,
  eventType: EventType,
  opts: { overrides?: Record<string, Destination[]> } = {},
): Decision {
  const rule = EVENT_TYPE_RULES[eventType] ?? EVENT_TYPE_RULES.OTHER;
  const override = opts.overrides?.[eventType];
  const destination = (override && override.length > 0 ? override : rule.destination).slice();
  // The source of truth must always be one of the destinations.
  const source_of_truth = destination.includes(rule.source_of_truth)
    ? rule.source_of_truth
    : destination[0];
  return {
    intent,
    event_type: eventType,
    destination: intent === "CHECK_AVAILABILITY" ? ["GOOGLE_CALENDAR"] : destination,
    source_of_truth,
    requires_approval: intent === "CREATE_EVENT" ? rule.requires_approval : false,
    reason: rule.reason,
  };
}

export function plannerCategoryFor(eventType: EventType): string {
  return EVENT_TYPE_RULES[eventType]?.planner_category ?? "Event";
}

// ── Execution context ────────────────────────────────────────────────────────

export interface OrchestratorContext {
  supabaseAdmin: any;
  userId: string;
  userEmail?: string | null;
  timezone?: string;
  /** Returns a Google Calendar OAuth access token for this user, or null. */
  getGoogleToken: () => Promise<string | null>;
}

export interface ActionRequest {
  intent: PlannerIntent;
  event_type?: EventType;
  utterance?: string;
  title?: string;
  description?: string;
  location?: string;
  start?: string; // ISO
  end?: string; // ISO
  all_day?: boolean;
  attendees?: string[];
  owner?: string;
  link_group?: string;
  planner_event_id?: string;
  google_event_id?: string;
  /** Skip duplicate/conflict guards after the user has been told about them. */
  force?: boolean;
  /** Set by sync jobs so we never bounce a change back to its origin. */
  origin?: Destination;
}

export interface ActionResult {
  ok: boolean;
  verified: boolean;
  source: "planner_orchestrator";
  decision: Decision;
  link_group?: string;
  planner_event_id?: string;
  google_event_id?: string;
  duplicate?: any;
  conflicts?: any[];
  suggestions?: { start: string; end: string }[];
  availability?: any;
  message: string;
  error?: string;
}

const hash = async (s: string) => {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const newLinkGroup = () => `EVT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function normTitle(s: string) {
  return (s || "").toLowerCase().replace(/^\[[^\]]+\]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ── Duplicate detection ──────────────────────────────────────────────────────

async function findPlannerDuplicate(ctx: OrchestratorContext, req: ActionRequest) {
  if (!req.start) return null;
  const start = new Date(req.start);
  const from = new Date(start.getTime() - 36 * 3600_000).toISOString();
  const to = new Date(start.getTime() + 36 * 3600_000).toISOString();
  const { data } = await ctx.supabaseAdmin
    .from("key_events")
    .select("id, title, event_name, start_at, end_at, link_group, event_type")
    .eq("deleted_in_google", false)
    .gte("start_at", from)
    .lte("start_at", to)
    .limit(50);
  const target = normTitle(req.title || "");
  return (data || []).find((r: any) => {
    const t = normTitle(r.event_name || r.title || "");
    return t && target && (t === target || t.includes(target) || target.includes(t));
  }) ?? null;
}

async function findGoogleDuplicate(token: string, req: ActionRequest) {
  if (!req.start) return null;
  const start = new Date(req.start);
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("timeMin", new Date(start.getTime() - 36 * 3600_000).toISOString());
  url.searchParams.set("timeMax", new Date(start.getTime() + 36 * 3600_000).toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", "50");
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const items = (await resp.json()).items || [];
  const target = normTitle(req.title || "");
  return items.find((e: any) => {
    const t = normTitle(e.summary || "");
    return t && target && (t === target || t.includes(target) || target.includes(t));
  }) ?? null;
}

// ── Conflict detection ───────────────────────────────────────────────────────

async function findConflicts(token: string, startISO: string, endISO: string) {
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("timeMin", startISO);
  url.searchParams.set("timeMax", endISO);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  const items = (await resp.json()).items || [];
  return items
    .filter((e: any) => e.start?.dateTime && e.status !== "cancelled" && e.transparency !== "transparent")
    .map((e: any) => ({ id: e.id, summary: e.summary, start: e.start.dateTime, end: e.end?.dateTime }));
}

async function suggestSlots(token: string, startISO: string, endISO: string) {
  const durationMs = new Date(endISO).getTime() - new Date(startISO).getTime();
  const dayStart = new Date(startISO);
  const scanEnd = new Date(dayStart.getTime() + 3 * 24 * 3600_000);
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("timeMin", dayStart.toISOString());
  url.searchParams.set("timeMax", scanEnd.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const busy: { s: number; e: number }[] = resp.ok
    ? ((await resp.json()).items || [])
        .filter((e: any) => e.start?.dateTime)
        .map((e: any) => ({ s: new Date(e.start.dateTime).getTime(), e: new Date(e.end.dateTime).getTime() }))
    : [];
  const out: { start: string; end: string }[] = [];
  let cursor = new Date(startISO).getTime();
  const limit = scanEnd.getTime();
  while (cursor + durationMs <= limit && out.length < 3) {
    const slotEnd = cursor + durationMs;
    const clash = busy.find((b) => cursor < b.e && slotEnd > b.s);
    const hour = new Date(cursor).getUTCHours();
    if (!clash && hour >= 8 && hour <= 17) {
      out.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString() });
      cursor = slotEnd;
    } else {
      cursor = clash ? clash.e : cursor + 30 * 60_000;
    }
  }
  return out;
}

// ── Writers ──────────────────────────────────────────────────────────────────

async function createPlannerEvent(ctx: OrchestratorContext, req: ActionRequest, decision: Decision) {
  const category = plannerCategoryFor(decision.event_type);
  const name = (req.title || "Untitled").trim();
  const { data, error } = await ctx.supabaseAdmin
    .from("key_events")
    .insert({
      google_event_id: `local:${crypto.randomUUID()}`,
      calendar_id: "local",
      title: `[${category}] ${name}`,
      event_name: name,
      category,
      event_type: decision.event_type,
      start_at: req.start,
      end_at: req.end || req.start,
      all_day: req.all_day ?? true,
      start_tz: ctx.timezone || "Europe/London",
      location: req.location || null,
      raw_description: req.description || null,
      owner: req.owner || ctx.userEmail || null,
      missing_fields: [],
      is_complete: true,
      risk_level: "green",
      linked_goal_ids: [],
      linked_docs: [],
      attendees: [],
      deleted_in_google: false,
      created_by: ctx.userId,
      approval_state: decision.requires_approval ? "pending" : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Planner write failed: ${error.message}`);
  return data.id as string;
}

async function createGoogleEvent(token: string, req: ActionRequest, ctx: OrchestratorContext, decision: Decision) {
  const allDay = req.all_day ?? false;
  const body: any = {
    summary: req.title,
    description: req.description,
    location: req.location,
    start: allDay
      ? { date: (req.start || "").slice(0, 10) }
      : { dateTime: req.start, timeZone: ctx.timezone || "UTC" },
    end: allDay
      ? { date: (req.end || req.start || "").slice(0, 10) }
      : { dateTime: req.end, timeZone: ctx.timezone || "UTC" },
  };
  if (decision.event_type === "ANNUAL_LEAVE" || decision.event_type === "SICK_LEAVE" || decision.event_type === "OUT_OF_OFFICE") {
    body.transparency = "opaque";
    body.eventType = "outOfOffice";
  }
  if (req.attendees?.length) body.attendees = req.attendees.map((email) => ({ email }));
  const resp = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?sendUpdates=all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    // outOfOffice events reject some fields on non-Workspace accounts — retry plain.
    if (body.eventType) {
      delete body.eventType;
      const retry = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?sendUpdates=all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (retry.ok) return await retry.json();
    }
    throw new Error(`Google Calendar write failed [${resp.status}]: ${await resp.text()}`);
  }
  return await resp.json();
}

async function patchGoogleEvent(token: string, eventId: string, req: ActionRequest, ctx: OrchestratorContext) {
  const body: any = {};
  if (req.title) body.summary = req.title;
  if (req.description) body.description = req.description;
  if (req.location) body.location = req.location;
  if (req.start) body.start = req.all_day ? { date: req.start.slice(0, 10) } : { dateTime: req.start, timeZone: ctx.timezone || "UTC" };
  if (req.end) body.end = req.all_day ? { date: req.end.slice(0, 10) } : { dateTime: req.end, timeZone: ctx.timezone || "UTC" };
  const resp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!resp.ok) throw new Error(`Google Calendar update failed [${resp.status}]: ${await resp.text()}`);
  return await resp.json();
}

async function deleteGoogleEvent(token: string, eventId: string) {
  const resp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  return resp.ok || resp.status === 410 || resp.status === 404;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function executePlannerAction(
  ctx: OrchestratorContext,
  req: ActionRequest,
): Promise<ActionResult> {
  const overrides = await loadDestinationConfig(ctx.supabaseAdmin);
  const eventType =
    req.event_type ?? classifyEventType(`${req.utterance || ""} ${req.title || ""} ${req.description || ""}`);
  const decision = decideDestination(req.intent, eventType, { overrides });
  const base = { ok: false, verified: false, source: "planner_orchestrator" as const, decision };

  const token = decision.destination.includes("GOOGLE_CALENDAR") || req.intent !== "CREATE_EVENT"
    ? await ctx.getGoogleToken()
    : null;

  // ── Availability ──────────────────────────────────────────────────────────
  if (req.intent === "CHECK_AVAILABILITY") {
    if (!token) return { ...base, message: "Google Calendar isn't connected for this user.", error: "no_google_token" };
    const startISO = req.start || new Date().toISOString();
    const endISO = req.end || new Date(new Date(startISO).getTime() + 24 * 3600_000).toISOString();
    const busy = await findConflicts(token, startISO, endISO);
    const free = await suggestSlots(token, startISO, endISO);
    return { ...base, ok: true, verified: true, availability: { busy, free }, message: `${busy.length} busy block(s) found.` };
  }

  // ── Existing link lookup ──────────────────────────────────────────────────
  let link: any = null;
  if (req.link_group || req.planner_event_id || req.google_event_id) {
    const q = ctx.supabaseAdmin.from("event_links").select("*");
    if (req.link_group) q.eq("link_group", req.link_group);
    else if (req.planner_event_id) q.eq("planner_event_id", req.planner_event_id);
    else q.eq("google_event_id", req.google_event_id);
    const { data } = await q.maybeSingle();
    link = data;
  }

  const payloadHash = await hash(
    JSON.stringify([req.title, req.start, req.end, req.all_day, req.location, req.intent]),
  );

  // Loop guard: a sync echo carrying the same payload we just wrote is ignored.
  if (link && link.last_sync_hash === payloadHash && req.origin && req.origin !== link.last_sync_origin) {
    return { ...base, ok: true, verified: true, link_group: link.link_group, message: "Already in sync — no action taken." };
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  if (req.intent === "CANCEL_EVENT") {
    let plannerDone = false;
    let googleDone = false;
    const plannerId = req.planner_event_id || link?.planner_event_id;
    const googleId = req.google_event_id || link?.google_event_id;
    if (plannerId) {
      const { error } = await ctx.supabaseAdmin
        .from("key_events")
        .update({ deleted_in_google: true, updated_at: new Date().toISOString() })
        .eq("id", plannerId);
      plannerDone = !error;
    }
    if (googleId && token) googleDone = await deleteGoogleEvent(token, googleId);
    if (link) {
      await ctx.supabaseAdmin
        .from("event_links")
        .update({ last_sync_origin: req.origin ?? decision.source_of_truth, last_sync_hash: payloadHash, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", link.id);
    }
    const ok = plannerDone || googleDone;
    return {
      ...base,
      ok,
      verified: ok,
      link_group: link?.link_group,
      message: ok
        ? `Cancelled${plannerDone ? " in Planner" : ""}${plannerDone && googleDone ? " and" : ""}${googleDone ? " in Google Calendar" : ""}.`
        : "Nothing was cancelled — no matching event found.",
      error: ok ? undefined : "not_found",
    };
  }

  // ── Update ────────────────────────────────────────────────────────────────
  if (req.intent === "UPDATE_EVENT") {
    const plannerId = req.planner_event_id || link?.planner_event_id;
    const googleId = req.google_event_id || link?.google_event_id;
    let plannerDone = false;
    let googleDone = false;
    if (plannerId && req.origin !== "PLANNER") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (req.start) patch.start_at = req.start;
      if (req.end) patch.end_at = req.end;
      if (req.title) patch.event_name = req.title;
      if (req.location) patch.location = req.location;
      const { error } = await ctx.supabaseAdmin.from("key_events").update(patch).eq("id", plannerId);
      plannerDone = !error;
    }
    if (googleId && token && req.origin !== "GOOGLE_CALENDAR") {
      try {
        await patchGoogleEvent(token, googleId, req, ctx);
        googleDone = true;
      } catch (e) {
        return { ...base, message: "Could not update the Google Calendar event.", error: String((e as Error).message) };
      }
    }
    if (link) {
      await ctx.supabaseAdmin
        .from("event_links")
        .update({ last_sync_origin: req.origin ?? decision.source_of_truth, last_sync_hash: payloadHash, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", link.id);
    }
    const ok = plannerDone || googleDone;
    return {
      ...base,
      ok,
      verified: ok,
      link_group: link?.link_group,
      planner_event_id: plannerId ?? undefined,
      google_event_id: googleId ?? undefined,
      message: ok ? "Updated across the linked systems." : "No linked record could be updated.",
      error: ok ? undefined : "not_found",
    };
  }

  // ── Create ────────────────────────────────────────────────────────────────
  if (!req.start) return { ...base, message: "A start date/time is required.", error: "missing_start" };

  if (!req.force) {
    const dupe = await findPlannerDuplicate(ctx, req);
    if (dupe) {
      return {
        ...base,
        ok: false,
        duplicate: { system: "PLANNER", ...dupe },
        message: `A matching Planner entry already exists ("${dupe.event_name || dupe.title}"). Nothing was created.`,
        error: "duplicate",
      };
    }
    if (token && decision.destination.includes("GOOGLE_CALENDAR")) {
      const gdupe = await findGoogleDuplicate(token, req);
      if (gdupe) {
        return {
          ...base,
          ok: false,
          duplicate: { system: "GOOGLE_CALENDAR", id: gdupe.id, summary: gdupe.summary, start: gdupe.start },
          message: `A matching Google Calendar event already exists ("${gdupe.summary}"). Nothing was created.`,
          error: "duplicate",
        };
      }
    }
  }

  // Conflict check — only for real meetings with a time range.
  if (!req.force && decision.event_type === "MEETING" && token && req.end && !req.all_day) {
    const conflicts = await findConflicts(token, req.start, req.end);
    if (conflicts.length > 0) {
      const suggestions = await suggestSlots(token, req.start, req.end);
      return {
        ...base,
        ok: false,
        conflicts,
        suggestions,
        message: `That slot clashes with ${conflicts.length} existing event(s). Suggested alternatives returned — nothing was created.`,
        error: "conflict",
      };
    }
  }

  let plannerId: string | undefined;
  let googleId: string | undefined;
  let googleCalendarId: string | undefined;

  if (decision.destination.includes("PLANNER")) {
    plannerId = await createPlannerEvent(ctx, req, decision);
  }
  if (decision.destination.includes("GOOGLE_CALENDAR")) {
    if (!token) {
      if (!plannerId) return { ...base, message: "Google Calendar isn't connected — nothing was created.", error: "no_google_token" };
    } else {
      const created = await createGoogleEvent(token, req, ctx, decision);
      googleId = created.id;
      googleCalendarId = "primary";
    }
  }

  const linkGroup = newLinkGroup();
  await ctx.supabaseAdmin.from("event_links").insert({
    link_group: linkGroup,
    event_type: decision.event_type,
    source_of_truth: decision.source_of_truth,
    destinations: decision.destination,
    planner_event_id: plannerId ?? null,
    google_event_id: googleId ?? null,
    google_calendar_id: googleCalendarId ?? null,
    created_by: ctx.userId,
    last_sync_origin: decision.source_of_truth,
    last_sync_hash: payloadHash,
    last_synced_at: new Date().toISOString(),
  });
  if (plannerId) {
    await ctx.supabaseAdmin.from("key_events").update({ link_group: linkGroup }).eq("id", plannerId);
  }

  const where = [plannerId ? "Planner" : null, googleId ? "Google Calendar" : null].filter(Boolean).join(" and ");
  return {
    ...base,
    ok: !!(plannerId || googleId),
    verified: !!(plannerId || googleId),
    link_group: linkGroup,
    planner_event_id: plannerId,
    google_event_id: googleId,
    message: `Added to ${where}.${decision.requires_approval ? " Awaiting approval in Planner." : ""}`,
  };
}
