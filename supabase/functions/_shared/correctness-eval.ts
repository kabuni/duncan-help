// Phase 9.5 — Correctness eval harness.
//
// Goal: a deterministic, offline-runnable suite of "golden" prompts that
// exercise the correctness linter against representative assistant drafts
// and tool envelopes. This is NOT an LLM-in-the-loop eval — it scores
// fixed (draft, envelopes) pairs so regressions in the linter or in tool
// migrations show up immediately without burning tokens.
//
// How to extend: append entries to GOLDEN_FIXTURES. Each fixture has:
//   - id           — stable key for reporting
//   - domain       — one of the DOMAIN_TRIGGERS keys (used for routing only)
//   - prompt       — user prompt the draft is responding to (documentation)
//   - draft        — the assistant's draft text to score
//   - envelopes    — ReadResult-wrapped envelopes the tool layer produced
//   - rubric       — expected outcomes (allowed/forbidden violation kinds)
//
// A fixture passes when:
//   - every violation kind in rubric.must_flag appears in the linter output
//   - no violation kind in rubric.must_not_flag appears
//   - the violation count matches rubric.exact_count (when set)

import {
  lintAssistantDraft,
  type LinterViolation,
  type ToolCallRecord,
} from "../_shared/correctness-linter.ts";
import {
  createReadResult,
  wrapReadResultAsEnvelope,
} from "../_shared/tool-envelope.ts";

export interface GoldenFixture {
  id: string;
  domain: string;
  prompt: string;
  draft: string;
  envelopes: ToolCallRecord[];
  rubric: {
    must_flag?: LinterViolation["kind"][];
    must_not_flag?: LinterViolation["kind"][];
    exact_count?: number;
  };
}

export interface FixtureResult {
  id: string;
  domain: string;
  passed: boolean;
  violations: LinterViolation[];
  reasons: string[];
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  by_domain: Record<string, { total: number; passed: number }>;
  failures: FixtureResult[];
}

// ----------------------------------------------------------------------------
// Helpers for building envelopes inside fixtures.
// ----------------------------------------------------------------------------

function calendarEnvelope(opts: {
  rows: unknown[];
  truncated?: boolean;
  empty_reason?: Parameters<typeof createReadResult>[0]["empty_reason"];
  fetched_at?: string;
}): ToolCallRecord {
  const rr = createReadResult({
    data: opts.rows,
    source: "google_calendar",
    freshness_sla_seconds: 60,
    row_count: opts.rows.length,
    truncated: opts.truncated,
    filters_applied: { window: "today" },
    query_echo: "calendar.events?window=today",
    empty_reason: opts.empty_reason ?? (opts.rows.length === 0 ? "no_matches" : undefined),
    fetched_at: opts.fetched_at,
  });
  return { tool: "list_calendar_events", envelope: wrapReadResultAsEnvelope(rr) };
}

function workstreamsEnvelope(opts: {
  rows: unknown[];
  truncated?: boolean;
  empty_reason?: Parameters<typeof createReadResult>[0]["empty_reason"];
}): ToolCallRecord {
  const rr = createReadResult({
    data: opts.rows,
    source: "workstreams_db",
    freshness_sla_seconds: 30,
    row_count: opts.rows.length,
    truncated: opts.truncated,
    filters_applied: { status: "open" },
    query_echo: "workstream_cards where status in (red,amber,green)",
    empty_reason: opts.empty_reason ?? (opts.rows.length === 0 ? "no_matches" : undefined),
  });
  return { tool: "list_workstream_cards", envelope: wrapReadResultAsEnvelope(rr) };
}

