// Phase 9.4 — Identity & timezone resolver.
//
// Single source of truth for "who is the caller and what is their local
// context" used by every tool that needs to resolve "today", "this week",
// "my manager", or "working hours". Eliminates the class of silent-wrong
// errors where one tool defaults to UTC, another to Europe/London, and a
// third to the server's locale.
//
// Pure data layer — no HTTP, no LLM. Cached per request-scope via a Map
// the caller owns so repeated lookups inside one turn don't re-query.

// Use a structural type instead of importing the SDK to avoid version-mismatch
// errors when callers pin different @supabase/supabase-js versions.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export interface ResolvedIdentity {
  user_id: string;
  profile_id: string | null;
  email: string | null;
  display_name: string | null;
  department: string | null;
  role_title: string | null;
  timezone: string;          // IANA, always populated (fallback DEFAULT_TZ)
  working_hours: {           // local-time window, always populated
    start: string;           // "HH:MM"
    end: string;             // "HH:MM"
    days: number[];          // 0=Sun..6=Sat
  };
  manager_id: string | null; // profile_id of manager, if recorded in preferences
  is_admin: boolean;
  source: "profiles" | "auth_only" | "fallback";
  resolved_at: string;       // ISO timestamp of resolution
}

export const DEFAULT_TZ = "Europe/London";
export const DEFAULT_WORKING_HOURS = {
  start: "09:00",
  end: "18:00",
  days: [1, 2, 3, 4, 5], // Mon–Fri
};

export class IdentityCache {
  private byUser = new Map<string, ResolvedIdentity>();
  private byProfile = new Map<string, ResolvedIdentity>();

  get(userId: string): ResolvedIdentity | undefined {
    return this.byUser.get(userId);
  }
  getByProfile(profileId: string): ResolvedIdentity | undefined {
    return this.byProfile.get(profileId);
  }
  set(id: ResolvedIdentity) {
    this.byUser.set(id.user_id, id);
    if (id.profile_id) this.byProfile.set(id.profile_id, id);
  }
}

function coerceTimezone(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_TZ;
  // Lightweight validation: IANA names contain "/" or are short region IDs.
  // Reject obvious junk like numeric offsets ("+01:00") which break Intl.
  if (/^[+-]\d/.test(raw)) return DEFAULT_TZ;
  try {
    // Throws RangeError on invalid TZ.
    new Intl.DateTimeFormat("en-GB", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TZ;
  }
}

function coerceWorkingHours(raw: unknown): ResolvedIdentity["working_hours"] {
  const wh = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const start = typeof wh.start === "string" && /^\d{2}:\d{2}$/.test(wh.start)
    ? wh.start : DEFAULT_WORKING_HOURS.start;
  const end = typeof wh.end === "string" && /^\d{2}:\d{2}$/.test(wh.end)
    ? wh.end : DEFAULT_WORKING_HOURS.end;
  const days = Array.isArray(wh.days)
    ? wh.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6)
    : DEFAULT_WORKING_HOURS.days;
  return { start, end, days: days.length ? days : DEFAULT_WORKING_HOURS.days };
}

/**
 * Resolve the identity context for a given auth user.
 * Always returns a populated object; never throws on missing profile.
 * Pass a fresh `cache` per request to avoid cross-user bleed.
 */
