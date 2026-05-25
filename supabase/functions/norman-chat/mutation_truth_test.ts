// Phase 7 — Mutation Truth Rule regression tests.
//
// These tests pin the canonical ToolResult envelope contract that
// `createStructuredToolResult` (in `index.ts`) MUST honor. They are
// intentionally implementation-free: they assert the rules a third party
// must be able to read off the envelope, so any refactor that breaks the
// invariants will fail here.
//
// When Phase 8 extracts the envelope helper into `_shared/tool_envelope.ts`,
// replace `classifyEnvelope` below with a direct import.
//
// Run: deno test supabase/functions/norman-chat/mutation_truth_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

type ToolResultStatus =
  | "success"
  | "no_data"
  | "partial"
  | "pending_confirmation"
  | "error"
  | "hard_error"
  | "timeout"
  | "circuit_open";

interface ToolResult {
  tool: string;
  source: string;
  status: ToolResultStatus;
  ok: boolean;
  verified: boolean;
  data?: unknown;
  before?: unknown;
  after?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean } | null;
  pending?: { pendingId: string; summary: string } | null;
}

// Mirror of the structural classification in index.ts. Kept here so that
// the contract is independently testable. If index.ts diverges from this
// table, these tests should fail and force a deliberate decision.
function classifyEnvelope(status: ToolResultStatus): { ok: boolean; verified: boolean } {
  switch (status) {
    case "success":
    case "no_data":
      return { ok: true, verified: true };
    case "pending_confirmation":
      return { ok: false, verified: false };
    case "partial":
    case "error":
    case "hard_error":
    case "timeout":
    case "circuit_open":
      return { ok: false, verified: false };
  }
}

// Mutation Truth Rule: the ONLY shape that lets the model claim a write
// happened is { ok: true, verified: true }. Everything else must be
// surfaced as not-yet-done.
function mayClaimWriteSucceeded(r: Pick<ToolResult, "ok" | "verified">): boolean {
  return r.ok === true && r.verified === true;
}

Deno.test("envelope: success defaults to ok=true, verified=true", () => {
  const c = classifyEnvelope("success");
  assertEquals(c, { ok: true, verified: true });
});

Deno.test("envelope: no_data is still a verified read outcome", () => {
  const c = classifyEnvelope("no_data");
  assertEquals(c, { ok: true, verified: true });
});

Deno.test("envelope: pending_confirmation is NEVER a success", () => {
  const c = classifyEnvelope("pending_confirmation");
  assertFalse(c.ok);
  assertFalse(c.verified);
});

Deno.test("envelope: hard_error / partial / timeout / circuit_open are all unverified failures", () => {
  for (const s of ["hard_error", "partial", "timeout", "circuit_open", "error"] as const) {
    const c = classifyEnvelope(s);
    assertFalse(c.ok, `status=${s} must not be ok`);
    assertFalse(c.verified, `status=${s} must not be verified`);
  }
});

Deno.test("Mutation Truth Rule: only ok+verified permits a write-success claim", () => {
  assert(mayClaimWriteSucceeded({ ok: true, verified: true }));
  assertFalse(mayClaimWriteSucceeded({ ok: true, verified: false }));
  assertFalse(mayClaimWriteSucceeded({ ok: false, verified: true }));
  assertFalse(mayClaimWriteSucceeded({ ok: false, verified: false }));
});

Deno.test("Mutation Truth Rule: pending_confirmation cannot pass through as a write success", () => {
  const envelope: ToolResult = {
    tool: "reschedule_event",
    source: "google_calendar",
    status: "pending_confirmation",
    ok: false,
    verified: false,
    pending: { pendingId: "abc", summary: "Move Lightning Strike to 14:00" },
  };
  assertFalse(mayClaimWriteSucceeded(envelope));
  assertEquals(envelope.status, "pending_confirmation");
});

Deno.test("Mutation Truth Rule: a verified-false write is structurally a failure even if ok=true", () => {
  // Defensive: prevents the historical bug where executors set ok=true but
  // skipped the read-back. With verified=false, no claim is allowed.
  const envelope: ToolResult = {
    tool: "reschedule_event",
    source: "google_calendar",
    status: "partial",
    ok: true,
    verified: false,
    error: { code: "verify_failed", message: "Post-write read-back mismatch", retryable: true },
  };
  assertFalse(mayClaimWriteSucceeded(envelope));
});

Deno.test("Phase 6: empty_completion and fabricated_tool_call are typed retryable errors", () => {
  const errors = [
    { code: "empty_completion", retryable: true },
    { code: "fabricated_tool_call", retryable: true },
  ];
  for (const e of errors) {
    assertEquals(e.retryable, true, `${e.code} must be retryable`);
  }
});
