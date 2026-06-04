
## What I found

### 1. Knowledge Base upload — PDF fails with "Buffer is not defined"
- Your latest upload (`KABUNI-SCHOOLS-HANDOUT-A5BOOKLET_FINAL.pdf`) shows in `documents` with `status='failed'`, `error_message='Buffer is not defined'`.
- The blob actually uploaded to Azure fine. The crash is in **`process-document`** (the text-extraction/chunking step) at this line:
  ```ts
  const buf = Buffer.from(bytes);   // ← Node-only, doesn't exist in Deno
  const res = await pdfParse(buf);
  ```
  `Buffer` is a Node.js global that Deno does not expose by default. Every PDF upload to KB currently dies here. Non-PDFs (txt, csv, md, docx, xlsx) are unaffected.

**Fix**: import Buffer from `node:buffer` (or pass the `Uint8Array` straight to `pdf-parse`). One-line change in `supabase/functions/process-document/index.ts`.

---

### 2. Duncan re-sends RSVP emails on every reply
- Looking at `event_rsvp_messages` for Samaresh (thread `19e4ea2c…`): three `follow_up` rows at **05:20, 05:25, 05:30** today, all producing outbound Gmail replies — even though the RSVP was already complete and `reply_sent_at` was set.
- The "skip duplicate send" guard in `process-rsvp-emails/index.ts` (~line 935) is too strict:
  ```ts
  const skipSend = allComplete
    && wasAlreadyComplete
    && alreadySentConfirmation
    && existingNotesAttendees.length === attendeesForReply.length;
  ```
  Whenever the user sends another reply in the thread (a "thanks!", a forwarded note, a duplicate confirmation), the AI re-extracts attendees, the count often differs by 1, `skipSend` flips to false, and Duncan fires another full confirmation email. Each new inbound = new outbound.

**Fix**: tighten the rule. Once `reply_sent_at` is set AND status hasn't changed AND no previously-missing fields were filled in by this new inbound, skip the outbound entirely (just update the ledger as `follow_up_silent`). Only send again if (a) status flipped (yes↔no), or (b) a missing field is now present, or (c) operator manually clears `reply_sent_at`.

---

### 3. NDA "not being generated"
- Backend is healthy. Last NDA request (`Charles Blake Thomas`, 2026-06-03 17:29) generated successfully with no error. No new attempt has hit `nda_submissions` in the last 24 h.
- Most likely you tried to generate one through chat and the AI didn't fire the `generate_nda` tool — or stopped mid-flow at the validation step. The tool requires 7 strict fields (Receiving Party Name & Entity, Date, Registered Address, Purpose, Recipient Name, Recipient Email) and rejects the whole call if any one is missing/invalid.

**Proposed action**: I'll add server-side logging to `nda-generate` so any future failed attempt is captured even when the chat layer silently rejects validation. Then I need from you: which NDA you tried to generate and roughly when, so I can pull the matching chat turn and confirm whether the tool was called at all vs. blocked by validation.

---

## Plan

1. **KB PDF fix** — `supabase/functions/process-document/index.ts`
   - Add `import { Buffer } from "node:buffer"` at the top.
   - Re-trigger processing for `bfda13c8-…` (and any other `status='failed'` PDFs) by re-invoking `process-document` with their `document_id`.

2. **RSVP repeat-reply fix** — `supabase/functions/process-rsvp-emails/index.ts`
   - Replace the `skipSend` block with: skip the outbound whenever `reply_sent_at` is set, status is unchanged from the existing row, and no previously-missing field has just been provided.
   - When skipping, write `outcome: 'follow_up_silent'` to `event_rsvp_messages` for visibility.

3. **NDA visibility** — `supabase/functions/nda-generate/index.ts` + `supabase/functions/norman-chat/index.ts`
   - Log every `generate_nda` tool call attempt (even validation rejections) with the offending fields so we can diagnose.
   - Then ask you to retry once, and I'll inspect the turn log to confirm what's happening.

No DB migrations, no UI changes. All three are edge-function edits.
