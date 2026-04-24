
## Plan: Slack Team Briefing permission update

### Goal

Update the Slack integration flow so Duncan requests the two missing Slack connector scopes:

- `channels:join`
- `groups:read`

Then clearly prompt the user from the Integrations UI to reconnect Slack so the new permissions take effect.

### Current confirmed state

The linked Slack connector exists and is connected to the project.

Current configured scopes include:

- `channels:read`
- `channels:history`
- `groups:history`
- messaging-related scopes

But it is missing:

- `channels:join`
- `groups:read`

The connector supports both missing scopes, so this is a reconnect/scope update issue, not a missing connector capability.

### Important constraint

I will not change Slack scanning behavior.

No changes to:

- 30-channel cap
- 24-hour window
- message limits
- channel ranking
- Slack pulse orchestration
- Team Briefing analysis logic
- Slack history scanning logic

This means:

- `channels:join` will allow Duncan’s existing auto-join logic to work for public channels.
- `groups:read` will be added to the connector permission set for future/private-channel visibility, but I will not alter the current hardcoded channel discovery logic unless you request that separately.

## Implementation steps

### 1. Trigger Slack reconnect with required scopes

Use the existing Slack connector reconnect flow for the linked connection:

- connection id: `std_01kn4ce01je1kbf8f54bzwwk5t`
- required scopes:
  - `channels:join`
  - `groups:read`

The reconnect prompt will tell the user that Slack permissions must be re-authorized before Team Briefing can use the updated scopes.

### 2. Add Slack-specific reconnect prompt in Integrations UI

Modify only `src/pages/Integrations.tsx`.

For the Slack integration detail panel, add a clear notice when Slack is connected:

```text
Slack permissions have been updated — please reconnect your Slack account to apply the new scopes.
```

The notice will explain that the new permissions allow Duncan to:

- automatically join public channels
- discover private channels where permitted

Add a clear button-style callout pointing the user to reconnect Slack through Connectors.

This will be UI-only guidance; it will not change credential storage, tool schemas, or scanning behavior.

### 3. Preserve existing Slack connection behavior

Keep Slack as a user integration in the existing Integrations page.

Do not change:

- `useUserIntegrations`
- `connect-integration`
- `ceo-slack-pulse`
- `ceo-briefing`
- `CommsPulseCard`
- backend env variables
- connector gateway calls

### 4. Verification

After implementation:

1. Confirm Slack connector configuration now requests:
   - `channels:join`
   - `groups:read`

2. Confirm Integrations → Slack shows the reconnect message.

3. Confirm no code changes were made to Slack scanning limits or Team Briefing scan logic.

4. Confirm the app still builds without TypeScript errors.

## Expected outcome

Once the user reconnects Slack:

- Duncan should no longer be blocked by missing `channels:join` when trying to enter public channels.
- Team Briefing should be able to scan public channel history after auto-join succeeds.
- The connector will also be authorized for `groups:read`, preparing Slack for private-channel discovery without changing scan logic in this step.
