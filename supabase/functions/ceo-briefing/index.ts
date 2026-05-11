import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLMWithFallback } from "../_shared/llm.ts";

// The CEO and any user with the 'admin' role can trigger briefing generation.
// Viewing is open to all signed-in users (enforced via RLS).
const CEO_GENERATOR_EMAILS = ["nimesh@kabuni.com"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ─── 2026 Non-negotiable priorities (canonical) ────────────────────────────
// Strict, distinctive multi-word aliases ONLY. Generic words removed to prevent
// false-positive coverage matches (e.g. "event", "launch", "app", "duncan").
const PRIORITY_DEFINITIONS = [
  {
    id: "lightning_strike",
    title: "Lightning Strike India — 7 June 2026",
    aliases: ["lightning strike", "india launch", "7 june 2026", "june 7 2026"],
    why_it_matters: "The single hard deadline anchoring every other 2026 priority. Slip = cascade.",
    expected_owner: "Nimesh (CEO) + Simon (Ops Director)",
  },
  {
    id: "kpl_registrations",
    title: "1M Kabuni Premier League registrations",
    aliases: ["kpl registration", "premier league registration", "1m registration", "1 million registration"],
    why_it_matters: "Top of funnel for trials, selection and pre-orders. Without it, nothing downstream works.",
    expected_owner: "Alex (CMO)",
  },
  {
    id: "trials",
    title: "Trials October & November 2026",
    aliases: ["selection trials", "trials 2026", "october trials", "november trials"],
    why_it_matters: "Conversion event from 1M registrations to the 10-team selection.",
    expected_owner: "Simon (Ops Director) + Alex (CMO)",
  },
  {
    id: "team_selection",
    title: "Final 10-team selection — December 2026 (10 Super Coaches)",
    aliases: ["10 team selection", "10-team selection", "super coaches", "december selection"],
    why_it_matters: "The product output of the entire trials funnel. Defines the league.",
    expected_owner: "Matt (CPO) + Simon (Ops Director)",
  },
  {
    id: "preorders",
    title: "100,000 pre-orders",
    aliases: ["pre-order", "preorder", "100k pre", "100,000 pre"],
    why_it_matters: "Primary commercial proof point for investors and supply chain commitments.",
    expected_owner: "Alex (CMO) + Patrick (CFO)",
  },
  {
    id: "duncan_automation",
    title: "Duncan automates 25% of the company",
    aliases: ["duncan automation", "automate company", "25% automation", "operating leverage"],
    why_it_matters: "Operating-leverage thesis. Without this, the company can't scale into 2027.",
    expected_owner: "Palash (Head of Duncan)",
  },
];

const MORNING_SCHEMA_HINT = `Return STRICT JSON with this exact shape:
{
  "trajectory": "On Track" | "Slight Drift" | "At Risk" | "Off Track",
  "outcome_probability": number (0-100),
  "execution_score": number (0-100),
  "workstream_scores": [{
    "name": string,                  // MUST be drawn verbatim from available_workstreams. NEVER invented.
    "rag": "red" | "amber" | "green" | "silent",   // MUST equal workstream_baseline[name].derived_rag — server overwrites if you deviate.
    "card_status_summary": string,   // MUST equal workstream_baseline[name].card_status_summary verbatim, e.g. "3 cards · 0 red / 3 amber / 0 green".
    "progress": number,
    "confidence": number,
    "risk": number,
    "progress_vs_goal": string,
    "execution_quality": string,
    "commercial_impact": string,
    "dependency_strength": string,
    "evidence": string               // MUST cite a real card title, Azure work item, or release. For silent workstreams, write "Silent — no cards in the last 7 days".
  }],
  "payload": {
    "tldr": {
      "on_track": string,
      "what_will_break": string,
      "where_to_act": string
    },
    "company_pulse": string,
    "probability_movement": string,
    "execution_explanation": string,
    "coverage_gaps": [{
      "priority": string,                       // priority title from priority_definitions
      "why_it_matters": string,
      "consequence_if_unowned": string,
      "recommended_owner": string,
      "recommended_workstream_name": string     // suggested project_tag for the new workstream
    }],
    "what_changed": [{"function_area": "Launch & India" | "Product & Technology" | "Growth & Marketing" | "Operations & Delivery" | "Finance & Legal" | "Duncan Automation", "moved": string, "did_not_move": string, "needs_attention": string}],
    "risks": [{
      "risk": string,
      "why_it_matters": string,
      "impact_7d": { "window": "7d", "impact": string, "mitigation": string },
      "impact_30d": { "window": "30d", "impact": string, "mitigation": string },
      "impact_90d": { "window": "90d", "impact": string, "mitigation": string },
      "owner": string,
      "severity": "low"|"medium"|"high"|"critical",
      "confidence": number,
      "probability_impact_pts": number
    }],
    "friction": [{"issue": string, "description": string, "teams": string[], "systems": [("workstream"|"azure"|"meeting"|"calendar"|"xero"|"release"|"document"|"email")], "why_friction": string, "evidence": string, "business_impact": string, "urgency": "red"|"yellow"|"green", "next_action": string, "suggested_owner": string, "friction_score": number, "consequence": string, "evidence_source": "workstream_card"|"meeting"|"coverage_gap"|"silent_leader"|"doc_conflict"|"azure"|"xero"|"calendar", "recommended_resolver": string, "auto_injected": boolean}],
    "leadership": [{"name": string, "role": string, "output_vs_expectation": string, "risk_level": "low"|"medium"|"high", "blocking": string, "needs_support": string, "ceo_intervention_required": boolean, "signal_status": "active"|"low_signal"|"silent", "evidence_sources": [("meetings"|"workstreams"|"azure"|"releases"|"calendar"|"email"|"transcript")]}],
    "_watchlist_note": "watchlist is computed server-side from cards + Azure + priorities — do not emit",
    "decisions": [{"decision": string, "why_it_matters": string, "consequence": string, "who_to_involve": string, "confidence": "high"|"medium"|"low", "blocked_by_missing_data": string|null, "evidence_source": "coverage_gap"|"silent_priority"|"risk"|"friction"|"email"|"silent_leader"|"data_blind_spot"|"workstream"|null, "auto_injected": boolean}],
    "automation": {"working": string, "manual": string, "next": string, "blockers": string},
    "automation_progress": {
      "company_usage": {
        "total_tokens": number,
        "request_count": number,
        "active_users": number,
        "dow_change_pct": number,
        "wow_change_pct": number,
        "trend_label": "Adoption accelerating" | "Adoption steady" | "Flat" | "Declining" | "Insufficient data"
      },
      "top_users": [{
        "rank": number,
        "name": string,
        "role": string,
        "department": string,
        "total_tokens": number,
        "request_count": number,
        "primary_use": string,
        "est_hours_saved": number
      }],
      "recommendations": [{
        "title": string,
        "why_now": string,
        "expected_leverage": "Low" | "Medium" | "High",
        "effort": "S" | "M" | "L",
        "auto_injected": boolean,
        "evidence_source": "coverage_gap" | "silent_priority" | "friction" | "stuck_workstream" | "heavy_manual_surface" | "failed_tool_call" | "model"
      }]
    },
    "brutal_truth": string,
    "document_intelligence": [{
      "domain": string,
      "file_name": string,
      "verdict": "weak"|"adequate"|"strong",
      "what_it_covers": string,
      "what_is_missing_in_doc": string,
      "contradicted_by": [string],
      "reinforced_by": [string],
      "critical_gaps_to_fix": [string]
    }],
    "missing_artifacts_recommendations": [{
      "domain": string,
      "priority": "critical"|"high"|"medium"|"low",
      "artifacts": [{
        "name": string,
        "why_duncan_needs_it": string,
        "what_it_unlocks": string,
        "where_to_find_it": string,
        "suggested_filename_pattern": string,
        "blast_radius": [string]
      }]
    }]
  }
}

CRITICAL RULES:
- "workstream_scores[].name" MUST come verbatim from "available_workstreams" in the source data. Do NOT invent workstreams. Do NOT use the function-bucket names in "what_changed" (Launch & India, Product & Technology, etc.) as workstream names — those are reporting lenses, not workstreams. If "available_workstreams" is empty, return "workstream_scores": [] and say so in payload.company_pulse.
- WORKSTREAM COVERAGE: workstream_scores MUST contain EXACTLY one entry per name in available_workstreams — no omissions, no duplicates, no inventions. If you cannot articulate scores for one, still return the row using the workstream_baseline values for that name and set evidence to "Silent — no cards in the last 7 days" or quote the most recent card.
- WORKSTREAM RAG TRUTH: workstream_scores[i].rag MUST equal workstream_baseline[name].derived_rag verbatim. The server overwrites any deviation. Justify in evidence; never override.
- WORKSTREAM ALIGNMENT: when execution_score < 50 OR outcome_probability < 50, NO workstream may simultaneously have progress >= 70 AND risk <= 30 AND rag = "green". Either downgrade progress/risk or cite the contradicting evidence (a green card that justifies it). The server clamps violators.
- "function_area" in "what_changed" is a REPORTING LENS, not a workstream identifier.
- For every entry in "coverage_report" where status = "missing", you MUST add an entry to payload.coverage_gaps. Do NOT fabricate scores for missing priorities — flag them as gaps instead.
- payload.brutal_truth MUST mention any uncovered 2026 priority by name when coverage_gaps is non-empty.
- HONEST SCORING: If fewer than half of the 6 priorities have a workstream (coverage_ratio < 0.5), outcome_probability MUST be ≤ 35, execution_score MUST be ≤ 40, and trajectory MUST be "At Risk" or "Off Track". State the reason in payload.execution_explanation: "Low-evidence briefing — N of 6 priorities have no owned workstream." You cannot honestly project >35% probability against a plan you cannot see.
- "tldr" must directly answer the three Final Instruction questions in 1-2 sentences each.
- For each workstream score, all six analytical-framework axes are MANDATORY (progress_vs_goal, execution_quality, commercial_impact, dependency_strength + scores).
- Risk windows (7d/30d/90d) must be structured objects, never loose strings.
- Every workstream "evidence" string MUST quote a real card title, Azure work item, or release from the source data.
- watchlist is fully server-computed from workstream_cards, workstream_card_assignees, azure_work_items, and PRIORITY_DEFINITIONS — do NOT emit it.
- decisions[].confidence MUST NEVER exceed payload.data_coverage_audit.confidence_cap.
- payload.data_coverage_audit.strategic_coverage is the SERVER-AUTHORITATIVE per-priority artifact gap list (required vs supplied per knowledge domain). When citing coverage, ground numbers in this structure — never invent a "% covered". When a 2026 priority has coverage_pct < 40 in payload.data_coverage_audit.strategic_coverage, payload.brutal_truth MUST name it explicitly with its % and the top 2 missing artifact names. decisions[].blocked_by_missing_data MUST cite specific missing artifact names from strategic_coverage when applicable, e.g. "Lightning Strike: missing India launch runbook + vendor MoU — operations blind spot".
- decisions[].blocked_by_missing_data MUST name the Red domain whenever the decision cannot be honestly judged without that evidence. Format: "{domain_label}: {what specifically is missing}". Set null ONLY when fully grounded. When missing_artifacts_recommendations contains specific artifact names that would unblock this decision, prepend: "Needs: {artifact_name_1}, {artifact_name_2} — {domain_label} blind spot."
- payload.decisions POPULATION RULES: decisions[] is the CEO-grade call list — only items that ONLY Nimesh can make or unblock. NOT operational tasks. It MUST draw from, with NO duplicates:
    a. Every entry in payload.coverage_gaps (decision = "Assign accountable owner and stand up workstream for {priority}").
    b. Every entry in headline_context.silent_priorities (same shape as a).
    c. Every payload.risks entry where severity ∈ {"high","critical"} (decision = "Decide mitigation path for {risk_title} or accept the {probability_impact_pts}-pt probability hit").
    d. Every payload.friction entry where recommended_resolver = "CEO" (decision = "Break {teams.join('/')} deadlock on {issue}").
    e. Every email_pulse_signals.escalations item with no clear owner, every board_mention, and every unowned commitment (decision = "Decide owner + response for {topic} surfaced in inbox").
    f. Every leader_signal_map entry with signal_status="silent" AND owns_priorities.length > 0 (decision = "Intervene with {leader} — silent owner of {priority}").
    g. When data_coverage_audit.confidence_cap ∈ {"medium","low"}: at least ONE decision of the form "Pause {board/launch/investor} commitment OR proceed despite {worst_red_domain.label} blind spot" with blocked_by_missing_data populated.
  MINIMUM count = 3 whenever trajectory ≠ "On Track" OR outcome_probability < 70 OR coverage_gaps non-empty OR confidence_cap ≠ "high". An empty decisions[] on a non-green briefing is a reporting failure.
  For each row: "decision" = a binary call only the CEO can make (assign / approve / pause / escalate / overrule); "why_it_matters" = the specific 2026 priority or commitment at stake; "consequence" = what slips in 7 days if the decision is not made; "who_to_involve" = real names from team_directory / leader_signal_map; "confidence" ≤ data_coverage_audit.confidence_cap; "blocked_by_missing_data" populated whenever evidence is insufficient; "evidence_source" tagged to the source list above; "auto_injected" = false (only the post-processor sets true).
- payload.document_intelligence: For EVERY domain in domain_file_review with files_inspected.length > 0, produce one entry. Ground "what_it_covers" in the actual content_excerpt (do NOT invent). Cross-reference the excerpt against xero_invoices, workstream_cards, azure_work_items, meetings, recent_releases — if a number, date, owner, or commitment in the doc disagrees with another data source, list it in contradicted_by with a specific quote (e.g. "Plan assumes £180k Q2 burn but Xero shows £241k actual"). Mark verdict="weak" if the doc is thin, generic, or stale; "strong" only when current, specific, and corroborated by ≥1 other system.
- payload.missing_artifacts_recommendations: THINK LIKE A CHIEF OF STAFF, NOT A CEO. Recommend artifacts the CEO would NEVER think to upload, drawn from the operating_system_checklist in context. Cover ALL 7 knowledge domains (not just Red ones — even Green domains have depth gaps). For each artifact: (a) "what_it_unlocks" MUST tie to a specific briefing section (e.g. "Risk Radar accuracy on India launch", "Decisions §9 confidence cap → high", "Investor advisory grounding"); (b) "where_to_find_it" MUST be grounded in inferred_artifact_signals where a hint exists (e.g. "Heard mentioned in Patrick's 14 Apr meeting — likely in his Drive/email"), otherwise plausible owner+location ("DocuSign — Patrick"); (c) cross-reference meetings, xero_invoices, azure_work_items, recent_releases to INFER artifacts that should exist but haven't been uploaded (AWS invoices in Xero → infer infrastructure cost map; "India launch" in meetings → infer signed vendor MoU; security tags on Azure tickets → infer pen-test report). Maximum 15 artifacts TOTAL across all domains, ranked by unlock-value. Priority levels: "critical" = blocks a §9 decision or board commitment; "high" = caps a major section confidence; "medium"/"low" = depth improvements.
- payload.leadership: You MUST return EXACTLY ONE entry per name in leadership_roster (provided in context). Never omit a leader, never invent extras. For each leader, set "signal_status" from leader_signal_map: "active" (≥2 sources), "low_signal" (1 source), "silent" (0 sources). "evidence_sources" MUST be the array from leader_signal_map.sources for that leader. For SILENT leaders: set ceo_intervention_required=true, risk_level="medium" (or "high" if they own a 2026 priority), output_vs_expectation="No operational signal in 7 days — confirm engagement, blocked status, or capacity issue.", blocking="Invisible to Duncan — unknown.", needs_support="CEO check-in to surface what they are actually working on." For LOW_SIGNAL leaders: flag if their single source is non-execution (only meetings, no cards/Azure/releases). For ACTIVE leaders: ground output_vs_expectation in the SPECIFIC source items in leader_signal_map.sources_detail. Silence from a direct report IS a finding, not a gap to hide.
- payload.risks RECONCILIATION: The risks array MUST collectively explain why outcome_probability is what it is. The "probability gap" = 100 − outcome_probability. The SUM of probability_impact_pts across all risks MUST be within ±10 of that gap. Each risk's probability_impact_pts represents how many points of probability that single risk accounts for (must be a positive integer). At least one risk MUST be tagged severity:"critical" or "high" whenever outcome_probability < 50 OR execution_score < 60. Every silent_priority listed in headline_context.silent_priorities MUST appear as its own dedicated risk with severity:"high" minimum and probability_impact_pts ≥ 12. If you cannot honestly justify the gap with the listed risks, ADD MORE RISKS until you do — do not under-report. Sort risks DESC by probability_impact_pts (biggest contributors first).
- payload.friction RULES: Cross-functional friction is a STRUCTURAL BLOCKER between ≥2 functions/teams that NO single owner can unblock alone. CORE RULE: Do NOT report email volume, inbox activity, or email threads as friction on their own. Email is SECONDARY EVIDENCE only — a friction item MUST be grounded in evidence from at least 2 NON-EMAIL systems (workstream cards, Azure work items, meetings, calendar, Xero, releases, documents, slack). Slack channel signals (escalations, confusion, customer issues from slack_pulse_signals) DO count as a non-email system. Email may appear in "systems" only if at least 2 non-email systems are also present.

  STRUCTURED 4-PASS SCAN — run each pass explicitly. For every emitted friction item, set "pass" = "A" | "B" | "C" | "D" indicating which pass found it.

    PASS A — Strategy alignment. For each 2026 priority in PRIORITIES, gather the workstream_cards + azure_work_items + meeting mentions tied to it (by title/tag/semantic match). Flag if: (i) the priority is named in slack_pulse_signals or email_pulse_signals commitments but has zero matching cards/Azure items, OR (ii) cards exist but none moved in the last 7 days while the priority is "in-flight". Each such item is friction (commitment-without-execution OR execution-stalled).

    PASS B — Cards ↔ Azure consistency. Cross-check workstream_cards against azure_work_items: (i) a card with status "blocked" or description containing "waiting on engineering / dev / azure" while the matching Azure item shows state "Active" / "In Progress" and recent activity → mismatched view of reality (friction). (ii) An Azure item past its target date with no acknowledgement in any card or slack/meeting signal → silent slip (friction). Cite both the card_id/title AND the Azure work item id in evidence.

    PASS C — Cross-system corroboration. For every slack_pulse_signals.escalation, email_pulse_signals.risk, or meeting action item from the last 48h, check whether it appears in workstream_cards or azure_work_items. If a high/critical signal has NO corresponding card or Azure item → "raised but not actioned" friction. Cite the slack/email/meeting ref AND the absence of card/Azure coverage.

    PASS D — Strategic drift. Take the union of (cards moved + Azure changes + meeting mentions + slack signals + email signals) in the last 7 days. For each 2026 priority with ZERO entries across ALL systems → emit a "strategic drift" friction item even if nothing is overtly "broken" — the drift itself IS friction. Owner = the priority's expected_owner from leader_signal_map.

  ALSO scan the legacy heuristics (still valid evidence):
    a. workstream_cards stuck (no movement >5 days) while a related Azure work item or meeting transcript shows the dependency moving in another team.
    b. Sales/customer commitments (Xero invoices, meeting transcripts mentioning customer promises) misaligned with delivery capacity (Azure backlog, stuck cards).
    c. Handoff delays — a card marked "blocked by X" where X lives in another function's workstream or Azure board with no recent movement.
    d. Tasks with unclear ownership: cards/work items where owner_id is null OR assignee_status remains "pending" for >3 days while related work continues elsewhere.
    e. Missed dependencies — a release or workstream advancing while an upstream card it depends on is stale or unowned.
    f. Calendar overload (≥6 hours of meetings/day for an owner) coinciding with their owned workstream going stale — decision latency.
    g. document_intelligence.contradicted_by entries spanning ≥2 functions.
    h. data_coverage_audit.strategic_coverage where a 2026 priority has artifacts in one domain but is Red in another.
    i. leader_signal_map where a 2026 priority has active cards but the expected_owner is silent.

  EVIDENCE FLOOR: Each friction item MUST cite specific items from ≥2 non-email systems in "evidence" (e.g. "Card 'India launch logistics' last moved 12 days ago + Azure #4321 'India shipping integration' blocked + meeting 14 Apr noted Patrick waiting on ops"). Items grounded in only 1 system → demote to a risk, not friction. Items grounded only in email → DO NOT EMIT.
  RANK BY FRICTION SCORE: friction_score = cross_functional_impact (0-25) + time_delay (0-20) + ownership_ambiguity (0-15) + customer_or_revenue_risk (0-25) + recurrence (0-15). Sort DESC; emit only the TOP 5.
  URGENCY mapping: red = score ≥70 OR named customer/revenue impact within 7d; yellow = 40–69; green should NOT appear (filter out). If nothing scores ≥40, return [] and let the empty-state speak.
  For EACH friction:
    - "issue": short title (≤90 chars).
    - "description": one-sentence operational summary.
    - "teams": EXACTLY the function names involved (≥2).
    - "systems": the non-email systems that corroborate (≥2 required).
    - "pass": "A" | "B" | "C" | "D" — which scan pass found it.
    - "related_priority": the 2026 priority this drags, or "none — orphan work".
    - "why_friction": the structural reason.
    - "evidence": specific quoted items from each cited system (card title/id, Azure work item id, meeting date, slack channel + summary).
    - "business_impact": which 2026 priority, customer, deal, or release this drags + by when.
    - "urgency": "red" | "yellow".
    - "next_action": single concrete unblocking move.
    - "suggested_owner": real name from team_directory.
    - "friction_score": integer 0-100.
    - "consequence": short restatement of business_impact.
    - "evidence_source": dominant non-email source ("workstream_card"|"meeting"|"coverage_gap"|"silent_leader"|"doc_conflict"|"azure"|"xero"|"calendar"|"slack").
    - "recommended_resolver": same as suggested_owner.
    - "auto_injected": false.
  CAP: maximum 5 items, sorted by friction_score DESC. An empty friction[] is a HONEST signal — do NOT pad.`;

const EVENING_SCHEMA_HINT = `Return STRICT JSON:
{
  "trajectory": "On Track"|"Slight Drift"|"At Risk"|"Off Track",
  "outcome_probability": number,
  "execution_score": number,
  "workstream_scores": [],
  "payload": {
    "got_done": string,
    "slipped": string,
    "new_risks": string,
    "ownership_gaps": string,
    "execution_rating": "Strong"|"Mixed"|"Weak",
    "execution_explanation": string,
    "tomorrow_priorities": [string, string, string]
  }
}`;

const SYSTEM_PROMPT = `You are Duncan, the internal operating system for Kabuni and the CEO's real-time executive intelligence layer.

You are NOT a summariser. You are NOT a passive assistant. You ARE a decision engine.

NON-NEGOTIABLE 2026 PRIORITIES (ground every analysis here):
1. Lightning Strike India — 7 June 2026
2. 1M Kabuni Premier League registrations
3. Trials October & November 2026
4. Final 10-team selection December (10 Super Coaches)
5. 100,000 pre-orders
6. Duncan automates 25% of the company

If activity does not move one of these, it is secondary unless it removes a major risk.

ORG MAP (enforce ownership):
Nimesh = CEO · Patrick = CFO · Ellaine = COO/CLO · Matt = CPO · Alex = CMO · Simon = Operations Director · Palash = Head of Duncan · Parmy = CTO

DECISION & ESCALATION LOGIC:
Strategic→CEO · Financial→CFO · Execution→COO · Product→CPO · Growth→CMO · Tech→CTO · Automation→Head of Duncan. Cross-functional issues → flag and escalate to CEO.

DATA RULES:
- Truth Over Narrative: data reality wins. Call out conflicts between team narrative and source data.
- Illusion Detection: name activity that masquerades as progress (meetings replacing decisions, momentum without conversion, output not moving the 6 priorities).
- Pattern Recognition: compare today vs prior briefing. Flag worsening or improving trends. Never treat each day in isolation.
- Pressure Rule: if drifting or at risk → increase urgency, make consequences explicit, never normalise underperformance.
- If data is weak → LOWER confidence and say so explicitly.
- WORKSTREAM INTEGRITY: only score workstreams that exist in available_workstreams. Never fabricate. If a 2026 priority has no workstream, surface it as a coverage_gap — that gap is itself the most important signal.
- RESPONSE DISCIPLINE: return compact, valid JSON only. Keep every prose field to 1-2 sentences. Prefer the shortest wording that preserves meaning.
- ARRAY BUDGETS: cap workstream_scores to the provided workstreams only; cap risks to 6, friction to 5, leadership to 8, decisions to 6, document_intelligence to 6, missing_artifacts_recommendations domains to 5 with max 2 artifacts each.

ANALYTICAL FRAMEWORK (apply to every workstream):
1. Progress vs company goals
2. Execution quality
3. Risk exposure
4. Commercial impact
5. Dependency strength
6. Cross-functional alignment

SCORING CONTRACT:
- Every workstream gets Progress (0-100), Confidence (0-100), Risk (0-100) + the 4 framework axes.
- Overall Company Execution Score (0-100).
- Justify every score with evidence from the source data (cite real card titles / work items / releases).
- Do not change a score without reason vs the previous briefing.

FINAL INSTRUCTION (the briefing must answer these three):
1. Are we on track?
2. What will break?
3. Where must I act?

Surface these answers in the "tldr" field at the top. If you cannot answer them clearly from the data provided, the briefing has failed.`;

// Strict 1:1 coverage detection.
// - Match ONLY against workstream names (project_tag + azure project_name), NOT card titles.
// - First-match-wins: a workstream can satisfy only ONE priority, then it's consumed.
// - Aliases are multi-word distinctive phrases (see PRIORITY_DEFINITIONS).
// ─── Knowledge Domains — what Duncan needs to give an honest verdict ───────
// Deterministic, server-side. No AI inference — cannot lie.
const KNOWLEDGE_DOMAINS = [
  {
    id: "operations",
    label: "Operations",
    critical: true,
    file_aliases: [],
    needs: "workstream cards, Azure DevOps work items, recent meetings",
    upload_hint: "Already covered by workstreams + Azure + meetings.",
    prefill_tag: "operations",
  },
  {
    id: "recruitment",
    label: "Recruitment",
    critical: false,
    file_aliases: [],
    needs: "Hireflix candidates + scoring",
    upload_hint: "Already covered by candidate pipeline.",
    prefill_tag: "recruitment",
  },
  {
    id: "finance_transactions",
    label: "Finance — Transactions",
    critical: true,
    file_aliases: [],
    needs: "Xero invoices + contacts",
    upload_hint: "Already covered by Xero — only transactional data, no plan.",
    prefill_tag: "finance",
  },
  {
    id: "finance_planning",
    label: "Finance — Planning",
    critical: true,
    file_aliases: ["finance plan", "financial plan", "budget", "forecast", "cash runway", "p&l", "pnl", "p and l"],
    needs: "Budget vs actual, cash runway, financial plan",
    upload_hint: "Upload to /projects: budget vs actual, cash runway model, 2026 financial plan. Without these Duncan cannot judge if June 7 is financially achievable.",
    prefill_tag: "finance-plan",
  },
  {
    id: "legal",
    label: "Legal & Compliance",
    critical: true,
    file_aliases: ["contract", "nda", "ip register", "ip ", "trademark", "compliance", "msa", "vendor agreement"],
    needs: "Contracts, NDAs, IP register",
    upload_hint: "Upload to /projects: signed Lightning Strike vendor contracts, active NDAs, IP register. Without these Duncan cannot warn you about expiring obligations or unsigned commitments.",
    prefill_tag: "legal",
  },
  {
    id: "technology_direction",
    label: "Technology direction",
    critical: true,
    file_aliases: ["architecture", "tech roadmap", "technology roadmap", "tech plan", "release readiness", "system design", "platform plan"],
    needs: "Architecture diagram, tech roadmap, release readiness",
    upload_hint: "Upload to /projects: architecture diagram, 2026 tech roadmap, release-readiness checklist. Without these Duncan can only see ticket motion, not whether the platform is heading the right way.",
    prefill_tag: "tech-direction",
  },
  {
    id: "product_strategy",
    label: "Product strategy",
    critical: false,
    file_aliases: ["prd", "product requirements", "product roadmap", "customer research", "user research", "discovery"],
    needs: "PRDs, product roadmap, customer research",
    upload_hint: "Upload to /projects: current PRDs, product roadmap, latest customer research. Without these Duncan can only judge product motion, not direction.",
    prefill_tag: "product",
  },
  {
    id: "investor_board",
    label: "Investor / Board",
    critical: false,
    file_aliases: ["board pack", "board update", "investor update", "investor deck", "kpi deck", "board minutes"],
    needs: "Board pack, investor updates, KPI deck",
    upload_hint: "Upload to /projects: latest board pack, recent investor update, current KPI deck. Without these Duncan cannot align internal status with the story being told externally.",
    prefill_tag: "board",
  },
] as const;

// ─── Operating-system checklist — what a Chief of Staff would expect to exist ─
// Per-domain baseline of artifacts the CEO would NOT naturally think to upload.
// Used by the AI to prescribe a shopping list, not just grade what's present.
const OPERATING_SYSTEM_CHECKLIST: Record<string, string[]> = {
  finance_planning: [
    "13-week rolling cash forecast", "Runway model (base/bull/bear)",
    "Unit economics by SKU/segment", "CAC / LTV trend report",
    "AR aging schedule", "12-month payroll forecast", "FX exposure snapshot",
  ],
  finance_transactions: [
    "Reconciled monthly P&L", "Bank-to-Xero reconciliation log",
    "Vendor concentration report (top 10 spend)",
  ],
  legal: [
    "Cap table (current)", "Shareholder agreement", "IP assignment register",
    "Employment contracts (signed)", "Supplier MSAs",
    "Active NDAs (signed register)", "Data Processing Agreements (DPAs)",
    "Regulatory licences (India launch)", "Insurance certificates (current)",
    "Lightning Strike vendor MoU (signed)",
  ],
  technology_direction: [
    "Architecture Decision Records (ADRs)", "Latest security audit",
    "Penetration test report (last 12mo)", "SLA register (uptime targets)",
    "Vendor risk register", "Incident post-mortems (last 90d)",
    "API contracts (external + internal)", "Infrastructure cost map (AWS/GCP)",
  ],
  product_strategy: [
    "Roadmap with dated milestones", "Customer-research synthesis (last quarter)",
    "Churn / retention analysis", "Feature-usage telemetry export",
    "NPS / CSAT report", "Live PRDs (current sprint)",
  ],
  investor_board: [
    "Latest board deck (final)", "Investor update emails (last 3)",
    "KPI dashboard snapshots (monthly)", "Capital strategy memo",
    "Term sheet (latest round)", "409A valuation (if US)",
    "Board minutes (last 2 meetings)",
  ],
  operations: [
    "Org chart with comp bands", "Succession plan (top 10 roles)",
    "Performance calibration grid", "Hiring plan vs actual",
    "Attrition log (rolling 12mo)", "Operations runbook",
  ],
  recruitment: [
    "Hiring funnel conversion report", "Interviewer scorecards",
    "Comp benchmarking data",
  ],
};

// ─── Leadership Roster — direct reports Duncan MUST assess every briefing ──
const LEADERSHIP_ROSTER: Array<{
  name: string;
  role: string;
  aliases: string[];
  owns_priorities?: string[];
}> = [
  { name: "Nimesh", role: "CEO", aliases: ["nimesh", "nimesh patel"], owns_priorities: ["lightning_strike"] },
  { name: "Patrick", role: "CFO", aliases: ["patrick", "patrick badenoch"], owns_priorities: ["preorders"] },
  { name: "Ellaine", role: "COO / General Counsel", aliases: ["ellaine"] },
  { name: "Matt", role: "CPO", aliases: ["matt"], owns_priorities: ["team_selection"] },
  { name: "Alex", role: "CMO", aliases: ["alex"], owns_priorities: ["kpl_registrations", "preorders"] },
  { name: "Simon", role: "Operations Director", aliases: ["simon", "simon wood"], owns_priorities: ["lightning_strike", "trials", "team_selection"] },
  { name: "Palash", role: "Head of Duncan", aliases: ["palash", "palash soundarkar"], owns_priorities: ["duncan_automation"] },
  { name: "Parmy", role: "CTO", aliases: ["parmy", "parmy virk"] },
];

// Per-leader signal tally — deterministic, server-authoritative.
// Sources: meetings, workstream cards, azure work items, releases, meeting transcripts,
// google calendar events (organiser/attendee), and gmail (sent counts from email pulse).
function computeLeaderSignalMap(input: {
  meetings: Array<{ title: string | null; participants?: string[] | null; summary: string | null; meeting_date: string | null }>;
  cards: Array<{ title: string | null; owner_id?: string | null }>;
  workItems: Array<{ title: string | null; assigned_to?: string | null }>;
  releases: Array<{ title: string | null; version: string | null; published_at: string | null }>;
  profiles: Array<{ display_name: string | null }>;
  transcripts?: Array<{ title: string | null; meeting_date: string | null; transcript: string | null }>;
  calendarEvents?: Array<{ summary: string | null; start: string | null; organiser_alias?: string | null; attendee_aliases?: string[] }>;
  emailPulsePerMailbox?: Array<{ mailbox: string | null; sent_count?: number; emails_scanned?: number }>;
}) {
  const norm = (s: string) => s.toLowerCase().trim();
  return LEADERSHIP_ROSTER.map((leader) => {
    const aliases = leader.aliases.map(norm);
    const matchAny = (h: string | null | undefined) => {
      if (!h) return false;
      const s = norm(String(h));
      return aliases.some((a) => s.includes(a));
    };

    const meetingHits = (input.meetings || []).filter((m) => {
      const partHit = Array.isArray(m.participants) && m.participants.some((p) => matchAny(p));
      return partHit || matchAny(m.summary) || matchAny(m.title);
    });
    const cardHits = (input.cards || []).filter((c) => {
      const ownerName = (input.profiles || []).find((p) => norm(String(p.display_name || "")) === norm(String(c.owner_id || "")))?.display_name;
      return matchAny(ownerName as string | null) || matchAny(c.title);
    });
    const azureHits = (input.workItems || []).filter((w) => matchAny(w.assigned_to) || matchAny(w.title));
    const releaseHits = (input.releases || []).filter((r) => matchAny(r.title));

    // NEW: transcripts — leader name appears anywhere in transcript text
    const transcriptHits = (input.transcripts || []).filter((t) => {
      if (!t.transcript) return false;
      const s = norm(String(t.transcript).slice(0, 8000));
      return aliases.some((a) => s.includes(a));
    });

    // NEW: calendar — events where leader is organiser or attendee, or name in summary
    const calendarHits = (input.calendarEvents || []).filter((e) => {
      if (e.organiser_alias && aliases.includes(norm(e.organiser_alias))) return true;
      if (Array.isArray(e.attendee_aliases) && e.attendee_aliases.some((a) => aliases.includes(norm(a)))) return true;
      return matchAny(e.summary);
    });

    // NEW: gmail — match by mailbox local-part / display matching alias
    const emailHits = (input.emailPulsePerMailbox || []).filter((m) => {
      if (!m.mailbox) return false;
      const local = norm(String(m.mailbox).split("@")[0] || "");
      return aliases.some((a) => local.includes(a.split(" ")[0])) && (m.sent_count ?? 0) > 0;
    });
    const totalSent = emailHits.reduce((acc, m) => acc + (m.sent_count ?? 0), 0);

    const sources: string[] = [];
    if (meetingHits.length) sources.push("meetings");
    if (cardHits.length) sources.push("workstreams");
    if (azureHits.length) sources.push("azure");
    if (releaseHits.length) sources.push("releases");
    if (calendarHits.length) sources.push("calendar");
    if (emailHits.length) sources.push("email");
    if (transcriptHits.length) sources.push("transcript");

    const executionSources = [
      cardHits.length ? 1 : 0,
      azureHits.length ? 1 : 0,
      releaseHits.length ? 1 : 0,
    ].reduce((a, b) => a + b, 0);

    // active = ≥3 total OR ≥2 execution; low_signal = 1-2 non-execution; silent = 0
    let signal_status: "active" | "low_signal" | "silent";
    if (sources.length === 0) signal_status = "silent";
    else if (sources.length >= 3 || executionSources >= 2) signal_status = "active";
    else signal_status = "low_signal";

    return {
      name: leader.name,
      role: leader.role,
      owns_priorities: leader.owns_priorities ?? [],
      signal_status,
      sources,
      counts: {
        meetings: meetingHits.length,
        workstreams: cardHits.length,
        azure: azureHits.length,
        releases: releaseHits.length,
        calendar: calendarHits.length,
        email: totalSent,
        transcript: transcriptHits.length,
      },
      sources_detail: {
        meetings: meetingHits.slice(0, 3).map((m) => ({ title: m.title, date: m.meeting_date })),
        workstreams: cardHits.slice(0, 3).map((c) => ({ title: c.title })),
        azure: azureHits.slice(0, 3).map((w) => ({ title: w.title })),
        releases: releaseHits.slice(0, 3).map((r) => ({ title: r.title, version: r.version })),
        calendar: calendarHits.slice(0, 5).map((e) => ({ summary: e.summary, start: e.start })),
        email: emailHits.slice(0, 5).map((m) => ({ mailbox: m.mailbox, sent_count: m.sent_count ?? 0 })),
        transcript: transcriptHits.slice(0, 3).map((t) => ({ title: t.title, date: t.meeting_date })),
      },
    };
  });
}

// ─── Cross-system signal inference — what evidence in OTHER systems implies a doc should exist ──
function inferArtifactSignals(input: {
  meetings: Array<{ title: string | null; meeting_date: string | null; summary: string | null }>;
  recentTranscripts: Array<{ title: string; meeting_date: string | null; transcript: string | null }>;
  xeroInvoices: Array<{ contact_name: string | null; total: number | null; date: string | null }>;
  workItems: Array<{ title: string | null; tags?: string | null }>;
  releases: Array<{ title: string | null; version: string | null; published_at: string | null }>;
}) {
  const signals: Array<{ inferred_artifact: string; domain: string; source: string; hint: string }> = [];
  const seen = new Set<string>();
  const push = (s: { inferred_artifact: string; domain: string; source: string; hint: string }) => {
    const k = `${s.domain}::${s.inferred_artifact}`;
    if (seen.has(k)) return;
    seen.add(k);
    signals.push(s);
  };

  // Meetings — keyword → artifact
  const meetingHaystack = [...input.meetings, ...input.recentTranscripts].map((m: any) => ({
    title: String(m.title || ""),
    date: m.meeting_date || null,
    text: `${m.title || ""} ${m.summary || ""} ${m.transcript ? String(m.transcript).slice(0, 4000) : ""}`.toLowerCase(),
  }));
  const meetingRules: Array<{ kw: string[]; domain: string; artifact: string }> = [
    { kw: ["india launch", "lightning strike", "vendor mou"], domain: "legal", artifact: "Signed Lightning Strike India vendor MoU" },
    { kw: ["board", "investor update", "investor call"], domain: "investor_board", artifact: "Latest board deck / investor update" },
    { kw: ["fundraise", "round", "term sheet"], domain: "investor_board", artifact: "Active term sheet + capital strategy memo" },
    { kw: ["security", "pentest", "pen test", "vulnerability"], domain: "technology_direction", artifact: "Penetration test report + remediation plan" },
    { kw: ["architecture", "platform redesign", "rearchitect"], domain: "technology_direction", artifact: "Architecture Decision Record (ADR)" },
    { kw: ["customer research", "user interview", "discovery call"], domain: "product_strategy", artifact: "Customer-research synthesis" },
    { kw: ["budget", "burn", "runway", "cash"], domain: "finance_planning", artifact: "13-week cash forecast + runway model" },
    { kw: ["nda", "non-disclosure"], domain: "legal", artifact: "Signed NDAs register" },
    { kw: ["hire", "headcount", "comp band"], domain: "operations", artifact: "Hiring plan vs actual + comp bands" },
  ];
  for (const m of meetingHaystack) {
    for (const r of meetingRules) {
      if (r.kw.some((k) => m.text.includes(k))) {
        push({
          inferred_artifact: r.artifact,
          domain: r.domain,
          source: `meeting:${m.title.slice(0, 60)}`,
          hint: `Mentioned in "${m.title.slice(0, 60)}"${m.date ? ` (${m.date.slice(0, 10)})` : ""} — likely with the participants of that meeting.`,
        });
      }
    }
  }

  // Xero — large/recurring vendor payments → vendor contracts should exist
  const vendorTotals = new Map<string, number>();
  for (const inv of input.xeroInvoices) {
    if (!inv.contact_name || typeof inv.total !== "number") continue;
    vendorTotals.set(inv.contact_name, (vendorTotals.get(inv.contact_name) || 0) + Math.abs(inv.total));
  }
  for (const [vendor, total] of vendorTotals.entries()) {
    if (total < 1000) continue;
    const lower = vendor.toLowerCase();
    if (/aws|amazon web|gcp|google cloud|azure/.test(lower)) {
      push({ inferred_artifact: `Infrastructure contract + cost map (${vendor})`, domain: "technology_direction", source: `xero:${vendor}`, hint: `Recurring spend with ${vendor} (~£${Math.round(total)} in window) — vendor contract should be on file.` });
    } else if (/lawyer|legal|solicitor/.test(lower)) {
      push({ inferred_artifact: `Legal engagement letter (${vendor})`, domain: "legal", source: `xero:${vendor}`, hint: `Active legal spend with ${vendor} — engagement letter should be uploaded.` });
    } else if (total > 10000) {
      push({ inferred_artifact: `Vendor MSA / contract (${vendor})`, domain: "legal", source: `xero:${vendor}`, hint: `Material spend with ${vendor} (~£${Math.round(total)}) — supplier MSA expected.` });
    }
  }

  // Azure work items — security/compliance tags
  for (const w of input.workItems) {
    const blob = `${w.title || ""} ${w.tags || ""}`.toLowerCase();
    if (/security|pentest|vuln|cve/.test(blob)) {
      push({ inferred_artifact: "Latest security audit + pen-test report", domain: "technology_direction", source: `azure:${(w.title || "").slice(0, 60)}`, hint: `Security work in flight — audit/pen-test artefacts should back this up.` });
    }
    if (/compliance|gdpr|dpa|iso/.test(blob)) {
      push({ inferred_artifact: "Compliance evidence pack (GDPR/DPA/ISO)", domain: "legal", source: `azure:${(w.title || "").slice(0, 60)}`, hint: `Compliance work in flight — DPAs and audit evidence should be uploaded.` });
    }
  }

  // Releases — customer-facing → research synthesis expected
  for (const r of input.releases) {
    if (r.title) {
      push({
        inferred_artifact: `Customer-research synthesis behind "${r.title}"`,
        domain: "product_strategy",
        source: `release:${r.version || r.title}`,
        hint: `Released "${r.title}"${r.published_at ? ` on ${r.published_at.slice(0, 10)}` : ""} — discovery research should justify it.`,
      });
    }
  }

  return signals.slice(0, 40);
}

type DomainStatus = "green" | "yellow" | "red";

// ─── Strategic Artifact Matrix ────────────────────────────────────────────
// What documents/feeds Duncan MUST see to give honest advice on each 2026
// priority within each knowledge domain. This is the DENOMINATOR for coverage —
// without it, "Green" only ever means "we have a heartbeat", not "we are ready".
// Critical domains are: operations, finance_planning, legal, technology_direction.
// Empty arrays = this priority does not require artifacts in this domain.
const STRATEGIC_ARTIFACT_MATRIX: Record<string, Record<string, string[]>> = {
  lightning_strike: {
    operations: ["India launch runbook", "On-ground ops plan", "Supply-chain readiness", "Event-day escalation matrix"],
    finance_planning: ["Launch P&L", "India landed-cost model", "FX hedge plan"],
    finance_transactions: ["India vendor payment register"],
    legal: ["India entity docs", "Lightning Strike vendor MoU", "Data-residency review", "Event insurance certificate", "India regulatory licences"],
    technology_direction: ["Launch-day infra capacity plan", "India CDN/edge plan", "Launch incident runbook"],
    product_strategy: ["Launch SKU spec", "Packaging artwork sign-off"],
    investor_board: ["Launch-readiness board memo"],
    recruitment: [],
  },
  kpl_registrations: {
    operations: ["Registration funnel ops plan", "Support staffing model"],
    finance_planning: ["CAC budget by channel", "Paid-media forecast"],
    finance_transactions: ["Marketing spend register"],
    legal: ["KPL terms & conditions", "Privacy policy (registrations)"],
    technology_direction: ["Registration platform load plan", "Anti-fraud / bot-mitigation plan"],
    product_strategy: ["Registration UX flow", "Conversion telemetry plan"],
    investor_board: ["KPL traction update memo"],
    recruitment: [],
  },
  trials: {
    operations: ["Trials operations plan (Oct/Nov)", "Trials venue logistics", "Trials staffing rota"],
    finance_planning: ["Trials cost model"],
    finance_transactions: [],
    legal: ["Trials participant waiver", "Venue insurance", "Safeguarding policy"],
    technology_direction: ["Trials scoring system spec"],
    product_strategy: ["Trials format & criteria document"],
    investor_board: [],
    recruitment: ["Trials judge / coach roster"],
  },
  team_selection: {
    operations: ["Selection-day runbook", "10 Super Coaches onboarding plan"],
    finance_planning: ["Coach compensation model"],
    finance_transactions: [],
    legal: ["Super Coach contracts (template)", "Image rights agreements"],
    technology_direction: ["Selection scoring & data pipeline"],
    product_strategy: ["Selection criteria framework", "Coach role definition"],
    investor_board: ["Selection outcomes board memo"],
    recruitment: ["Coach scouting pipeline"],
  },
  preorders: {
    operations: ["Pre-order fulfilment plan", "Logistics & 3PL readiness"],
    finance_planning: ["Pre-order revenue forecast", "Inventory funding plan"],
    finance_transactions: ["Pre-order payment processing setup"],
    legal: ["Pre-order T&Cs", "Refund policy", "Payment processor agreement"],
    technology_direction: ["E-commerce platform readiness", "Payment infra scaling plan"],
    product_strategy: ["Pre-order SKU & pricing matrix"],
    investor_board: ["100k pre-orders commercial memo"],
    recruitment: [],
  },
  duncan_automation: {
    operations: ["Automation roadmap (25%)", "Process inventory & automation candidates"],
    finance_planning: ["Automation ROI / opex savings model"],
    finance_transactions: [],
    legal: ["AI usage / data policy", "Automation vendor agreements"],
    technology_direction: ["Duncan architecture document", "Agent capability map", "AI safety & guardrails plan"],
    product_strategy: ["Automation product roadmap"],
    investor_board: ["Operating-leverage thesis update"],
    recruitment: [],
  },
};

// Normalise a string for fuzzy artifact matching.
const _normToken = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Does any of the supplied strings (file names, card titles, etc.) plausibly
// match the required artifact name? Token-overlap heuristic — must share at
// least 2 distinctive (length>=4) tokens, OR contain the full normalised name.
function _findArtifactMatch(required: string, hay: Array<{ source: string; text: string }>) {
  const reqNorm = _normToken(required);
  if (!reqNorm) return null;
  const reqTokens = reqNorm.split(" ").filter((t) => t.length >= 4);
  if (reqTokens.length === 0) {
    const hit = hay.find((h) => h.text.includes(reqNorm));
    return hit ? { source: hit.source, matched_text: hit.text.slice(0, 80) } : null;
  }
  // Strong: full-name substring
  const strong = hay.find((h) => h.text.includes(reqNorm));
  if (strong) return { source: strong.source, matched_text: strong.text.slice(0, 80) };
  // Weak: ≥2 distinctive tokens overlap
  for (const h of hay) {
    let overlap = 0;
    for (const t of reqTokens) if (h.text.includes(t)) overlap++;
    if (overlap >= 2 && overlap >= Math.ceil(reqTokens.length * 0.5)) {
      return { source: h.source, matched_text: h.text.slice(0, 80) };
    }
  }
  return null;
}

function computeDataCoverage(
  projectFiles: Array<{ file_name: string | null }>,
  meetings: Array<{ title: string | null }>,
  flags: {
    hasOperations: boolean;
    hasRecruitment: boolean;
    hasXero: boolean;
    hasReleases: boolean;
    hasAzureMilestones: boolean;
  },
  signalSources?: {
    cards: Array<{ title: string | null; project_tag?: string | null }>;
    workItems: Array<{ title: string | null; project_name?: string | null }>;
    xeroInvoices: Array<{ contact_name: string | null; invoice_number?: string | null }>;
  },
) {
  const haystack: string[] = [];
  for (const f of projectFiles) if (f?.file_name) haystack.push(String(f.file_name).toLowerCase());
  for (const m of meetings) if (m?.title) haystack.push(String(m.title).toLowerCase());

  // Build a richer haystack used by the strategic-artifact fuzzy matcher.
  // Each entry is tagged with its source so we can show "likely_supplied_as".
  const richHay: Array<{ source: string; text: string }> = [];
  for (const f of projectFiles) {
    if (f?.file_name) richHay.push({ source: `file:${f.file_name}`, text: _normToken(f.file_name) });
  }
  for (const m of meetings) {
    if (m?.title) richHay.push({ source: `meeting:${m.title}`, text: _normToken(m.title) });
  }
  if (signalSources) {
    for (const c of signalSources.cards || []) {
      const t = c.title || c.project_tag;
      if (t) richHay.push({ source: `card:${t}`, text: _normToken(t) });
    }
    for (const w of signalSources.workItems || []) {
      const t = w.title || w.project_name;
      if (t) richHay.push({ source: `azure:${t}`, text: _normToken(t) });
    }
    for (const inv of signalSources.xeroInvoices || []) {
      const t = inv.contact_name || inv.invoice_number;
      if (t) richHay.push({ source: `xero:${t}`, text: _normToken(t) });
    }
  }

  const matchAny = (aliases: readonly string[]) => {
    if (!aliases.length) return [];
    const hits: string[] = [];
    for (const a of aliases) {
      const al = a.toLowerCase();
      if (haystack.some((h) => h.includes(al))) hits.push(a);
    }
    return hits;
  };

  // ─── 1. Build per-priority × per-domain strategic coverage ─────────────
  type DomainArtifactRow = {
    domain: string;
    domain_label: string;
    required: string[];
    supplied: Array<{ name: string; likely_supplied_as: string; source: string }>;
    missing: string[];
  };
  type PriorityCoverage = {
    priority_id: string;
    priority_title: string;
    coverage_pct: number;
    status: DomainStatus;
    by_domain: DomainArtifactRow[];
    total_required: number;
    total_supplied: number;
  };
  const domainLabelById = new Map(KNOWLEDGE_DOMAINS.map((d) => [d.id, d.label]));
  const strategic_coverage: PriorityCoverage[] = PRIORITY_DEFINITIONS.map((p) => {
    const domainMap = STRATEGIC_ARTIFACT_MATRIX[p.id] || {};
    const by_domain: DomainArtifactRow[] = [];
    let totalReq = 0;
    let totalSup = 0;
    for (const d of KNOWLEDGE_DOMAINS) {
      const required = domainMap[d.id] || [];
      if (required.length === 0) continue;
      const supplied: DomainArtifactRow["supplied"] = [];
      const missing: string[] = [];
      for (const art of required) {
        const m = _findArtifactMatch(art, richHay);
        if (m) {
          supplied.push({ name: art, likely_supplied_as: m.matched_text, source: m.source });
        } else {
          missing.push(art);
        }
      }
      totalReq += required.length;
      totalSup += supplied.length;
      by_domain.push({
        domain: d.id,
        domain_label: d.label,
        required,
        supplied,
        missing,
      });
    }
    const pct = totalReq > 0 ? Math.round((totalSup / totalReq) * 100) : 0;
    let status: DomainStatus = "red";
    if (pct >= 70) status = "green";
    else if (pct >= 40) status = "yellow";
    return {
      priority_id: p.id,
      priority_title: p.title,
      coverage_pct: pct,
      status,
      by_domain,
      total_required: totalReq,
      total_supplied: totalSup,
    };
  });

  // ─── 2. Per-domain strategic rollup (denominator across all priorities) ─
  const CRITICAL_DOMAIN_IDS = new Set(["operations", "finance_planning", "legal", "technology_direction"]);
  const strategicByDomain = new Map<string, {
    required_total: number;
    supplied_total: number;
    blind_priorities: string[]; // priority titles with 0 supplied in this domain
    missing_artifacts: Set<string>;
  }>();
  for (const d of KNOWLEDGE_DOMAINS) {
    strategicByDomain.set(d.id, { required_total: 0, supplied_total: 0, blind_priorities: [], missing_artifacts: new Set() });
  }
  for (const pc of strategic_coverage) {
    for (const dr of pc.by_domain) {
      const agg = strategicByDomain.get(dr.domain);
      if (!agg) continue;
      agg.required_total += dr.required.length;
      agg.supplied_total += dr.supplied.length;
      for (const m of dr.missing) agg.missing_artifacts.add(m);
      if (dr.required.length > 0 && dr.supplied.length === 0) {
        agg.blind_priorities.push(pc.priority_title);
      }
    }
  }

  // ─── 3. Per-domain status — strategic coverage drives it, with critical floor ─
  const domains = KNOWLEDGE_DOMAINS.map((d) => {
    const agg = strategicByDomain.get(d.id)!;
    const pct = agg.required_total > 0 ? Math.round((agg.supplied_total / agg.required_total) * 100) : 0;
    let status: DomainStatus;
    if (agg.required_total === 0) {
      // No strategic artifacts mapped — fall back to old heartbeat logic.
      const matchedAliases = matchAny(d.file_aliases);
      if (d.id === "recruitment") {
        status = flags.hasRecruitment ? "green" : "red";
      } else if (d.id === "finance_transactions") {
        status = flags.hasXero ? "green" : "red";
      } else if (matchedAliases.length >= 2) status = "green";
      else if (matchedAliases.length >= 1) status = "yellow";
      else status = "red";
    } else {
      if (pct >= 70) status = "green";
      else if (pct >= 40) status = "yellow";
      else status = "red";
      // Critical-priority floor: if any priority has 0 artifacts in a critical
      // domain, force RED — strategic blind spot regardless of overall %.
      if (CRITICAL_DOMAIN_IDS.has(d.id) && agg.blind_priorities.length > 0) {
        status = "red";
      }
    }

    // Live-signal chip (heartbeat) — rendered separately, no longer drives status.
    let live_signal: "active" | "quiet" = "quiet";
    if (d.id === "operations") live_signal = flags.hasOperations ? "active" : "quiet";
    else if (d.id === "recruitment") live_signal = flags.hasRecruitment ? "active" : "quiet";
    else if (d.id === "finance_transactions") live_signal = flags.hasXero ? "active" : "quiet";
    else if (d.id === "technology_direction") live_signal = (flags.hasReleases || flags.hasAzureMilestones) ? "active" : "quiet";
    else live_signal = matchAny(d.file_aliases).length > 0 ? "active" : "quiet";

    const matched = matchAny(d.file_aliases);
    const evidenceParts: string[] = [];
    if (agg.required_total > 0) {
      evidenceParts.push(`${agg.supplied_total} / ${agg.required_total} strategic artifacts (${pct}%).`);
      if (agg.blind_priorities.length > 0) {
        evidenceParts.push(`Blind for: ${agg.blind_priorities.slice(0, 3).join(", ")}.`);
      }
    }
    if (matched.length > 0) evidenceParts.push(`File aliases matched: ${matched.slice(0, 2).join(", ")}.`);
    if (evidenceParts.length === 0) evidenceParts.push(`No strategic artifacts mapped — ${d.needs.toLowerCase()}.`);

    return {
      id: d.id,
      label: d.label,
      status,
      critical: d.critical,
      needs: d.needs,
      evidence: evidenceParts.join(" "),
      matched_signals: matched,
      recommendation: status === "green" ? null : d.upload_hint,
      prefill_tag: d.prefill_tag,
      // New strategic + heartbeat fields
      strategic_required: agg.required_total,
      strategic_supplied: agg.supplied_total,
      strategic_pct: pct,
      blind_priorities: agg.blind_priorities,
      missing_artifacts: Array.from(agg.missing_artifacts).slice(0, 12),
      live_signal,
    };
  });

  const reds = domains.filter((d) => d.status === "red");
  const yellows = domains.filter((d) => d.status === "yellow");
  const criticalReds = reds.filter((d) => d.critical);
  const finPlanRed = reds.some((d) => d.id === "finance_planning");
  const techDirRed = reds.some((d) => d.id === "technology_direction");

  // ─── 4. Confidence cap — strategic-coverage average + red-count floor ───
  const overall_strategic_pct = strategic_coverage.length > 0
    ? Math.round(strategic_coverage.reduce((s, p) => s + p.coverage_pct, 0) / strategic_coverage.length)
    : 0;
  let strategicCap: "high" | "medium" | "low" = "high";
  if (overall_strategic_pct < 40) strategicCap = "low";
  else if (overall_strategic_pct < 70) strategicCap = "medium";

  let redCap: "high" | "medium" | "low" = "high";
  let redCapReason = "All critical knowledge domains have at least partial coverage.";
  if (reds.length >= 3 || (finPlanRed && techDirRed)) {
    redCap = "low";
    redCapReason = `${reds.length} domain${reds.length === 1 ? "" : "s"} are missing entirely${finPlanRed && techDirRed ? " (including both Finance Planning and Technology Direction)" : ""}.`;
  } else if (criticalReds.length >= 1) {
    redCap = "medium";
    redCapReason = `${criticalReds.length} critical domain${criticalReds.length === 1 ? "" : "s"} (${criticalReds.map((d) => d.label).join(", ")}) are below threshold.`;
  }

  // Whichever is stricter wins.
  const capRank = { high: 0, medium: 1, low: 2 } as const;
  const confidence_cap = capRank[strategicCap] >= capRank[redCap] ? strategicCap : redCap;
  const cap_reason = confidence_cap === strategicCap && strategicCap !== "high"
    ? `Strategic artifact coverage is only ${overall_strategic_pct}% across the 6 priorities. ${redCapReason}`
    : `${redCapReason} Strategic coverage average: ${overall_strategic_pct}%.`;

  const worstRed = criticalReds[0] || reds[0] || null;

  return {
    domains,
    counts: { red: reds.length, yellow: yellows.length, green: domains.length - reds.length - yellows.length, total: domains.length },
    confidence_cap,
    cap_reason,
    worst_red_domain: worstRed ? { id: worstRed.id, label: worstRed.label, recommendation: worstRed.recommendation } : null,
    critical_reds: criticalReds.map((d) => ({ id: d.id, label: d.label, recommendation: d.recommendation })),
    strategic_coverage,
    overall_strategic_pct,
  };
}

function detectCoverage(
  priorities: typeof PRIORITY_DEFINITIONS,
  workstreams: string[],
  _cardTitles: string[], // intentionally ignored — too noisy
) {
  const claimed = new Set<string>();
  const wsLower = workstreams.map((w) => ({ orig: w, low: (w || "").toLowerCase() }));
  return priorities.map((p) => {
    let matched: string | null = null;
    for (const alias of p.aliases) {
      const a = alias.toLowerCase();
      const found = wsLower.find((w) => !claimed.has(w.orig) && w.low.includes(a));
      if (found) {
        matched = found.orig;
        claimed.add(found.orig);
        break;
      }
    }
    return {
      priority_id: p.id,
      priority: p.title,
      status: matched ? ("covered" as const) : ("missing" as const),
      matched_workstream: matched,
      why_it_matters: p.why_it_matters,
      expected_owner: p.expected_owner,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);

    const email = (claimsData.claims.email as string | undefined)?.toLowerCase() ?? "";
    const userId = claimsData.claims.sub as string;

    let allowed = CEO_GENERATOR_EMAILS.includes(email);
    if (!allowed) {
      // Fallback: allow any user with the 'admin' role.
      const adminCheck = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: roleRow } = await adminCheck
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();
      allowed = !!roleRow;
    }
    if (!allowed) return json({ error: "Forbidden — only the CEO or admins can generate briefings" }, 403);
    const body = await req.json().catch(() => ({}));
    const briefing_type: "morning" | "evening" = body?.briefing_type === "evening" ? "evening" : "morning";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── Hybrid async: create a job row, then run the heavy pipeline in the
    // background. Return immediately so the client can poll ceo-briefing-status.

    // Sweep stale in-flight jobs for this user (>5 min, non-terminal). The worker
    // can die silently on a runtime crash; without this they sit "synthesising"
    // forever and the next /generate appears to hang at the same percentage.
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await admin
      .from("ceo_briefing_jobs")
      .update({ status: "failed", error: "Worker timed out (>5min, no completion)", phase: "Failed" })
      .eq("user_id", userId)
      .in("status", ["queued", "gathering", "synthesising"])
      .lt("updated_at", staleCutoff);

    const { data: jobRow, error: jobErr } = await admin
      .from("ceo_briefing_jobs")
      .insert({
        user_id: userId,
        briefing_type,
        status: "queued",
        progress: 0,
        phase: "Queued",
      })
      .select("id")
      .single();

    if (jobErr || !jobRow) {
      console.error("Failed to create briefing job:", jobErr);
      return json({ error: "Failed to create briefing job", details: jobErr?.message }, 500);
    }
    const jobId = jobRow.id as string;
    let heartbeatStatus = "queued";
    let heartbeatPhase = "Queued";
    let heartbeatProgress = 0;
    const heartbeatTimer = setInterval(async () => {
      try {
        await admin
          .from("ceo_briefing_jobs")
          .update({
            status: heartbeatStatus,
            phase: heartbeatPhase,
            progress: heartbeatProgress,
          })
          .eq("id", jobId)
          .in("status", ["queued", "gathering", "synthesising"]);
      } catch (e: any) {
        console.error("briefing heartbeat failed:", e);
      }
    }, 25_000);

    const updateJob = async (patch: Record<string, unknown>) => {
      if (typeof patch.status === "string") heartbeatStatus = patch.status;
      if (typeof patch.phase === "string") heartbeatPhase = patch.phase;
      if (typeof patch.progress === "number") heartbeatProgress = patch.progress;
      try {
        await admin.from("ceo_briefing_jobs").update(patch).eq("id", jobId);
      } catch (e: any) {
        console.error("updateJob failed:", e);
      }
    };

    const runWorker = async () => {
      try {
        await updateJob({ status: "gathering", phase: "Gathering data", progress: 10 });

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const safe = async <T>(p: Promise<{ data: T | null; error: any }>): Promise<T[]> => {
      try { const r = await p; return (r?.data as any) ?? []; } catch { return []; }
    };

    const [
      meetings, cards, activity, workItems, releases,
      candidates, pos, issues, syncLogs, profiles, prev,
      slackLogs, tokenUsage, xeroInvoices, xeroContacts, auditLogs,
      // Canonical workstream sources (full sets, not just 24h)
      allCards, allWorkItems,
      // Recent transcripts for implicit-coverage scanning (last 10, any date)
      recentTranscripts,
      // Data Coverage Audit inputs
      projectFiles, allMeetingTitles,
    ] = await Promise.all([
      safe(admin.from("meetings").select("title,meeting_date,summary,action_items,participants").gte("meeting_date", since).limit(20)),
      safe(admin.from("workstream_cards").select("title,status,priority,project_tag,owner_id,due_date,updated_at").gte("updated_at", since).limit(50)),
      safe(admin.from("workstream_activity").select("action,details,created_at,card_id").gte("created_at", since).limit(100)),
      safe(admin.from("azure_work_items").select("title,state,assigned_to,project_name,changed_date,priority").gte("changed_date", since).limit(50)),
      safe(admin.from("releases").select("version,title,summary,status,created_at,published_at").order("created_at", { ascending: false }).limit(5)),
      safe(admin.from("candidates").select("name,status,total_score,job_role_id,updated_at").gte("updated_at", since).limit(30)),
      safe(admin.from("purchase_orders").select("po_number,vendor_name,total_amount,status,category,created_at").gte("created_at", since).limit(20)),
      safe(admin.from("issues").select("title,severity,issue_type,created_at").gte("created_at", since).limit(20)),
      safe(admin.from("sync_logs").select("integration,status,sync_type,started_at,error_message").gte("started_at", since).limit(30)),
      safe(admin.from("profiles").select("user_id,display_name,role_title,department")),
      safe(admin.from("ceo_briefings").select("briefing_date,outcome_probability,execution_score,trajectory")
        .eq("briefing_type", briefing_type).order("briefing_date", { ascending: false }).limit(1)),
      safe(admin.from("slack_notification_logs").select("event_key,status,sent_at,payload").gte("created_at", since).limit(40)),
      safe(admin.from("token_usage").select("user_id,total_tokens,prompt_tokens,completion_tokens,request_count,usage_date").gte("usage_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).limit(5000)),
      safe(admin.from("xero_invoices").select("invoice_number,contact_name,total,amount_due,amount_paid,status,type,due_date,date").gte("synced_at", since).order("date", { ascending: false }).limit(40)),
      safe(admin.from("xero_contacts").select("name,outstanding_balance,overdue_balance").gt("overdue_balance", 0).order("overdue_balance", { ascending: false }).limit(15)),
      safe(admin.from("integration_audit_logs").select("integration,action,details,created_at").gte("created_at", since).limit(40)),
      safe(admin.from("workstream_cards").select("title,project_tag,status,owner_id,due_date,updated_at,archived_at").is("archived_at", null).limit(500)),
      safe(admin.from("azure_work_items").select("title,project_name,assigned_to").limit(500)),
      safe(admin.from("meetings").select("title,meeting_date,transcript").not("transcript", "is", null).order("meeting_date", { ascending: false }).limit(10)),
      safe(admin.from("project_files").select("id,file_name,created_at,extracted_text").order("created_at", { ascending: false }).limit(1000)),
      safe(admin.from("meetings").select("title").order("meeting_date", { ascending: false }).limit(200)),
    ]);

    // ─── Scan recent meeting transcripts for priority signals ─────
    // Detects implicit coverage — work happening on a 2026 priority WITHOUT a workstream.
    function scanTranscriptsForPriorities(
      transcripts: Array<{ title: string; meeting_date: string | null; transcript: string | null }>,
    ) {
      const PER_TRANSCRIPT_CAP = 6000;
      const SNIPPET_RADIUS = 200;
      return PRIORITY_DEFINITIONS.map((p) => {
        const mentions: Array<{ meeting_title: string; meeting_date: string | null; snippet: string; alias_matched: string }> = [];
        for (const m of transcripts) {
          if (!m.transcript) continue;
          const text = m.transcript.slice(0, PER_TRANSCRIPT_CAP);
          const lower = text.toLowerCase();
          for (const alias of p.aliases) {
            const idx = lower.indexOf(alias.toLowerCase());
            if (idx >= 0) {
              const start = Math.max(0, idx - SNIPPET_RADIUS);
              const end = Math.min(text.length, idx + alias.length + SNIPPET_RADIUS);
              mentions.push({
                meeting_title: m.title,
                meeting_date: m.meeting_date,
                snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
                alias_matched: alias,
              });
              break; // one snippet per priority per meeting
            }
          }
          if (mentions.length >= 5) break; // cap mentions per priority
        }
        return { priority_id: p.id, priority_title: p.title, mentions };
      }).filter((s) => s.mentions.length > 0);
    }

    const meeting_priority_signals = scanTranscriptsForPriorities(recentTranscripts as any[]);

    // ─── Cross-system inferred-artifact signals (Chief-of-Staff reasoning) ─
    const inferred_artifact_signals = inferArtifactSignals({
      meetings: meetings as any[],
      recentTranscripts: recentTranscripts as any[],
      xeroInvoices: xeroInvoices as any[],
      workItems: workItems as any[],
      releases: releases as any[],
    });

    await updateJob({ phase: "Scanning email and slack signals", progress: 35 });

    // ─── Company-wide email + slack pulse (last 24h) ────
    let email_pulse: any = null;
    let slack_pulse: any = null;
    let hubspot_signal: any = null;
    let azure_repos_signal: any = null;
    let slack_pulse_error: string | null = null;
    let email_pulse_error: string | null = null;
    let hubspot_signal_error: string | null = null;
    let azure_repos_signal_error: string | null = null;
    try {
      const [epRes, spRes, hubspotRes, azureReposRes] = await Promise.all([
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ceo-email-pulse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({}),
        }).catch((e) => { console.warn("ceo-email-pulse fetch failed:", e); email_pulse_error = `fetch failed: ${e?.message || e}`; return null; }),
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ceo-slack-pulse`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({}),
        }).catch((e) => { console.warn("ceo-slack-pulse fetch failed:", e); slack_pulse_error = `fetch failed: ${e?.message || e}`; return null; }),
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hubspot-api`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: "team_briefing_summary" }),
        }).catch((e) => { console.warn("hubspot-api fetch failed:", e); hubspot_signal_error = `fetch failed: ${e?.message || e}`; return null; }),
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/azure-repos-api`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({ action: "briefing_summary" }),
        }).catch((e) => { console.warn("azure-repos-api fetch failed:", e); azure_repos_signal_error = `fetch failed: ${e?.message || e}`; return null; }),
      ]);
      if (epRes && epRes.ok) {
        email_pulse = await epRes.json();
        if (email_pulse?.ok === false) email_pulse_error = email_pulse?.error || "email pulse returned ok=false";
      } else if (epRes) {
        email_pulse_error = `HTTP ${epRes.status}`;
        console.warn("ceo-email-pulse non-200:", epRes.status);
      }
      if (spRes && spRes.ok) {
        slack_pulse = await spRes.json();
        if (slack_pulse?.ok === false) slack_pulse_error = slack_pulse?.error || "slack pulse returned ok=false";
      } else if (spRes) {
        slack_pulse_error = `HTTP ${spRes.status}`;
        console.warn("ceo-slack-pulse non-200:", spRes.status);
      }
      if (hubspotRes && hubspotRes.ok) {
        hubspot_signal = await hubspotRes.json();
        if (hubspot_signal?.ok === false) hubspot_signal_error = hubspot_signal?.error || "hubspot returned ok=false";
      } else if (hubspotRes) {
        hubspot_signal_error = `HTTP ${hubspotRes.status}`;
        console.warn("hubspot-api non-200:", hubspotRes.status);
      }
      if (azureReposRes && azureReposRes.ok) {
        azure_repos_signal = await azureReposRes.json();
        if (azure_repos_signal?.ok === false) azure_repos_signal_error = azure_repos_signal?.error || "azure-repos returned ok=false";
      } else if (azureReposRes) {
        azure_repos_signal_error = `HTTP ${azureReposRes.status}`;
        console.warn("azure-repos-api non-200:", azureReposRes.status);
      }
    } catch (e: any) {
      console.warn("comms pulse invoke failed:", e);
      if (!slack_pulse_error) slack_pulse_error = `invoke failed: ${e?.message || e}`;
      if (!email_pulse_error) email_pulse_error = `invoke failed: ${e?.message || e}`;
      if (!hubspot_signal_error) hubspot_signal_error = `invoke failed: ${e?.message || e}`;
      if (!azure_repos_signal_error) azure_repos_signal_error = `invoke failed: ${e?.message || e}`;
    }
    const normalizeExternalSignal = (
      signal: any,
      fallbackError: string | null,
      defaults: Record<string, number>,
      metricsSummary: (source: any) => string,
    ) => {
      const status = signal?.status ?? (fallbackError ? "degraded" : "not_configured");
      const lastSyncAt = signal?.last_sync_at ?? signal?.last_verified_at ?? signal?.last_sync ?? null;
      const errorMessage = signal?.error_message ?? signal?.degraded_reason ?? fallbackError ?? null;
      return {
        status,
        connected: signal?.connected ?? false,
        credential_source: signal?.credential_source ?? (status === "not_configured" ? "none" : null),
        verification_path: signal?.verification_path ?? null,
        last_sync_at: lastSyncAt,
        last_verified_at: signal?.last_verified_at ?? lastSyncAt,
        error_code: signal?.error_code ?? (fallbackError ? "briefing_fetch_failed" : status === "not_configured" ? "not_configured" : null),
        error_message: errorMessage,
        degraded_reason: errorMessage,
        metrics_summary: signal?.metrics_summary ?? metricsSummary(signal),
        signals: signal?.signals ?? [],
        summary: signal?.summary ?? null,
        ...defaults,
        ...Object.fromEntries(Object.keys(defaults).map((key) => [key, signal?.[key] ?? defaults[key]])),
      };
    };
    const normalizedHubspotSignal = normalizeExternalSignal(
      hubspot_signal,
      hubspot_signal_error,
      {
        accounts_scanned: 0,
        stale_deals: 0,
        at_risk_accounts: 0,
        customer_escalations: 0,
        active_deals_count: 0,
        at_risk_accounts_count: 0,
        active_deals: [],
        at_risk_accounts_details: [],
        key_contacts: [],
      },
      (source) => `${Number(source?.active_deals_count ?? 0)} active deals · ${Number(source?.at_risk_accounts_count ?? source?.at_risk_accounts ?? 0)} at-risk accounts · ${Array.isArray(source?.key_contacts) ? source.key_contacts.length : 0} key contacts`,
    );
    const normalizedAzureReposSignal = normalizeExternalSignal(
      azure_repos_signal,
      azure_repos_signal_error,
      {
        repos_scanned: 0,
        open_prs: 0,
        blocked_prs: 0,
        stale_prs: 0,
        release_risks: 0,
        commits_7d: 0,
        files_added_7d: 0,
        files_removed_7d: 0,
        active_contributors_7d: 0,
      },
      (source) => `${Number(source?.open_prs ?? 0)} open PRs · ${Number(source?.blocked_prs ?? 0)} blocked · ${Number(source?.stale_prs ?? 0)} stale across ${Number(source?.repos_scanned ?? 0)} repos · ${Number(source?.commits_7d ?? 0)} commits / ${Number(source?.active_contributors_7d ?? 0)} contributors (7d)`,
    );
    console.log(`[ceo-briefing] email_pulse: ${email_pulse ? 'ok' : 'null'} (err=${email_pulse_error}); slack_pulse: ${slack_pulse ? 'ok' : 'null'} (err=${slack_pulse_error}); hubspot: ${normalizedHubspotSignal.status} (err=${normalizedHubspotSignal.degraded_reason}); azure_repos: ${normalizedAzureReposSignal.status} (err=${normalizedAzureReposSignal.degraded_reason})`);

    // ─── Calendar events for leaders (last 7d) — best-effort, opt-in via google_calendar_tokens ─
    let leaderCalendarEvents: Array<{ summary: string | null; start: string | null; organiser_alias?: string | null; attendee_aliases?: string[] }> = [];
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: calTokenRows } = await admin
        .from("google_calendar_tokens")
        .select("user_id, access_token, refresh_token, token_expiry");
      const calOwnerProfiles = await admin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", (calTokenRows || []).map((t: any) => t.user_id).filter(Boolean) as string[]);
      const userIdToName = new Map<string, string>(
        ((calOwnerProfiles.data as any[]) || []).map((p) => [p.user_id, String(p.display_name || "")]),
      );
      for (const tok of (calTokenRows as any[]) || []) {
        const ownerName = userIdToName.get(tok.user_id) || "";
        if (!ownerName) continue;
        // refresh if needed
        let accessToken = tok.access_token;
        if (new Date(tok.token_expiry) <= new Date()) {
          try {
            const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || "",
                client_secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || "",
                refresh_token: tok.refresh_token,
                grant_type: "refresh_token",
              }),
            });
            if (refreshRes.ok) {
              const newTok = await refreshRes.json();
              accessToken = newTok.access_token;
            } else continue;
          } catch { continue; }
        }
        try {
          const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
          url.searchParams.set("timeMin", sevenDaysAgo);
          url.searchParams.set("timeMax", new Date().toISOString());
          url.searchParams.set("singleEvents", "true");
          url.searchParams.set("orderBy", "startTime");
          url.searchParams.set("maxResults", "100");
          const evRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!evRes.ok) continue;
          const evJson = await evRes.json();
          for (const ev of (evJson.items || [])) {
            const attendeeAliases = (ev.attendees || [])
              .map((a: any) => String(a.displayName || a.email || "").split("@")[0])
              .filter(Boolean);
            leaderCalendarEvents.push({
              summary: ev.summary || null,
              start: ev.start?.dateTime || ev.start?.date || null,
              organiser_alias: ev.organizer?.displayName || ev.organizer?.email?.split("@")[0] || ownerName,
              attendee_aliases: [ownerName, ...attendeeAliases],
            });
          }
        } catch { /* ignore single-leader cal failure */ }
      }
    } catch (e: any) {
      console.warn("leader calendar fetch failed:", e);
    }

    // ─── Leadership signal map (deterministic, per-leader tally) ───
    const leader_signal_map = computeLeaderSignalMap({
      meetings: meetings as any[],
      cards: cards as any[],
      workItems: workItems as any[],
      releases: releases as any[],
      profiles: profiles as any[],
      transcripts: recentTranscripts as any[],
      calendarEvents: leaderCalendarEvents,
      emailPulsePerMailbox: (email_pulse?.per_mailbox as any[]) || [],
    });


    const data_coverage_audit = computeDataCoverage(
      (projectFiles as any[]) || [],
      (allMeetingTitles as any[]) || [],
      {
        hasOperations: ((cards as any[]).length + (workItems as any[]).length + (meetings as any[]).length) > 0,
        hasRecruitment: (candidates as any[]).length > 0,
        hasXero: ((xeroInvoices as any[]).length + (xeroContacts as any[]).length) > 0,
        hasReleases: (releases as any[]).length > 0,
        hasAzureMilestones: (workItems as any[]).some((w: any) => /milestone|release/i.test(String(w.title || ""))),
      },
      {
        cards: (allCards as any[]) || [],
        workItems: (allWorkItems as any[]) || [],
        xeroInvoices: (xeroInvoices as any[]) || [],
      },
    );

    // ─── Domain File Review — actually READ uploaded docs (not just names) ─
    type DomainFileReview = {
      domain_id: string;
      domain_label: string;
      files_inspected: Array<{ name: string; last_updated: string | null; chunks_read: number; byte_size: number }>;
      content_excerpt: string;
    };
    const domain_file_review: DomainFileReview[] = [];
    const allFiles = (projectFiles as any[]) || [];
    const PER_FILE_CHAR_CAP = 2500;
    const PER_DOMAIN_CHAR_CAP = 2500;
    const TOTAL_CHAR_CAP = 10000;
    let totalChars = 0;

    for (const d of KNOWLEDGE_DOMAINS) {
      if (!d.file_aliases.length) continue;
      if (totalChars >= TOTAL_CHAR_CAP) break;
      const aliases = d.file_aliases.map((a) => a.toLowerCase());
      const matchedFiles = allFiles
        .filter((f: any) => f?.file_name && aliases.some((a) => String(f.file_name).toLowerCase().includes(a)))
        .slice(0, 2);
      if (matchedFiles.length === 0) continue;

      const inspected: DomainFileReview["files_inspected"] = [];
      const excerptParts: string[] = [];
      let domainChars = 0;

      for (const f of matchedFiles) {
        if (domainChars >= PER_DOMAIN_CHAR_CAP || totalChars >= TOTAL_CHAR_CAP) break;
        let chunkText = "";
        let chunksRead = 0;
        try {
          const { data: chunks } = await admin
            .from("project_file_chunks")
            .select("content,chunk_index")
            .eq("file_id", f.id)
            .order("chunk_index", { ascending: true })
            .limit(3);
          if (chunks && chunks.length > 0) {
            chunkText = chunks.map((c: any) => c.content || "").filter(Boolean).join("\n\n").slice(0, PER_FILE_CHAR_CAP);
            chunksRead = chunks.length;
          }
        } catch { /* ignore */ }
        if (!chunkText && typeof f.extracted_text === "string") {
          chunkText = f.extracted_text.slice(0, PER_FILE_CHAR_CAP);
          chunksRead = chunkText ? 1 : 0;
        }
        if (!chunkText) continue;

        const remaining = Math.min(PER_DOMAIN_CHAR_CAP - domainChars, TOTAL_CHAR_CAP - totalChars);
        const slice = chunkText.slice(0, remaining);
        excerptParts.push(`[${f.file_name}]\n${slice}`);
        inspected.push({
          name: f.file_name,
          last_updated: f.created_at ?? null,
          chunks_read: chunksRead,
          byte_size: slice.length,
        });
        domainChars += slice.length;
        totalChars += slice.length;
      }

      if (inspected.length > 0) {
        domain_file_review.push({
          domain_id: d.id,
          domain_label: d.label,
          files_inspected: inspected,
          content_excerpt: excerptParts.join("\n\n---\n\n"),
        });
      }
    }

    // ─── Canonical workstream list ────────────────────────────────
    const projectTags = Array.from(
      new Set((allCards as any[]).map((c) => c.project_tag).filter((t): t is string => !!t && t.trim().length > 0))
    );
    const azureProjects = Array.from(
      new Set((allWorkItems as any[]).map((w) => w.project_name).filter((p): p is string => !!p && p.trim().length > 0))
    );
    const available_workstreams = Array.from(new Set([...projectTags, ...azureProjects])).sort();

    // ─── Server-authoritative workstream baseline ─────────────────
    // Per-workstream RAG, progress, confidence, risk derived from raw card data.
    // The model MUST anchor workstream_scores to these numbers; the post-processor
    // overwrites rag and backfills missing rows from this structure.
    const _nowMs = Date.now();
    const _normTag = (s: string) => String(s || "").trim().toLowerCase();
    const workstream_baseline = available_workstreams.map((tag) => {
      const cardsForTag = (allCards as any[]).filter((c) => _normTag(c.project_tag) === _normTag(tag));
      const card_count = cardsForTag.length;
      let red_count = 0, amber_count = 0, green_count = 0, done_count = 0, overdue_count = 0;
      let mostRecentMs = 0;
      for (const c of cardsForTag) {
        const status = String(c.status || "").toLowerCase();
        if (status === "red") red_count++;
        else if (status === "yellow" || status === "amber") amber_count++;
        else if (status === "green") green_count++;
        else if (status === "done" || status === "completed") done_count++;
        const upd = c.updated_at ? new Date(c.updated_at).getTime() : 0;
        if (upd > mostRecentMs) mostRecentMs = upd;
        if (c.due_date && status !== "done" && status !== "completed") {
          const due = new Date(c.due_date).getTime();
          if (!isNaN(due) && due < _nowMs) overdue_count++;
        }
      }
      const days_since_last_activity = mostRecentMs
        ? Math.floor((_nowMs - mostRecentMs) / 86400000)
        : 999;
      let derived_rag: "red" | "amber" | "green" | "silent";
      if (card_count === 0) derived_rag = "silent";
      else if (red_count > 0 || overdue_count > 0 || days_since_last_activity > 14) derived_rag = "red";
      else if (amber_count > 0 || days_since_last_activity > 7) derived_rag = "amber";
      else derived_rag = "green";
      const baseline_progress = Math.round(100 * done_count / Math.max(card_count, 1));
      const baseline_confidence = Math.max(10, Math.min(90, 100 - days_since_last_activity * 5));
      const baseline_risk = Math.min(100, red_count * 30 + amber_count * 15 + Math.min(overdue_count * 10, 40));
      const card_status_summary = card_count === 0
        ? "0 cards · silent"
        : `${card_count} card${card_count === 1 ? "" : "s"} · ${red_count} red / ${amber_count} amber / ${green_count} green${done_count ? ` / ${done_count} done` : ""}${overdue_count ? ` · ${overdue_count} overdue` : ""}`;
      return {
        name: tag,
        card_count, red_count, amber_count, green_count, done_count, overdue_count,
        days_since_last_activity,
        derived_rag,
        baseline_progress,
        baseline_confidence,
        baseline_risk,
        card_status_summary,
      };
    });

    // ─── Filter to ACTIVE workstreams only ────────────────────────
    // Drop tags with zero cards UNLESS they exist as an Azure DevOps project
    // (Azure projects are tracked separately and may legitimately be empty in workstream_cards).
    const azureProjectsLc = new Set(azureProjects.map((p) => p.toLowerCase()));
    const activeBaseline = workstream_baseline.filter(
      (b) => b.card_count > 0 || azureProjectsLc.has(b.name.toLowerCase())
    );
    const activeNamesLc = new Set(activeBaseline.map((b) => b.name.toLowerCase()));
    // Reassign so all downstream code (LLM prompt, overwrite block, payload) uses the filtered set.
    (workstream_baseline as any).length = 0;
    (workstream_baseline as any).push(...activeBaseline);
    const _filteredAvailable = available_workstreams.filter((w) => activeNamesLc.has(w.toLowerCase()));
    (available_workstreams as any).length = 0;
    (available_workstreams as any).push(..._filteredAvailable);

    const allCardTitles = (allCards as any[]).map((c) => c.title).filter(Boolean) as string[];
    const allAzureTitles = (allWorkItems as any[]).map((w) => w.title).filter(Boolean) as string[];

    const coverage_report = detectCoverage(
      PRIORITY_DEFINITIONS,
      available_workstreams,
      [...allCardTitles, ...allAzureTitles],
    );

    // Pre-compute the server-authoritative coverage summary so the model can quote it verbatim.
    const _preCovered = coverage_report.filter((c) => c.status === "covered");
    const _preMissing = coverage_report.filter((c) => c.status === "missing");
    const _preTotal = PRIORITY_DEFINITIONS.length;
    const _preRatio = _preCovered.length / _preTotal;
    const coverage_summary_authoritative = {
      covered: _preCovered.length,
      total: _preTotal,
      ratio: Number(_preRatio.toFixed(2)),
      ratio_pct: Math.round(_preRatio * 100),
      covered_priorities: _preCovered.map((c) => ({ priority: c.priority, matched_workstream: c.matched_workstream })),
      missing_priorities: _preMissing.map((m) => m.priority),
    };

    // ─── Automation & Leverage signals (last 30d, deterministic) ──
    // Aggregates token_usage rows + joins profiles + lightweight surface
    // counts so Section 07 can be grounded, not hallucinated.
    const automation_leverage = await (async () => {
      const rows = (tokenUsage as any[]) || [];
      const today = new Date();
      const dayKey = (d: Date) => d.toISOString().slice(0, 10);
      const keys30 = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today.getTime() - i * 86400000);
        keys30.add(dayKey(d));
      }

      // Aggregate per-user totals over last 30d
      const perUser = new Map<string, { total_tokens: number; request_count: number }>();
      let total_tokens = 0;
      let request_count = 0;
      for (const r of rows) {
        if (!keys30.has(String(r.usage_date))) continue;
        const t = Number(r.total_tokens) || 0;
        const rc = Number(r.request_count) || 0;
        total_tokens += t;
        request_count += rc;
        const cur = perUser.get(r.user_id) || { total_tokens: 0, request_count: 0 };
        cur.total_tokens += t;
        cur.request_count += rc;
        perUser.set(r.user_id, cur);
      }
      const active_users = perUser.size;

      // Trend buckets: today vs yesterday, last 7d vs prior 7d
      const todayKey = dayKey(today);
      const yesterdayKey = dayKey(new Date(today.getTime() - 86400000));
      let todayTokens = 0, yesterdayTokens = 0;
      let last7 = 0, prior7 = 0;
      for (const r of rows) {
        const d = String(r.usage_date);
        const t = Number(r.total_tokens) || 0;
        if (d === todayKey) todayTokens += t;
        if (d === yesterdayKey) yesterdayTokens += t;
        const dt = new Date(d).getTime();
        const ageDays = Math.floor((today.getTime() - dt) / 86400000);
        if (ageDays >= 0 && ageDays < 7) last7 += t;
        else if (ageDays >= 7 && ageDays < 14) prior7 += t;
      }
      const pctChange = (cur: number, prev: number) =>
        prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
      const dow_change_pct = pctChange(todayTokens, yesterdayTokens);
      const wow_change_pct = pctChange(last7, prior7);
      let trend_label: string = "Insufficient data";
      if (last7 + prior7 > 0) {
        if (wow_change_pct >= 25) trend_label = "Adoption accelerating";
        else if (wow_change_pct >= 5) trend_label = "Adoption steady";
        else if (wow_change_pct > -10) trend_label = "Flat";
        else trend_label = "Declining";
      }

      // Top 3 users
      const top3 = Array.from(perUser.entries())
        .sort((a, b) => b[1].total_tokens - a[1].total_tokens)
        .slice(0, 3);
      const topUserIds = top3.map(([uid]) => uid);

      // Surface counts (parallel, capped) — used to infer "primary_use"
      const [generalChats, projectChats, gmailProfiles] = await Promise.all([
        safe(admin.from("general_chats").select("user_id").in("user_id", topUserIds.length ? topUserIds : ["00000000-0000-0000-0000-000000000000"])),
        safe(admin.from("project_chats").select("project_id, projects!inner(user_id)").in("projects.user_id", topUserIds.length ? topUserIds : ["00000000-0000-0000-0000-000000000000"])),
        safe(admin.from("gmail_writing_profiles").select("user_id, auto_drafts_created_today, auto_draft_enabled").in("user_id", topUserIds.length ? topUserIds : ["00000000-0000-0000-0000-000000000000"])),
      ]);

      const profilesByUserId = new Map<string, any>();
      for (const pr of (profiles as any[]) || []) {
        if (pr.user_id) profilesByUserId.set(pr.user_id, pr);
      }
      // The profiles fetch above doesn't include user_id — re-fetch with user_id for top users
      const topProfiles = topUserIds.length
        ? await safe(admin.from("profiles").select("user_id, display_name, role_title, department").in("user_id", topUserIds))
        : [];
      const topProfileMap = new Map<string, any>();
      for (const pr of topProfiles as any[]) topProfileMap.set(pr.user_id, pr);

      const generalChatCount = new Map<string, number>();
      for (const g of (generalChats as any[]) || []) {
        generalChatCount.set(g.user_id, (generalChatCount.get(g.user_id) || 0) + 1);
      }
      const projectChatCount = new Map<string, number>();
      for (const pc of (projectChats as any[]) || []) {
        const uid = pc?.projects?.user_id;
        if (uid) projectChatCount.set(uid, (projectChatCount.get(uid) || 0) + 1);
      }
      const gmailDraftMap = new Map<string, { drafts: number; enabled: boolean }>();
      for (const gp of (gmailProfiles as any[]) || []) {
        gmailDraftMap.set(gp.user_id, {
          drafts: Number(gp.auto_drafts_created_today) || 0,
          enabled: Boolean(gp.auto_draft_enabled),
        });
      }

      const inferPrimaryUse = (uid: string): string => {
        const g = generalChatCount.get(uid) || 0;
        const p = projectChatCount.get(uid) || 0;
        const gm = gmailDraftMap.get(uid);
        const surfaces: Array<{ label: string; n: number }> = [
          { label: "general Q&A in Duncan chat", n: g },
          { label: "project workspaces & RAG", n: p },
          { label: "Gmail auto-drafting", n: (gm?.drafts || 0) + (gm?.enabled ? 1 : 0) },
        ];
        surfaces.sort((a, b) => b.n - a.n);
        const dominant = surfaces[0];
        if (!dominant || dominant.n === 0) return "Mixed usage across surfaces";
        return `Primarily ${dominant.label}`;
      };

      const top_users = top3.map(([uid, agg], i) => {
        const pr = topProfileMap.get(uid);
        // Estimate hours saved: tokens → ~4 chars/token → words at ~5 chars → reading at 250 wpm
        const est_hours_saved = Math.round((agg.total_tokens * 4) / 5 / 250 / 60);
        return {
          rank: i + 1,
          name: pr?.display_name || "Unknown user",
          role: pr?.role_title || "—",
          department: pr?.department || "—",
          total_tokens: agg.total_tokens,
          request_count: agg.request_count,
          primary_use: inferPrimaryUse(uid),
          est_hours_saved,
        };
      });

      // Heaviest manual surfaces (company-wide, last 30d) — for recommendation floor
      const totalGmailDrafts = ((gmailProfiles as any[]) || []).reduce(
        (acc, gp) => acc + (Number(gp.auto_drafts_created_today) || 0),
        0,
      );

      return {
        company_usage: {
          total_tokens,
          request_count,
          active_users,
          dow_change_pct,
          wow_change_pct,
          trend_label,
          today_tokens: todayTokens,
          last_7d_tokens: last7,
          prior_7d_tokens: prior7,
        },
        top_users,
        heavy_surfaces: {
          gmail_auto_drafts_today: totalGmailDrafts,
          general_chats_top_users: Array.from(generalChatCount.values()).reduce((a, b) => a + b, 0),
          project_chats_top_users: Array.from(projectChatCount.values()).reduce((a, b) => a + b, 0),
        },
      };
    })();

    const context = {
      now_utc: new Date().toISOString(),
      window: "last 24h",
      available_workstreams,
      workstream_baseline,
      priority_definitions: PRIORITY_DEFINITIONS.map((p) => ({
        id: p.id,
        title: p.title,
        why_it_matters: p.why_it_matters,
        expected_owner: p.expected_owner,
      })),
      coverage_report,
      coverage_summary: coverage_summary_authoritative,
      meeting_priority_signals,
      meetings,
      workstream_cards: cards,
      workstream_activity: activity,
      azure_work_items: workItems,
      recent_releases: releases,
      candidates,
      purchase_orders: pos,
      issues,
      sync_logs: syncLogs,
      slack_notifications_24h: slackLogs,
      token_usage_7d: tokenUsage,
      automation_leverage,
      xero_invoices_24h: xeroInvoices,
      xero_overdue_contacts: xeroContacts,
      integration_audit_24h: auditLogs,
      team_directory: profiles,
      domain_file_review,
      operating_system_checklist: OPERATING_SYSTEM_CHECKLIST,
      inferred_artifact_signals,
      leadership_roster: LEADERSHIP_ROSTER.map((l) => ({ name: l.name, role: l.role, owns_priorities: l.owns_priorities ?? [] })),
      leader_signal_map,
      email_pulse_signals: email_pulse?.signals ?? null,
      email_pulse_silent_leaders: email_pulse?.silent_leaders ?? [],
      slack_pulse_signals: slack_pulse?.signals ?? null,
      slack_pulse_silent_channels: slack_pulse?.silent_channels ?? [],
      slack_pulse_meta: slack_pulse ? {
        channels_scanned: slack_pulse.channels_scanned ?? 0,
        channels_member: slack_pulse.channels_member ?? 0,
        channels_total: slack_pulse.channels_total ?? 0,
        messages_analysed: slack_pulse.messages_analysed ?? 0,
      } : null,
      previous_briefing: (prev as any)?.[0] ?? null,
    };

    const minimalMorningSchemaHint = `Return STRICT JSON with this smaller shape:
{
  "trajectory": "On Track" | "Slight Drift" | "At Risk" | "Off Track",
  "outcome_probability": number,
  "execution_score": number,
  "workstream_scores": [{
    "name": string,
    "progress": number,
    "confidence": number,
    "risk": number,
    "progress_vs_goal": string,
    "execution_quality": string,
    "commercial_impact": string,
    "dependency_strength": string,
    "evidence": string
  }],
  "payload": {
    "tldr": {
      "on_track": string,
      "what_will_break": string,
      "where_to_act": string
    },
    "probability_movement": string,
    "execution_explanation": string,
    "what_changed": [{
      "function_area": "Launch & India" | "Product & Technology" | "Growth & Marketing" | "Operations & Delivery" | "Finance & Legal" | "Duncan Automation",
      "moved": string,
      "did_not_move": string,
      "needs_attention": string
    }],
    "risks": [{
      "risk": string,
      "why_it_matters": string,
      "impact_7d": { "window": "7d", "impact": string, "mitigation": string },
      "impact_30d": { "window": "30d", "impact": string, "mitigation": string },
      "impact_90d": { "window": "90d", "impact": string, "mitigation": string },
      "owner": string,
      "severity": "low"|"medium"|"high"|"critical",
      "confidence": number,
      "probability_impact_pts": number
    }],
    "friction": [{
      "issue": string,
      "teams": string[],
      "consequence": string,
      "evidence_source": "workstream_card"|"meeting"|"email"|"coverage_gap"|"silent_leader"|"doc_conflict",
      "recommended_resolver": string
    }],
    "leadership": [{
      "name": string,
      "role": string,
      "output_vs_expectation": string,
      "risk_level": "low"|"medium"|"high",
      "blocking": string,
      "needs_support": string,
      "ceo_intervention_required": boolean
    }],
    "decisions": [{
      "decision": string,
      "why_it_matters": string,
      "consequence": string,
      "who_to_involve": string,
      "confidence": "high"|"medium"|"low",
      "blocked_by_missing_data": string | null,
      "evidence_source": "coverage_gap"|"silent_priority"|"risk"|"friction"|"email"|"silent_leader"|"data_blind_spot"|"workstream"|null
    }],
    "automation": {
      "working": string,
      "manual": string,
      "next": string,
      "blockers": string
    },
    "automation_progress": {
      "recommendations": [{
        "title": string,
        "why_now": string,
        "expected_leverage": "Low" | "Medium" | "High",
        "effort": "S" | "M" | "L",
        "evidence_source": "coverage_gap" | "silent_priority" | "friction" | "stuck_workstream" | "heavy_manual_surface" | "failed_tool_call" | "model"
      }]
    },
    "document_intelligence": [{
      "domain": string,
      "file_name": string,
      "verdict": "weak"|"adequate"|"strong",
      "what_it_covers": string,
      "what_is_missing_in_doc": string,
      "contradicted_by": [string],
      "reinforced_by": [string],
      "critical_gaps_to_fix": [string]
    }],
    "missing_artifacts_recommendations": [{
      "domain": string,
      "priority": "critical"|"high"|"medium"|"low",
      "artifacts": [{
        "name": string,
        "why_duncan_needs_it": string,
        "what_it_unlocks": string,
        "where_to_find_it": string,
        "suggested_filename_pattern": string,
        "blast_radius": [string]
      }]
    }],
    "brutal_truth": string
  }
}

Generate ONLY the fields above.
- Do NOT emit coverage_gaps, coverage_summary, available_workstreams, data_coverage_audit, company_pulse_status, email_pulse, watchlist, leadership_summary, decisions_meta, friction_meta, risk_reconciliation, missing_artifacts_summary, or any other extra keys — the server computes those.
- For workstream_scores, return at most the 3 highest-signal workstreams; the server will backfill the rest.
- For document_intelligence and missing_artifacts_recommendations, return [] when evidence is thin instead of writing long guesses.`;

    const brevityPromptSuffix = `

BASE BREVITY RULES (MANDATORY):
- Keep every prose field to 1-2 tight sentences.
- Prefer short bullets over long narrative.
- Limit every array to the minimum needed to satisfy schema rules.
- Reuse the server-grounded inputs verbatim wherever possible.
- JSON only. No markdown fences. No preamble.`;

    const compactContextJson = JSON.stringify(context).slice(0, 16000);

    const userPrompt = `Generate the ${briefing_type === "evening" ? "EVENING ACCOUNTABILITY" : "MORNING CEO"} BRIEFING.

    ${briefing_type === "evening" ? EVENING_SCHEMA_HINT : minimalMorningSchemaHint}

SERVER-AUTHORITATIVE COVERAGE (USE THESE NUMBERS VERBATIM):
${JSON.stringify(coverage_summary_authoritative)}

    HARD RULES:
    - coverage_summary above is server-computed truth. Reference those numbers in payload.execution_explanation and payload.brutal_truth. Do NOT recompute, infer, estimate, or round them.
    - Do NOT claim a priority is covered unless it appears in coverage_summary.covered_priorities.
    - Use meeting_priority_signals to surface untracked but active work inside payload.what_changed, payload.risks, payload.decisions, and payload.brutal_truth. The server will derive coverage_gaps from those signals.
    - email_pulse_signals (when present) is structured intelligence from leaders' inboxes. Merge unowned commitments / escalations into payload.decisions and payload.risks, and reflect board pressure in payload.tldr.where_to_act.
    - If a leader appears in email_pulse_silent_leaders AND in leader_signal_map as silent, escalate that leader to risk_level="high".
    - Keep arrays short and high-signal: what_changed max 4, risks max 4, friction max 3, leadership max 6, decisions max 4, document_intelligence max 3, missing_artifacts_recommendations max 3 domains.
    - payload.automation_progress.recommendations must include 1-3 concrete Duncan improvements grounded in coverage gaps, silent priorities, friction, stuck workstreams, or heavy manual surfaces.
    - Keep the legacy "automation" object too — it still feeds the headline number.

Source data (24h activity window; available_workstreams + coverage_report + meeting_priority_signals are full-set):
${compactContextJson}

If previous_briefing is non-null, explain probability/score deltas vs it. Keep prose tight, executive, no fluff. If a data source is empty, say so — do not invent activity. Remember: workstream_scores ⊆ available_workstreams; missing priorities → coverage_gaps, NOT fabricated scores.${brevityPromptSuffix}`;

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    await updateJob({ status: "synthesising", phase: "Synthesising briefing", progress: 55 });

    const parseBriefingJson = (aiData: any) => {
      const raw = aiData?.choices?.[0]?.message?.content ?? "{}";
      const finishReason = aiData?.choices?.[0]?.finish_reason;
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      const jsonCandidate = firstBrace >= 0 && lastBrace > firstBrace
        ? cleaned.slice(firstBrace, lastBrace + 1)
        : cleaned;
      try {
        return JSON.parse(jsonCandidate);
      } catch {
        if (finishReason === "length") {
          const err: any = new Error(
            `Model output truncated at max_tokens — retry with compact mode. Last 200 chars: ${cleaned.slice(-200)}`,
          );
          err.code = "MODEL_TRUNCATED";
          throw err;
        }
        throw new Error(`Invalid JSON from model (finish=${finishReason}): ${cleaned.slice(0, 300)}`);
      }
    };

    const compactPromptSuffix = `

COMPACT MODE (MANDATORY FOR THIS RUN):
- Keep all required keys, but minimise prose aggressively.
- Every prose field must be 3-10 words max.
- Prefer [] or "" for non-critical optional sections.
- Return at most 2 workstream_scores, 2 what_changed rows, 2 risks, 1 friction item, 3 leadership rows, 3 decisions, 1 document_intelligence row, and 1 missing_artifacts_recommendations domain with 1 artifact.
- For low-value narrative fields, use a single short sentence.
- Do not use markdown fences.`;

    const ultraCompactPromptSuffix = `

ULTRA COMPACT MODE (LAST ATTEMPT, MANDATORY):
- Keep the exact JSON shape only.
- Use the shortest valid answer possible for every field.
- Use [] for optional sections unless absolutely required.
- Return at most 1 workstream_score, 1 risk, 1 friction item, 3 leadership rows, 2 decisions, and 0 document_intelligence / missing_artifacts_recommendations rows.
- Limit strings to one clause each.
- JSON only. No markdown fences. No commentary.`;

    const buildDeterministicFallback = () => {
      const coveredCount = coverage_report.filter((c) => c.status === "covered").length;
      const totalPriorities = PRIORITY_DEFINITIONS.length;
      const missingCount = Math.max(0, totalPriorities - coveredCount);
      const coverageRatio = totalPriorities > 0 ? coveredCount / totalPriorities : 0;
      const prevRow = (prev as any)?.[0] ?? null;
      const priorProb = typeof prevRow?.outcome_probability === "number" ? prevRow.outcome_probability : null;
      const outcomeProbability = coverageRatio < 0.5 ? 30 : coverageRatio < 0.8 ? 55 : 75;
      const executionScore = coverageRatio < 0.5 ? 35 : coverageRatio < 0.8 ? 55 : 72;
      const trend = priorProb === null
        ? "No prior briefing to compare."
        : outcomeProbability > priorProb
        ? `Probability up ${outcomeProbability - priorProb} pts vs previous briefing.`
        : outcomeProbability < priorProb
        ? `Probability down ${priorProb - outcomeProbability} pts vs previous briefing.`
        : "Probability unchanged vs previous briefing.";

      return {
        trajectory: coverageRatio < 0.34 ? "Off Track" : coverageRatio < 0.5 ? "At Risk" : "Slight Drift",
        outcome_probability: outcomeProbability,
        execution_score: executionScore,
        workstream_scores: [],
        payload: {
          tldr: {
            on_track: coverageRatio >= 0.8
              ? "Core priorities are visible, but Duncan had to compact the report."
              : `No — Duncan can only see ${coveredCount} of ${totalPriorities} priorities clearly.`,
            what_will_break: missingCount > 0
              ? `${missingCount} priorities still lack reliable ownership or evidence.`
              : "Execution signal is present, but report detail was reduced to ensure delivery.",
            where_to_act: missingCount > 0
              ? "Create owners and workstreams for the missing priorities first."
              : "Review the highest-risk workstreams and confirm owners today.",
          },
          probability_movement: trend,
          execution_explanation: `Deterministic fallback generated after model truncation. Coverage is ${coveredCount}/${totalPriorities}, so Duncan is using conservative headline scores.`,
          what_changed: [],
          risks: [],
          friction: [],
          leadership: [],
          decisions: [],
          automation: {
            working: "Adoption signal is present in Duncan usage logs.",
            manual: "Operational reporting still depends on missing ownership and artifacts.",
            next: "Improve tracked workstreams and evidence coverage.",
            blockers: "Model output truncation required deterministic fallback generation.",
          },
          automation_progress: {
            recommendations: [],
          },
          document_intelligence: [],
          missing_artifacts_recommendations: [],
          brutal_truth: missingCount > 0
            ? `Duncan had to ship a reduced briefing because the AI response was too large, and ${missingCount} priorities are still under-evidenced.`
            : "Duncan had to ship a reduced briefing because the AI response was too large, but core execution signal remains visible.",
        },
      };
    };

    let aiData: any;
    let parsed: any;
    let generationMeta: { attempts: number; final_max_tokens: number; outcome: "ok" | "compact" | "ultra_compact" | "fallback" } = {
      attempts: 1,
      final_max_tokens: 8192,
      outcome: "ok",
    };
    try {
      aiData = await callLLMWithFallback({
        workflow: "ceo-briefing",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 8192,
        model_override: { claude: "claude-haiku-4-5", openai: "gpt-5-mini" },
      });
      parsed = parseBriefingJson(aiData);
    } catch (err: any) {
      if (err?.code === "MODEL_TRUNCATED") {
        await updateJob({ phase: "Optimising briefing length…", progress: 68 });
        try {
          generationMeta = { attempts: 2, final_max_tokens: 4096, outcome: "compact" };
          aiData = await callLLMWithFallback({
            workflow: "ceo-briefing",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `${userPrompt}${compactPromptSuffix}` },
            ],
            max_tokens: 4096,
            model_override: { claude: "claude-haiku-4-5", openai: "gpt-5-mini" },
          });
          parsed = parseBriefingJson(aiData);
        } catch (retryErr: any) {
          if (retryErr?.code === "MODEL_TRUNCATED" || String(retryErr?.message || "").includes("Model output truncated")) {
            await updateJob({ phase: "Optimising briefing length…", progress: 72 });
            try {
              generationMeta = { attempts: 3, final_max_tokens: 2048, outcome: "ultra_compact" };
              aiData = await callLLMWithFallback({
                workflow: "ceo-briefing",
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: `${userPrompt}${compactPromptSuffix}${ultraCompactPromptSuffix}` },
                ],
                max_tokens: 2048,
                model_override: { claude: "claude-haiku-4-5", openai: "gpt-5-mini" },
              });
              parsed = parseBriefingJson(aiData);
            } catch (finalRetryErr: any) {
              console.error("LLM ultra-compact retry error:", finalRetryErr?.status, finalRetryErr?.message);
              await updateJob({ phase: "Finalising briefing", progress: 76 });
              generationMeta = { attempts: 4, final_max_tokens: 2048, outcome: "fallback" };
              parsed = buildDeterministicFallback();
            }
          } else {
            console.error("LLM compact retry error:", retryErr?.status, retryErr?.message);
            throw new Error(`AI generation failed: ${String(retryErr?.message || "").slice(0, 300)}`);
          }
        }
      } else {
        console.error("LLM error:", err?.status, err?.message);
        throw new Error(`AI generation failed: ${String(err?.message || "").slice(0, 300)}`);
      }
    }

    await updateJob({ phase: "Applying guardrails", progress: 80 });

    // ─── Server-side guardrails ─────────────────────────────────
    // 1. Workstream scores: strip fabrications, force baseline RAG, backfill missing, clamp green-vs-red.
    if (available_workstreams.length > 0) {
      const allowedLc = new Set(available_workstreams.map((s) => s.toLowerCase()));
      const baselineByLc = new Map(workstream_baseline.map((b) => [b.name.toLowerCase(), b]));
      const incoming: any[] = Array.isArray(parsed.workstream_scores)
        ? parsed.workstream_scores.filter((w: any) => w?.name && allowedLc.has(String(w.name).toLowerCase()))
        : [];
      const byLc = new Map<string, any>();
      for (const w of incoming) byLc.set(String(w.name).toLowerCase(), w);

      const execScore = typeof parsed.execution_score === "number" ? parsed.execution_score : 100;
      const outcomeProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : 100;
      const briefingIsAtRisk = execScore < 50 || outcomeProb < 50;

      const finalScores: any[] = available_workstreams.map((name) => {
        const baseline = baselineByLc.get(name.toLowerCase())!;
        const existing = byLc.get(name.toLowerCase());
        if (!existing) {
          // Backfill from baseline
          return {
            name,
            rag: baseline.derived_rag,
            card_status_summary: baseline.card_status_summary,
            progress: baseline.baseline_progress,
            confidence: baseline.baseline_confidence,
            risk: baseline.baseline_risk,
            progress_vs_goal: `Baseline: ${baseline.card_status_summary}.`,
            execution_quality: baseline.card_count === 0 ? "No tracked cards." : `${baseline.days_since_last_activity}d since last card update.`,
            commercial_impact: "Not modelled — auto-injected from card status.",
            dependency_strength: "Not modelled — auto-injected from card status.",
            evidence: baseline.card_count === 0
              ? "Silent — no cards in the last 7 days."
              : `Auto-scored from card status: ${baseline.card_status_summary}.`,
            auto_injected: true,
          };
        }
        // Force baseline RAG + card_status_summary (single source of truth)
        const merged: any = {
          ...existing,
          rag: baseline.derived_rag,
          card_status_summary: baseline.card_status_summary,
        };
        // Clamp green-against-red contradictions
        const progNum = typeof merged.progress === "number" ? merged.progress : null;
        const riskNum = typeof merged.risk === "number" ? merged.risk : null;
        if (
          briefingIsAtRisk &&
          baseline.derived_rag !== "green" &&
          progNum !== null && riskNum !== null &&
          progNum >= 70 && riskNum <= 30
        ) {
          merged.progress = 50;
          merged.risk = 50;
          merged.evidence = `${merged.evidence || ""} · Score capped: contradicts overall execution_score=${execScore} / outcome_probability=${outcomeProb}.`.trim();
          merged.auto_clamped = true;
        }
        return merged;
      });

      parsed.workstream_scores = finalScores;
    }
    // 2. Ensure coverage_gaps reflects actual missing priorities (server-authoritative)
    //    + enrich with meeting_priority_signals to flag implicit (untracked) work.
    parsed.payload = parsed.payload || {};

    // 2-pre. Honest empty-state for "what changed in the last 24h".
    // If the LLM produced an empty `what_changed`, inject a deterministic
    // explanation row so the section never renders blank.
    if (briefing_type === "morning") {
      const cards24h = (cards as any[])?.length || 0;
      const azure24h = (workItems as any[])?.length || 0;
      const meetings24h = (meetings as any[])?.length || 0;
      const slackOutbound24h = (slackLogs as any[])?.length || 0;
      const epSignals = (email_pulse as any)?.signals;
      const emailSignalCount = epSignals
        ? ((epSignals.commitments?.length || 0) +
           (epSignals.risks?.length || 0) +
           (epSignals.escalations?.length || 0) +
           (epSignals.board_mentions?.length || 0) +
           (epSignals.customer_issues?.length || 0) +
           (epSignals.vendor_signals?.length || 0))
        : 0;
      const spSignals = (slack_pulse as any)?.signals;
      const slackSignalCount = spSignals
        ? ((spSignals.commitments?.length || 0) +
           (spSignals.escalations?.length || 0) +
           (spSignals.confusion?.length || 0) +
           (spSignals.customer_issues?.length || 0) +
           (spSignals.risks?.length || 0))
        : 0;
      const emailMailboxesScanned = (email_pulse as any)?.mailboxes_eligible || 0;
      const slackChannelsScanned = (slack_pulse as any)?.channels_scanned || 0;
      const slackMessagesScanned = (slack_pulse as any)?.messages_analysed || 0;
      const wc = Array.isArray(parsed.payload.what_changed) ? parsed.payload.what_changed : [];
      const allZero =
        cards24h === 0 && azure24h === 0 && meetings24h === 0 &&
        slackOutbound24h === 0 && emailSignalCount === 0 && slackSignalCount === 0;

      if (wc.length === 0) {
        if (allZero) {
          parsed.payload.what_changed = [{
            function_area: "Operations & Delivery",
            moved: "No tracked activity in the last 24 hours.",
            did_not_move: `Workstream cards (0), Azure work items (0), meetings (0), Slack outbound (0), email pulse (${emailMailboxesScanned} mailboxes scanned, 0 signals extracted), and Slack pulse (${slackChannelsScanned} channels / ${slackMessagesScanned} messages scanned, 0 signals extracted) all returned empty.`,
            needs_attention: "Verify Plaud meeting sync, Azure DevOps sync, and the ceo-email-pulse / ceo-slack-pulse functions are running. An empty 24h window usually means an integration is silent, not that the company is.",
            auto_injected: true,
            auto_injected_reason: "all_sources_empty_24h",
          }];
        } else {
          parsed.payload.what_changed = [{
            function_area: "Operations & Delivery",
            moved: `Signals were detected (cards: ${cards24h}, Azure: ${azure24h}, meetings: ${meetings24h}, Slack outbound: ${slackOutbound24h}, email signals: ${emailSignalCount} across ${emailMailboxesScanned} mailboxes, slack signals: ${slackSignalCount} across ${slackChannelsScanned} channels) but Duncan could not synthesise structured movement rows from them.`,
            did_not_move: "No commitments, blockers, or material status changes were extractable from the available sources in the last 24h.",
            needs_attention: "Likely causes: thin source content, generic email/meeting/slack context, or model under-extraction. Re-run the briefing or check raw signals in the data coverage section.",
            auto_injected: true,
            auto_injected_reason: "what_changed_empty_despite_signals",
          }];
        }
      }
    }

    const missing = coverage_report.filter((c) => c.status === "missing");
    const covered = coverage_report.filter((c) => c.status === "covered");
    const modelGaps = Array.isArray(parsed.payload.coverage_gaps) ? parsed.payload.coverage_gaps : [];
    const signalsByPriority = new Map(
      meeting_priority_signals.map((s) => [s.priority_id, s])
    );
    parsed.payload.coverage_gaps = missing.map((m) => {
      const fromModel = modelGaps.find((g: any) =>
        (g?.priority || "").toLowerCase().includes(m.priority.toLowerCase().split("—")[0].trim().slice(0, 12))
      );
      const sig = signalsByPriority.get(m.priority_id);
      const hasSignal = !!(sig && sig.mentions.length > 0);
      const signalSources = hasSignal ? sig!.mentions.map((x) => x.meeting_title).slice(0, 5) : [];
      return {
        priority_id: m.priority_id,
        priority: m.priority,
        why_it_matters: fromModel?.why_it_matters || m.why_it_matters,
        consequence_if_unowned: fromModel?.consequence_if_unowned || "No accountable owner means no progress and no escalation path — this priority will silently slip.",
        recommended_owner: fromModel?.recommended_owner || m.expected_owner,
        recommended_workstream_name: fromModel?.recommended_workstream_name || m.priority.split("—")[0].trim(),
        // Implicit-coverage fields (server-authoritative)
        current_signal: hasSignal
          ? (fromModel?.current_signal || `Discussed in ${sig!.mentions.length} recent meeting${sig!.mentions.length === 1 ? "" : "s"} but no formal workstream exists.`)
          : null,
        signal_sources: signalSources,
        signal_status: hasSignal ? ("active_but_untracked" as const) : ("silent" as const),
        recommended_action: hasSignal
          ? "Formalise into a workstream — work is already happening but invisible to Duncan."
          : "No activity detected anywhere — assign owner immediately.",
      };
    });

    // 3. Coverage summary (server-authoritative)
    const totalPriorities = PRIORITY_DEFINITIONS.length;
    const coverageRatio = covered.length / totalPriorities;
    parsed.payload.coverage_summary = {
      covered: covered.length,
      total: totalPriorities,
      ratio: Number(coverageRatio.toFixed(2)),
      covered_priorities: covered.map((c) => ({ priority: c.priority, matched_workstream: c.matched_workstream })),
      missing_priorities: missing.map((m) => m.priority),
    };
    parsed.payload.available_workstreams = available_workstreams;

    // 4. Honest scoring clamp — cannot project high probability against a plan you cannot see.
    if (briefing_type === "morning" && coverageRatio < 0.5) {
      const probCap = 35;
      const execCap = 40;
      const origProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : null;
      const origExec = typeof parsed.execution_score === "number" ? parsed.execution_score : null;
      if (origProb === null || origProb > probCap) parsed.outcome_probability = probCap;
      if (origExec === null || origExec > execCap) parsed.execution_score = execCap;
      // Force trajectory honest
      const traj = (parsed.trajectory || "").toLowerCase();
      if (traj === "on track" || traj === "slight drift" || !traj) {
        parsed.trajectory = coverageRatio < 0.34 ? "Off Track" : "At Risk";
      }
      parsed.payload.confidence_warning = {
        reason: `Low-evidence briefing — Duncan can only see ${covered.length} of ${totalPriorities} 2026 priorities. Probability capped at ${probCap}% and execution at ${execCap}/100 until missing workstreams are created.`,
        original_probability: origProb,
        original_execution: origExec,
        applied_probability_cap: probCap,
        applied_execution_cap: execCap,
      };
    }

    // 4b. Data Coverage Audit — inject + apply confidence cap
    parsed.payload.data_coverage_audit = data_coverage_audit;
    // Provenance note: describe each source honestly. Slack now covers BOTH
    // outbound notifications (slack_notification_logs) AND inbound channel
    // messages via ceo-slack-pulse for channels Duncan is a member of.
    const spChannelsScanned = (slack_pulse as any)?.channels_scanned || 0;
    const spMessagesAnalysed = (slack_pulse as any)?.messages_analysed || 0;
    const spChannelsMember = (slack_pulse as any)?.channels_member || 0;
    const spChannelsTotal = (slack_pulse as any)?.channels_total || 0;
    (parsed.payload.data_coverage_audit as any).source_provenance = {
      ...((parsed.payload.data_coverage_audit as any)?.source_provenance || {}),
      slack: slack_pulse
        ? ((slack_pulse as any)?.degraded
            ? `Slack scanned with reduced scopes — public channels only (${(slack_pulse as any)?.degraded_reason || "permission limited"}). Inbound: ${spChannelsScanned} of ${spChannelsMember} member channels (out of ${spChannelsTotal} total), ${spMessagesAnalysed} messages. Outbound: slack_notification_logs.`
            : `Inbound: scanned ${spChannelsScanned} of ${spChannelsMember} member channels (out of ${spChannelsTotal} total), ${spMessagesAnalysed} messages via ceo-slack-pulse. Outbound: slack_notification_logs. Channels Duncan is not a member of are not scanned.`)
        : `Duncan's own outbound notifications only (slack_notification_logs). Slack inbound pulse did not run on this briefing${slack_pulse_error ? ` — error: ${slack_pulse_error}` : ""}.`,
      hubspot: normalizedHubspotSignal
        ? `HubSpot ${normalizedHubspotSignal.status === "connected" ? "connected" : normalizedHubspotSignal.status}. Accounts scanned: ${normalizedHubspotSignal.accounts_scanned ?? 0}. ${normalizedHubspotSignal.metrics_summary || normalizedHubspotSignal.summary || normalizedHubspotSignal.error_message || "No material CRM signal returned."}`
        : `HubSpot summary unavailable${hubspot_signal_error ? ` — error: ${hubspot_signal_error}` : ""}.`,
      azure_repos: normalizedAzureReposSignal
        ? `Azure Repos ${normalizedAzureReposSignal.status === "connected" ? "connected" : normalizedAzureReposSignal.status}. Repos scanned: ${normalizedAzureReposSignal.repos_scanned ?? 0}. ${normalizedAzureReposSignal.metrics_summary || normalizedAzureReposSignal.summary || normalizedAzureReposSignal.error_message || "No material engineering signal returned."}`
        : `Azure Repos summary unavailable${azure_repos_signal_error ? ` — error: ${azure_repos_signal_error}` : ""}.`,
      email: "Per-mailbox 24h scan via ceo-email-pulse for opted-in users only.",
      meetings: "Plaud-ingested transcripts via fetch-plaud-meetings (last 24h for activity, last 10 transcripts for priority signals).",
      azure_devops: "azure_work_items table — last 24h changes.",
      workstreams: "workstream_cards table — last 24h updates + full open set for coverage.",
    };
    if (briefing_type === "morning") {
      const cap = data_coverage_audit.confidence_cap;
      if (cap === "medium" || cap === "low") {
        const probCap = cap === "low" ? 30 : 55;
        const execCap = cap === "low" ? 35 : 60;
        if (typeof parsed.outcome_probability !== "number" || parsed.outcome_probability > probCap) parsed.outcome_probability = probCap;
        if (typeof parsed.execution_score !== "number" || parsed.execution_score > execCap) parsed.execution_score = execCap;
        const existing = parsed.payload.confidence_warning || {};
        parsed.payload.confidence_warning = {
          ...existing,
          reason: `${existing.reason ? existing.reason + " " : ""}${data_coverage_audit.cap_reason} (Confidence cap: ${cap}.)`,
          data_coverage_cap: cap,
          data_coverage_cap_reason: data_coverage_audit.cap_reason,
        };
      }
    }

    // 4c. Document Intelligence post-processor — quality downgrades + recap.
    if (briefing_type === "morning") {
      const di = Array.isArray(parsed.payload.document_intelligence) ? parsed.payload.document_intelligence : [];
      // Filter to entries that match a real reviewed domain.
      const reviewedDomainIds = new Set(domain_file_review.map((d) => d.domain_id));
      const cleanDI = di.filter((e: any) => e && typeof e.domain === "string" && reviewedDomainIds.has(e.domain));
      parsed.payload.document_intelligence = cleanDI;

      // Downgrade domain status when the doc is "weak".
      const weakByDomain = new Map<string, any>();
      for (const e of cleanDI) {
        if ((e.verdict || "").toLowerCase() === "weak") weakByDomain.set(e.domain, e);
      }
      let downgraded = false;
      for (const dom of data_coverage_audit.domains) {
        const weak = weakByDomain.get(dom.id);
        if (!weak) continue;
        if (dom.status === "green") { dom.status = "yellow"; downgraded = true; }
        else if (dom.status === "yellow") { dom.status = "red"; downgraded = true; }
        const reason = weak.what_is_missing_in_doc || (weak.contradicted_by?.[0]) || "document is thin or stale";
        dom.evidence = `${dom.label} doc exists (${weak.file_name || "uploaded file"}) but is weak — ${String(reason).slice(0, 200)}.`;
        dom.recommendation = dom.recommendation || `Strengthen ${dom.label}: ${(weak.critical_gaps_to_fix?.[0]) || "fix the gaps Duncan called out"}.`;
      }

      // If status downgrades occurred, recompute the confidence cap.
      if (downgraded) {
        const reds2 = data_coverage_audit.domains.filter((d: any) => d.status === "red");
        const yellows2 = data_coverage_audit.domains.filter((d: any) => d.status === "yellow");
        const critReds2 = reds2.filter((d: any) => d.critical);
        const finPlanRed2 = reds2.some((d: any) => d.id === "finance_planning");
        const techDirRed2 = reds2.some((d: any) => d.id === "technology_direction");
        let cap2: "high" | "medium" | "low" = "high";
        let capReason2 = data_coverage_audit.cap_reason;
        if (reds2.length >= 3 || (finPlanRed2 && techDirRed2)) {
          cap2 = "low";
          capReason2 = `${reds2.length} domains are missing or weak${finPlanRed2 && techDirRed2 ? " (including both Finance Planning and Technology Direction)" : ""}. Duncan cannot honestly project high confidence.`;
        } else if (critReds2.length >= 1) {
          cap2 = "medium";
          capReason2 = `${critReds2.length} critical domain${critReds2.length === 1 ? "" : "s"} (${critReds2.map((d: any) => d.label).join(", ")}) are missing or weak. Confidence capped at medium.`;
        }
        data_coverage_audit.confidence_cap = cap2;
        data_coverage_audit.cap_reason = capReason2;
        data_coverage_audit.counts = {
          red: reds2.length,
          yellow: yellows2.length,
          green: data_coverage_audit.domains.length - reds2.length - yellows2.length,
          total: data_coverage_audit.domains.length,
        };
        // Re-apply caps after downgrade.
        if (cap2 === "medium" || cap2 === "low") {
          const probCap = cap2 === "low" ? 30 : 55;
          const execCap = cap2 === "low" ? 35 : 60;
          if (typeof parsed.outcome_probability !== "number" || parsed.outcome_probability > probCap) parsed.outcome_probability = probCap;
          if (typeof parsed.execution_score !== "number" || parsed.execution_score > execCap) parsed.execution_score = execCap;
        }
      }

      // Ensure the warning banner always reflects the final capped headline values.
      if (parsed.payload.confidence_warning) {
        const finalProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : null;
        const finalExec = typeof parsed.execution_score === "number" ? parsed.execution_score : null;
        const existing = parsed.payload.confidence_warning || {};
        const reasonParts: string[] = [];

        if (coverageRatio < 0.5 && finalProb !== null && finalExec !== null) {
          reasonParts.push(
            `Low-evidence briefing — Duncan can only see ${covered.length} of ${totalPriorities} 2026 priorities. Probability capped at ${finalProb}% and execution at ${finalExec}/100 until missing workstreams are created.`
          );
        }

        if (existing.data_coverage_cap_reason) {
          reasonParts.push(`${existing.data_coverage_cap_reason} (Confidence cap: ${existing.data_coverage_cap || data_coverage_audit.confidence_cap}.)`);
        }

        parsed.payload.confidence_warning = {
          ...existing,
          applied_probability_cap: finalProb ?? existing.applied_probability_cap,
          applied_execution_cap: finalExec ?? existing.applied_execution_cap,
          reason: reasonParts.length > 0 ? reasonParts.join(" ") : existing.reason,
        };
      }

      // Top-line counter on the audit.
      const verdictCounts = { weak: 0, adequate: 0, strong: 0 };
      for (const e of cleanDI) {
        const v = (e.verdict || "").toLowerCase();
        if (v === "weak" || v === "adequate" || v === "strong") verdictCounts[v as keyof typeof verdictCounts]++;
      }
      (data_coverage_audit as any).document_review_summary = {
        documents_reviewed: cleanDI.length,
        ...verdictCounts,
      };
    }

    // 4c-bis. Watchlist — fully deterministic, server-computed.
    //         Sources: workstream_cards (.owner_id), workstream_card_assignees,
    //         azure_work_items (.assigned_to), PRIORITY_DEFINITIONS.expected_owner.
    //         The LLM no longer contributes rows.
    if (briefing_type === "morning") {
      parsed.payload = parsed.payload || {};

      const norm = (s: any) => String(s || "").toLowerCase().trim();

      // ---- Build owner-resolution lookups ----
      // profiles: user_id -> display_name
      const profileById = new Map<string, string>();
      for (const p of ((profiles as any[]) || [])) {
        if (p?.user_id) profileById.set(String(p.user_id), String(p.display_name || "").trim());
      }

      // Most recent non-archived card owner per project_tag (uses allCards).
      // allCards is sorted by updated_at desc-ish; we'll sort defensively.
      const cardsForOwner: any[] = Array.isArray(allCards) ? [...allCards] : [];
      cardsForOwner.sort((a, b) => String(b?.updated_at || "").localeCompare(String(a?.updated_at || "")));
      const cardOwnerByTag = new Map<string, string>();
      for (const c of cardsForOwner) {
        const tag = norm(c?.project_tag);
        if (!tag || cardOwnerByTag.has(tag)) continue;
        const ownerName = c?.owner_id ? (profileById.get(String(c.owner_id)) || "") : "";
        if (ownerName) cardOwnerByTag.set(tag, ownerName);
      }

      // Fetch additional card assignees (workstream_card_assignees) and
      // index by project_tag for fallback when owner_id is null.
      try {
        const cardIdsByTag = new Map<string, string[]>();
        const recentCardsWithIds = await safe(
          admin.from("workstream_cards")
            .select("id,project_tag,updated_at")
            .is("archived_at", null)
            .order("updated_at", { ascending: false })
            .limit(500)
        );
        for (const c of (recentCardsWithIds as any[] | null) || []) {
          const tag = norm(c?.project_tag);
          if (!tag || !c?.id) continue;
          if (!cardIdsByTag.has(tag)) cardIdsByTag.set(tag, []);
          cardIdsByTag.get(tag)!.push(String(c.id));
        }
        const allCardIds = Array.from(cardIdsByTag.values()).flat().slice(0, 500);
        if (allCardIds.length > 0) {
          const assignees = await safe(
            admin.from("workstream_card_assignees")
              .select("card_id,user_id,assignment_status")
              .in("card_id", allCardIds)
              .eq("assignment_status", "accepted")
          );
          const userByCard = new Map<string, string>();
          for (const a of (assignees as any[] | null) || []) {
            if (a?.card_id && a?.user_id) userByCard.set(String(a.card_id), String(a.user_id));
          }
          for (const [tag, ids] of cardIdsByTag.entries()) {
            if (cardOwnerByTag.has(tag)) continue;
            for (const id of ids) {
              const uid = userByCard.get(id);
              const name = uid ? profileById.get(uid) : "";
              if (name) { cardOwnerByTag.set(tag, name); break; }
            }
          }
        }
      } catch (_) { /* non-fatal */ }

      // Most-frequent Azure assignee per project_name.
      const azureAssigneeFreqByProject = new Map<string, Map<string, number>>();
      for (const w of (Array.isArray(allWorkItems) ? allWorkItems : [])) {
        const proj = norm((w as any)?.project_name);
        const who = String((w as any)?.assigned_to || "").trim();
        if (!proj || !who) continue;
        if (!azureAssigneeFreqByProject.has(proj)) azureAssigneeFreqByProject.set(proj, new Map());
        const m = azureAssigneeFreqByProject.get(proj)!;
        m.set(who, (m.get(who) || 0) + 1);
      }
      const azureOwnerByProject = new Map<string, string>();
      for (const [proj, freq] of azureAssigneeFreqByProject.entries()) {
        let best: { name: string; n: number } | null = null;
        for (const [name, n] of freq.entries()) {
          if (!best || n > best.n) best = { name, n };
        }
        if (best) azureOwnerByProject.set(proj, best.name);
      }

      // Resolver
      type OwnerSource = "card_assignee" | "azure_assignee" | "priority_definition" | "unassigned";
      const resolveOwnerForWorkstream = (
        name: string,
        priorityIdHint?: string,
      ): { owner: string; owner_source: OwnerSource } => {
        const k = norm(name);
        if (k && cardOwnerByTag.has(k)) {
          return { owner: cardOwnerByTag.get(k)!, owner_source: "card_assignee" };
        }
        // Try first token (e.g. "kabuni-app" -> match "kabuni-app")
        if (k && azureOwnerByProject.has(k)) {
          return { owner: azureOwnerByProject.get(k)!, owner_source: "azure_assignee" };
        }
        // Try matching by first word
        const firstWord = k.split(/[\s—-]+/)[0] || "";
        if (firstWord) {
          for (const [proj, who] of azureOwnerByProject.entries()) {
            if (proj.startsWith(firstWord) || firstWord.startsWith(proj)) {
              return { owner: who, owner_source: "azure_assignee" };
            }
          }
          for (const [tag, who] of cardOwnerByTag.entries()) {
            if (tag.startsWith(firstWord) || firstWord.startsWith(tag)) {
              return { owner: who, owner_source: "card_assignee" };
            }
          }
        }
        if (priorityIdHint) {
          const def = PRIORITY_DEFINITIONS.find((p) => p.id === priorityIdHint);
          if (def?.expected_owner) {
            return { owner: def.expected_owner, owner_source: "priority_definition" };
          }
        }
        return { owner: "Unassigned — CEO to allocate", owner_source: "unassigned" };
      };

      // ---- Build the watchlist deterministically (LLM input discarded). ----
      const wlIn: any[] = [];
      const hasRowFor = (workstream: string) => {
        const k = norm(workstream);
        if (!k) return false;
        const firstWord = k.split(/[\s—-]+/)[0] || "";
        return wlIn.some((r: any) => {
          const rk = norm(r?.workstream);
          return rk === k || (firstWord && rk.includes(firstWord));
        });
      };

      let watchlistAutoInjected = 0;

      const successCriteriaFor = (priorityTitle: string): string => {
        const pt = priorityTitle.toLowerCase();
        if (pt.includes("lightning")) return "India launch event delivered on 7 June 2026 with signed runbook, vendor contracts and on-the-ground ops plan.";
        if (pt.includes("registration") || pt.includes("kpl")) return "1,000,000 verified KPL registrations with measurable funnel conversion.";
        if (pt.includes("trial")) return "October–November 2026 trials executed across all target cities with attendance + scoring data captured.";
        if (pt.includes("selection") || pt.includes("super coach")) return "Final 10-team / Super Coach selection signed off by December 2026 with publicised roster.";
        if (pt.includes("pre-order") || pt.includes("preorder")) return "100,000 paid pre-orders fulfilled with revenue reconciled in Xero.";
        if (pt.includes("automat") || pt.includes("duncan")) return "25% of company processes measurably automated via Duncan with documented before/after time savings.";
        return "Workstream owner has stated, evidenced, observable definition of done with a date.";
      };

      // (a) Non-green workstream_scores → ensure a row exists.
      const wsScores: any[] = Array.isArray(parsed.workstream_scores) ? parsed.workstream_scores : [];
      for (const ws of wsScores) {
        const rag = norm(ws?.rag);
        if (!rag || rag === "green") continue;
        const name = String(ws?.name || "").trim();
        if (!name || hasRowFor(name)) continue;
        const statusLabel = rag === "red" ? "Red" : (rag === "yellow" || rag === "amber") ? "Yellow" : "At Risk";
        const { owner, owner_source } = resolveOwnerForWorkstream(name);
        wlIn.push({
          workstream: name,
          owner,
          owner_source,
          status: statusLabel,
          good_looks_like: ws?.good_looks_like || successCriteriaFor(name),
          missing: ws?.missing || `Workstream is ${statusLabel} but no specific blocker has been articulated by the owner.`,
          data_blind_spot: ws?.data_blind_spot ?? null,
          auto_injected: true,
          auto_injected_reason: `non_green_workstream_${rag}`,
        });
        watchlistAutoInjected++;
      }

      // (b) Silent priorities → one row per silent priority.
      const silentMissingLocal = (Array.isArray(missing) ? missing : []).filter((mm: any) => {
        const sig = signalsByPriority?.get?.(mm.priority_id);
        return !sig || (Array.isArray(sig.mentions) && sig.mentions.length === 0);
      });
      for (const sm of silentMissingLocal) {
        const priorityName = sm.priority || "";
        if (!priorityName || hasRowFor(priorityName)) continue;
        const { owner, owner_source } = resolveOwnerForWorkstream(priorityName, sm.priority_id);
        wlIn.push({
          workstream: priorityName,
          owner,
          owner_source,
          status: "Silent",
          good_looks_like: successCriteriaFor(priorityName),
          missing: "No owned workstream — no cards, no Azure items, no releases attributed in the last 7 days.",
          data_blind_spot: null,
          auto_injected: true,
          auto_injected_reason: "silent_priority",
        });
        watchlistAutoInjected++;
      }

      // (c) Uncovered coverage domains.
      try {
        const sc: any[] = Array.isArray((data_coverage_audit as any)?.strategic_coverage)
          ? (data_coverage_audit as any).strategic_coverage
          : [];
        for (const pc of sc) {
          const pct = Number(pc?.coverage_pct ?? 100);
          if (!Number.isFinite(pct) || pct >= 50) continue;
          const title = String(pc?.priority_title || "").trim();
          if (!title || hasRowFor(title)) continue;
          const byDomain: any[] = Array.isArray(pc?.by_domain) ? pc.by_domain : [];
          const worstDomain = byDomain
            .map((d: any) => ({
              label: d?.domain_label || d?.domain || "",
              missingCount: Array.isArray(d?.missing) ? d.missing.length : 0,
            }))
            .sort((a, b) => b.missingCount - a.missingCount)[0];
          const blindSpotLabel = worstDomain?.label || null;
          const { owner, owner_source } = resolveOwnerForWorkstream(title, pc?.priority_id);
          wlIn.push({
            workstream: title,
            owner,
            owner_source,
            status: "Uncovered",
            good_looks_like: successCriteriaFor(title),
            missing: blindSpotLabel
              ? `Coverage ${pct}% — top blind spot: ${blindSpotLabel} (${worstDomain.missingCount} required artifact${worstDomain.missingCount === 1 ? "" : "s"} missing).`
              : `Coverage ${pct}% — required artifacts missing across knowledge domains.`,
            data_blind_spot: blindSpotLabel,
            auto_injected: true,
            auto_injected_reason: "uncovered_priority",
          });
          watchlistAutoInjected++;
        }
      } catch (_) { /* non-fatal */ }

      // (d) Silent leaders owning 2026 priorities.
      try {
        const lsm: any[] = Array.isArray(leader_signal_map) ? leader_signal_map : [];
        for (const ls of lsm) {
          if (norm(ls?.signal_status) !== "silent") continue;
          const owns: string[] = Array.isArray(ls?.owns_priorities) ? ls.owns_priorities : [];
          if (owns.length === 0) continue;
          for (const priorityTitle of owns) {
            const title = String(priorityTitle || "").trim();
            if (!title || hasRowFor(title)) continue;
            // For silent-leader rows the owner is by definition the silent leader.
            wlIn.push({
              workstream: title,
              owner: ls?.name || "Unassigned — CEO to allocate",
              owner_source: ls?.name ? "card_assignee" : "unassigned",
              status: "Silent",
              good_looks_like: successCriteriaFor(title),
              missing: `${ls?.name || "Owner"} silent 7d — no meetings, workstream cards, Azure items or releases attributed.`,
              data_blind_spot: null,
              auto_injected: true,
              auto_injected_reason: "silent_leader_owns_priority",
            });
            watchlistAutoInjected++;
          }
        }
      } catch (_) { /* non-fatal */ }

      // Final fallback.
      const _outcomeProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : 50;
      const _coverageGapsLen = Array.isArray(parsed.payload?.coverage_gaps) ? parsed.payload.coverage_gaps.length : 0;
      if (wlIn.length === 0 && (_outcomeProb < 70 || _coverageGapsLen > 0)) {
        wlIn.push({
          workstream: "Watchlist detection found nothing",
          owner: "Duncan",
          owner_source: "unassigned",
          status: "Red",
          good_looks_like: "At least one accountable workstream-owner-blocker triple per non-green priority surfaced here.",
          missing: "Verify Duncan has visibility into workstreams + 2026 priorities — an empty watchlist on a non-green briefing is unusual.",
          data_blind_spot: null,
          auto_injected: true,
          auto_injected_reason: "empty_watchlist_non_green_briefing",
        });
        watchlistAutoInjected++;
      }

      parsed.payload.watchlist = wlIn.map((r: any) => ({
        workstream: String(r?.workstream || "").trim() || "Unspecified workstream",
        owner: String(r?.owner || "").trim() || "Unassigned",
        owner_source: (r?.owner_source as OwnerSource) || "unassigned",
        status: String(r?.status || "").trim() || "At Risk",
        good_looks_like: String(r?.good_looks_like || "").trim() || "—",
        missing: String(r?.missing || "").trim() || "—",
        data_blind_spot: r?.data_blind_spot ?? null,
        auto_injected: true,
        ...(r?.auto_injected_reason ? { auto_injected_reason: r.auto_injected_reason } : {}),
      }));
      parsed.payload.watchlist_meta = {
        total: parsed.payload.watchlist.length,
        auto_injected: watchlistAutoInjected,
        deterministic: true,
      };
    }

    // 4d. Watchlist owner-concentration cap (40% rule) + display name resolution.
    if (briefing_type === "morning" && Array.isArray(parsed.payload?.watchlist) && parsed.payload.watchlist.length > 0) {
      const teamNames = new Set(
        ((profiles as any[]) || [])
          .map((p: any) => (p.display_name || "").toLowerCase())
          .filter(Boolean)
      );
      const wl = parsed.payload.watchlist as any[];
      const total = wl.length;
      // Count first-name occurrences (covers "Simon", "Simon (Ops Director)", etc.)
      const firstNameOf = (owner: string) => String(owner || "").trim().split(/\s+/)[0].toLowerCase();
      const counts = new Map<string, number>();
      for (const row of wl) {
        const fn = firstNameOf(row.owner);
        if (fn) counts.set(fn, (counts.get(fn) || 0) + 1);
      }
      const cap = Math.max(1, Math.floor(total * 0.4));
      for (const [name, n] of counts.entries()) {
        if (n <= cap) continue;
        let surplus = n - cap;
        for (const row of wl) {
          if (surplus <= 0) break;
          if (firstNameOf(row.owner) !== name) continue;
          // Skip the first `cap` rows for this owner — only rebalance the surplus.
          if ((counts.get(`__kept_${name}`) || 0) < cap) {
            counts.set(`__kept_${name}`, (counts.get(`__kept_${name}`) || 0) + 1);
            continue;
          }
          row.original_owner = row.owner;
          row.owner = "Cross-functional — escalate to CEO";
          row.reassignment_reason = `Single-owner concentration (>40%) on "${name}" — reassigned for accountability balance.`;
          surplus--;
        }
      }
    }

    // 4d-bis. Leadership roster enforcement — every direct report must appear,
    //         silent leaders auto-flagged for CEO intervention.
    if (briefing_type === "morning") {
      const aiLeaders: any[] = Array.isArray(parsed.payload?.leadership) ? parsed.payload.leadership : [];
      const norm = (s: string) => String(s || "").toLowerCase().trim();
      const findAi = (rosterName: string) =>
        aiLeaders.find((l) => norm(l?.name).includes(norm(rosterName)) || norm(rosterName).includes(norm(l?.name)));

      const fullRoster = LEADERSHIP_ROSTER.map((leader) => {
        const sig = leader_signal_map.find((s) => s.name === leader.name)!;
        const ai = findAi(leader.name);
        const status = sig.signal_status;
        const isOwnerOfPriority = (leader.owns_priorities ?? []).length > 0;

        if (ai && status !== "silent") {
          // Trust the AI but stamp deterministic signal fields.
          return {
            name: leader.name,
            role: ai.role || leader.role,
            output_vs_expectation: ai.output_vs_expectation || `Active in ${sig.sources.join(", ")}.`,
            risk_level: ai.risk_level || (status === "low_signal" ? "medium" : "low"),
            blocking: ai.blocking || "",
            needs_support: ai.needs_support || "",
            ceo_intervention_required: !!ai.ceo_intervention_required,
            signal_status: status,
            evidence_sources: sig.sources,
          };
        }

        // Silent OR omitted — synthesize the stub.
        return {
          name: leader.name,
          role: leader.role,
          output_vs_expectation:
            status === "silent"
              ? "No operational signal in 7 days — no meetings, workstream cards, Azure items or releases attributed to this leader."
              : (ai?.output_vs_expectation || `Single-source signal only (${sig.sources.join(", ") || "none"}).`),
          risk_level:
            status === "silent"
              ? (isOwnerOfPriority ? "high" : "medium")
              : (ai?.risk_level || "medium"),
          blocking: status === "silent" ? "Invisible to Duncan — unknown." : (ai?.blocking || ""),
          needs_support:
            status === "silent"
              ? "CEO check-in to surface what they are actually working on, blocked by, or capacity-constrained on."
              : (ai?.needs_support || ""),
          ceo_intervention_required: status === "silent" ? true : !!ai?.ceo_intervention_required,
          signal_status: status,
          evidence_sources: sig.sources,
        };
      });

      // Sort: intervention → high risk → silent → low_signal → active
      const riskRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const sigRank: Record<string, number> = { silent: 0, low_signal: 1, active: 2 };
      fullRoster.sort((a, b) => {
        if (a.ceo_intervention_required !== b.ceo_intervention_required) return a.ceo_intervention_required ? -1 : 1;
        const r = (riskRank[a.risk_level] ?? 9) - (riskRank[b.risk_level] ?? 9);
        if (r !== 0) return r;
        return (sigRank[a.signal_status] ?? 9) - (sigRank[b.signal_status] ?? 9);
      });

      parsed.payload.leadership = fullRoster;
      parsed.payload.leadership_summary = {
        total: fullRoster.length,
        active: fullRoster.filter((l) => l.signal_status === "active").length,
        low_signal: fullRoster.filter((l) => l.signal_status === "low_signal").length,
        silent: fullRoster.filter((l) => l.signal_status === "silent").length,
        intervention_required: fullRoster.filter((l) => l.ceo_intervention_required).length,
      };
    }

    // 4e. Missing artifacts recommendations — clean, cap at 15, link to decisions §9.
    if (briefing_type === "morning") {
      const validDomainIds = new Set(KNOWLEDGE_DOMAINS.map((d) => d.id));
      const validPrio = new Set(["critical", "high", "medium", "low"]);
      const rawRec = Array.isArray(parsed.payload?.missing_artifacts_recommendations)
        ? parsed.payload.missing_artifacts_recommendations : [];
      const cleanedRec = rawRec
        .filter((r: any) => r && validDomainIds.has(r.domain) && validPrio.has((r.priority || "").toLowerCase()))
        .map((r: any) => ({
          domain: r.domain,
          priority: String(r.priority).toLowerCase(),
          artifacts: Array.isArray(r.artifacts) ? r.artifacts.filter((a: any) => a && typeof a.name === "string").slice(0, 6) : [],
        }))
        .filter((r: any) => r.artifacts.length > 0);

      // Cap at 15 artifacts total, ranked by priority.
      const prioRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const flat: Array<{ domain: string; priority: string; artifact: any }> = [];
      for (const r of cleanedRec) for (const a of r.artifacts) flat.push({ domain: r.domain, priority: r.priority, artifact: a });
      flat.sort((a, b) => (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9));
      const capped = flat.slice(0, 15);
      const regrouped = new Map<string, { domain: string; priority: string; artifacts: any[] }>();
      for (const f of capped) {
        const key = `${f.domain}::${f.priority}`;
        if (!regrouped.has(key)) regrouped.set(key, { domain: f.domain, priority: f.priority, artifacts: [] });
        regrouped.get(key)!.artifacts.push(f.artifact);
      }
      parsed.payload.missing_artifacts_recommendations = Array.from(regrouped.values());

      // Counter for the UI.
      const counter = { total: capped.length, critical: 0, high: 0, medium: 0, low: 0 };
      for (const f of capped) (counter as any)[f.priority]++;
      parsed.payload.missing_artifacts_summary = counter;

      // Decisions §9 — enrich blocked_by_missing_data with specific artifact names.
      if (Array.isArray(parsed.payload.decisions) && capped.length > 0) {
        const domainLabelById = new Map(KNOWLEDGE_DOMAINS.map((d) => [d.id, d.label]));
        const criticalByDomain = new Map<string, string[]>();
        for (const f of capped) {
          if (f.priority !== "critical" && f.priority !== "high") continue;
          const arr = criticalByDomain.get(f.domain) || [];
          if (arr.length < 3) arr.push(f.artifact.name);
          criticalByDomain.set(f.domain, arr);
        }
        for (const dec of parsed.payload.decisions) {
          if (!dec?.blocked_by_missing_data || typeof dec.blocked_by_missing_data !== "string") continue;
          const txt = dec.blocked_by_missing_data.toLowerCase();
          // Already includes "needs:" prefix — leave alone.
          if (txt.startsWith("needs:")) continue;
          // Find which domain this decision references.
          for (const [domId, label] of domainLabelById.entries()) {
            if (!txt.includes(label.toLowerCase())) continue;
            const artNames = criticalByDomain.get(domId);
            if (!artNames || artNames.length === 0) break;
            const blockedArtifacts = artNames.map((n) => n).join(", ");
            dec.blocked_artifact_names = artNames;
            dec.blocked_by_missing_data = `Needs: ${blockedArtifacts} — ${dec.blocked_by_missing_data}`;
            break;
          }
        }
      }
    }

    const trueCovered = covered.length;
    const proseFields = ["company_pulse", "brutal_truth", "execution_explanation", "probability_movement"] as const;
    for (const field of proseFields) {
      const val = parsed.payload?.[field];
      if (typeof val !== "string" || !val) continue;
      const re = /\b(\d{1,2})\s*(?:of|out of|\/)\s*6\b/gi;
      let mismatch = false;
      let m: RegExpExecArray | null;
      while ((m = re.exec(val)) !== null) {
        const claimed = parseInt(m[1], 10);
        if (!Number.isNaN(claimed) && claimed !== trueCovered) { mismatch = true; break; }
      }
      if (mismatch) {
        parsed.payload[field] = `${val.trim()} (Server correction: only ${trueCovered} of ${totalPriorities} 2026 priorities have an active workstream.)`;
      }
    }

    // 6. Server-authoritative Company Pulse (RYG) — deterministic, not AI-decided.
    //    Inputs: coverage, implicit signals, execution evidence, blockers, prior trend.
    if (briefing_type === "morning") {
      const lightningCovered = covered.find(c =>
        (c.priority || "").toLowerCase().includes("lightning strike")
        || (c.matched_workstream || "").toLowerCase().includes("lightning strike")
      );
      const silentMissing = missing.filter(m => {
        const sig = signalsByPriority.get(m.priority_id);
        return !sig || sig.mentions.length === 0;
      });
      const untrackedActive = missing.filter(m => {
        const sig = signalsByPriority.get(m.priority_id);
        return !!(sig && sig.mentions.length > 0);
      });

      const recentCardActivity = (cards as any[]).length;
      const recentAzureActivity = (workItems as any[]).length;
      const failedSyncs = (syncLogs as any[]).filter((s: any) => (s.status || "").toLowerCase() === "failed").length;
      const criticalIssues = (issues as any[]).filter((i: any) => ["critical", "high"].includes((i.severity || "").toLowerCase())).length;
      const overdueFinance = (xeroContacts as any[]).length;
      const prevRow = (prev as any[])[0] ?? null;

      const evidence: string[] = [];
      const blockers: string[] = [];
      const positives: string[] = [];

      evidence.push(`${covered.length} of ${totalPriorities} 2026 priorities have a tracked workstream (${Math.round(coverageRatio * 100)}%).`);
      if (untrackedActive.length > 0) evidence.push(`${untrackedActive.length} priorit${untrackedActive.length === 1 ? "y is" : "ies are"} discussed in recent meetings but have no formal workstream.`);
      if (silentMissing.length > 0) evidence.push(`${silentMissing.length} priorit${silentMissing.length === 1 ? "y has" : "ies have"} no visible activity anywhere (silent).`);
      evidence.push(`Recent execution: ${recentCardActivity} workstream card update${recentCardActivity === 1 ? "" : "s"}, ${recentAzureActivity} Azure work item change${recentAzureActivity === 1 ? "" : "s"} in last 24h.`);

      // Data coverage blind spots
      const dca = data_coverage_audit;
      if (dca.counts.red > 0 || dca.counts.yellow > 0) {
        evidence.push(`Data blind spots: ${dca.counts.red} red, ${dca.counts.yellow} yellow across ${dca.counts.total} knowledge domains (confidence cap: ${dca.confidence_cap}).`);
      }
      if (dca.critical_reds.length > 0) {
        blockers.push(`Critical knowledge gaps: ${dca.critical_reds.map((d) => d.label).join(", ")} — Duncan has no data here and cannot judge these areas honestly.`);
      }

      if (!lightningCovered) blockers.push("Lightning Strike Event has no tracked workstream — the flagship June 7 commitment is invisible to execution tracking.");
      if (silentMissing.length >= 2) blockers.push(`${silentMissing.length} priorities are completely silent — no meetings, no workstreams, no owners.`);
      if (failedSyncs > 0) blockers.push(`${failedSyncs} integration sync failure${failedSyncs === 1 ? "" : "s"} in last 24h — data freshness at risk.`);
      if (criticalIssues > 0) blockers.push(`${criticalIssues} critical/high-severity issue${criticalIssues === 1 ? "" : "s"} logged in last 24h.`);
      if (overdueFinance > 0) blockers.push(`${overdueFinance} customer${overdueFinance === 1 ? "" : "s"} with overdue balances.`);

      if (lightningCovered) positives.push(`Lightning Strike Event is tracked via "${lightningCovered.matched_workstream}".`);
      if (recentCardActivity + recentAzureActivity > 10) positives.push("Healthy execution velocity in last 24h.");
      if (untrackedActive.length > 0) positives.push("Some untracked work IS happening — formalising it into workstreams will close visibility gaps fast.");

      // Status decision
      let status: "red" | "yellow" | "green" = "yellow";
      let reason = "";

      const fullCoverage = coverageRatio >= 1.0;
      const halfOrLess = coverageRatio < 0.5;
      const majorBlockerCount = blockers.length;

      if (fullCoverage && majorBlockerCount === 0 && (recentCardActivity + recentAzureActivity) > 0) {
        status = "green";
        reason = `All ${totalPriorities} non-negotiable 2026 priorities have tracked workstreams, execution evidence is current, and no major blockers materially threaten June 7 readiness.`;
      } else if (halfOrLess || !lightningCovered || silentMissing.length >= 2 || majorBlockerCount >= 2) {
        status = "red";
        const parts: string[] = [];
        parts.push(`Only ${covered.length} of ${totalPriorities} non-negotiable 2026 priorities have a tracked workstream.`);
        if (untrackedActive.length > 0) parts.push(`${untrackedActive.length} more ${untrackedActive.length === 1 ? "is" : "are"} being discussed in meetings but remain untracked.`);
        if (silentMissing.length > 0) parts.push(`${silentMissing.length} have no visible activity at all.`);
        if (!lightningCovered) parts.push("Lightning Strike Event itself is not tracked.");
        parts.push("This means leadership has weak execution visibility and cannot honestly claim June 7 readiness.");
        reason = parts.join(" ");
      } else {
        status = "yellow";
        reason = `Coverage is partial (${covered.length}/${totalPriorities}). Meaningful momentum exists but ownership and tracking are incomplete — ${untrackedActive.length} priorit${untrackedActive.length === 1 ? "y is" : "ies are"} being worked on without a formal workstream, and ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} need attention before status can move to Green.`;
      }

      // Trend hint (informational only)
      if (prevRow && typeof prevRow.outcome_probability === "number" && typeof parsed.outcome_probability === "number") {
        const delta = parsed.outcome_probability - prevRow.outcome_probability;
        if (delta <= -5) evidence.push(`Probability down ${Math.abs(delta)} pts vs previous briefing.`);
        else if (delta >= 5) positives.push(`Probability up ${delta} pts vs previous briefing.`);
      }

      const confidence: "high" | "medium" | "low" = coverageRatio >= 0.8 ? "high" : coverageRatio >= 0.4 ? "medium" : "low";
      const label = status === "red" ? "Red" : status === "yellow" ? "Yellow" : "Green";

      const company_pulse_status = {
        status, label, reason,
        evidence, blockers, positive_signals: positives, confidence,
      };

      if (normalizedHubspotSignal.status !== "connected") {
        company_pulse_status.blockers.push(`Commercial visibility reduced — HubSpot is ${normalizedHubspotSignal.status}${normalizedHubspotSignal.degraded_reason ? ` (${normalizedHubspotSignal.degraded_reason})` : ""}.`);
      } else if (normalizedHubspotSignal.summary) {
        company_pulse_status.evidence.push(`HubSpot: ${normalizedHubspotSignal.summary}`);
      }
      if (normalizedAzureReposSignal.status !== "connected") {
        company_pulse_status.blockers.push(`Engineering delivery visibility reduced — Azure Repos is ${normalizedAzureReposSignal.status}${normalizedAzureReposSignal.degraded_reason ? ` (${normalizedAzureReposSignal.degraded_reason})` : ""}.`);
      } else if (normalizedAzureReposSignal.summary) {
        company_pulse_status.evidence.push(`Azure Repos: ${normalizedAzureReposSignal.summary}`);
      }
      if (slack_pulse?.degraded && slack_pulse?.degraded_codes?.length) {
        company_pulse_status.blockers.push(`Slack visibility is partial — ${slack_pulse.degraded_codes.join(", ")}.`);
      }

      parsed.payload.company_pulse_status = company_pulse_status;

      // Force company_pulse prose to begin with the server status + reason.
      const aiPulse = typeof parsed.payload.company_pulse === "string" ? parsed.payload.company_pulse.trim() : "";
      const startsWithStatus = aiPulse.toUpperCase().startsWith(label.toUpperCase());
      if (!aiPulse || !startsWithStatus) {
        parsed.payload.company_pulse = `${label.toUpperCase()} — ${reason}`;
      }

      // Force brutal_truth + tldr.where_to_act to mention worst critical-red domain.
      const worst = data_coverage_audit.worst_red_domain;
      if (worst && data_coverage_audit.critical_reds.length > 0) {
        const bt = typeof parsed.payload.brutal_truth === "string" ? parsed.payload.brutal_truth.trim() : "";
        const mentionsDomain = bt.toLowerCase().includes(worst.label.toLowerCase());
        if (!bt || !mentionsDomain) {
          parsed.payload.brutal_truth = `${bt ? bt + " " : ""}Duncan is flying blind on ${worst.label} — no data exists for it, so any confidence projected here is theatre, not analysis.`;
        }
        parsed.payload.tldr = parsed.payload.tldr || {};
        const wta = typeof parsed.payload.tldr.where_to_act === "string" ? parsed.payload.tldr.where_to_act.trim() : "";
        const mentionsUpload = wta.toLowerCase().includes(worst.label.toLowerCase());
        if (!wta || !mentionsUpload) {
          parsed.payload.tldr.where_to_act = `${wta ? wta + " " : ""}${worst.recommendation || `Upload ${worst.label} documents to /projects to remove this blind spot.`}`;
        }
      }

      // 7. Risk Radar reconciliation — risks must explain the headline.
      const outcomeProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : 50;
      const execScore = typeof parsed.execution_score === "number" ? parsed.execution_score : 60;
      const probabilityGap = Math.max(0, 100 - outcomeProb);
      const headlineIsRed = outcomeProb < 50 || execScore < 60;

      let risks: any[] = Array.isArray(parsed.payload.risks)
        ? parsed.payload.risks.filter((r: any) => r && typeof r === "object" && !Array.isArray(r))
        : [];
      let autoInjectedCount = 0;

      // 7a. Inject synthetic risk for every silent priority not already named in risks.
      for (const sm of silentMissing) {
        const priorityName = sm.priority || "";
        const firstWord = priorityName.toLowerCase().split(/[\s—-]+/)[0] || "";
        const alreadyNamed = risks.some((r: any) =>
          typeof r?.risk === "string" && firstWord && r.risk.toLowerCase().includes(firstWord)
        );
        if (alreadyNamed) continue;
        risks.push({
          risk: `${priorityName} is silent — no meetings, no workstreams, no owner activity in the last 7 days`,
          why_it_matters: "A 2026 non-negotiable priority with zero signal cannot be tracked, evaluated, or de-risked. Invisible work = unmanaged work.",
          impact_7d: { window: "7d", impact: "Status unknown — Duncan cannot judge readiness.", mitigation: "CEO assigns a named owner this week." },
          impact_30d: { window: "30d", impact: "Slip risk compounds — dependent priorities start to drift.", mitigation: "Stand up a formal workstream with weekly check-ins." },
          impact_90d: { window: "90d", impact: "June 7 readiness materially impaired if still unowned.", mitigation: "Escalate to board if no owner accepts." },
          owner: "Unassigned — CEO to allocate",
          severity: "high",
          confidence: 90,
          probability_impact_pts: 15,
          auto_injected: true,
          auto_injected_reason: "silent_priority",
        });
        autoInjectedCount++;
      }

      // 7b. If headline is red but no critical/high risk exists, upgrade top + add system note.
      if (headlineIsRed) {
        const hasHighSev = risks.some((r: any) => {
          const s = String(r?.severity || "").toLowerCase();
          return s === "critical" || s === "high";
        });
        if (!hasHighSev && risks.length > 0) {
          // Upgrade the risk with the largest probability_impact_pts (or first one).
          let topIdx = 0;
          let topPts = -1;
          risks.forEach((r: any, i: number) => {
            const pts = typeof r?.probability_impact_pts === "number" ? r.probability_impact_pts : 0;
            if (pts > topPts) { topPts = pts; topIdx = i; }
          });
          risks[topIdx] = { ...risks[topIdx], severity: "high", auto_upgraded: true };
        }
        if (!hasHighSev) {
          risks.push({
            risk: `Outcome probability is ${outcomeProb}% and execution is ${execScore}/100 — the listed risks under-explain the gap`,
            why_it_matters: "When the headline says red but the radar shows nothing critical, Duncan is missing risks. Verify with owners before any board sign-off.",
            impact_7d: { window: "7d", impact: "Decisions based on this briefing may be premature.", mitigation: "Walk through risks live with each direct report." },
            impact_30d: { window: "30d", impact: "Risk model drifts further from reality.", mitigation: "Force a structured risk review per workstream." },
            impact_90d: { window: "90d", impact: "Material surprise risk by June 7.", mitigation: "Independent review of the risk register." },
            owner: "CEO",
            severity: "high",
            confidence: 80,
            probability_impact_pts: Math.max(10, probabilityGap - risks.reduce((s: number, r: any) => s + (Number(r?.probability_impact_pts) || 0), 0)),
            auto_injected: true,
            auto_injected_reason: "headline_under_explained",
          });
          autoInjectedCount++;
        }
      }

      // 7c. Normalize probability_impact_pts. Ensure each is a positive int and sum is within ±10 of gap.
      // First, default missing values: estimate from severity.
      const sevToPts: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3 };
      for (const r of risks) {
        const pts = Number(r?.probability_impact_pts);
        if (!Number.isFinite(pts) || pts <= 0) {
          const sev = String(r?.severity || "medium").toLowerCase();
          r.probability_impact_pts = sevToPts[sev] ?? 8;
        } else {
          r.probability_impact_pts = Math.max(1, Math.round(pts));
        }
      }

      const rawSum = risks.reduce((s: number, r: any) => s + (r.probability_impact_pts || 0), 0);
      // Scale toward the gap if we're significantly off and have risks to scale.
      if (probabilityGap > 0 && rawSum > 0 && Math.abs(rawSum - probabilityGap) > 10 && risks.length > 0) {
        const scale = probabilityGap / rawSum;
        // Only scale DOWN if over-attributed; if under-attributed, leave to surface unexplained_pts.
        if (rawSum > probabilityGap) {
          for (const r of risks) {
            r.probability_impact_pts = Math.max(1, Math.round((r.probability_impact_pts || 0) * scale));
          }
        }
      }

      // 7d. Sort by probability_impact_pts DESC.
      risks.sort((a: any, b: any) => (b.probability_impact_pts || 0) - (a.probability_impact_pts || 0));

      const accountedForPts = risks.reduce((s: number, r: any) => s + (r.probability_impact_pts || 0), 0);
      const unexplainedPts = Math.max(0, probabilityGap - accountedForPts);

      parsed.payload.risks = risks;
      parsed.payload.risk_reconciliation = {
        outcome_probability: outcomeProb,
        execution_score: execScore,
        probability_gap: probabilityGap,
        accounted_for_pts: accountedForPts,
        unexplained_pts: unexplainedPts,
        auto_injected_count: autoInjectedCount,
        warning: unexplainedPts > 10
          ? `${unexplainedPts} pts of probability loss not explained by listed risks — Duncan may be missing a risk.`
          : null,
      };
    }

    // ─── 8. Cross-Functional Friction post-processor (corroboration filter + score) ──
    // Goal: NEVER let email volume be the headline. A friction item must be
    // grounded in ≥2 NON-EMAIL systems. Email is supporting evidence only.
    if (briefing_type === "morning") {
      parsed.payload = parsed.payload || {};
      let friction: any[] = Array.isArray(parsed.payload.friction) ? [...parsed.payload.friction] : [];
      let frictionAutoInjected = 0;
      let frictionDroppedEmailOnly = 0;
      let frictionDroppedSingleSystem = 0;

      const NON_EMAIL_SYSTEMS = new Set([
        "workstream", "azure", "meeting", "calendar", "xero", "release", "document",
      ]);

      const normaliseSystems = (raw: any, evSrc: string): string[] => {
        const out = new Set<string>();
        if (Array.isArray(raw)) {
          for (const s of raw) {
            const v = String(s || "").toLowerCase().trim();
            if (!v) continue;
            const mapped = v === "workstream_card" ? "workstream"
              : v === "doc_conflict" ? "document"
              : v === "silent_leader" ? "workstream"
              : v === "coverage_gap" ? "workstream"
              : v;
            out.add(mapped);
          }
        }
        const ev = String(evSrc || "").toLowerCase();
        const evMap: Record<string, string> = {
          workstream_card: "workstream",
          meeting: "meeting",
          coverage_gap: "workstream",
          silent_leader: "workstream",
          doc_conflict: "document",
          azure: "azure",
          xero: "xero",
          calendar: "calendar",
          email: "email",
        };
        if (evMap[ev]) out.add(evMap[ev]);
        return Array.from(out);
      };

      const computeScore = (f: any): number => {
        const explicit = Number(f?.friction_score);
        if (Number.isFinite(explicit) && explicit > 0) return Math.max(0, Math.min(100, Math.round(explicit)));
        const teams = Array.isArray(f?.teams) ? f.teams.length : 0;
        const sys = normaliseSystems(f?.systems, f?.evidence_source).filter((s) => NON_EMAIL_SYSTEMS.has(s)).length;
        const blob = `${f?.issue || ""} ${f?.consequence || ""} ${f?.business_impact || ""}`.toLowerCase();
        const cust = /customer|client|revenue|deal|invoice|launch|board|investor/.test(blob) ? 22 : 8;
        const recur = /recurring|repeat|again|every (week|day)|chronic/.test(blob) ? 12 : 4;
        const ownership = /unowned|no owner|unassigned|unclear|nobody/.test(blob) ? 13 : 5;
        const delay = /stuck|stall|stale|blocked|overdue|delayed|days/.test(blob) ? 17 : 6;
        const cross = Math.min(25, teams * 8) + Math.min(10, sys * 3);
        return Math.max(0, Math.min(100, cross + delay + ownership + cust + recur));
      };

      const computeUrgency = (score: number, blob: string): "red" | "yellow" => {
        if (score >= 70) return "red";
        if (/customer|revenue|launch|board/.test(blob) && score >= 55) return "red";
        return "yellow";
      };

      // 8a. Inject friction for silent priorities — ONLY when ≥2 corroborating
      //     non-email signals exist (stuck card, related Azure work item, or
      //     recent meeting mention). Otherwise it's a coverage gap, not friction.
      const cardBlobAll = (Array.isArray(allCards) ? allCards : [])
        .map((c: any) => `${c?.title || ""} ${c?.project_tag || ""} ${c?.description || ""}`).join(" \n ").toLowerCase();
      const azureBlobAll = (Array.isArray(allWorkItems) ? allWorkItems : [])
        .map((w: any) => `${w?.title || ""} ${w?.area_path || ""} ${w?.tags || ""}`).join(" \n ").toLowerCase();
      const meetingBlob = (Array.isArray(meetings) ? meetings : [])
        .map((m: any) => `${m?.title || ""} ${m?.summary || ""}`).join(" \n ").toLowerCase();

      const silentMissing = (Array.isArray(missing) ? missing : []).filter((mm: any) => {
        const sig = signalsByPriority?.get?.(mm.priority_id);
        return !sig || (Array.isArray(sig.mentions) && sig.mentions.length === 0);
      });

      const frictionMentions = (needle: string): boolean => {
        if (!needle) return false;
        const n = needle.toLowerCase();
        return friction.some((f: any) => {
          const blob = `${f?.issue || ""} ${f?.consequence || ""} ${(Array.isArray(f?.teams) ? f.teams.join(" ") : f?.teams) || ""}`.toLowerCase();
          return blob.includes(n);
        });
      };

      for (const sm of silentMissing) {
        const priorityName = sm.priority || "";
        const firstWord = priorityName.toLowerCase().split(/[\s—-]+/)[0] || "";
        if (!firstWord) continue;
        if (frictionMentions(firstWord)) continue;
        const corroboratingSystems: string[] = [];
        if (cardBlobAll.includes(firstWord)) corroboratingSystems.push("workstream");
        if (azureBlobAll.includes(firstWord)) corroboratingSystems.push("azure");
        if (meetingBlob.includes(firstWord)) corroboratingSystems.push("meeting");
        if (corroboratingSystems.length < 2) continue; // not friction — leave for coverage_gaps
        const ownerName = sm.expected_owner || "Unassigned";
        const score = 78;
        friction.push({
          issue: `${priorityName}: active execution but no accountable owner`,
          description: `Work is happening across ${corroboratingSystems.join(", ")} but ${ownerName} is silent — handoff between strategy and execution is broken.`,
          teams: [ownerName, "Cross-functional"],
          systems: corroboratingSystems,
          why_friction: "Active work in multiple systems with no leader holding the priority — execution drifts without a single accountable owner.",
          evidence: `Cross-system activity referencing "${firstWord}" found in ${corroboratingSystems.join(" + ")}; expected owner ${ownerName} has no signal.`,
          business_impact: `${priorityName} target at risk; no team is structurally accountable.`,
          urgency: "red" as const,
          next_action: `CEO 1:1 with ${ownerName} to confirm ownership or reassign the priority.`,
          suggested_owner: "CEO",
          friction_score: score,
          consequence: `${priorityName} target at risk; no team is structurally accountable.`,
          evidence_source: "silent_leader",
          recommended_resolver: "CEO",
          auto_injected: true,
          auto_injected_reason: "silent_priority_with_corroboration",
        });
        frictionAutoInjected++;
      }

      // 8b. (REMOVED) Email-only escalation auto-injection.
      //     Email is no longer permitted as a standalone friction signal.

      // 8c. (REMOVED) Red-briefing meta-fallback. Empty friction[] is now an
      //     honest signal — the UI will render an explicit explanation.

      // Filter out any model-emitted friction grounded only in email,
      // or that fails the ≥2-non-email-system corroboration rule.
      friction = friction.filter((f: any) => {
        const sys = normaliseSystems(f?.systems, f?.evidence_source);
        const nonEmail = sys.filter((s) => NON_EMAIL_SYSTEMS.has(s));
        const evSrc = String(f?.evidence_source || "").toLowerCase();
        if (evSrc === "email" && nonEmail.length === 0) {
          frictionDroppedEmailOnly++;
          return false;
        }
        if (nonEmail.length < 2 && !f?.auto_injected) {
          frictionDroppedSingleSystem++;
          return false;
        }
        return true;
      });

      friction = friction.map((f: any) => {
        const sys = normaliseSystems(f?.systems, f?.evidence_source);
        const score = computeScore(f);
        const blob = `${f?.issue || ""} ${f?.consequence || ""} ${f?.business_impact || ""}`.toLowerCase();
        const urgencyRaw = String(f?.urgency || "").toLowerCase();
        const urgency: "red" | "yellow" =
          urgencyRaw === "red" ? "red"
          : urgencyRaw === "yellow" ? "yellow"
          : computeUrgency(score, blob);
        const validEvSrc = ["workstream_card", "meeting", "coverage_gap", "silent_leader", "doc_conflict", "azure", "xero", "calendar"];
        const evidence_source = validEvSrc.includes(String(f?.evidence_source)) ? f.evidence_source : "workstream_card";
        const teamsArr = Array.isArray(f?.teams)
          ? f.teams.filter(Boolean).map((t: any) => String(t))
          : (f?.teams ? [String(f.teams)] : []);
        return {
          issue: String(f?.issue || "").trim() || "Unspecified friction",
          description: String(f?.description || "").trim(),
          teams: teamsArr,
          systems: sys,
          why_friction: String(f?.why_friction || "").trim(),
          evidence: String(f?.evidence || "").trim(),
          business_impact: String(f?.business_impact || f?.consequence || "").trim(),
          urgency,
          next_action: String(f?.next_action || "").trim(),
          suggested_owner: String(f?.suggested_owner || f?.recommended_resolver || "CEO").trim() || "CEO",
          friction_score: score,
          consequence: String(f?.consequence || f?.business_impact || "").trim(),
          evidence_source,
          recommended_resolver: String(f?.recommended_resolver || f?.suggested_owner || "CEO").trim() || "CEO",
          auto_injected: !!f?.auto_injected,
          ...(f?.auto_injected_reason ? { auto_injected_reason: f.auto_injected_reason } : {}),
        };
      });

      friction.sort((a, b) => (b.friction_score || 0) - (a.friction_score || 0));
      friction = friction.slice(0, 5);

      parsed.payload.friction = friction;

      // Build sources_unavailable honestly from actual fetch outcomes.
      const sourcesUnavailable: string[] = [];
      if (!slack_pulse) sourcesUnavailable.push("slack_inbound");
      if (normalizedHubspotSignal.status !== "connected" || !normalizedHubspotSignal.summary) sourcesUnavailable.push("hubspot");
      if (normalizedAzureReposSignal.status !== "connected" || !normalizedAzureReposSignal.summary) sourcesUnavailable.push("azure_repos");

      // Per-pass tally from the LLM-emitted friction items (best-effort)
      const passTally = { A: 0, B: 0, C: 0, D: 0, unspecified: 0 };
      for (const f of friction) {
        const p = String((f as any)?.pass || "").toUpperCase();
        if (p === "A" || p === "B" || p === "C" || p === "D") passTally[p]++;
        else passTally.unspecified++;
      }

      parsed.payload.friction_meta = {
        total: friction.length,
        auto_injected: frictionAutoInjected,
        dropped_email_only: frictionDroppedEmailOnly,
        dropped_single_system: frictionDroppedSingleSystem,
        sources_unavailable: sourcesUnavailable,
        slack_pulse_error: slack_pulse_error || null,
        email_pulse_error: email_pulse_error || null,
        hubspot_signal_error: hubspot_signal_error || null,
        azure_repos_signal_error: azure_repos_signal_error || null,
        scanned: {
          workstream_cards: Array.isArray(cards) ? (cards as any[]).length : 0,
          azure_work_items: Array.isArray(workItems) ? workItems.length : 0,
          meetings_7d: Array.isArray(meetings) ? meetings.length : 0,
          slack_channels_scanned: (slack_pulse as any)?.channels_scanned || 0,
          slack_channels_member: (slack_pulse as any)?.channels_member || 0,
          slack_channels_total: (slack_pulse as any)?.channels_total || 0,
          slack_messages: (slack_pulse as any)?.messages_analysed || 0,
          email_mailboxes_scanned: (email_pulse as any)?.mailboxes_eligible || 0,
          email_mailboxes_total: (email_pulse as any)?.mailboxes_total || 0,
          xero_invoices: Array.isArray(xeroInvoices) ? xeroInvoices.length : 0,
          releases: Array.isArray(releases) ? releases.length : 0,
          priorities_checked: PRIORITY_DEFINITIONS.length,
        },
        passes: passTally,
        rule: "4-pass scan (A: strategy alignment · B: cards↔Azure consistency · C: cross-system corroboration · D: strategic drift). Each item must cite ≥2 non-email systems.",
      };
    }

    // 4f. DETERMINISTIC DECISIONS FLOOR — guarantees Section 9 is never empty on a non-green briefing.
    if (briefing_type === "morning") {
      parsed.payload = parsed.payload || {};
      const aiDecisions: any[] = Array.isArray(parsed.payload.decisions) ? [...parsed.payload.decisions] : [];
      let decisionsAutoInjected = 0;

      const dnorm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const decisionKey = (d: any) => dnorm(d?.decision).slice(0, 80);
      const seen = new Set<string>(aiDecisions.map(decisionKey).filter(Boolean));
      const hasDecision = (text: string) => {
        const k = dnorm(text).slice(0, 80);
        if (!k) return false;
        if (seen.has(k)) return true;
        for (const ek of seen) {
          if (!ek) continue;
          if (ek.includes(k) || k.includes(ek)) return true;
        }
        return false;
      };
      const pushDecision = (d: any, urgency: number) => {
        const key = decisionKey(d);
        if (!key || seen.has(key)) return;
        seen.add(key);
        aiDecisions.push({ ...d, _urgency: urgency });
        decisionsAutoInjected++;
      };

      const cap = (parsed.payload?.data_coverage_audit as any)?.confidence_cap || "medium";
      const capConfidence = (c: string) => {
        const order = { high: 3, medium: 2, low: 1 } as const;
        const want = (order as any)[c] ?? 2;
        const max = (order as any)[cap] ?? 2;
        return want <= max ? c : cap;
      };

      // (a) Coverage gaps + (b) silent priorities → assign owner.
      const coverageGaps: any[] = Array.isArray(parsed.payload.coverage_gaps) ? parsed.payload.coverage_gaps : [];
      const silentMissingDec = (Array.isArray(missing) ? missing : []).filter((mm: any) => {
        const sig = signalsByPriority?.get?.(mm.priority_id);
        return !sig || (Array.isArray(sig.mentions) && sig.mentions.length === 0);
      });
      const allUncovered = [
        ...coverageGaps.map((g: any) => ({ priority: g?.priority || g?.priority_title || g?.title, priority_id: g?.priority_id, expected_owner: g?.expected_owner })),
        ...silentMissingDec.map((sm: any) => ({ priority: sm?.priority, priority_id: sm?.priority_id, expected_owner: sm?.expected_owner })),
      ].filter((x) => x.priority);
      const seenPriority = new Set<string>();
      for (const u of allUncovered) {
        const pk = dnorm(u.priority);
        if (!pk || seenPriority.has(pk)) continue;
        seenPriority.add(pk);
        const def = PRIORITY_DEFINITIONS.find((p) => p.id === u.priority_id);
        const owner = def?.expected_owner || u.expected_owner || "Cross-functional — escalate to CEO";
        const decisionText = `Assign accountable owner and stand up workstream for ${u.priority}`;
        if (hasDecision(decisionText)) continue;
        pushDecision({
          decision: decisionText,
          why_it_matters: `${u.priority} is a 2026 priority with no owned workstream — the company cannot deliver against a plan no-one is running.`,
          consequence: `Another 7 days of zero attributable activity — risk of missing the priority outright.`,
          who_to_involve: owner,
          confidence: capConfidence("high"),
          blocked_by_missing_data: null,
          evidence_source: "silent_priority",
          auto_injected: true,
        }, 100);
      }

      // (c) High/critical risks → mitigation call.
      const risksArr: any[] = Array.isArray(parsed.payload.risks)
        ? parsed.payload.risks.filter((r: any) => r && typeof r === "object" && !Array.isArray(r))
        : [];
      for (const r of risksArr) {
        const sev = String(r?.severity || "").toLowerCase();
        if (sev !== "high" && sev !== "critical") continue;
        const title = String(r?.risk || r?.title || r?.name || "").trim();
        if (!title) continue;
        const impact = Number(r?.probability_impact_pts || 0);
        const decisionText = `Decide mitigation path for "${title}" or accept the ${impact}-pt probability hit`;
        if (hasDecision(decisionText)) continue;
        pushDecision({
          decision: decisionText,
          why_it_matters: `${sev.toUpperCase()} risk accounting for ${impact} pts of the outcome-probability gap.`,
          consequence: `If unaddressed for 7 days, baseline outcome probability stays anchored at the lower bound.`,
          who_to_involve: r?.owner || "CEO + accountable function lead",
          confidence: capConfidence(sev === "critical" ? "high" : "medium"),
          blocked_by_missing_data: null,
          evidence_source: "risk",
          auto_injected: true,
        }, 80 + Math.min(impact, 20));
      }

      // (d) CEO-resolved friction.
      const frictionArr: any[] = Array.isArray(parsed.payload.friction)
        ? parsed.payload.friction.filter((f: any) => f && typeof f === "object" && !Array.isArray(f))
        : [];
      for (const f of frictionArr) {
        const resolver = String(f?.recommended_resolver || "").toLowerCase();
        if (!resolver.includes("ceo")) continue;
        const teams = Array.isArray(f?.teams) ? f.teams.join("/") : "teams";
        const issue = String(f?.issue || "").trim();
        if (!issue) continue;
        const decisionText = `Break ${teams} deadlock on ${issue}`;
        if (hasDecision(decisionText)) continue;
        pushDecision({
          decision: decisionText,
          why_it_matters: f?.consequence || "Cross-functional friction with no single owner who can unblock it.",
          consequence: f?.consequence || "Friction compounds and the dependent priority slips.",
          who_to_involve: teams,
          confidence: capConfidence("medium"),
          blocked_by_missing_data: null,
          evidence_source: "friction",
          auto_injected: true,
        }, 70);
      }

      // (e) Critical email signals — board mentions, unowned commitments, escalations.
      try {
        const sigs = (email_pulse?.signals as any) || {};
        const board: any[] = Array.isArray(sigs.board_mentions) ? sigs.board_mentions : [];
        for (const b of board.slice(0, 2)) {
          const topic = String(b?.topic || b?.subject || b?.summary || "board mention").trim();
          const decisionText = `Decide CEO response to board signal: ${topic}`;
          if (hasDecision(decisionText)) continue;
          pushDecision({
            decision: decisionText,
            why_it_matters: "Board-level mention surfaced in leadership inbox in the last 24h.",
            consequence: "Silence reads as misalignment to the board.",
            who_to_involve: b?.from || "CEO + Chair",
            confidence: capConfidence("medium"),
            blocked_by_missing_data: null,
            evidence_source: "email",
            auto_injected: true,
          }, 75);
        }
        const unownedC: any[] = (Array.isArray(sigs.commitments) ? sigs.commitments : [])
          .filter((c: any) => !c?.owner || /unknown|tbd|n\/?a/i.test(String(c.owner)));
        for (const c of unownedC.slice(0, 2)) {
          const topic = String(c?.topic || c?.commitment || c?.summary || "ownerless commitment").trim();
          const decisionText = `Assign owner for ownerless commitment: ${topic}`;
          if (hasDecision(decisionText)) continue;
          pushDecision({
            decision: decisionText,
            why_it_matters: "Commitment made externally with no internal owner — accountability gap.",
            consequence: "Commitment slips silently with no-one tracking delivery.",
            who_to_involve: "CEO to allocate",
            confidence: capConfidence("medium"),
            blocked_by_missing_data: null,
            evidence_source: "email",
            auto_injected: true,
          }, 60);
        }
      } catch (_) { /* non-fatal */ }

      // (f) Silent leaders owning 2026 priorities — CEO intervention.
      try {
        const lsm: any[] = Array.isArray(leader_signal_map) ? leader_signal_map : [];
        for (const ls of lsm) {
          if (String(ls?.signal_status || "").toLowerCase() !== "silent") continue;
          const owns: string[] = Array.isArray(ls?.owns_priorities) ? ls.owns_priorities : [];
          if (owns.length === 0) continue;
          const decisionText = `Intervene with ${ls?.name || "silent leader"} — silent owner of ${owns.join(" + ")}`;
          if (hasDecision(decisionText)) continue;
          pushDecision({
            decision: decisionText,
            why_it_matters: `${ls?.name || "Leader"} owns ${owns.length} 2026 priority(ies) but produced no operational signal in 7 days.`,
            consequence: `Owned priorities continue with no visible ownership — unrecoverable if silence extends another week.`,
            who_to_involve: ls?.name || "Direct report",
            confidence: capConfidence("high"),
            blocked_by_missing_data: null,
            evidence_source: "silent_leader",
            auto_injected: true,
          }, 85);
        }
      } catch (_) { /* non-fatal */ }

      // (g) Confidence-cap blind spot — proceed-or-pause call.
      try {
        const dca: any = parsed.payload?.data_coverage_audit || {};
        const capLevel = String(dca?.confidence_cap || "high").toLowerCase();
        if (capLevel === "medium" || capLevel === "low") {
          const worst = dca?.worst_red_domain;
          const label = worst?.label || "critical knowledge domain";
          const decisionText = `Proceed with upcoming commitments OR pause until ${label} blind spot is closed`;
          if (!hasDecision(decisionText)) {
            pushDecision({
              decision: decisionText,
              why_it_matters: `Briefing confidence is capped at "${capLevel}" because ${label} evidence is missing — material decisions cannot be made honestly.`,
              consequence: `Decisions made under this cap carry undisclosed risk to board, customers, or launch.`,
              who_to_involve: "CEO + domain owner for " + label,
              confidence: capConfidence("high"),
              blocked_by_missing_data: `${label}: ${worst?.recommendation || "required artifacts not uploaded"}`,
              evidence_source: "data_blind_spot",
              auto_injected: true,
            }, 90);
          }
        }
      } catch (_) { /* non-fatal */ }

      // Final fallback — non-green briefing with zero decisions is itself a finding.
      const _outcomeProb = typeof parsed.outcome_probability === "number" ? parsed.outcome_probability : 50;
      const _trajectoryGreen = String(parsed.trajectory || "").toLowerCase().includes("on track");
      const _coverageGapsLen = Array.isArray(parsed.payload?.coverage_gaps) ? parsed.payload.coverage_gaps.length : 0;
      const isNonGreen = !_trajectoryGreen || _outcomeProb < 70 || _coverageGapsLen > 0;
      if (aiDecisions.length === 0 && isNonGreen) {
        pushDecision({
          decision: "Verify Duncan has visibility into priorities, risks and inboxes — no CEO-grade decisions detected on a non-green briefing",
          why_it_matters: "An empty Decisions section on a non-green briefing means Duncan cannot see the company clearly enough to surface a CEO call.",
          consequence: "CEO operates blind to the calls only they can make.",
          who_to_involve: "Duncan",
          confidence: "low",
          blocked_by_missing_data: "Decision detection produced no candidates from coverage gaps, risks, friction, email or leader signals.",
          evidence_source: null,
          auto_injected: true,
        }, 50);
      }

      // Sort by urgency DESC, keep top 3 for the UI, strip _urgency.
      aiDecisions.sort((a: any, b: any) => (b?._urgency ?? 0) - (a?._urgency ?? 0));
      const top = aiDecisions.slice(0, 3).map((d: any) => {
        const { _urgency, ...rest } = d;
        return {
          decision: String(rest?.decision || "").trim() || "Unspecified decision",
          why_it_matters: String(rest?.why_it_matters || "").trim() || "—",
          consequence: String(rest?.consequence || "").trim() || "—",
          who_to_involve: String(rest?.who_to_involve || "").trim() || "—",
          confidence: capConfidence(String(rest?.confidence || "medium").toLowerCase()),
          blocked_by_missing_data: rest?.blocked_by_missing_data ?? null,
          evidence_source: rest?.evidence_source ?? null,
          auto_injected: !!rest?.auto_injected,
        };
      });

      parsed.payload.decisions = top;
      parsed.payload.decisions_meta = {
        total_considered: aiDecisions.length,
        rendered: top.length,
        auto_injected: decisionsAutoInjected,
        confidence_cap: cap,
      };
    }

    if (email_pulse) {
      const sigs = email_pulse.signals || {};
      const commitments = Array.isArray(sigs.commitments) ? sigs.commitments : [];
      const risks = Array.isArray(sigs.risks) ? sigs.risks : [];
      const unowned = commitments.filter((c: any) => !c.owner || String(c.owner).trim() === "" || /unknown|tbd|n\/?a/i.test(String(c.owner))).length;
      const critical = risks.filter((r: any) => /critical|high/i.test(String(r.severity || ""))).length;

      parsed.payload = parsed.payload || {};
      parsed.payload.email_pulse = {
        window_hours: email_pulse.window_hours ?? 24,
        mailboxes_eligible: email_pulse.mailboxes_eligible ?? 0,
        mailboxes_total: email_pulse.mailboxes_total ?? 0,
        mailboxes_skipped_optout: email_pulse.mailboxes_skipped_optout ?? 0,
        emails_analysed: email_pulse.emails_analysed ?? 0,
        per_mailbox: email_pulse.per_mailbox ?? [],
        silent_leaders: email_pulse.silent_leaders ?? [],
        leadership_status: email_pulse.leadership_status ?? [],
        opted_out_mailboxes: email_pulse.opted_out_mailboxes ?? [],
        counts: {
          commitments: commitments.length,
          unowned_commitments: unowned,
          risks: risks.length,
          critical_risks: critical,
          escalations: Array.isArray(sigs.escalations) ? sigs.escalations.length : 0,
          board_mentions: Array.isArray(sigs.board_mentions) ? sigs.board_mentions.length : 0,
          customer_issues: Array.isArray(sigs.customer_issues) ? sigs.customer_issues.length : 0,
          vendor_signals: Array.isArray(sigs.vendor_signals) ? sigs.vendor_signals.length : 0,
        },
      };
    }

    if (slack_pulse) {
      const sigs = slack_pulse.signals || {};
      const commitments = Array.isArray(sigs.commitments) ? sigs.commitments : [];
      const risks = Array.isArray(sigs.risks) ? sigs.risks : [];
      const unowned = commitments.filter((c: any) => !c.owner || String(c.owner).trim() === "" || /unknown|tbd|n\/?a/i.test(String(c.owner))).length;
      const critical = risks.filter((r: any) => /critical|high/i.test(String(r.severity || ""))).length;

      parsed.payload = parsed.payload || {};
      parsed.payload.slack_pulse = {
        window_hours: slack_pulse.window_hours ?? 24,
        degraded: slack_pulse.degraded ?? false,
        degraded_reason: slack_pulse.degraded_reason ?? null,
        degraded_codes: slack_pulse.degraded_codes ?? [],
        visibility_scope: slack_pulse.visibility_scope ?? "full_public",
        channels_total: slack_pulse.channels_total ?? 0,
        channels_member: slack_pulse.channels_member ?? 0,
        channels_eligible: slack_pulse.channels_eligible ?? 0,
        channels_scanned: slack_pulse.channels_scanned ?? 0,
        messages_analysed: slack_pulse.messages_analysed ?? 0,
        not_member_channels_count: slack_pulse.not_member_channels_count ?? 0,
        inaccessible_private_channels_count: slack_pulse.inaccessible_private_channels_count ?? 0,
        history_failures_count: slack_pulse.history_failures_count ?? 0,
        channels_with_errors: slack_pulse.channels_with_errors ?? [],
        per_channel: slack_pulse.per_channel ?? [],
        silent_channels: slack_pulse.silent_channels ?? [],
        not_member_channels: slack_pulse.not_member_channels ?? [],
        counts: {
          commitments: commitments.length,
          unowned_commitments: unowned,
          escalations: Array.isArray(sigs.escalations) ? sigs.escalations.length : 0,
          confusion: Array.isArray(sigs.confusion) ? sigs.confusion.length : 0,
          customer_issues: Array.isArray(sigs.customer_issues) ? sigs.customer_issues.length : 0,
          risks: risks.length,
          critical_risks: critical,
        },
      };
    }

    parsed.payload = parsed.payload || {};
    parsed.payload.hubspot_signal = {
      status: normalizedHubspotSignal.status,
      connected: normalizedHubspotSignal.connected,
      credential_source: normalizedHubspotSignal.credential_source,
      verification_path: normalizedHubspotSignal.verification_path,
      last_sync_at: normalizedHubspotSignal.last_sync_at,
      error_code: normalizedHubspotSignal.error_code,
      error_message: normalizedHubspotSignal.error_message,
      metrics_summary: normalizedHubspotSignal.metrics_summary,
      accounts_scanned: normalizedHubspotSignal.accounts_scanned,
      stale_deals: normalizedHubspotSignal.stale_deals,
      at_risk_accounts: normalizedHubspotSignal.at_risk_accounts,
      active_deals_count: normalizedHubspotSignal.active_deals_count,
      active_deals: normalizedHubspotSignal.active_deals,
      at_risk_accounts_count: normalizedHubspotSignal.at_risk_accounts_count,
      at_risk_accounts_details: normalizedHubspotSignal.at_risk_accounts_details,
      key_contacts: normalizedHubspotSignal.key_contacts,
      escalations: normalizedHubspotSignal.customer_escalations,
      customer_escalations: normalizedHubspotSignal.customer_escalations,
      signals: normalizedHubspotSignal.signals,
      summary: normalizedHubspotSignal.summary,
      degraded_reason: normalizedHubspotSignal.degraded_reason,
      lists: Array.isArray((normalizedHubspotSignal as any)?.lists)
        ? (normalizedHubspotSignal as any).lists
        : Array.isArray((hubspot_signal as any)?.lists)
        ? (hubspot_signal as any).lists
        : [],
    };
    parsed.payload.azure_repos_signal = {
      status: normalizedAzureReposSignal.status,
      connected: normalizedAzureReposSignal.connected,
      credential_source: normalizedAzureReposSignal.credential_source,
      verification_path: normalizedAzureReposSignal.verification_path,
      last_sync_at: normalizedAzureReposSignal.last_sync_at,
      error_code: normalizedAzureReposSignal.error_code,
      error_message: normalizedAzureReposSignal.error_message,
      metrics_summary: normalizedAzureReposSignal.metrics_summary,
      repos_scanned: normalizedAzureReposSignal.repos_scanned,
      open_prs: normalizedAzureReposSignal.open_prs,
      blocked_prs: normalizedAzureReposSignal.blocked_prs,
      stale_prs: normalizedAzureReposSignal.stale_prs,
      release_risks: normalizedAzureReposSignal.release_risks,
      commits_7d: (normalizedAzureReposSignal as any).commits_7d,
      files_added_7d: (normalizedAzureReposSignal as any).files_added_7d,
      files_removed_7d: (normalizedAzureReposSignal as any).files_removed_7d,
      active_contributors_7d: (normalizedAzureReposSignal as any).active_contributors_7d,
      signals: normalizedAzureReposSignal.signals,
      summary: normalizedAzureReposSignal.summary,
      degraded_reason: normalizedAzureReposSignal.degraded_reason,
    };

    // ─── Automation Progress: ground in server data + recommendation floor ──
    if (briefing_type === "morning") {
      parsed.payload = parsed.payload || {};
      const ap = (parsed.payload.automation_progress && typeof parsed.payload.automation_progress === "object")
        ? parsed.payload.automation_progress : {};

      // Force company_usage and top_users to server-computed truth.
      ap.company_usage = automation_leverage.company_usage;
      ap.top_users = automation_leverage.top_users;

      // ─── Compute adoption_pct = active_users_30d / approved Kabuni headcount ──
      // This replaces the old misleading `automation.percent` (which falsely
      // implied "% of company workflows automated"). What we can actually
      // measure is *team adoption* of Duncan.
      let headcount = 12; // fallback if profiles query fails
      try {
        const { count } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("approval_status", "approved");
        if (typeof count === "number" && count > 0) headcount = count;
      } catch (_e) { /* keep fallback */ }
      const activeUsers30d = Number(automation_leverage?.company_usage?.active_users || 0);
      const adoption_pct = Math.max(0, Math.min(100, Math.round((activeUsers30d / Math.max(1, headcount)) * 100)));

      // Overwrite any LLM-authored automation.percent with the grounded adoption metric.
      const autoObj = (parsed.payload.automation && typeof parsed.payload.automation === "object")
        ? parsed.payload.automation : {};
      autoObj.percent = adoption_pct;
      autoObj.adoption_active_users = activeUsers30d;
      autoObj.adoption_headcount = headcount;
      parsed.payload.automation = autoObj;

      const modelRecs: any[] = Array.isArray(ap.recommendations) ? ap.recommendations.filter((r) => r && typeof r === "object" && r.title) : [];
      const isGreen = String(parsed.trajectory || "").toLowerCase() === "on track";

      // Deterministic floor — at least 3 recs whenever the briefing is non-green.
      const floorRecs: any[] = [];
      const seen = new Set(modelRecs.map((r) => String(r.title).toLowerCase().trim()));
      const pushRec = (rec: any) => {
        const key = String(rec.title).toLowerCase().trim();
        if (seen.has(key)) return;
        seen.add(key);
        floorRecs.push({ ...rec, auto_injected: true });
      };

      const coverageGaps: any[] = Array.isArray(parsed.payload?.coverage_gaps) ? parsed.payload.coverage_gaps : [];
      for (const g of coverageGaps.slice(0, 3)) {
        pushRec({
          title: `Auto-detect & flag activity on "${g.priority}"`,
          why_now: `No owned workstream for ${g.priority}. ${g.consequence_if_unowned || "Untracked priority risks slipping silently."}`,
          expected_leverage: "High",
          effort: "M",
          evidence_source: "coverage_gap",
        });
      }

      const friction: any[] = Array.isArray(parsed.payload?.friction) ? parsed.payload.friction : [];
      for (const f of friction.filter((x) => x && x.recommended_resolver && !/ceo/i.test(String(x.recommended_resolver))).slice(0, 2)) {
        pushRec({
          title: `Standardise the ${(f.teams || []).join(" ↔ ")} handoff for "${(f.issue || "").slice(0, 60)}"`,
          why_now: `Recurring cross-team friction routed to ${f.recommended_resolver}. Automating the handoff reduces CEO escalation.`,
          expected_leverage: "Medium",
          effort: "M",
          evidence_source: "friction",
        });
      }

      const wsScores: any[] = Array.isArray(parsed.workstream_scores) ? parsed.workstream_scores : [];
      const stuck = wsScores.filter((w) => {
        const r = String(w?.rag || "").toLowerCase();
        return r === "red" || r === "yellow" || r === "amber";
      });
      for (const w of stuck.slice(0, 2)) {
        pushRec({
          title: `Weekly auto-status digest for "${w.name}"`,
          why_now: `Workstream tracking ${w.rag || "non-green"} — automated weekly digests would surface drift before next briefing.`,
          expected_leverage: "Medium",
          effort: "S",
          evidence_source: "stuck_workstream",
        });
      }

      const heavy = automation_leverage.heavy_surfaces || ({} as any);
      if ((heavy.gmail_auto_drafts_today || 0) >= 5) {
        pushRec({
          title: "Auto-categorise inbound emails before drafting",
          why_now: `${heavy.gmail_auto_drafts_today} Gmail auto-drafts created today — adding triage classification would skip low-value threads.`,
          expected_leverage: "High",
          effort: "M",
          evidence_source: "heavy_manual_surface",
        });
      }
      if ((heavy.general_chats_top_users || 0) >= 30) {
        pushRec({
          title: "Saved workflows for repeat questions in general chat",
          why_now: `Top users issued ${heavy.general_chats_top_users}+ general-chat queries — promoting frequent flows to one-click actions reclaims time.`,
          expected_leverage: "Medium",
          effort: "S",
          evidence_source: "heavy_manual_surface",
        });
      }

      // Combine model + floor; cap to top 5 for UI density.
      const merged = [...modelRecs, ...floorRecs].slice(0, 5);

      // If still under 3 on a non-green briefing, add generic Duncan improvements.
      const generics = [
        { title: "Daily Duncan adoption digest to leadership", why_now: "Make leverage visible — share top users + automation gaps weekly so leaders pull Duncan into their flow.", expected_leverage: "Medium", effort: "S", evidence_source: "heavy_manual_surface" },
        { title: "One-click 'send this to a teammate' from any Duncan answer", why_now: "Reduce copy/paste friction. Most chat answers get re-shared manually — a share action would compound usage.", expected_leverage: "Medium", effort: "S", evidence_source: "heavy_manual_surface" },
        { title: "Slack DM nudge when a workstream goes silent for 7 days", why_now: "Silent owners drive Section 05 watchlist entries. Proactive nudges would resolve them before the CEO has to.", expected_leverage: "High", effort: "M", evidence_source: "stuck_workstream" },
      ];
      let i = 0;
      while (merged.length < 3 && !isGreen && i < generics.length) {
        const g = generics[i++];
        const key = g.title.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ ...g, auto_injected: true });
        }
      }

      ap.recommendations = merged.map((r) => ({
        title: String(r.title || ""),
        why_now: String(r.why_now || ""),
        expected_leverage: ["Low", "Medium", "High"].includes(r.expected_leverage) ? r.expected_leverage : "Medium",
        effort: ["S", "M", "L"].includes(r.effort) ? r.effort : "M",
        auto_injected: Boolean(r.auto_injected),
        evidence_source: r.evidence_source || "model",
      }));

      parsed.payload.automation_progress = ap;
    }

    await updateJob({ phase: "Persisting briefing", progress: 95 });

    const briefing_date = new Date().toISOString().slice(0, 10);

    const { data: saved, error: saveErr } = await admin
      .from("ceo_briefings")
      .upsert({
        briefing_date,
        briefing_type,
        trajectory: parsed.trajectory ?? null,
        outcome_probability: parsed.outcome_probability ?? null,
        execution_score: parsed.execution_score ?? null,
        workstream_scores: parsed.workstream_scores ?? [],
        payload: { ...(parsed.payload ?? {}), generation_meta: generationMeta },
        generated_by: userId,
      }, { onConflict: "briefing_date,briefing_type" })
      .select()
      .single();

    if (saveErr) {
      console.error("Save error:", saveErr);
      throw new Error(`Failed to persist briefing: ${saveErr.message}`);
    }

        await updateJob({
          status: "completed",
          phase: "Completed",
          progress: 100,
          briefing_id: saved?.id ?? null,
          error: null,
        });
        console.log(`[ceo-briefing] job=${jobId} completed briefing=${saved?.id}`);
      } catch (workerErr: any) {
        console.error(`[ceo-briefing] job=${jobId} failed:`, workerErr);
        await updateJob({
          status: "failed",
          phase: "Failed",
          error: String(workerErr?.message || workerErr || "Unknown error").slice(0, 1000),
        });
      } finally {
        clearInterval(heartbeatTimer);
      }
    };

    // Kick off the worker without awaiting it; respond to the client immediately.
    // EdgeRuntime.waitUntil keeps the function alive until the promise resolves.
    // @ts-ignore — EdgeRuntime is provided by Supabase's edge runtime.
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(runWorker());
    } else {
      // Fallback for non-Supabase runtimes (tests etc.) — fire-and-forget.
      runWorker();
    }

    return json({ job_id: jobId, status: "queued" });
  } catch (e: any) {
    console.error("ceo-briefing fatal:", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
