I can generate a new Team Briefing, but the current mode is read-only, so I cannot invoke the backend function from here yet.

Plan once you approve:

1. Trigger the existing Team Briefing generation flow
   - Invoke the current `ceo-briefing` backend function with `briefing_type: "morning"`.
   - Use the existing asynchronous job flow if the function returns a job ID.

2. Monitor completion
   - Poll the existing `ceo-briefing-status` backend function until the job completes or fails.
   - Capture the final status and any failure reason if it does not complete.

3. Verify the refreshed briefing
   - Check the latest saved Team Briefing payload.
   - Confirm the Slack section no longer shows stale `missing_scope: channels:join` degradation if the new Slack scan succeeds.
   - Report whether the new briefing replaced today’s previous briefing or created a new dated briefing.

Technical details:
- No code changes will be made.
- This will use the existing Team Briefing functions and database tables.
- Based on the current implementation, generating again for the same date should refresh today’s briefing record rather than create a separate same-day archive entry.