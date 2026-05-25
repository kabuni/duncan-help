// Phase 9 unit tests — ReadResult envelope + correctness linter (shadow mode).

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createReadResult,
  wrapReadResultAsEnvelope,
  isReadResultEnvelope,
} from "../_shared/tool-envelope.ts";
import { lintAssistantDraft } from "../_shared/correctness-linter.ts";

Deno.test("createReadResult populates required envelope fields", () => {
  const r = createReadResult({
    data: [{ id: 1 }],
    source: "google_calendar",
    freshness_sla_seconds: 60,
    row_count: 1,
    filters_applied: { window: "today" },
    query_echo: "calendar.events where start>=today",
  });
  assertEquals(r.ok, true);
  assertEquals(r.source, "google_calendar");
  assertEquals(r.row_count, 1);
  assertEquals(r.truncated, false);
  assertEquals(typeof r.fetched_at, "string");
});

Deno.test("createReadResult refuses silent empties", () => {
  assertThrows(() =>
    createReadResult({
      data: [],
      source: "google_calendar",
      freshness_sla_seconds: 60,
      row_count: 0,
      filters_applied: {},
      query_echo: "calendar.events",
    })
  );
});

Deno.test("createReadResult accepts row_count=0 when empty_reason provided", () => {
  const r = createReadResult({
    data: [],
    source: "gmail",
    freshness_sla_seconds: 60,
    row_count: 0,
    filters_applied: { q: "from:nobody" },
    query_echo: "gmail.search from:nobody",
    empty_reason: "no_matches",
  });
  assertEquals(r.empty_reason, "no_matches");
});

Deno.test("wrapReadResultAsEnvelope marks readResult opt-in", () => {
  const r = createReadResult({
    data: [],
    source: "workstreams_db",
    freshness_sla_seconds: 30,
    row_count: 0,
    filters_applied: {},
    query_echo: "workstreams where status='red'",
    empty_reason: "no_matches",
  });
  const env = wrapReadResultAsEnvelope("list_workstreams", r);
  assertEquals(isReadResultEnvelope(env), true);
  assertEquals(env.status, "no_data");
});

Deno.test("linter flags unbacked calendar claim", () => {
  const draft = "You have a meeting at 3pm today on your calendar.";
  const report = lintAssistantDraft(draft, []);
  assertEquals(report.violations.some(v => v.kind === "unbacked_claim"), true);
});

Deno.test("linter passes when calendar ReadResult is present", () => {
  const r = createReadResult({
    data: [{ id: "evt_1" }],
    source: "google_calendar",
    freshness_sla_seconds: 60,
    row_count: 1,
    filters_applied: { window: "today" },
    query_echo: "calendar.events",
  });
  const env = wrapReadResultAsEnvelope("get_calendar_events", r);
  const report = lintAssistantDraft(
    "You have a meeting at 3pm today on your calendar.",
    [{ tool: "get_calendar_events", envelope: env }],
  );
  assertEquals(report.violations.filter(v => v.kind === "unbacked_claim").length, 0);
});

Deno.test("linter flags silent empty when draft claims data exists", () => {
  const r = createReadResult({
    data: [],
    source: "gmail",
    freshness_sla_seconds: 60,
    row_count: 0,
    filters_applied: { q: "from:ceo" },
    query_echo: "gmail.search from:ceo",
    empty_reason: "no_matches",
  });
  const env = wrapReadResultAsEnvelope("search_gmail", r);
  const report = lintAssistantDraft(
    "Here are the emails from the CEO this week.",
    [{ tool: "search_gmail", envelope: env }],
  );
  assertEquals(report.violations.some(v => v.kind === "silent_empty"), true);
});

Deno.test("linter flags hidden truncation", () => {
  const r = createReadResult({
    data: new Array(50).fill({}),
    source: "workstreams_db",
    freshness_sla_seconds: 30,
    row_count: 50,
    filters_applied: {},
    query_echo: "workstreams limit 50",
    truncated: true,
  });
  const env = wrapReadResultAsEnvelope("list_workstreams", r);
  const report = lintAssistantDraft(
    "Here are your workstream cards.",
    [{ tool: "list_workstreams", envelope: env }],
  );
  assertEquals(report.violations.some(v => v.kind === "truncation_hidden"), true);
});
