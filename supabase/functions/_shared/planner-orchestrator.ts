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
  /** Existing Planner category key stored on key_events.category. */
  planner_category: string;
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

// ── Planner categories ───────────────────────────────────────────────────────
// These are the EXISTING Planner categories (mirrors src/components/diary/
// categoryMeta.ts). No new category system — the engine only ever picks one of
// these keys, falling back to "Event".

export const PLANNER_CATEGORIES = [
  "Travel",
  "Holiday",
  "PublicHoliday",
  "GlobalAllHands",
  "TeamSocials",
  "Product",
  "Releases",
  "Event",
  "Super Coaches",
  "Investor",
  "Social",
  "PR",
  "Launch",
  "Marketing",
  "Operations",
  "Communication",
  "Creative",
  "BusinessDevelopment",
] as const;

export type PlannerCategory = (typeof PLANNER_CATEGORIES)[number];

// Ordered: the first pattern that matches wins. More specific before generic.
const CATEGORY_PATTERNS: [string, RegExp][] = [
  ["PublicHoliday", /\b(public holiday|bank holiday|national holiday)\b/i],
  ["Holiday", /\b(annual leave|holiday|vacation|taking .*\boff\b|day off|days off|time off|pto|sick|unwell|out of office|ooo)\b/i],
  ["Travel", /\b(travel(l?ing)?|flight|flying|trip to|train to|visiting|offsite|on[- ]site visit)\b/i],
  ["GlobalAllHands", /\b(all[- ]hands|town ?hall|company[- ]wide (meeting|call)|global (meeting|call|update))\b/i],
  ["TeamSocials", /\b(team social|socials?|dinner|drinks|night out|christmas party|team lunch|away ?day|celebration)\b/i],
  ["Releases", /\b(release|patch|deploy(ment)?|version \d|ship(ping)? (date|version)|go[- ]live)\b/i],
  ["Launch", /\b(launch(es|ing)?|unveil|public debut|market launch|product launch)\b/i],
  ["Investor", /\b(investor|board (meeting|update)|fundrais(e|ing)|due diligence|vc\b|term sheet)\b/i],
  ["PR", /\b(press|pr\b|media|journalist|interview with .*(magazine|paper)|announcement to press)\b/i],
  ["Social", /\b(social media|instagram|linkedin|tiktok|twitter|x post|content calendar|post going out)\b/i],
  ["Marketing", /\b(marketing|campaign|newsletter|webinar|promo(tion)?|advert)\b/i],
  ["Super Coaches", /\b(super coach(es)?|coaching (session|programme|program))\b/i],
  ["Creative", /\b(creative|design review|shoot|photo ?shoot|brand (work|review)|artwork)\b/i],
  ["BusinessDevelopment", /\b(business development|bd\b|partnership|client pitch|prospect|sales meeting|school signing)\b/i],
  ["Communication", /\b(comms|communication|announcement|internal update|briefing)\b/i],
  ["Operations", /\b(operations|ops\b|logistics|process review|supplier|procurement)\b/i],
  ["Product", /\b(product|roadmap|feature|sprint|milestone|deadline|due (by|on)|spec review)\b/i],
  ["Event", /\b(event|conference|summit|showcase|exhibition|workshop)\b/i],
];

