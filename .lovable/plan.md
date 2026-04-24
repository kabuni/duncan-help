
## Plan: Slack connector scope update + Slack-only reconnect button

### Scope

Only do these two things:

1. Add these scopes to the existing Slack connector authorization request:
   - `channels:join`
   - `groups:read`

2. Add a Slack-only “Reconnect Slack” button on the Integrations page.

No changes to:
- `ceo-slack-pulse`
- Team Briefing logic
- channel caps
- time windows
- scan behavior
- payload shape
- other integrations
- other UI pages

---

## Change 1: Add missing Slack scopes

Update the existing Slack connector configuration so the current scope list is preserved and these two scopes are added:

```text
channels:join
groups:read
```

This is the permission fix required for the existing auto-join logic to work.

Expected result after reauthorization:

```text
channels:join is authorized
groups:read is authorized
all existing Slack scopes remain authorized
```

---

## Change 2: Add “Reconnect Slack” button in `src/pages/Integrations.tsx`

Add the button only inside the Slack integration detail panel.

Button label:

```text
Reconnect Slack
```

Supporting copy:

```text
Slack permissions have been updated. Reconnect Slack to approve channels:join and groups:read so Duncan can join public channels and improve Team Briefing visibility.
```

### Button behavior

Because the active Slack integration is a Lovable workspace connector, the app runtime cannot directly modify connector scopes or secretly force OAuth reauthorization from inside React.

So the button will:

1. Disconnect the current app-level Slack integration record if one exists.
2. Direct the user to the Slack connector reconnection flow so they can approve the expanded OAuth permissions.
3. Clearly explain that Slack must be reconnected before Team Briefing can use the new scopes.

This keeps the UI scoped to Slack only and avoids touching Team Briefing code.

---

## Files to change

```text
src/pages/Integrations.tsx
```

Only Slack-specific UI/action logic will be added.

---

## Verification

After implementation:

1. Confirm the Slack connector requests:
   - `channels:join`
   - `groups:read`

2. Confirm existing Slack scopes are not removed.

3. Confirm the Slack detail panel in `/integrations` shows:
   - the new scope explanation
   - the “Reconnect Slack” button

4. Confirm no Team Briefing or Slack scanning files are changed.

5. Confirm the app builds cleanly.

---

## Expected outcome

After Slack is reconnected with the new scopes:

- The existing `ceo-slack-pulse` auto-join logic should no longer be blocked by missing `channels:join`.
- Duncan should be able to join public channels before reading history.
- Team Briefing should stop showing 0 scanned channels when the only blocker is missing Slack join permission.
- `groups:read` will be available for private-channel discovery support where Slack permissions and membership allow it.
