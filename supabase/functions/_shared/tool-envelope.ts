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