export async function resolveIdentity(
  supabaseAdmin: SupabaseClient,
  userId: string,
  cache?: IdentityCache,
): Promise<ResolvedIdentity> {
  const hit = cache?.get(userId);
  if (hit) return hit;

  const fallback: ResolvedIdentity = {
    user_id: userId,
    profile_id: null,
    email: null,
    display_name: null,
    department: null,
    role_title: null,
    timezone: DEFAULT_TZ,
    working_hours: DEFAULT_WORKING_HOURS,
    manager_id: null,
    is_admin: false,
    source: "fallback",
    resolved_at: new Date().toISOString(),
  };

  // Profile (preferred source).
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, department, role_title, preferences")
    .eq("user_id", userId)
    .maybeSingle();

  // Email from auth.users.
  let email: string | null = null;
  try {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
    email = u?.user?.email ?? null;
  } catch { /* ignore */ }

  // Admin role.
  let isAdmin = false;
  try {
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    isAdmin = !!roleRow;
  } catch { /* ignore */ }

  if (!profile) {
    const result = { ...fallback, email, is_admin: isAdmin, source: "auth_only" as const };
    cache?.set(result);
    return result;
  }

  const prefs = (profile.preferences && typeof profile.preferences === "object")
    ? profile.preferences as Record<string, unknown>
    : {};

  const resolved: ResolvedIdentity = {
    user_id: userId,
    profile_id: profile.id,
    email,
    display_name: profile.display_name ?? null,
    department: profile.department ?? null,
    role_title: profile.role_title ?? null,
    timezone: coerceTimezone(prefs.timezone),
    working_hours: coerceWorkingHours(prefs.working_hours),
    manager_id: typeof prefs.manager_id === "string" ? prefs.manager_id : null,
    is_admin: isAdmin,
    source: "profiles",
    resolved_at: new Date().toISOString(),
  };
  cache?.set(resolved);
  return resolved;
}

/**
 * Render an identity block suitable for injection into a system prompt.
 * Compact and deterministic so the linter can recognise "as of" hedges.
 */
export function formatIdentityForPrompt(id: ResolvedIdentity): string {
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: id.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  const wh = `${id.working_hours.start}–${id.working_hours.end} on days [${id.working_hours.days.join(",")}]`;
  return [
    `Caller: ${id.display_name ?? id.email ?? id.user_id}`,
    `Email: ${id.email ?? "(unknown)"}`,
    `Profile ID: ${id.profile_id ?? "(none)"}`,
    `Department: ${id.department ?? "(unset)"} · Role: ${id.role_title ?? "(unset)"}`,
    `Timezone: ${id.timezone} (local now: ${localNow})`,
    `Working hours: ${wh}`,
    `Admin: ${id.is_admin ? "yes" : "no"}`,
    `Identity source: ${id.source}`,
  ].join("\n");
}

/**
 * Resolve "today" / "tomorrow" / "this week" in the caller's timezone.
 * Returns ISO strings (UTC) for the boundaries so DB queries stay portable.
 */
export function resolveWindow(
  id: ResolvedIdentity,
  window: "today" | "tomorrow" | "this_week" | "next_week",
  now: Date = new Date(),
): { startISO: string; endISO: string; label: string; timezone: string } {
  // Build a date in the user's timezone by formatting then re-parsing.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: id.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const localY = Number(parts.year), localM = Number(parts.month), localD = Number(parts.day);

  // Anchor midnight-local for "today" by constructing UTC then back-correcting.
  const midnightLocalAsUTC = new Date(Date.UTC(localY, localM - 1, localD, 0, 0, 0));
  // Offset between server-UTC and the desired local midnight.
  const offsetMin = (new Date(now.toLocaleString("en-US", { timeZone: id.timezone })).getTime()
                    - now.getTime()) / 60000;
  const todayStart = new Date(midnightLocalAsUTC.getTime() - offsetMin * 60000);

  let start = todayStart;
  let days = 1;
  let label = "today";
  if (window === "tomorrow") { start = new Date(todayStart.getTime() + 86400000); label = "tomorrow"; }
  else if (window === "this_week") {
    const dow = new Date(todayStart).getUTCDay(); // 0..6 relative to local midnight UTC equiv
    const offset = (dow + 6) % 7; // make Monday=0
    start = new Date(todayStart.getTime() - offset * 86400000);
    days = 7; label = "this_week";
  } else if (window === "next_week") {
    const dow = new Date(todayStart).getUTCDay();
    const offset = (dow + 6) % 7;
    start = new Date(todayStart.getTime() + (7 - offset) * 86400000);
    days = 7; label = "next_week";
  }
  const end = new Date(start.getTime() + days * 86400000);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    label,
    timezone: id.timezone,
  };
}
