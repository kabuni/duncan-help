// Phase 8: canonical tool-result envelope.
// Shared by norman-chat (and, in future, confirm-chat-write executors) so every
// tool — read, write, pending, or error — returns the same structural shape.
//
// Rules:
// - Read tools: ok=true, verified=true, status="success" | "no_data".
// - Write tools (direct exec): ok/verified reflect the post-write read-back.
// - Write tools (confirmation path): ok=false, verified=false,
//   status="pending_confirmation" — never "success".
// - Errors: ok=false, verified=false, populated error.
//
// The Mutation Truth Rule in the system prompt depends on these invariants.

export type ToolResultStatus =
  | "success"
  | "no_data"
  | "partial"
  | "pending_confirmation"
  | "hard_error"
  | "error"
  | "timeout"
  | "circuit_open";

export interface ToolEnvelope<T = unknown> {
  tool: string;
  source: string;
  status: ToolResultStatus;
  ok: boolean;
  verified: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  pending?: { pendingId: string; summary: string };
  meta?: Record<string, unknown>;
  [extra: string]: unknown;
}

export function createStructuredToolResult(
  toolName: string,
  result: any,
  statusHint: ToolResultStatus = "success",
): Record<string, any> {
  const payload: Record<string, any> =
    result && typeof result === "object" && !Array.isArray(result)
      ? { ...result }
      : { data: result };

  // status: caller-provided result.status wins; otherwise use the hint.
  const status: ToolResultStatus =
    (typeof payload.status === "string" ? payload.status : statusHint) as ToolResultStatus;

  // Derived defaults — only applied if the underlying tool didn't already set
  // them. Write tools (reschedule_event, etc.) return their own ok/verified.
  const positive = status === "success" || status === "no_data";
  const ok = typeof payload.ok === "boolean" ? payload.ok : positive;
  const verified = typeof payload.verified === "boolean" ? payload.verified : positive;
  const source = typeof payload.source === "string" ? payload.source : toolName;

  const envelope: Record<string, any> = { ...payload };
  envelope.tool = toolName;
  envelope.source = source;
  envelope.status = status;
  envelope.ok = ok;
  envelope.verified = verified;
  return envelope;
}

export function classifyToolOutcome(
  toolName: string,
  result: any,
): { status: "success" | "no_data" | "partial" | "hard_error"; payload: any } {
  if (result == null) {
    return {
      status: "no_data",
      payload: createStructuredToolResult(toolName, { reason: "empty result" }, "no_data"),
    };
  }

  if (typeof result === "object" && !Array.isArray(result)) {
    const errorMessage = typeof result.error === "string" ? result.error.toLowerCase() : "";
    if (errorMessage.includes("timed out")) {
      return {
        status: "partial",
        payload: createStructuredToolResult(toolName, {
          error: result.error,
          fallback_message: "This source took too long, so continue without blocking on it.",
        }, "partial"),
      };
    }

    const likelyNoData = errorMessage.includes("no meetings")
      || errorMessage.includes("no data")
      || errorMessage.includes("not found")
      || errorMessage.includes("no results")
      || result.skipped === true
      || result.empty === true;

    if (likelyNoData) {
      return { status: "no_data", payload: createStructuredToolResult(toolName, result, "no_data") };
    }

    return { status: "success", payload: createStructuredToolResult(toolName, result, "success") };
  }

  if (typeof result === "string" && result.trim().length === 0) {
    return {
      status: "no_data",
      payload: createStructuredToolResult(toolName, { reason: "blank string result" }, "no_data"),
    };
  }

  return { status: "success", payload: createStructuredToolResult(toolName, result, "success") };
}

// ============================================================================
// Phase 9.1 — Read Truth Rule envelope
// ----------------------------------------------------------------------------
// Read tools wrap their payload in a ReadResult so the LLM (and the post-LLM
// correctness linter) can verify that every factual claim has provenance,
// freshness, and a non-silent empty reason.
//
// This is additive — existing tools keep returning ToolEnvelope until they
// are migrated. The correctness linter only enforces ReadResult-backed
// claims once a tool has been opted in via meta.readResult = true.
// ============================================================================

export type EmptyReason =
  | "no_matches"          // query ran fine, zero rows in the resolved window
  | "scope_missing"       // OAuth scope / permission not granted
  | "integration_disconnected"
  | "out_of_window"       // resolved window excluded everything the user meant
  | "permission_denied"   // RLS / RBAC blocked the read
  | "rate_limited"
  | "upstream_error";

export interface ReadResult<T = unknown> {
  ok: true;
  data: T;
  source: string;                 // e.g. "google_calendar", "workstreams_db"
  fetched_at: string;             // ISO timestamp the read completed
  freshness_sla_seconds: number;  // claims older than this must be hedged
  row_count: number;
  truncated: boolean;
  filters_applied: Record<string, unknown>;
  query_echo: string;             // human-readable echo of the resolved query
  empty_reason?: EmptyReason;     // REQUIRED when row_count === 0
  conflicts?: Array<{ field: string; sources: string[]; values: unknown[] }>;
}

export interface ReadResultInput<T = unknown> {
  data: T;
  source: string;
  freshness_sla_seconds: number;
  row_count: number;
  filters_applied: Record<string, unknown>;
  query_echo: string;
  truncated?: boolean;
  empty_reason?: EmptyReason;
  conflicts?: ReadResult<T>["conflicts"];
}

/**
 * Build a Phase 9 ReadResult envelope. Throws when row_count===0 and no
 * empty_reason was provided — silent empties are the exact failure mode this
 * phase exists to kill.
 */
export function createReadResult<T>(input: ReadResultInput<T>): ReadResult<T> {
  if (input.row_count === 0 && !input.empty_reason) {
    throw new Error(
      `createReadResult(${input.source}): row_count=0 requires an explicit empty_reason ` +
        `(no_matches | scope_missing | integration_disconnected | out_of_window | permission_denied | rate_limited | upstream_error)`,
    );
  }
  return {
    ok: true,
    data: input.data,
    source: input.source,
    fetched_at: new Date().toISOString(),
    freshness_sla_seconds: input.freshness_sla_seconds,
    row_count: input.row_count,
    truncated: input.truncated ?? false,
    filters_applied: input.filters_applied,
    query_echo: input.query_echo,
    empty_reason: input.empty_reason,
    conflicts: input.conflicts,
  };
}

/**
 * Wrap a ReadResult inside the existing ToolEnvelope so legacy plumbing keeps
 * working. Sets meta.readResult = true so the correctness linter knows this
 * tool is opted in to Phase 9 enforcement.
 */
export function wrapReadResultAsEnvelope<T>(
  toolName: string,
  read: ReadResult<T>,
): Record<string, any> {
  const status: ToolResultStatus = read.row_count === 0 ? "no_data" : "success";
  const envelope = createStructuredToolResult(toolName, {
    source: read.source,
    data: read.data,
    read_result: read,
    meta: { readResult: true, fetched_at: read.fetched_at, row_count: read.row_count },
  }, status);
  return envelope;
}

export function isReadResultEnvelope(env: Record<string, any> | undefined | null): boolean {
  if (!env || typeof env !== "object") return false;
  const meta = (env as any).meta;
  return !!(meta && meta.readResult === true);
}
