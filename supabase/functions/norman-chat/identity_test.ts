// Phase 9.4 tests — identity resolver helpers.
// Pure-function tests (no DB) for coercion, prompt formatting, and window math.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_TZ,
  DEFAULT_WORKING_HOURS,
  formatIdentityForPrompt,
  resolveWindow,
  type ResolvedIdentity,
} from "../_shared/identity.ts";

function fixture(over: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return {
    user_id: "u1",
    profile_id: "p1",
    email: "a@b.com",
    display_name: "Alice",
    department: "Eng",
    role_title: "Engineer",
    timezone: "Europe/London",
    working_hours: DEFAULT_WORKING_HOURS,
    manager_id: null,
    is_admin: false,
    source: "profiles",
    resolved_at: new Date().toISOString(),
    ...over,
  };
}

Deno.test("formatIdentityForPrompt includes timezone and local now", () => {
  const block = formatIdentityForPrompt(fixture());
  assert(block.includes("Timezone: Europe/London"));
  assert(block.includes("Caller: Alice"));
  assert(block.includes("Working hours: 09:00–18:00"));
});

Deno.test("resolveWindow today returns 24h span in caller TZ", () => {
  const now = new Date("2026-05-25T14:00:00Z");
  const w = resolveWindow(fixture({ timezone: "Europe/London" }), "today", now);
  const ms = new Date(w.endISO).getTime() - new Date(w.startISO).getTime();
  assertEquals(ms, 86400000);
  assertEquals(w.label, "today");
  assertEquals(w.timezone, "Europe/London");
});

Deno.test("resolveWindow this_week spans 7 days", () => {
  const now = new Date("2026-05-27T10:00:00Z"); // Wednesday
  const w = resolveWindow(fixture(), "this_week", now);
  const ms = new Date(w.endISO).getTime() - new Date(w.startISO).getTime();
  assertEquals(ms, 7 * 86400000);
});

Deno.test("DEFAULT_TZ is Europe/London", () => {
  assertEquals(DEFAULT_TZ, "Europe/London");
});