export function isPlannerCategory(value?: string | null): boolean {
  return !!value && (PLANNER_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Picks the Planner category as part of the SAME orchestration decision as
 * intent, destination and approval. Priority:
 *   1. an explicitly supplied valid category (AI suggestion or manual correction)
 *   2. wording in the user's own request
 *   3. the event type's default category
 *   4. "Event" as the safe existing fallback — never a new category.
 */
export function resolvePlannerCategory(
  eventType: EventType,
  text?: string | null,
  suggested?: string | null,
): string {
  if (isPlannerCategory(suggested)) return suggested as string;
  const t = text || "";
  if (t.trim()) {
    for (const [category, re] of CATEGORY_PATTERNS) if (re.test(t)) return category;
  }
  return EVENT_TYPE_RULES[eventType]?.planner_category ?? "Event";
}

/** THE decision engine. Pure — same inputs always give the same routing. */
export function decideDestination(
  intent: PlannerIntent,
  eventType: EventType,
  opts: {
    overrides?: Record<string, Destination[]>;
    text?: string | null;
    suggested_category?: string | null;
  } = {},
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
    planner_category: resolvePlannerCategory(eventType, opts.text, opts.suggested_category),
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
  /** For UPDATE without ids — the date the event currently sits on. */
  current_start?: string;

  owner?: string;
  link_group?: string;
  planner_event_id?: string;
  google_event_id?: string;
  /** Skip duplicate/conflict guards after the user has been told about them. */
  force?: boolean;
  /** Set by sync jobs so we never bounce a change back to its origin. */
  origin?: Destination;
}

export interface DecisionTrace {
  intent: PlannerIntent;
  event_type: EventType;
  destination: Destination[];
  source_of_truth: Destination;
  requires_approval: boolean;
  reason: string;
  existing_event_found: boolean;
  duplicate_detected: boolean;
  conflict_detected: boolean;
  action_taken: "CREATE" | "UPDATE" | "DELETE" | "READ" | "NO_ACTION";
  linked: boolean;
  link_group: string | null;
  planner_event_id: string | null;
  google_event_id: string | null;
  /** Resolved dynamically from the requester's line manager — never hardcoded. */
  approver_profile_id: string | null;
  approver_name: string | null;
  approval_routed: boolean;
  approval_id: string | null;
}

export interface ApprovalRouting {
  approval_id: string | null;
  approver_profile_id: string | null;
  approver_name: string | null;
  routed: boolean;
  reason: string;
}

export interface ActionResult {
  ok: boolean;
  verified: boolean;
  source: "planner_orchestrator";
  decision: Decision;
  trace?: DecisionTrace;
  link_group?: string;
  planner_event_id?: string;
  google_event_id?: string;
  matched_event?: any;
  duplicate?: any;
  conflicts?: any[];
  suggestions?: { start: string; end: string }[];
  availability?: any;
  approval?: ApprovalRouting;
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

// ── Approval routing ─────────────────────────────────────────────────────────

/**
 * Routes an approval through the EXISTING Approval Manager (key_event_approvals
 * → approvals inbox). The approver is always resolved dynamically from the
 * requester's current line manager on their Duncan profile. No manager is ever
 * hardcoded. Once written, the row keeps its approver even if the reporting
 * line later changes.
 */
async function routeApprovalToLineManager(
  ctx: OrchestratorContext,
  plannerEventId: string,
  decision: Decision,
): Promise<ApprovalRouting> {
  const none = (reason: string): ApprovalRouting => ({
    approval_id: null,
    approver_profile_id: null,
    approver_name: null,
    routed: false,
    reason,
  });

  const { data: requester } = await ctx.supabaseAdmin
    .from("profiles")
    .select("id, display_name, line_manager_profile_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (!requester) return none("No Duncan profile found for the requester.");
  if (!requester.line_manager_profile_id) {
    return none("No line manager is set on the requester's Duncan profile.");
  }

  const { data: manager } = await ctx.supabaseAdmin
    .from("profiles")
    .select("id, user_id, display_name")
    .eq("id", requester.line_manager_profile_id)
    .maybeSingle();
  if (!manager) return none("The line manager on the profile no longer exists.");

  const label = decision.event_type
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

  // requested_by stores the requester's AUTH user id (same convention as the
  // Planner UI and the approvals inbox trigger).
  const { data: approval, error } = await ctx.supabaseAdmin
    .from("key_event_approvals")
    .insert({
      event_id: plannerEventId,
      approval_type: "line_manager",
      label: `${label} — line manager approval`,
      approver_profile_id: manager.id,
      requested_by: ctx.userId,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (error) return none(`Could not create the approval request: ${error.message}`);
  if (!approval?.id) return none("The approval request could not be created.");

  // Notify the approver in their Duncan notification bell (the approvals inbox
  // row itself is written by the existing sync_event_approval_to_inbox trigger).
  if (manager.user_id) {
    const { data: ev } = await ctx.supabaseAdmin
      .from("key_events")
      .select("title")
      .eq("id", plannerEventId)
      .maybeSingle();
    await ctx.supabaseAdmin.from("notifications").insert({
      user_id: manager.user_id,
      kind: "approval_requested",
      title: `Approval requested: ${label}`,
      body: `${requester.display_name || "A teammate"} asked you to approve "${ev?.title || "an event"}".`,
      link: `/diary?event=${plannerEventId}`,
      metadata: { approval_id: approval.id, event_id: plannerEventId },
    });
  }

  return {
    approval_id: approval.id,
    approver_profile_id: manager.id,
    approver_name: manager.display_name ?? null,
    routed: true,
    reason: "Routed to the requester's current line manager.",
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Public entry point. Runs the action and attaches a DecisionTrace describing
 * exactly what the decision engine concluded (used by the Decision Lab test
 * view and by anything that needs to explain the routing).
 */
export async function executePlannerAction(
  ctx: OrchestratorContext,
  req: ActionRequest,
): Promise<ActionResult> {
  const result = await runPlannerAction(ctx, req);
  const d = result.decision;
  const conflict_detected = !!(result.conflicts && result.conflicts.length);
  const duplicate_detected = !!result.duplicate;
  const existing_event_found =
    duplicate_detected ||
    !!result.matched_event ||
    (req.intent !== "CREATE_EVENT" && !!(result.planner_event_id || result.google_event_id));

  let action_taken: DecisionTrace["action_taken"] = "NO_ACTION";
  if (req.intent === "CHECK_AVAILABILITY") action_taken = result.ok ? "READ" : "NO_ACTION";
  else if (result.ok && req.intent === "CREATE_EVENT") action_taken = "CREATE";
  else if (result.ok && req.intent === "UPDATE_EVENT") action_taken = "UPDATE";
  else if (result.ok && req.intent === "CANCEL_EVENT") action_taken = "DELETE";

  const trace: DecisionTrace = {
    intent: d.intent,
    event_type: d.event_type,
    destination: d.destination,
    source_of_truth: d.source_of_truth,
    requires_approval: d.requires_approval,
    reason: d.reason,
    existing_event_found,
    duplicate_detected,
    conflict_detected,
    action_taken,
    linked: !!(result.link_group && result.planner_event_id && result.google_event_id),
    link_group: result.link_group ?? null,
    planner_event_id: result.planner_event_id ?? null,
    google_event_id: result.google_event_id ?? null,
    approver_profile_id: result.approval?.approver_profile_id ?? null,
    approver_name: result.approval?.approver_name ?? null,
    approval_routed: !!result.approval?.routed,
    approval_id: result.approval?.approval_id ?? null,
  };
  return { ...result, trace };
}

async function runPlannerAction(
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
    let matched: any = null;
    // No explicit ids supplied ("move my holiday from Friday to Monday") —
    // find the user's most likely existing record of this type.
    if (!link && !req.planner_event_id && !req.google_event_id) {
      const { data: rows } = await ctx.supabaseAdmin
        .from("key_events")
        .select("id, event_name, title, category, event_type, start_at, link_group")
        .eq("created_by", ctx.userId)
        .eq("deleted_in_google", false)
        .order("start_at", { ascending: true })
        .limit(200);
      const target = normTitle(req.title || "");
      const fromDay = (req.current_start || "").slice(0, 10);
      const candidates = (rows || []).filter((r: any) => {
        const typeMatch = r.event_type === decision.event_type ||
          plannerCategoryFor(decision.event_type) === r.category;
        const titleMatch = target && normTitle(r.event_name || r.title || "").includes(target);
        const dayMatch = fromDay && String(r.start_at || "").slice(0, 10) === fromDay;
        return dayMatch || titleMatch || typeMatch;
      });
      // Prefer a same-day match, then a title match, then the next one of this type.
      matched = candidates.find((r: any) => fromDay && String(r.start_at || "").slice(0, 10) === fromDay)
        ?? candidates.find((r: any) => target && normTitle(r.event_name || r.title || "").includes(target))
        ?? candidates[0]
        ?? null;
      if (matched?.link_group) {
        const { data: l } = await ctx.supabaseAdmin
          .from("event_links").select("*").eq("link_group", matched.link_group).maybeSingle();
        if (l) link = l;
      }
    }
    const plannerId = req.planner_event_id || link?.planner_event_id || matched?.id;
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
      matched_event: matched ?? undefined,
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

  // Approval is routed through the EXISTING Approval Manager, to whoever is the
  // requester's current line manager at this moment.
  let approval: ApprovalRouting | undefined;
  if (decision.requires_approval && plannerId) {
    approval = await routeApprovalToLineManager(ctx, plannerId, decision);
    if (!approval.routed) {
      // Never show "Pending approval" when no approval request actually exists.
      await ctx.supabaseAdmin
        .from("key_events")
        .update({ approval_state: null })
        .eq("id", plannerId);
    }
  }

  const where = [plannerId ? "Planner" : null, googleId ? "Google Calendar" : null].filter(Boolean).join(" and ");
  const approvalNote = !decision.requires_approval
    ? ""
    : approval?.routed
      ? ` Sent to ${approval.approver_name || "your line manager"} for approval.`
      : ` It needs approval but I could not request it — ${approval?.reason || "no approver could be resolved"} Add your line manager in Settings, then ask me again.`;

  return {
    ...base,
    ok: !!(plannerId || googleId),
    verified: !!(plannerId || googleId),
    link_group: linkGroup,
    planner_event_id: plannerId,
    google_event_id: googleId,
    approval,
    message: `Added to ${where}.${approvalNote}`,
  };
}
