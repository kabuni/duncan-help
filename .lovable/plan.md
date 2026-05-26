## Goal

Give admins the ability to operate Duncan's own Google account (duncan@kabuni.com) — calendar CRUD and mailbox read + send — directly from the Duncan chat, alongside (not replacing) their personal Gmail/Calendar.

## Current state

- `duncan_calendar_tokens` already exists as a singleton, admin-managed table, but scopes are **read-only** (`calendar.readonly`, `calendar.events.readonly`) and only used by the `reschedule_event` tool.
- No equivalent table or OAuth flow for Duncan's Gmail.
- All other `CALENDAR_TOOLS` and `GMAIL_TOOLS` in `norman-chat` operate on the **caller's personal** Google account via `google_calendar_tokens` / `gmail_tokens`.
- Admin status is already determined via `has_role(uid, 'admin')`.

## Design

Add a `mailbox: "self" | "duncan"` argument to the existing Gmail and Calendar tools (default `"self"` to preserve current behavior). When `"duncan"` is passed, `norman-chat` resolves the singleton Duncan tokens; if the caller isn't admin or Duncan isn't connected, the tool returns a clean error and Duncan tells the user. No new tools, no model retraining on new names.

System prompt is updated so the model knows: "If the caller is an admin and asks about Duncan's inbox/calendar/'as Duncan', pass `mailbox: 'duncan'`. Otherwise default to the caller's own account."

## Changes

### 1. Database (singleton tokens for Duncan's Gmail)

```text
duncan_gmail_tokens (singleton, mirrors duncan_calendar_tokens)
  id, google_account_email, access_token, refresh_token,
  token_expiry, scopes, created_at, updated_at
+ RLS: service-role only; admin-readable status via get_duncan_gmail_status()
```

Plus a one-time scope upgrade for the existing Duncan **calendar** OAuth so we can write events:
- Add `https://www.googleapis.com/auth/calendar` and `calendar.events` to `duncan-calendar-auth` SCOPES.
- Admin will need to "Reconnect Duncan calendar" once from Settings to grant the new scopes.

### 2. Edge functions

New:
- `duncan-gmail-auth` + `duncan-gmail-callback` — same pattern as `duncan-calendar-auth/callback`, admin-only, scopes: `gmail.readonly`, `gmail.send`, `gmail.modify` (needed for thread reads + sending; no compose-only required).

Updated:
- `duncan-calendar-auth` — broaden SCOPES to writable calendar.
- `norman-chat/index.ts`:
  - Add `getDuncanGmailContext()` helper (mirrors `getDuncanCalendarContext`) with refresh-token flow.
  - Add `mailbox` enum to: `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `list_gmail_emails`, `search_gmail`, `read_gmail_email`, `read_gmail_thread`, `send_gmail_email`. (`draft_gmail_reply` stays self-only — Duncan's drafts folder isn't useful.)
  - In each tool executor: if `mailbox === "duncan"`, check admin role → resolve Duncan token → call Google with that token instead of the caller's. Non-admins get `{ error: "Duncan mailbox is admin-only" }`.
  - System prompt: add a paragraph telling the model how/when to set `mailbox: 'duncan'`, plus the existing send-email confirmation rule applies (and we'll make it extra explicit: "When sending from Duncan, the From address is duncan@kabuni.com — confirm with the user before sending.").

### 3. Frontend (admin-only connection UI)

In `src/components/settings/` — add a new admin-only `SettingsDuncanMailbox.tsx` panel (or extend the existing admin section), surfaced inside `Settings` for `isAdmin === true`:
- Card 1: **Duncan Calendar** — shows current connection (uses existing `get_duncan_calendar_status`), "Reconnect with write access" button → invokes `duncan-calendar-auth`.
- Card 2: **Duncan Mailbox** — same pattern using new `get_duncan_gmail_status` RPC, "Connect duncan@kabuni.com" / "Disconnect" buttons → invokes `duncan-gmail-auth`.

Both cards explain: "Admins can ask Duncan in chat to read or send mail from this inbox, or change events on Duncan's calendar."

No changes to the chat UI itself — the model picks `mailbox: 'duncan'` based on the user's wording ("as Duncan", "Duncan's inbox", "Duncan's calendar", "from duncan@kabuni.com").

### 4. Memory

Add a new memory entry `mem://integrations/duncan-mailbox-shared-identity` describing the singleton + admin-only access model, and update the index to reference it.

## Out of scope

- Draft replies as Duncan (drafts live in Duncan's Gmail UI, not useful here).
- Per-user audit log for Duncan-mailbox actions (existing `calendar_mutation_audit` already covers calendar writes; we'll extend it to log Gmail sends in a follow-up if you want).
- Non-admin access to Duncan's mailbox.

## Technical notes

- Reuses `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` and `GOOGLE_CALENDAR_CLIENT_ID/SECRET` already in vault — no new secrets.
- The OAuth callback URL pattern is `${SUPABASE_URL}/functions/v1/duncan-gmail-callback` — admin must add this redirect URI to the existing Google OAuth client.
- Admin check enforced **twice**: once in the auth edge function (matches current `duncan-calendar-auth` pattern), once inside each tool executor in norman-chat before resolving Duncan tokens.
