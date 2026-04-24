## Change

In `supabase/functions/_shared/llm.ts`, extend `WORKFLOW_PRIMARY_MODEL` (lines 70–76) with two new entries so that the `score-cv-values` and `score-cv-competencies` workflows use Claude Haiku 4.5 as their PRIMARY model.

### Updated block

```ts
const WORKFLOW_PRIMARY_MODEL: Partial<Record<WorkflowName, { openai?: string; claude?: string }>> = {
  "parse-cv":              { openai: "gpt-5-mini" },
  "parse-jd-competencies": { openai: "gpt-5-mini" },
  "extract-file-text":     { openai: "gpt-5-mini" },
  "extract-chat-file":     { openai: "gpt-5-mini" },
  "google-analytics":      { openai: "gpt-5-mini" },
  "score-cv-values":       { claude: "claude-haiku-4-5" },
  "score-cv-competencies": { claude: "claude-haiku-4-5" },
};
```

## Why this satisfies the requirements

- **Applies as PRIMARY only**: `pickModel` (line 468) reads `WORKFLOW_PRIMARY_MODEL` only when `!degrade`, so the override is used solely on the primary attempt. Degrade still falls through to `CLAUDE_MODEL_DEGRADE`.
- **Does not affect other Claude workflows**: only the two named keys are added; all other workflows continue to resolve to `CLAUDE_MODEL_PRIMARY` (Sonnet 4.5).
- **Does not modify fallback logic**: `WORKFLOW_ROUTING` for `score-cv-values` / `score-cv-competencies` remains `{ primary: "claude", fallback: "openai" }`. The OpenAI fallback chain is untouched.

## Files modified

- `supabase/functions/_shared/llm.ts` (single block edit, lines 70–76)

No other files require changes.