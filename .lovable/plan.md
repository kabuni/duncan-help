## Root cause found

The Team Briefing worker is failing inside `supabase/functions/ceo-briefing/index.ts`, not in the UI.

Recent backend log:

```text
[ceo-briefing] job=3d1c4338-bcf6-46f6-ad37-1c3d80fdd3ea failed:
TypeError: Cannot create property 'probability_impact_pts' on string 'friction'
    at runWorker (.../ceo-briefing/index.ts:3512:40)
```

What this means technically:

- The LLM call for `workflow=ceo-briefing` completed successfully.
- The report then failed during server-side post-processing.
- The failure happens because `parsed.payload.risks` contains at least one non-object value, likely the string `