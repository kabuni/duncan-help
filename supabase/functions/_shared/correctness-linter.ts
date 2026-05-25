// ============================================================================
// Phase 9.7 — Post-LLM correctness linter (SHADOW MODE)
// ----------------------------------------------------------------------------
// Runs between the LLM draft and the SSE flush. In shadow mode it only LOGS
// violations — it does not strip text or re-prompt. Once we trust the signal
// we flip ENFORCE = true (Phase 9 step 6).
//
// A violation is: the draft contains a factual-looking assertion
// (date, count, name, status) for a domain we have a ReadResult tool for,
// but no opted-in ReadResult was returned in this turn's tool log.
// ============================================================================

import type { ReadResult } from "./tool-envelope.ts";
import { isReadResultEnvelope } from "./tool-envelope.ts";

export type LinterMode = "shadow" | "enforce";

export interface ToolCallRecord {
  tool: string;
  envelope: Record<string, any>;
}

export interface LinterViolation {
  kind: "unbacked_claim" | "stale_claim" | "truncation_hidden" | "silent_empty";
  detail: string;
  source_hint?: string;
}

export interface LinterReport {
  mode: LinterMode;
  violations: LinterViolation[];
  readResultsSeen: Array<{ source: string; row_count: number; fetched_at: string }>;
}

// Domain → trigger phrases that imply Duncan asserted something factual.
// Conservative on purpose: false negatives are fine in shadow mode.
const DOMAIN_TRIGGERS: Record<string, RegExp[]> = {
  google_calendar: [
    /\byou (?:have|'ve got|don't have)\b[^.]{0,80}\b(?:meeting|event|call|appointment)/i,
    /\bon your calendar\b/i,
    /\bno (?:meetings|events) (?:today|tomorrow|this week)/i,
  ],
  workstreams_db: [
    /\b\d+\s+(?:open|overdue|active|red|yellow|green)\s+workstream/i,
    /\bthe (?:workstream|card) (?:"|'|“)/i,
  ],
  gmail: [
    /\byou have \d+ (?:unread|new) emails?/i,
    /\bno emails from\b/i,
    /\b(?:sent|emailed) you \d+ (?:email|message)s?\b/i,
    /\bunread email from\b/i,
  ],
  meetings: [
    /\bin (?:the|your) (?:last|recent) meeting\b/i,
  ],
};

export function lintAssistantDraft(
  draft: string,
  toolCalls: ToolCallRecord[],
  mode: LinterMode = "shadow",
): LinterReport {
  const readResults = toolCalls
    .filter(tc => isReadResultEnvelope(tc.envelope))
    .map(tc => (tc.envelope as any).read_result as ReadResult)
    .filter(Boolean);

  const sourcesSeen = new Set(readResults.map(r => r.source));
  const violations: LinterViolation[] = [];

  // 1. Unbacked claims by domain.
  for (const [domain, patterns] of Object.entries(DOMAIN_TRIGGERS)) {
    for (const pattern of patterns) {
      if (pattern.test(draft) && !sourcesSeen.has(domain)) {
        violations.push({
          kind: "unbacked_claim",
          detail: `Draft makes a ${domain} claim matching ${pattern} but no ReadResult from ${domain} this turn.`,
          source_hint: domain,
        });
      }
    }
  }

  // 2. Stale claims (claim cites data older than SLA).
  const now = Date.now();
  for (const r of readResults) {
    const ageSec = (now - new Date(r.fetched_at).getTime()) / 1000;
    if (ageSec > r.freshness_sla_seconds) {
      const hedged = /\bas of\b/i.test(draft);
      if (!hedged) {
        violations.push({
          kind: "stale_claim",
          detail: `${r.source} data is ${ageSec.toFixed(0)}s old (SLA ${r.freshness_sla_seconds}s) and the draft has no "as of …" hedge.`,
          source_hint: r.source,
        });
      }
    }
  }

  // 3. Hidden truncation.
  for (const r of readResults) {
    if (r.truncated && !/\b(?:more|additional|truncated|first \d+)\b/i.test(draft)) {
      violations.push({
        kind: "truncation_hidden",
        detail: `${r.source} returned truncated=true but the draft does not flag that more rows exist.`,
        source_hint: r.source,
      });
    }
  }

  // 4. Silent empties (row_count 0 with no empty_reason surfaced).
  for (const r of readResults) {
    if (r.row_count === 0 && r.empty_reason && !draft.toLowerCase().includes(r.empty_reason.replace("_", " "))) {
      // Soft check — model often paraphrases, so we only flag when draft
      // pretends data exists at all.
      const claimsData = /\byou have\b|\bhere (?:are|is)\b|\bI found\b/i.test(draft);
      if (claimsData) {
        violations.push({
          kind: "silent_empty",
          detail: `${r.source} returned 0 rows (empty_reason=${r.empty_reason}) but the draft asserts data exists.`,
          source_hint: r.source,
        });
      }
    }
  }

  const report: LinterReport = {
    mode,
    violations,
    readResultsSeen: readResults.map(r => ({
      source: r.source,
      row_count: r.row_count,
      fetched_at: r.fetched_at,
    })),
  };

  if (violations.length > 0) {
    console.warn(
      `[correctness-linter:${mode}] ${violations.length} violation(s):`,
      JSON.stringify(violations, null, 2),
    );
  }

  return report;
}
