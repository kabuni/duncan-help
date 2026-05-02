## Two issues, two fixes

### 1. Project chat composer is missing dashboard-chat features

**What you have today on the main dashboard ("New Chat" on Home):**
- Inline paperclip → attach up to 5 files (images, PDFs, docx, xlsx, csv, txt, md, json) with chip previews and 10MB cap
- Multimodal: images and documents are sent to Duncan as part of the message (vision + doc reasoning)
- Voice mic → press-to-talk, transcribe, drop into the input
- Streaming responses (Duncan's reply types out live)

**What the project chat has today:**
- Plain textarea, send button. That's it.
- File uploads only via the separate "Files" drawer (RAG ingestion, not multimodal in-message attachments).
- Non-streaming reply (full response appears at once after a spinner).
- No voice input.

**Plan: reuse the existing `<ChatInput />` component inside Projects.**

```text
ProjectWorkspace.tsx
  └── replace inline <textarea>+send button block (both the empty-state and active-chat versions)
      with <ChatInput onSubmit={handleSend} isLoading={sending} ... />
```

Backend changes to `chat-with-project-context` edge function:
- Accept `attachments: ChatAttachment[]` (same shape as `norman-chat`)
- For images → pass as multimodal `image_url` content parts to gpt-4o
- For documents → extract text via existing `_shared/document parsing` helper (same one norman-chat uses) and inject as quoted context before the user message
- Switch the response to **SSE streaming** (mirror norman-chat's `streamAssistantResponse` pattern) so replies stream into the UI

`useProjectChat.sendMessage(msg, chatId, attachments?)` updated to:
- POST attachments alongside `message`
- Read the SSE stream and surface incremental text to the UI (same hook contract as `useNormanChat`)

Scope guardrails:
- Voice transcription uses the same edge function the dashboard already calls — no new infra.
- Files drawer / RAG pipeline stays exactly as-is. Inline attachments are *additional*, not a replacement.
- Planning checklist stays where it is.

### 2. "Adding Simon to a project task won't do it"

I checked the database for the project you're on right now. Both items in the Planning checklist (`Test` and the daily-update task) **are already assigned to Simon Wood** (`assignee_profile_id` matches Simon's user id, last updated a few minutes ago). The save is working — the UX just doesn't tell you so.

What's confusing:
- No toast or visual confirmation when you pick an assignee
- The picker closes and the row only shows a tiny avatar circle — easy to miss
- No error is shown if a save *did* fail silently

**Fix:**
- Show a brief "Assigned to {name}" toast on successful change (and a clear error toast on failure — currently `updateAssignee` swallows errors)
- Add a visible name label next to the assignee avatar in each row (today the name only shows in the quick-add bar, not on existing rows — only the avatar shows on saved rows)
- Optimistic UI: update the local row immediately so the avatar+name reflect the choice without waiting for the realtime round-trip
- Add error logging + toast inside `updateAssignee`, `updateTitle`, `updateGroup`, `toggleDone`, `acceptItem`

### Files I'll touch

- `src/pages/ProjectWorkspace.tsx` — swap inline composer for `<ChatInput />` (both empty-state and active-chat)
- `src/hooks/useProjectChat.ts` — accept attachments, consume SSE stream
- `src/components/projects/PlanningChecklist.tsx` — visible assignee name on rows, toast confirmations, optimistic update, error surfacing
- `supabase/functions/chat-with-project-context/index.ts` — accept attachments (multimodal + doc extraction), stream SSE response

### Out of scope (ask if you want it)

- Changing the Files drawer behaviour
- Changing how Planning checklist items promote to Workstreams
- Adding voice to the empty-state composer (will add only if you want — currently empty-state on dashboard also lacks it)
