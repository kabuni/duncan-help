## Goal

Inside a Project workspace chat, let you build up a working to-do list as you brainstorm with Duncan, then hand it over to Duncan with one click to turn the items into proper workstream cards and tasks.

## How it will work (user-facing)

1. **A new "Planning checklist" panel** appears at the top of the project chat (collapsible, sticky).
   - Add items by typing + Enter, or via a small "+ Add to plan" button on any of Duncan's bullet points in the chat.
   - Each item has: title, optional notes, optional due date, optional assignee, and a checkbox.
   - Items can be reordered, edited, and grouped under a heading (becomes the card title).

2. **Duncan can populate it from chat.** When you say things like "draft a plan for the launch", Duncan will both reply normally AND emit suggested checklist items — these appear in the panel as "suggested" (greyed) until you accept them.

3. **"Send to Workstreams" button** at the bottom of the panel.
   - Opens a small confirm dialog: pick the project tag (Lightning Strike Event / Website / K10 App / School Integrations), pick assignees, optional due date.
   - Click Create → Duncan creates one workstream card per heading (or one card with all items as tasks if there are no headings), assigns them, and posts a confirmation message in the chat with links to the new cards.

4. The checklist persists with the chat (per-chat, per-project), so you can come back to it.

## Technical changes

### Database (1 migration)
- New table `project_chat_plan_items`:
  - `chat_id` (FK to chats), `project_id`, `user_id`
  - `group_title` (nullable — becomes card title)
  - `title`, `notes`, `due_date`, `assignee_profile_id`
  - `status`: `suggested` | `accepted` | `done` | `promoted`
  - `position` (int, for ordering)
  - `promoted_card_id`, `promoted_task_id` (set once items become workstream entries)
- RLS: only chat owner + project members can read/write items for that chat.

### Edge Functions
- **Update `chat-with-project-context`**:
  - Add tool calling support (currently has none) using OpenAI function-calling.
  - Tool 1 — `suggest_plan_items`: lets Duncan add suggested items to the checklist while replying. Items are inserted with `status='suggested'`.
  - Tool 2 — `promote_plan_to_workstream`: triggered when user clicks the button. Reads accepted items from the table, creates workstream cards + tasks (reusing the same logic already in `norman-chat`), updates each item with `promoted_card_id`/`promoted_task_id`, and returns a summary.
  - System prompt addition: "When a user describes a workflow or list of next steps, call `suggest_plan_items` to add them to the planning checklist for review."

### Frontend (`src/pages/ProjectWorkspace.tsx` + new components)
- New `src/components/projects/PlanningChecklist.tsx`:
  - Collapsible panel above the message list.
  - Shows live list (Supabase realtime on `project_chat_plan_items`).
  - Inline add, edit, delete, drag-to-reorder, mark-done, accept/reject suggested items.
  - Group separator rows (becomes card title).
  - "Send to Workstreams" button → opens `PromoteToWorkstreamDialog`.
- New `src/components/projects/PromoteToWorkstreamDialog.tsx`:
  - Pick project tag, default assignee, optional default due date.
  - Calls the `promote_plan_to_workstream` edge function.
  - On success: toast "Created N cards with M tasks" + link to /workstreams.
- Add small "+ Add to plan" affordance next to bullet points in Duncan's markdown replies (parses `- ` / `* ` lines from the most recent assistant message and offers a one-click capture).

### Reuse, not rebuild
- Card/task creation reuses the exact insert logic from `norman-chat` (`workstream_cards`, `workstream_tasks`, `workstream_card_assignees`, `workstream_activity`) so deduplication, RYG defaults (amber), and assignment behaviour stay consistent.

## Out of scope (for this round)
- No editing of cards/tasks from inside the chat after promotion (use the Workstreams board for that).
- No cross-chat plan merging.
- Items are owned by the chat — deleting the chat deletes its plan items.

Ready to build this when you approve.