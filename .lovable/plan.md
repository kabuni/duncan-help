## Current Google Drive Integration State

### 1. Integrations page status
- The Google Drive card currently checks `google_drive_tokens` directly and will show **Connected** if any token row exists.
- The backend currently has an active Google Drive token row, last refreshed today, so the card should show **Connected**.
- However, this check only verifies that a row exists. It does not validate that the token can still call Drive, and it does not expose token/account details.

### 2. Connect / callback flow
- Clicking **Connect Google Drive** is wired to `google-drive-auth`.
- `google-drive-auth` builds the Google OAuth URL with `drive.readonly` and redirects to `google-drive-callback`.
- `google-drive-callback` exchanges the code, deletes the existing singleton token, inserts a fresh row, then redirects to `/integrations?drive_connected=true`.
- The Integrations page handles `drive_connected=true`, shows a success toast, rechecks token state, then clears the URL parameter.
- This flow is broadly wired correctly.

### 3. Post-connection experience
- There is currently no Drive account confirmation in the UI.
- The connected state just says **Connected & syncing**.
- There is no account email/name, no Drive file count/sample, and no **Test connection** action.
- The backend `google-drive-api` can list real files, but the Integrations card does not use that to prove the connection works.

### 4. Disconnect flow
- The UI disconnect button calls `google-drive-api` with `{ action: "disconnect" }`.
- The backend deletes only `.eq("connected_by", user.id)`.
- Because the feature is modeled as a singleton company connection with fallback to the latest token, this can leave a shared token behind if the current user did not originally connect it.
- Result: disconnect can appear to succeed but the card may remain **Connected** because a token row still exists. This is broken for the company-wide singleton model.

### 5. Error handling
- OAuth callback errors are surfaced as raw codes like `token_exchange_failed`, `storage_failed`, etc.
- Runtime/token failures are not surfaced on the card unless the user manually triggers an action.
- A stale/expired/revoked token can still look connected if the token row exists.

## Fix Plan

### Frontend: Google Drive card only
- Add Google Drive-specific state in `src/pages/Integrations.tsx` for:
  - connection status
  - linked account/email if available
  - token expiry / last verified timestamp
  - Drive test/list result summary
  - readable error message
- Replace the current row-exists-only check with a call to `google-drive-api` `{ action: "status" }`, falling back to direct row existence only if needed.
- In the Google Drive detail drawer:
  - show **Connected to [email/account]** when available
  - show last verified / token expiry metadata
  - add a **Test connection** button that calls `google-drive-api` and confirms Drive can list files
  - surface useful errors if the token is expired, revoked, missing scopes, or not connected
- Improve OAuth callback toast messages so `drive_error` codes become human-readable.

### Backend: Google Drive auth/API flow only
- Update `google-drive-api` status behavior so it returns a real health object instead of `{ connected: true/false }` only:
  - `status`: `connected`, `disconnected`, or `degraded`
  - `account_email` / account name if retrievable from Google token/userinfo
  - `token_expiry`, `updated_at`, `last_verified_at`
  - optional sample file count or files visible
  - `degraded_reason` for expired/revoked/permission errors
- Add or adjust a safe `test`/`status` path that verifies Drive access by calling a lightweight Drive endpoint such as `about` or a small file listing.
- Fix disconnect for the singleton company-wide connection so an admin disconnect clears the singleton Drive token row, not only the token connected by the current user.
- Keep non-admins unable to configure/disconnect company Google Drive, matching the existing company integration pattern.

### Optional database migration, only if needed
- If the current `google_drive_tokens` table does not have fields for account email/name, add nullable metadata columns such as:
  - `account_email`
  - `account_name`
  - `account_picture`
- Store those during OAuth callback after token exchange.
- Keep RLS protected; do not expose access or refresh tokens in the frontend.

### Verification
- Confirm the Integrations page shows Google Drive as **Connected** from live backend health, not stale `company_integrations` data.
- Confirm Connect redirects to Google and back to `/integrations?drive_connected=true`.
- Confirm the detail drawer shows linked account metadata and a working test result.
- Confirm Disconnect clears the singleton token and the card returns to **Not connected**.
- Confirm auth/token failures are shown as useful messages.

## Scope Guardrails
- Only touch:
  - Google Drive section of `src/pages/Integrations.tsx`
  - `supabase/functions/google-drive-auth/index.ts` if needed
  - `supabase/functions/google-drive-callback/index.ts`
  - `supabase/functions/google-drive-api/index.ts`
  - a small migration only if account metadata columns are needed
- Do not change Team Briefing logic.
- Do not change other integrations.