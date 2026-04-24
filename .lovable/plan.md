
## Plan: Slack connector scopes + reconnect action

### Confirmed current state

The Slack workspace connection exists and is linked to the project:

- Connection ID: `std_01kn4ce01je1kbf8f54bzwwk5t`
- Connector: Slack
- Access type: bot
- Linked to project: yes

Current configured scopes include:

```text
channels:history
channels:read
chat:write
chat:write.customize
groups:history
im:read
im:write
mpim:history
mpim:read
mpim:write
mpim:write.topic
```

The missing scopes are available on the connector but not currently configured:

```text
channels:join
groups:read
```

That matches the confirmed Team Briefing failure: `ceo-slack-pulse` already attempts `conversations.join`, but Slack blocks it because the connector token does not include `channels:join`.

---

## Important implementation boundary

The app’s React UI cannot directly modify Lovable workspace connector scopes or force a workspace-level OAuth reconnect by itself.

Those actions are managed by Lovable connector settings, not by runtime app code. So the correct implementation has two parts:

1. Use the Lovable connector reconnect flow to request the missing scopes.
2. Add a Slack-specific button in the Integrations page that clearly directs the user to reconnect Slack after the scope update.

The button can guide/trigger the user-facing reconnect path, but the actual Slack OAuth re-authorization must happen through the connector reconnect/settings flow.

---

## Change 1: Update Slack connector requested scopes

Use the existing Slack connection:

```text
std_01kn4ce01je1kbf8f54bzwwk5t
```

Request these additional scopes without removing existing scopes:

```text
channels:join
groups:read
```

This will surface a reconnect prompt so the user can re-authorize Slack with the expanded permissions.

Expected connector result after reconnect:

```text
configured_scopes contains channels:join
configured_scopes contains groups:read
existing configured scopes remain intact
```

---

## Change 2: Add a “Reconnect Slack” button in Integrations

File to change:

```text
src/pages/Integrations.tsx
```

Add the button only inside the Slack integration detail panel.

Button label:

```text
Reconnect Slack
```

Supporting copy:

```text
Slack permissions have been updated. Reconnect Slack to apply channels:join and groups:read so Duncan can join public channels and discover private channels.
```

Behavior:

- Do not change Team Briefing logic.
- Do not change Slack scan limits.
- Do not change the 30-channel cap.
- Do not change the 24-hour window.
- Do not change `ceo-slack-pulse`.
- Do not change any other integration.
- Keep the button scoped to Slack only.

Implementation approach:

- Add Slack-specific UI in the existing `IntegrationDetail` Slack section.
- The button should direct the user to the Slack connector reconnect/settings flow rather than touching `user_integrations`, because `user_integrations` is not the real Lovable Slack connector connection.
- Avoid using the existing Slack “password/API key” flow for this reconnect, because the active Team Briefing Slack integration uses the Lovable connector environment variables, not a manually entered Slack password.

---

## Verification

After implementation:

1. Confirm the Slack connector reconnect prompt requests:

```text
channels:join
groups:read
```

2. Confirm no existing Slack scopes are removed.
3. Confirm the Integrations page shows the Slack-only “Reconnect Slack” button.
4. Confirm no files related to Team Briefing scan logic are changed.
5. Confirm the app builds cleanly.

## Expected outcome

After the user reconnects Slack:

- `ceo-slack-pulse` should no longer skip/ fail auto-join because of missing `channels:join`.
- Duncan should be able to join public channels before reading message history.
- Team Briefing should stop showing “Duncan in 0 of 83 channels” when the only blocker is missing `channels:join`.
- `groups:read` will allow private channel discovery where Slack permissions and bot membership allow it, without changing private-channel scan logic in this step.
