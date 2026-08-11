# Task Classification: Workstream Cards vs To-Dos

Duncan currently has no real To-Do concept. "My Tasks" only aggregates workstream tasks and project planning items, and Duncan's chat instructions actively push it to create a Workstream Card whenever someone describes work. That's why individual actions keep becoming cards.

This plan adds a real To-Do list and teaches Duncan the classification rules from your document.

## 1. A real To-Do list

New To-Do store with:

- Title, optional notes, due date, priority
- Created by / assigned to (a To-Do can be assigned to a colleague; it then appears in their My Tasks)
- Done / not done, completed date
- Optional link back to a source (e.g. a meeting or chat) so you can see where it came from

Access rules: you can see and edit a To-Do if you created it or it's assigned to you. Nobody else can see it.

## 2. My Tasks becomes the To-Do home

- New "To-Dos" section at the top of My Tasks, alongside the existing Workstream and Project task lists
- Add a To-Do inline (title + due date + assignee), tick to complete, edit and delete
- Assigned-to-you To-Dos from colleagues show who assigned them
- To-Dos also flow into the Home dashboard's pending-task list so they aren't hidden away

## 3. Duncan learns the classification rules

Duncan's instructions get a new, high-priority section based on your document:

- Workstream Card = company-wide collaborative initiative involving multiple people or functions
- Task / subtask = pieces of work that exist *under* a card
- To-Do = an individual action (send an email, review a doc, prepare a report)
- Decision rule: collaborative company-wide initiative → Card; otherwise → To-Do
- On ambiguity, default to a To-Do — never invent a workstream structure
- Never use "project", "workstream", "task", "subtask" and "to-do" interchangeably

The existing card-creation instruction is rewritten so Duncan no longer proactively turns any described work into a card, and the card tool's description gains an explicit "do not use for individual actions" guard.

## 4. New Duncan capability: create To-Dos

- New `create_todo` tool so Duncan can capture individual actions as To-Dos (with assignee resolution via the existing team-member lookup, so "add a to-do for Ashish to send the deck" works)
- New `list_my_todos` tool so "what's on my to-do list" answers from To-Dos rather than workstream cards
- Meeting action items and chat-captured follow-ups route to To-Dos by default, and only become card tasks when they belong to an existing initiative

## 5. Behaviour when Duncan gets it wrong

If Duncan proposes a Card for something that's really an individual action, you can say "that's a to-do" and it will create the To-Do instead — the classification rules make this the fallback rather than the exception.

## Technical notes

- New `todos` table (`user_id` = assignee, `created_by`, `title`, `notes`, `due_date`, `priority`, `completed`, `completed_at`, `source_type`, `source_id`), RLS scoped to assignee or creator, plus grants and an `updated_at` trigger.
- New `useTodos` hook (list/create/toggle/update/delete) following the existing `useWorkstreams` query patterns; realtime not required (invalidate on mutation).
- `src/pages/MyTasks.tsx`: add a To-Dos section and a lightweight add/edit dialog reusing existing shadcn components; extend the unified task model with a `todo` kind.
- `src/hooks/useHomeDashboard.ts` `useMyPendingTasks`: include open To-Dos.
- `supabase/functions/norman-chat/index.ts`: add the classification section to the system prompt, revise the Workstream Management block and `create_workstream_card` description, and add `create_todo` / `list_my_todos` tool definitions plus their executor cases. To-Do creation executes directly (no confirmation gate) since it's low-risk and personal.
