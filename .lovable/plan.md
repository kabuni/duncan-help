# Meeting-driven Project updates (design only)

Goal: meetings and Duncan Chat become two inputs into one task system. No Gemini integration, no database or production changes in this step — this is the proposed architecture for approval.

## 1. How a transcript enters Duncan

Transcripts land in the existing `meetings` store (same place Plaud and Google Meet notes already go), with the source recorded. A Gemini feed would simply be another source writing into that same store later.

Each stored meeting keeps: title, date, attendees, full transcript, and the existing AI analysis. Nothing is deleted or rewritten.

## 2. Understanding pass

When a meeting is stored, Duncan runs a single analysis that separates the transcript into two kinds of content:

- **Commitments** — someone agreed to do something, a status changed, a date moved, an owner changed, something is blocked, or a decision was made that affects work.
- **Context** — everything else: discussion, opinions, background, ideas without an owner.

Only commitments ever become task activity. Context is retained as meeting notes (see section 6).

Each commitment is captured as a proposed change with one of these intents:

| Intent | Example phrase |
| --- | --- |
| New task | "Sarah will send the revised school proposal by Friday" |
| Complete task | "the proposal went out yesterday" |
| Owner change | "actually James is picking this up" |
| Deadline change | "let's push that to the 20th" |
| Blocked | "we can't start until legal replies" |
| Decision affecting a task | "we're dropping the pilot school approach" |

## 3. Finding the right Project and Area of Work

Duncan resolves placement in this order, using records that already exist:

1. **Explicit mention** — a project or area name said in the meeting.
2. **Attendee overlap** — project members and area owners present in the meeting.
3. **Meaning match** — the commitment's wording compared against project names, area names, area descriptions and recent tasks.
4. **Recent activity** — projects the attendees have been working in lately.

Each placement gets a confidence level. If nothing clears the bar, the commitment is held for a human to place rather than guessed at.

Example: "Sarah will send the revised school proposal by Friday" → Project *Road to 400* → Area of Work *School Integration*.

## 4. Matching against existing tasks (no duplicates)

Within the chosen Area of Work, Duncan compares the commitment to existing tasks on wording, owner and subject. Three outcomes:

- **Strong match** → update the existing task (status, owner, due date, or a note) — never a second copy.
- **Possible match** → propose the update but ask which task is meant.
- **No match** → propose a new task.

Owners are resolved against the team directory (people, not free text). "Friday" is resolved to a real date relative to the meeting date.

## 5. Automatic versus confirmation

| Situation | Behaviour |
| --- | --- |
| Confident update to an existing task (deadline, owner, blocked, completed) | Applied automatically, logged in Activity, notification to the task owner |
| Confident new task with clear owner and date | Applied automatically, owner notified |
| Uncertain project/area, uncertain task match, or ambiguous owner/date | Held as a suggestion for review |
| Completion of someone else's task, or a decision that cancels/changes scope | Always asks — never auto-applies |

Everything auto-applied is reversible: the Activity entry names the meeting it came from, and one click undoes it.

A review surface (a "From meetings" list on the Project, plus a Duncan Chat prompt) shows pending suggestions with Accept / Edit / Dismiss. Dismissals teach Duncan not to re-raise the same line.

## 6. Keeping meeting context without making tasks

Each meeting is linked to the Project (and Area of Work where it's specific enough) and appears in Activity as a meeting entry with its summary, decisions and key points. Tasks that came from a meeting carry a reference back to it, so anyone can see where the commitment came from. Discussion that isn't a commitment stays as meeting context only.

## 7. Same system as Duncan Chat

Chat and meetings share one decision path: both produce the same kind of proposed change, both run through the same placement, matching and confirmation rules, and both write to the same task records. Duncan Chat can also answer "what changed in Road to 400 this week?" using meeting-sourced activity. There is no second task system and no separate meeting task list.

## 8. Technical outline

- Reuse the existing `meetings` records and analysis function; add a second stage that emits structured proposed changes rather than free-text actions.
- A shared resolver module (alongside the existing planner orchestrator pattern) does project/area resolution, task matching and owner resolution, called by both the meeting pipeline and Duncan Chat.
- New records needed when we build: proposed changes awaiting review, a link between meetings and projects/areas, and a source reference on tasks. These are additive only.
- Tasks continue to live on `workstream_tasks`; areas remain the existing workstream cards linked to a project.

## 9. Suggested build order

1. Structured extraction stage on existing stored meetings (read-only, produces suggestions).
2. Shared resolver for project/area/task/owner matching.
3. Review surface on the Project with Accept / Edit / Dismiss.
4. Auto-apply for high-confidence updates, with Activity entries and undo.
5. Gemini as a transcript source feeding the same pipeline.

No production data is touched, and nothing is built until this approach is approved.
