## Plan: Per-user Slack OAuth connection

### Scope

Add a new per-user Slack OAuth flow that mirrors the existing Gmail/Google OAuth pattern, without changing the existing Team Briefing Slack connector logic.

This will include:

- A per-user `slack_connections` database table
- Secure server-side token exchange in backend functions
- Frontend connect/callback/disconnect/status UX
- A reusable `useSlackConnection` hook

### Important implementation note

The user-facing redirect route will be:

```text
/auth/slack/callback
```

The Slack app’s configured redirect URI should be:

```text
https://duncan.help/auth/slack/callback
```

That frontend route will receive Slack’s `code` + `state`, then call the backend function to exchange the code server-side. The Slack client secret will only live in backend secrets and will never be exposed in frontend code.

---

## 1. Backend secrets

Add support for these runtime secrets:

```text
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
```

The client ID may be used by the frontend only if required to construct the authorization URL, but I will avoid hardcoding it. Preferred implementation: create a backend auth-start function so both client ID and state construction stay server-side.

---

## 2. Database

Create a new `slack_connections` table for per-user Slack OAuth tokens.

Planned columns:

```text
id uuid primary key
user_id uuid not null
access_token text not null
team_id text not null
team_name text
authed_user_id text
scope text
created_at timestamptz
updated_at timestamptz
```

Notes:

- I will not reference `auth.users` directly, following the project’s backend rules.
- Add a unique constraint on `user_id` so each user has one active Slack connection.
- Enable RLS.
- Add policies so users can read and delete only their own connection.
- Backend functions will insert/update via service role after validating the logged-in user.

---

## 3. Backend functions

Create three Slack-specific backend functions:

### `slack-auth`

Purpose: generate the Slack OAuth URL.

Behavior:

- Validate the logged-in user from the Authorization header.
- Generate a CSRF-safe `state` value tied to the user/session.
- Request scopes:

```text
channels:read,chat:write,users:read
```

- Return the Slack authorization URL:

```text
https://slack.com/oauth/v2/authorize
```

### `slack-oauth-callback`

Purpose: exchange Slack authorization code for tokens.

Behavior:

- Validate the logged-in user from the Authorization header.
- Validate the `state` generated during the auth-start step.
- Exchange the code with Slack at:

```text
https://slack.com/api/oauth.v2.access
```

- Use backend secrets for `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
- Store/update the user’s Slack connection in `slack_connections`:
  - access token
  - team ID
  - team name
  - authed user ID
  - granted scopes
- Return structured success/failure JSON to the frontend.

### `slack-disconnect`

Purpose: remove the current user’s Slack connection.

Behavior:

- Validate the logged-in user.
- Delete only that user’s row in `slack_connections`.
- Return success/failure JSON.

---

## 4. Frontend route

Add a protected route:

```text
/auth/slack/callback
```

Create a callback page that:

- Reads `code`, `state`, and `error` from the URL.
- If Slack returned an error, shows failure and links back to Integrations.
- Calls `slack-oauth-callback` with `code` and `state`.
- Shows a success state if token exchange/storage succeeds.
- Redirects or links back to `/integrations` with a Slack success/error indicator.

---

## 5. Reusable hook

Create `useSlackConnection`.

It will provide:

```text
isConnected
workspaceName
connection
isLoading
connect()
disconnect()
refetch()
```

Behavior:

- Query `slack_connections` for the current user’s connection status.
- `connect()` calls `slack-auth` and redirects the browser to Slack.
- `disconnect()` calls `slack-disconnect`, invalidates cached status, and shows a toast.

---

## 6. Integrations UI

Update only the Slack card/detail behavior on `/integrations`:

- Replace the current Slack password/API-key style flow with OAuth.
- Show `Slack connected` when a row exists in `slack_connections`.
- Show the connected workspace name when available.
- Add a `Connect Slack` button when disconnected.
- Add a `Disconnect` button when connected.
- Handle Slack callback query params with success/error toasts.

No other integration cards or pages will be changed.

---

## 7. Security details

- Slack client secret stays backend-only.
- OAuth code exchange happens only in the backend function.
- Use `state` to bind the OAuth response to the initiating authenticated user.
- RLS prevents users from reading/deleting other users’ Slack connection rows.
- Frontend only receives connection metadata, never the Slack access token.

---

## 8. Verification

After implementation:

1. Confirm the project builds cleanly.
2. Confirm `/integrations` shows Slack as disconnected initially.
3. Click `Connect Slack` and verify it redirects to Slack OAuth.
4. Return through `/auth/slack/callback` and verify the backend exchange succeeds.
5. Confirm `/integrations` shows `Slack connected` with workspace name.
6. Click `Disconnect` and confirm the connection row is removed and UI updates.

---

## Out of scope

This plan will not change:

- Existing Team Briefing Slack scanning logic
- Existing Lovable Slack connector usage
- Slack channel caps, windows, or auto-join behavior
- Norman chat tool routing/prompts
- Gmail, Google Analytics, Calendar, Drive, or other integrations