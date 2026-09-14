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
  | "FIND_EVENT"
  | "CHECK_AVAILABILITY";

export type EventType =
  | "MEETING"
  | "AVAILABILITY"
  | "OUT_OF_OFFICE"
  | "ANNUAL_LEAVE"
  | "SICK_LEAVE"
  | "COMPANY_EVENT"
  | "PROJECT_MILESTONE"
  | "PERSONAL_APPOINTMENT"
  | "TRAVEL"
  | "OTHER";

/** Who the thing is for. Drives destination alongside the event type. */
export type Audience = "PERSONAL" | "TEAM" | "COMPANY";

export interface Decision {
  intent: PlannerIntent;
  event_type: EventType;
  destination: Destination[];
  source_of_truth: Destination;
  requires_approval: boolean;
  reason: string;
  /** Existing Planner category key stored on key_events.category. */
  planner_category: string;
  /** Signals the engine evaluated before choosing the destination. */
  audience: Audience;
  attendance_required: boolean;
  /** True when intent is genuinely unclear — Duncan should ask, not guess. */
  ambiguous: boolean;
  clarifying_question: string | null;
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
    reason: "Company-wide things (launches, releases, all-hands, big events) belong on the Planner so everyone sees them — they are not put on anyone's personal Google Calendar.",
  },
  PROJECT_MILESTONE: {
    destination: ["PLANNER"],
    source_of_truth: "PLANNER",
    requires_approval: false,
    planner_category: "Product",
    reason: "Deadlines and milestones are company markers — Planner only, not a personal calendar entry.",
  },
  PERSONAL_APPOINTMENT: {
    destination: ["GOOGLE_CALENDAR"],
    source_of_truth: "GOOGLE_CALENDAR",
    requires_approval: false,
    reason: "Personal appointments stay on the person's own Google Calendar and off the company Planner.",
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

/** Wording that means "people are getting together" — this always wins over
 *  company-wide wording, so "launch planning meeting" is a meeting, not a launch. */
const EXPLICIT_MEETING =
  /\b(meeting|call|sync|catch ?up|1:1|one[- ]to[- ]one|standup|stand[- ]up|huddle|workshop with|session with|review with|interview|book .* with|meet(ing)? with|invite)\b/i;

/** Company-wide moments that belong on the shared Planner, never on a personal calendar. */
const COMPANY_WIDE =
  /\b(launch(es|ing)?|go[- ]live|release|ship(ping)? (date|version)|version \d|rollout|roll[- ]out|all[- ]hands|town ?hall|company[- ]wide|company (event|party|away ?day|update)|christmas party|away ?day|team social|socials?|conference|summit|showcase|exhibition|expo|open day|festival|campaign|webinar|announcement|press release|demo day|board meeting|investor (update|day)|graduation|awards?)\b/i;

const TYPE_PATTERNS: [EventType, RegExp][] = [
  ["PERSONAL_APPOINTMENT", /\b(dentist|doctor'?s? appointment|gp appointment|optician|hospital appointment|school run|personal appointment|physio|therapy)\b/i],
  ["ANNUAL_LEAVE", /\b(annual leave|holiday|vacation|taking .* off|day off|days off|time off|pto|book(ing)? leave|i'?m off)\b/i],
  ["SICK_LEAVE", /\b(sick|unwell|ill|medical leave)\b/i],
  ["OUT_OF_OFFICE", /\b(out of office|ooo|away from desk|unavailable all day)\b/i],
  ["TRAVEL", /\b(flight|flying|travel(ling)?|trip to|train to|offsite travel)\b/i],
  ["COMPANY_EVENT", COMPANY_WIDE],
  ["PROJECT_MILESTONE", /\b(deadline|milestone|due (by|on)|cut ?off|sprint end|end of sprint|target date)\b/i],
  ["AVAILABILITY", /\b(am i free|what am i free for|availability|free slots?|when (am|are) .* free|find (me )?time)\b/i],
  ["MEETING", EXPLICIT_MEETING],
];

/** Heuristic fallback when the caller did not supply an explicit event_type. */
export function classifyEventType(text: string): EventType {
  const t = text || "";
  // A get-together is a meeting even when it is about a launch or release,
  // unless the person is describing leave, sickness, travel or an appointment.
  const personal = TYPE_PATTERNS.slice(0, 5).find(([, re]) => re.test(t));
  if (personal) return personal[0];
  if (EXPLICIT_MEETING.test(t)) return "MEETING";
  for (const [type, re] of TYPE_PATTERNS) if (re.test(t)) return type;
  return "OTHER";
}

// ── Signal analysis ──────────────────────────────────────────────────────────
// Destination is NEVER decided from the category name. It is decided from
// intent + audience + whether people have to turn up + whether a real time was
// given + organisational significance.

/** Wording that means the whole company / a whole team is involved. */
const COMPANY_AUDIENCE =
  /\b(company[- ]wide|whole (company|team|business|school)|all staff|all employees|everyone|the entire (team|company)|all[- ]hands|town ?hall|company (event|party|social|away ?day|update|meeting)|with the (whole|entire) team|all of us|team[- ]wide)\b/i;

/** Things that only exist because people gather for them — attendance is implied. */
const ATTENDABLE =
  /\b(party|all[- ]hands|town ?hall|away ?day|social|socials|celebration|dinner|drinks|night out|conference|summit|showcase|open day|graduation|awards?|demo day|webinar|festival|offsite|off[- ]site|expo|exhibition|ceremony|screening|training day|hackathon|kick[- ]?off)\b/i;

/** Company markers that are a date in the plan, not a gathering. */
const MILESTONE_WORDING =
  /\b(launch(es|ing)?|go[- ]live|release|rollout|roll[- ]out|ship(ping)? (date|version)|version \d|deadline|milestone|due (by|on)|cut ?off|target date|announcement|press release|campaign)\b/i;

/** Event types where the Planner-vs-Calendar question is actually open. */
const OPEN_TYPES: EventType[] = ["COMPANY_EVENT", "PROJECT_MILESTONE", "OTHER"];

export interface EventSignals {
  audience: Audience;
  attendance_required: boolean;
  significant: boolean;
  has_specific_time: boolean;
  ambiguous: boolean;
  clarifying_question: string | null;
}

function hasClockTime(start?: string | null, allDay?: boolean): boolean {
  if (allDay) return false;
  if (!start) return false;
  if (!/\d{2}:\d{2}/.test(start)) return false;
  return !/T00:00(:00)?/.test(start);
}

/**
 * Works out who an item is for and whether anyone has to attend it.
 * Explicit values supplied by the caller always win over the wording.
 */
export function analyzeSignals(
  eventType: EventType,
  text: string,
  opts: {
    all_day?: boolean;
    start?: string | null;
    attendees?: string[];
    audience?: Audience;
    attendance_required?: boolean;
  } = {},
): EventSignals {
  const t = text || "";
  const timed = hasClockTime(opts.start, opts.all_day);
  const companyWords = COMPANY_AUDIENCE.test(t);
  const attendable = ATTENDABLE.test(t);
  const milestone = MILESTONE_WORDING.test(t);
  const hasAttendees = !!(opts.attendees && opts.attendees.length);

  const personalType = eventType === "PERSONAL_APPOINTMENT" || eventType === "ANNUAL_LEAVE" ||
    eventType === "SICK_LEAVE" || eventType === "OUT_OF_OFFICE" || eventType === "TRAVEL";

  let audience: Audience =
    opts.audience ??
    (personalType ? "PERSONAL" : companyWords ? "COMPANY" : hasAttendees || eventType === "MEETING" ? "TEAM" : OPEN_TYPES.includes(eventType) ? "COMPANY" : "PERSONAL");

  const significant = audience === "COMPANY" && (companyWords || attendable || milestone || OPEN_TYPES.includes(eventType));

  const attendance_required =
    opts.attendance_required ??
    (eventType === "MEETING" || personalType
      ? true
      : attendable || hasAttendees || (companyWords && timed));

  // Only ask when a company-level item genuinely could be either: a milestone
  // phrased with a real clock time, but nothing saying people must turn up.
  const ambiguous =
    opts.attendance_required === undefined &&
    OPEN_TYPES.includes(eventType) &&
    milestone &&
    timed &&
    !companyWords &&
    !attendable &&
    !hasAttendees;

  return {
    audience,
    attendance_required,
    significant,
    has_specific_time: timed,
    ambiguous,
    clarifying_question: ambiguous
      ? "Is this something people need to attend at that time, or just a date to mark on the Planner?"
      : null,
  };
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

/**
 * THE decision engine. Pure — same inputs always give the same routing.
 *
 * Hierarchy:
 *   1. primarily a meeting / appointment / availability question → Google Calendar
 *   2. primarily a company planning milestone                    → Planner
 *   3. a significant company item people must attend             → Planner + Google Calendar
 * The Planner category is resolved separately and never drives the destination.
 */
export function decideDestination(
  intent: PlannerIntent,
  eventType: EventType,
  opts: {
    overrides?: Record<string, Destination[]>;
    text?: string | null;
    suggested_category?: string | null;
    all_day?: boolean;
    start?: string | null;
    attendees?: string[];
    audience?: Audience;
    attendance_required?: boolean;
  } = {},
): Decision {
  const rule = EVENT_TYPE_RULES[eventType] ?? EVENT_TYPE_RULES.OTHER;
  const signals = analyzeSignals(eventType, opts.text || "", {
    all_day: opts.all_day,
    start: opts.start,
    attendees: opts.attendees,
    audience: opts.audience,
    attendance_required: opts.attendance_required,
  });

  const override = opts.overrides?.[eventType];
  let destination = (override && override.length > 0 ? override : rule.destination).slice();
  let reason = rule.reason;

  // Company-level items: the destination depends on attendance, not on wording
  // or on the category. A launch date is a Planner marker; a launch everyone
  // joins at 10am is a Planner marker AND a calendar entry.
  if (
    !override &&
    intent !== "CHECK_AVAILABILITY" &&
    OPEN_TYPES.includes(eventType) &&
    signals.audience !== "PERSONAL"
  ) {
    if (signals.attendance_required && signals.significant) {
      destination = ["PLANNER", "GOOGLE_CALENDAR"];
      reason =
        "A company planning item that people also need to attend — recorded on the Planner and put on calendars so attendance is real.";
    } else if (signals.attendance_required) {
      destination = ["GOOGLE_CALENDAR"];
      reason = "People need to attend this, and it isn't a company-wide planning marker — Google Calendar.";
    } else {
      destination = ["PLANNER"];
      reason = "A company planning item / milestone with no attendance required — Planner only.";
    }
  }

  // The source of truth follows the resulting event shape: Planner owns
  // anything the company plans; Google Calendar owns anything only attended.
  const preferred: Destination = destination.includes("PLANNER") ? "PLANNER" : "GOOGLE_CALENDAR";
  const source_of_truth = destination.includes(rule.source_of_truth)
    ? (OPEN_TYPES.includes(eventType) ? preferred : rule.source_of_truth)
    : preferred;

  return {
    intent,
    event_type: eventType,
    destination: intent === "CHECK_AVAILABILITY" ? ["GOOGLE_CALENDAR"] : destination,
    source_of_truth,
    requires_approval: intent === "CREATE_EVENT" ? rule.requires_approval : false,
    reason,
    planner_category: resolvePlannerCategory(eventType, opts.text, opts.suggested_category),
    audience: signals.audience,
    attendance_required: signals.attendance_required,
    ambiguous: intent === "CREATE_EVENT" && signals.ambiguous,
    clarifying_question: intent === "CREATE_EVENT" ? signals.clarifying_question : null,
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
  /** Optional AI/manual category hint — validated against the existing list. */
  planner_category?: string;
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
  planner_category: string;
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
  /** Possible matches for a find/cancel/update request the user must choose from. */
  candidates?: EventCandidate[];
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

// ── Event finding (shared by SEARCH, UPDATE and CANCEL) ─────────────────────
//
// One matcher for every "which existing event does the user mean?" question, so
// find, change and remove all agree on what counts as a match. Deliberately
// conservative: a vague request returns several candidates rather than acting.

export interface EventCandidate {
  link_group: string | null;
  planner_event_id: string | null;
  google_event_id: string | null;
  title: string;
  start: string | null;
  all_day: boolean;
  event_type: string | null;
  category: string | null;
  approval_state: string | null;
  systems: Destination[];
  score: number;
}

const dayOf = (v?: string | null) => (v ? String(v).slice(0, 10) : "");

function titleOverlap(target: string, candidate: string): boolean {
  if (!target) return false;
  const a = normTitle(target);
  const b = normTitle(candidate);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = a.split(" ").filter((w) => w.length > 3);
  return words.length > 0 && words.every((w) => b.includes(w));
}

/**
 * Finds the existing event(s) a request refers to, across Planner and Google
 * Calendar, collapsing linked records into one logical event.
 */
async function findEventCandidates(
  ctx: OrchestratorContext,
  req: ActionRequest,
  decision: Decision,
  token: string | null,
): Promise<EventCandidate[]> {
  const day = dayOf(req.start || req.current_start);
  const title = req.title || "";
  const typeGiven = !!req.event_type;

  // Search window: the named day (± 1) when we have one, otherwise a wide band
  // around today so "cancel my holiday" can still find it.
  const anchor = day ? new Date(`${day}T12:00:00Z`) : new Date();
  const from = new Date(anchor.getTime() - (day ? 2 : 30) * 86_400_000).toISOString();
  const to = new Date(anchor.getTime() + (day ? 2 : 365) * 86_400_000).toISOString();

  const { data: rows } = await ctx.supabaseAdmin
    .from("key_events")
    .select("id, event_name, title, category, event_type, start_at, all_day, link_group, approval_state, google_event_id, created_by")
    .eq("created_by", ctx.userId)
    .eq("deleted_in_google", false)
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at", { ascending: true })
    .limit(200);

  const out: EventCandidate[] = [];
  for (const r of rows || []) {
    const name = r.event_name || r.title || "";
    let score = 0;
    if (day && dayOf(r.start_at) === day) score += 5;
    if (titleOverlap(title, name)) score += 4;
    if (typeGiven && r.event_type === decision.event_type) score += 2;
    if (decision.planner_category && r.category === decision.planner_category) score += 1;
    if (score === 0) continue;
    out.push({
      link_group: r.link_group ?? null,
      planner_event_id: r.id,
      google_event_id: r.google_event_id ?? null,
      title: name,
      start: r.start_at ?? null,
      all_day: !!r.all_day,
      event_type: r.event_type ?? null,
      category: r.category ?? null,
      approval_state: r.approval_state ?? null,
      systems: ["PLANNER"],
      score,
    });
  }

  // Google Calendar side — meetings usually live there only.
  if (token) {
    const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
    url.searchParams.set("timeMin", from);
    url.searchParams.set("timeMax", to);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (title) url.searchParams.set("q", title);
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (resp.ok) {
      const items = ((await resp.json()).items || []).filter((e: any) => e.status !== "cancelled");
      for (const e of items) {
        const start = e.start?.dateTime || e.start?.date || null;
        let score = 0;
        if (day && dayOf(start) === day) score += 5;
        if (titleOverlap(title, e.summary || "")) score += 4;
        if (score === 0) continue;
        const linked = out.find((c) => c.google_event_id && c.google_event_id === e.id);
        if (linked) {
          linked.systems = ["PLANNER", "GOOGLE_CALENDAR"];
          linked.score = Math.max(linked.score, score);
          continue;
        }
        out.push({
          link_group: null,
          planner_event_id: null,
          google_event_id: e.id,
          title: e.summary || "(untitled)",
          start,
          all_day: !e.start?.dateTime,
          event_type: "MEETING",
          category: null,
          approval_state: null,
          systems: ["GOOGLE_CALENDAR"],
          score,
        });
      }
    }
  }

  // Attach link groups so linked pairs are treated as one logical event.
  for (const c of out) {
    if (!c.link_group && !c.planner_event_id && !c.google_event_id) continue;
    const q = ctx.supabaseAdmin.from("event_links").select("*");
    if (c.link_group) q.eq("link_group", c.link_group);
    else if (c.planner_event_id) q.eq("planner_event_id", c.planner_event_id);
    else q.eq("google_event_id", c.google_event_id);
    const { data: l } = await q.maybeSingle();
    if (l) {
      c.link_group = l.link_group;
      c.planner_event_id = c.planner_event_id || l.planner_event_id || null;
      c.google_event_id = c.google_event_id || l.google_event_id || null;
      c.systems = [
        ...(c.planner_event_id ? (["PLANNER"] as Destination[]) : []),
        ...(c.google_event_id ? (["GOOGLE_CALENDAR"] as Destination[]) : []),
      ];
    }
  }

  // Collapse anything that ended up pointing at the same logical event.
  const seen = new Map<string, EventCandidate>();
  for (const c of out.sort((a, b) => b.score - a.score)) {
    const key = c.link_group || c.planner_event_id || c.google_event_id || c.title;
    const prev = seen.get(key);
    if (!prev) seen.set(key, c);
    else prev.score = Math.max(prev.score, c.score);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score || String(a.start).localeCompare(String(b.start)));
}

/**
 * Cancels any still-open approval requests for an event through the EXISTING
 * Approval Manager, so removing a pending leave request never leaves an
 * orphaned approval in someone's inbox (the inbox row is removed by the
 * existing sync_event_approval_to_inbox trigger).
 */
async function cancelApprovalsForEvent(ctx: OrchestratorContext, plannerEventId: string) {
  const { data: open } = await ctx.supabaseAdmin
    .from("key_event_approvals")
    .select("id, approver_profile_id, label")
    .eq("event_id", plannerEventId)
    .in("status", ["pending", "proposed"]);
  if (!open?.length) return 0;

  const { data: ev } = await ctx.supabaseAdmin
    .from("key_events").select("title").eq("id", plannerEventId).maybeSingle();

  for (const a of open) {
    const { data: manager } = await ctx.supabaseAdmin
      .from("profiles").select("user_id").eq("id", a.approver_profile_id).maybeSingle();
    if (manager?.user_id) {
      await ctx.supabaseAdmin.from("notifications").insert({
        user_id: manager.user_id,
        kind: "approval_cancelled",
        title: "Approval request withdrawn",
        body: `"${ev?.title || "An event"}" was cancelled, so the approval request no longer needs a decision.`,
        link: "/approvals",
        metadata: { approval_id: a.id, event_id: plannerEventId },
      });
    }
  }
  await ctx.supabaseAdmin
    .from("key_event_approvals")
    .delete()
    .in("id", open.map((a: any) => a.id));
  return open.length;
}

// ── Writers ──────────────────────────────────────────────────────────────────

async function createPlannerEvent(ctx: OrchestratorContext, req: ActionRequest, decision: Decision) {
  const category = decision.planner_category || plannerCategoryFor(decision.event_type);
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
  const pending = decision.requires_approval === true;
  const body: any = {
    summary: pending ? `[Pending approval] ${req.title}` : req.title,
    description: req.description,
    location: req.location,
    start: allDay
      ? { date: (req.start || "").slice(0, 10) }
      : { dateTime: req.start, timeZone: ctx.timezone || "UTC" },
    end: allDay
      ? { date: (req.end || req.start || "").slice(0, 10) }
      : { dateTime: req.end, timeZone: ctx.timezone || "UTC" },
  };
  // Not confirmed until the approval is granted.
  if (pending) body.status = "tentative";

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
    if (body.eventType || body.status) {
      delete body.eventType;
      delete body.status;
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
  else if (req.intent === "FIND_EVENT") action_taken = result.ok ? "READ" : "NO_ACTION";

  const trace: DecisionTrace = {
    intent: d.intent,
    event_type: d.event_type,
    destination: d.destination,
    source_of_truth: d.source_of_truth,
    requires_approval: d.requires_approval,
    reason: d.reason,
    planner_category: d.planner_category,
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
  const decision = decideDestination(req.intent, eventType, {
    overrides,
    text: `${req.utterance || ""} ${req.title || ""} ${req.description || ""}`,
    suggested_category: req.planner_category,
  });
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

  // ── Find / search ─────────────────────────────────────────────────────────
  if (req.intent === "FIND_EVENT") {
    const found = await findEventCandidates(ctx, req, decision, token);
    return {
      ...base,
      ok: true,
      verified: true,
      candidates: found,
      message: found.length
        ? `${found.length} matching event(s) found.`
        : "No matching event found in Planner or Google Calendar.",
    };
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

  // ── Cancel / delete / remove ──────────────────────────────────────────────
  if (req.intent === "CANCEL_EVENT") {
    let plannerId = req.planner_event_id || link?.planner_event_id || null;
    let googleId = req.google_event_id || link?.google_event_id || null;
    let matched: EventCandidate | null = null;

    // No explicit record supplied ("remove my annual leave next Friday") — find
    // it. Never guess: nothing is removed on a vague or ambiguous match.
    if (!plannerId && !googleId) {
      if (!req.title && !req.start && !req.current_start && !req.event_type) {
        return {
          ...base,
          message: "I need to know which event to remove — a name, a date, or both.",
          error: "ambiguous",
        };
      }
      const found = await findEventCandidates(ctx, req, decision, token);
      if (found.length === 0) {
        return { ...base, candidates: [], message: "I couldn't find a matching event in Planner or Google Calendar.", error: "not_found" };
      }
      // Ambiguous unless one candidate is clearly the strongest match.
      const clear = found.length === 1 || (found[0].score >= 5 && found[0].score > found[1].score);
      if (!clear && !req.force) {
        return {
          ...base,
          candidates: found.slice(0, 5),
          message: `I found ${found.length} events that could match. Which one do you mean?`,
          error: "ambiguous",
        };
      }
      matched = found[0];
      plannerId = matched.planner_event_id;
      googleId = matched.google_event_id;
      if (matched.link_group && !link) {
        const { data: l } = await ctx.supabaseAdmin
          .from("event_links").select("*").eq("link_group", matched.link_group).maybeSingle();
        if (l) link = l;
      }
    }

    // Permission: a user can only remove their own Planner records here.
    if (plannerId) {
      const { data: owner } = await ctx.supabaseAdmin
        .from("key_events").select("created_by, title, event_name").eq("id", plannerId).maybeSingle();
      if (owner && owner.created_by && owner.created_by !== ctx.userId) {
        const { data: isAdmin } = await ctx.supabaseAdmin
          .rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
        if (!isAdmin) {
          return { ...base, message: "That event belongs to someone else, so I can't remove it.", error: "not_permitted" };
        }
      }
    }

    let plannerDone = false;
    let googleDone = false;
    let approvalsCancelled = 0;

    if (plannerId) {
      // Withdraw any open approval first, so no orphaned request is left behind.
      approvalsCancelled = await cancelApprovalsForEvent(ctx, plannerId);
      const { error } = await ctx.supabaseAdmin
        .from("key_events")
        .update({
          deleted_in_google: true,
          status: "cancelled",
          approval_state: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", plannerId);
      plannerDone = !error;
    }
    if (googleId && token) googleDone = await deleteGoogleEvent(token, googleId);

    if (link) {
      await ctx.supabaseAdmin
        .from("event_links")
        .update({
          status: "cancelled",
          last_sync_origin: req.origin ?? decision.source_of_truth,
          last_sync_hash: payloadHash,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", link.id);
    }

    const ok = plannerDone || googleDone;
    const where = [plannerDone ? "Planner" : null, googleDone ? "Google Calendar" : null].filter(Boolean).join(" and ");
    return {
      ...base,
      ok,
      verified: ok,
      link_group: link?.link_group ?? matched?.link_group ?? undefined,
      planner_event_id: plannerId ?? undefined,
      google_event_id: googleId ?? undefined,
      matched_event: matched ?? undefined,
      message: ok
        ? `Removed from ${where}.${approvalsCancelled ? " The pending approval request was withdrawn too." : ""}`
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
      // Re-categorise only when the request actually carries category signal, so
      // a simple date move never re-labels an event the user already corrected.
      const explicitCategory = isPlannerCategory(req.planner_category)
        ? (req.planner_category as string)
        : req.event_type
          ? decision.planner_category
          : null;
      const currentCategory = matched?.category
        ?? (await ctx.supabaseAdmin.from("key_events").select("category").eq("id", plannerId).maybeSingle()).data?.category
        ?? null;
      const category = explicitCategory || currentCategory;
      if (category) {
        patch.category = category;
        if (req.title) patch.title = `[${category}] ${req.title}`;
      }
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

  // APPROVAL GATE (pre-check): if this event type requires approval, an approver
  // must be resolvable BEFORE anything is written anywhere.
  if (decision.requires_approval) {
    const { data: requesterProfile } = await ctx.supabaseAdmin
      .from("profiles")
      .select("id, line_manager_profile_id")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (!requesterProfile?.line_manager_profile_id) {
      return {
        ...base,
        ok: false,
        verified: false,
        error: "approval_unavailable",
        message:
          "This needs line manager approval, and no line manager is set on your Duncan profile — so I can't raise the approval request. Nothing was added to Planner or Google Calendar. Set your line manager in your profile (or ask an admin to), then ask me again.",
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
      // APPROVAL GATE: an event that requires approval must never exist without a
      // real approval request behind it. Roll the whole thing back rather than
      // leaving a confirmed-looking entry in Planner and Google Calendar.
      if (googleId) {
        try {
          const token = await ctx.getGoogleToken();
          if (token) {
            await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId || "primary")}/events/${encodeURIComponent(googleId)}`,
              { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
            );
          }
        } catch (_e) { /* best effort */ }
      }
      await ctx.supabaseAdmin.from("event_links").delete().eq("link_group", linkGroup);
      await ctx.supabaseAdmin.from("key_events").delete().eq("id", plannerId);

      return {
        ...base,
        ok: false,
        verified: false,
        link_group: null,
        planner_event_id: null,
        google_event_id: null,
        approval,
        error: "approval_unavailable",
        message: `${decision.event_type === "ANNUAL_LEAVE" ? "Annual leave" : "This"} needs line manager approval, and I couldn't create the approval request — ${approval.reason || "no approver could be resolved."} Nothing was added to Planner or Google Calendar. Add your line manager in your profile, then ask me again.`,
      };
    }
  }

  const where = [plannerId ? "Planner" : null, googleId ? "Google Calendar" : null].filter(Boolean).join(" and ");
  const approvalNote = !decision.requires_approval
    ? ""
    : ` Pending approval — sent to ${approval?.approver_name || "your line manager"}. It isn't confirmed until they approve it.`;

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
