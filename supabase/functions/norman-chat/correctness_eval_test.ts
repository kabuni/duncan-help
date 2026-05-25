// Phase 9.5 — unit tests for the eval harness itself.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GOLDEN_FIXTURES,
  evaluateFixture,
  runEval,
} from "../_shared/correctness-eval.ts";

Deno.test("seed fixtures cover all four violation kinds", () => {
  const kinds = new Set<string>();
  for (const f of GOLDEN_FIXTURES) {
    for (const k of f.rubric.must_flag ?? []) kinds.add(k);
  }
  for (const required of ["unbacked_claim", "silent_empty", "truncation_hidden", "stale_claim"]) {
    assert(kinds.has(required), `seed missing fixture for '${required}'`);
  }
});

Deno.test("every seed fixture passes its own rubric", () => {
  const report = runEval();
  if (report.failed > 0) {
    console.error("Failures:", report.failures);
  }
  assertEquals(report.failed, 0, "seed fixtures should all pass");
  assertEquals(report.pass_rate, 1);
});

Deno.test("evaluateFixture returns reasons on rubric mismatch", () => {
  // Take a passing fixture and flip its rubric to force a failure.
  const f = GOLDEN_FIXTURES.find((x) => x.id === "calendar/empty-clean")!;
  const result = evaluateFixture({
    ...f,
    rubric: { must_flag: ["unbacked_claim"] },
  });
  assertEquals(result.passed, false);
  assert(result.reasons.some((r) => r.includes("unbacked_claim")));
});

Deno.test("runEval aggregates by domain", () => {
  const report = runEval();
  assert(report.by_domain.calendar);
  assert(report.by_domain.workstreams);
  assert(report.by_domain.gmail);
  assert(report.by_domain.calendar.total >= 5);
});