function gmailEnvelope(opts: {
  rows: unknown[];
  empty_reason?: Parameters<typeof createReadResult>[0]["empty_reason"];
}): ToolCallRecord {
  const rr = createReadResult({
    data: opts.rows,
    source: "gmail",
    freshness_sla_seconds: 120,
    row_count: opts.rows.length,
    filters_applied: { query: "is:unread" },
    query_echo: "gmail.messages?q=is:unread",
    empty_reason: opts.empty_reason ?? (opts.rows.length === 0 ? "no_matches" : undefined),
  });
  return { tool: "list_gmail_messages", envelope: wrapReadResultAsEnvelope(rr) };
}

// ----------------------------------------------------------------------------
// Golden fixtures — initial seed covering the four violation kinds across
// the three highest-traffic domains. Add more as tools migrate.
// ----------------------------------------------------------------------------

export const GOLDEN_FIXTURES: GoldenFixture[] = [
  // --- Calendar ---
  {
    id: "calendar/empty-clean",
    domain: "calendar",
    prompt: "Anything on my calendar today?",
    draft: "You have nothing on your calendar today.",
    envelopes: [calendarEnvelope({ rows: [] })],
    rubric: { must_not_flag: ["silent_empty", "unbacked_claim"], exact_count: 0 },
  },
  {
    id: "calendar/silent-empty",
    domain: "calendar",
    prompt: "What meetings do I have today?",
    draft: "You have a meeting at 10am with the design team and a 2pm review.",
    envelopes: [calendarEnvelope({ rows: [] })],
    rubric: { must_flag: ["silent_empty"] },
  },
  {
    id: "calendar/unbacked-claim",
    domain: "calendar",
    prompt: "Do I have anything at 3pm?",
    draft: "Yes, you have a 3pm meeting with Alice about Q4 planning.",
    envelopes: [], // no calendar read was performed
    rubric: { must_flag: ["unbacked_claim"] },
  },
  {
    id: "calendar/truncation-hidden",
    domain: "calendar",
    prompt: "What's on this week?",
    draft: "Here are all your events this week: standup, design review, demo.",
    envelopes: [calendarEnvelope({ rows: [{}, {}, {}], truncated: true })],
    rubric: { must_flag: ["truncation_hidden"] },
  },
  {
    id: "calendar/truncation-disclosed",
    domain: "calendar",
    prompt: "What's on this week?",
    draft: "Here are your first events: standup, design review, demo. More than this was returned — let me know if you want the rest.",
    envelopes: [calendarEnvelope({ rows: [{}, {}, {}], truncated: true })],
    rubric: { must_not_flag: ["truncation_hidden"] },
  },

  // --- Workstreams ---
  {
    id: "workstreams/silent-empty",
    domain: "workstreams",
    prompt: "What workstream cards are open?",
    draft: "You have three open cards: API migration, mobile polish, and the onboarding revamp.",
    envelopes: [workstreamsEnvelope({ rows: [] })],
    rubric: { must_flag: ["silent_empty"] },
  },
  {
    id: "workstreams/clean-pass",
    domain: "workstreams",
    prompt: "Show me red cards.",
    draft: "There is 1 red card: 'API migration' — overdue by 2 days.",
    envelopes: [workstreamsEnvelope({ rows: [{ title: "API migration", status: "red" }] })],
    rubric: { must_not_flag: ["silent_empty", "unbacked_claim", "truncation_hidden"], exact_count: 0 },
  },

  // --- Gmail ---
  {
    id: "gmail/unbacked-claim",
    domain: "gmail",
    prompt: "Any new emails from Alice?",
    draft: "Yes, Alice sent you 2 emails about the contract this morning.",
    envelopes: [], // no gmail read
    rubric: { must_flag: ["unbacked_claim"] },
  },
  {
    id: "gmail/silent-empty",
    domain: "gmail",
    prompt: "Any unread emails?",
    draft: "You have an unread email from Bob about budget approvals.",
    envelopes: [gmailEnvelope({ rows: [] })],
    rubric: { must_flag: ["silent_empty"] },
  },
  {
    id: "gmail/empty-clean",
    domain: "gmail",
    prompt: "Any unread emails?",
    draft: "Inbox zero — nothing unread right now.",
    envelopes: [gmailEnvelope({ rows: [] })],
    rubric: { must_not_flag: ["silent_empty", "unbacked_claim"], exact_count: 0 },
  },

  // --- Stale-claim guard (calendar fetched > SLA seconds ago, no "as of" hedge) ---
  {
    id: "calendar/stale-unhedged",
    domain: "calendar",
    prompt: "What's next on my calendar?",
    draft: "Your next event is a design review at 4pm.",
    envelopes: [calendarEnvelope({
      rows: [{}],
      // fetched 10 minutes ago — well past the 60s SLA
      fetched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })],
    rubric: { must_flag: ["stale_claim"] },
  },
  {
    id: "calendar/stale-hedged",
    domain: "calendar",
    prompt: "What's next on my calendar?",
    draft: "As of 10 minutes ago, your next event was a design review at 4pm.",
    envelopes: [calendarEnvelope({
      rows: [{}],
      fetched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    })],
    rubric: { must_not_flag: ["stale_claim"] },
  },
];

