# Onboarding v2 — Module Introduction Layer

Goal: After existing onboarding completes, help new users understand how Duncan's modules fit together as one operating system — without replacing any existing flow.

Approach: **Hybrid** — short post-onboarding tour, persistent Learn hub for reference, Home "Getting Started" checklist, and lightweight Duncan-driven nudges in the first week.

---

## 1. What stays unchanged

Sign-up & approval, Gmail/Calendar connect, Personalization wizard, Welcome modal, and Workspace welcome email all remain exactly as they are. The new layer activates **after** `onboarding_completed_at` is set and **before** first workspace render.

---

## 2. New experience — three surfaces

### A. Post-onboarding tour: "Meet Duncan" (one-time, ~60 seconds)

A lightweight slide-based modal shown once, right after the user clicks "Activate Duncan" on the existing personalization step. Skippable at any time. 9 slides:

1. **Meet Duncan** — AI Teammate, Knowledge Assistant, Operations Assistant, Project Assistant. One screen, dog avatar, one-line role per pillar.
2. **Chat** — "Your fastest way to get anything done." Examples: retrieve info, search meetings, create work, summarize.
3. **Projects** — Strategic visibility: goals, milestones, owners, timelines.
4. **Workstreams** — Execution layer: kanban for ongoing operational work.
5. **Knowledge Base** — Organizational memory: docs, SOPs, policies, notes.
6. **Planner** — Priorities, deadlines, commitments, approvals.
7. **Settings & Personal Workspace** — Profile, Integrations, Request Feature, Bug Report (one slide, four mini-cards).
8. **How it fits together** — Single diagram: Chat at center; Projects/Workstreams/KB/Planner as petals; Profile + Integrations as foundation; Feedback as loop.
9. **You're ready** — CTA: "Go to Home" + "Replay anytime in Settings."

Each slide: icon, 1-line headline, 2-3 line description, one "Try it" link that deep-links to the module (does not exit the tour). Progress dots top, Back/Skip/Next bottom.

### B. Persistent Learn hub — `/learn`

A dedicated route accessible from the sidebar footer ("Learn Duncan") and from Settings. Same 8 module cards as the tour, but always available — used as reference and for returning users. Each card opens an expanded panel with:
- What it does
- When to use it
- 2-3 example prompts (for Chat) or example workflows (for others)
- Deep link into the module

### C. Home "Getting Started" checklist (dismissible)

Card on the Home dashboard, shown until dismissed or all items completed:

```text
Getting started with Duncan                              [Dismiss]
  [x] Connect Gmail & Calendar
  [x] Personalise Duncan
  [ ] Send your first chat message
  [ ] Create or open a Project
  [ ] Open a Workstream
  [ ] Add a document to Knowledge Base
  [ ] Review your Planner
  [ ] Replay the Meet Duncan tour →
```

Items auto-tick from real signals (existing tables: `general_chats`, `projects`, `workstream_cards`, `kb_documents`, etc.). No new background jobs — just queries.

---

## 3. Replay & re-entry

- **Settings → General**: "Replay Meet Duncan tour" button.
- **Home checklist**: "Replay tour" item always present.
- **Sidebar footer**: "Learn Duncan" link to `/learn` (always available).

---

## 4. First-week proactive nudges

Lightweight, non-intrusive. Driven by signals already in DB; no new cron.

| Trigger                                                | Nudge                                                                                |
|--------------------------------------------------------|--------------------------------------------------------------------------------------|
| 3+ chats sent, 0 projects opened                       | Duncan suggests: "Want me to show you Projects? They're where goals live."          |
| 0 KB documents after 5 days                            | Home card: "Add your first document so Duncan can answer from your knowledge."      |
| 0 workstream cards after 5 days                        | Home card: "Track ongoing work in Workstreams."                                     |
| Planner has pending approvals & user hasn't visited it | Home card pings Planner.                                                            |

Nudges show as small dismissible Home cards (not modal interrupts). Each can be dismissed forever via a `dismissed_nudges` array on `profiles`.

---

## 5. Wireframe — Meet Duncan tour

```text
┌──────────────────────────────────────────────────────────┐
│  ● ● ● ○ ○ ○ ○ ○ ○                              Skip ×   │
│                                                          │
│            [icon]                                        │
│                                                          │
│      Chat — your fastest way in                          │
│                                                          │
│      Ask anything. Duncan searches meetings,             │
│      retrieves knowledge, creates work, and              │
│      summarises across your tools.                       │
│                                                          │
│      → Try it in Chat                                    │
│                                                          │
│                                                          │
│  Back                                          Next →    │
└──────────────────────────────────────────────────────────┘
```

## 6. Wireframe — Learn hub `/learn`

```text
Learn Duncan
A quick guide to how everything fits together.

[Replay Meet Duncan tour]

┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ 💬 Chat     │ │ 📁 Projects │ │ ⚙ Workstr…  │ │ 📚 KB       │
│ Primary…    │ │ Strategic…  │ │ Execution…  │ │ Memory…     │
│ Open →      │ │ Open →      │ │ Open →      │ │ Open →      │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ 🗓 Planner   │ │ 👤 Profile  │ │ 🔌 Integr.  │ │ 🐞 Feedback │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘

How it works together
  Chat sits at the centre. Projects give strategic visibility,
  Workstreams drive execution, KB is memory, Planner manages
  priorities, Profile + Integrations personalise everything,
  Feedback closes the loop.
```

---

## 7. Technical details

**New files**
- `src/components/onboarding/MeetDuncanTour.tsx` — modal slide tour, reuses framer-motion patterns from `Onboarding.tsx`.
- `src/components/onboarding/moduleContent.ts` — single source of truth for the 8 module descriptions (used by tour, Learn hub, and Home checklist).
- `src/components/home/GettingStartedCard.tsx` — checklist card with auto-tick queries.
- `src/components/home/AdoptionNudges.tsx` — first-week nudge cards.
- `src/pages/Learn.tsx` — Learn hub route.

**Edits**
- `src/pages/Onboarding.tsx` — after `completeOnboarding`, navigate to `/?tour=meet-duncan` instead of `/`.
- `src/pages/Index.tsx` — auto-open `MeetDuncanTour` when `?tour=meet-duncan` is present; mount `GettingStartedCard` + `AdoptionNudges`.
- `src/App.tsx` — add `<Route path="/learn" element={<Learn />} />` inside `ProtectedShell`.
- `src/components/Sidebar.tsx` — add "Learn Duncan" link in the pinned footer.
- `src/components/settings/SettingsGeneral.tsx` — add "Replay Meet Duncan tour" button.

**Database** — single migration adds two columns to `profiles`:
- `meet_duncan_tour_completed_at timestamptz` — set when tour finishes or is skipped; absence = show on next visit.
- `dismissed_nudges text[] default '{}'` — for per-nudge dismissals and the Getting Started card.

No new tables, no new edge functions, no new cron.

**Replay logic**: clicking "Replay" sets `meet_duncan_tour_completed_at = null` and navigates to `/?tour=meet-duncan`.

**Tour content** lives in `moduleContent.ts` so future modules can be added in one place.

---

## 8. Out of scope (explicit)

- Interactive DOM coachmarks on the real UI (rejected in favour of a focused modal — simpler, more polished, easier to maintain).
- Per-module "first-visit" mini-tooltips.
- Video walkthroughs.
- Localisation of tour copy (English only for now).
