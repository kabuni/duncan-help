// Phase 8: turn classification surface area.
// This module exports the canonical Turn shape and helper types so the
// router logic currently inlined in norman-chat/index.ts has a typed
// destination. Full extraction of the classifier body will follow once
// the surrounding chat loop is itself decomposed; landing the types
// first lets new code reference a single source of truth.

export type TurnIntent = "read" | "write" | "chitchat" | "unknown";

export interface Turn {
  /** Did any intent rule match the user message? */
  intentMatched: boolean;
  /** Read or write classification when known. */
  intent?: TurnIntent;
  /** Was the matched intent a data-fetching one (calendar/workstreams/etc)? */
  isDataIntent: boolean;
  /** Should the LLM call skip tool offers for this turn? */
  bypassTools: boolean;
  /** Did the meeting-source router decide we must clarify Plaud vs Meet? */
  needsMeetingSourceClarification: boolean;
  /** Did the user explicitly name a source (e.g. "from Plaud")? */
  explicitSourceMeetingRequest: boolean;
  /** Has the user already chosen a source earlier in the conversation? */
  sourceAlreadyChosen: boolean;
  /** Resolved project tag (when the user referenced a project by name). */
  resolvedProjectTag: string | null;
}

export function createEmptyTurn(): Turn {
  return {
    intentMatched: false,
    intent: undefined,
    isDataIntent: false,
    bypassTools: false,
    needsMeetingSourceClarification: false,
    explicitSourceMeetingRequest: false,
    sourceAlreadyChosen: false,
    resolvedProjectTag: null,
  };
}