// ----------------------------------------------------------------------------
// Runner.
// ----------------------------------------------------------------------------

export function evaluateFixture(fixture: GoldenFixture): FixtureResult {
  // Run linter in shadow mode to capture violations without mutation.
  const report = lintAssistantDraft(fixture.draft, fixture.envelopes, "shadow");
  const violations = report.violations;
  const reasons: string[] = [];

  if (fixture.rubric.must_flag) {
    for (const kind of fixture.rubric.must_flag) {
      if (!violations.some((v) => v.kind === kind)) {
        reasons.push(`expected violation '${kind}' was not flagged`);
      }
    }
  }
  if (fixture.rubric.must_not_flag) {
    for (const kind of fixture.rubric.must_not_flag) {
      if (violations.some((v) => v.kind === kind)) {
        reasons.push(`unexpected violation '${kind}' was flagged`);
      }
    }
  }
  if (typeof fixture.rubric.exact_count === "number"
      && violations.length !== fixture.rubric.exact_count) {
    reasons.push(`expected exactly ${fixture.rubric.exact_count} violation(s), got ${violations.length}`);
  }

  return {
    id: fixture.id,
    domain: fixture.domain,
    passed: reasons.length === 0,
    violations,
    reasons,
  };
}

export function runEval(fixtures: GoldenFixture[] = GOLDEN_FIXTURES): EvalReport {
  const results = fixtures.map(evaluateFixture);
  const passed = results.filter((r) => r.passed).length;
  const by_domain: Record<string, { total: number; passed: number }> = {};
  for (const r of results) {
    const d = (by_domain[r.domain] ||= { total: 0, passed: 0 });
    d.total += 1;
    if (r.passed) d.passed += 1;
  }
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    pass_rate: results.length ? passed / results.length : 1,
    by_domain,
    failures: results.filter((r) => !r.passed),
  };
}

// ----------------------------------------------------------------------------
// CLI: `deno run --allow-all supabase/functions/_shared/correctness-eval.ts`
// ----------------------------------------------------------------------------
if (import.meta.main) {
  const report = runEval();
  console.log("\n=== Phase 9.5 Correctness Eval ===");
  console.log(`Total:  ${report.total}`);
  console.log(`Passed: ${report.passed}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Pass rate: ${(report.pass_rate * 100).toFixed(1)}%`);
  console.log("\nBy domain:");
  for (const [domain, stats] of Object.entries(report.by_domain)) {
    console.log(`  ${domain.padEnd(14)} ${stats.passed}/${stats.total}`);
  }
  if (report.failures.length) {
    console.log("\nFailures:");
    for (const f of report.failures) {
      console.log(`  [${f.id}] ${f.reasons.join("; ")}`);
      if (f.violations.length) {
        for (const v of f.violations) {
          console.log(`    - ${v.kind}: ${v.detail}`);
        }
      }
    }
    Deno.exit(1);
  }
}
