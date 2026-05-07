# Apply change D — voice-only fast path (tools stay enabled)

Goal: Cut LLM latency in voice mode (~500–1500 ms saved per turn) without affecting text chat. Duncan must still access real data via tools during voice turns.

## Scope
Voice path only. Text chat in `useNormanChat` continues to use `gpt-4o` with multi-round reasoning exactly as today.

## Changes

### 1. `src/hooks/useNormanChat.ts`
- Extend `send(input, mode, attachments, opts?)` with optional `opts: { voiceMode?: boolean }`.
- When `voiceMode === true`, include `voiceMode: true` in the POST body to `norman-chat`.
- No other behavior change for text callers (default `false`).

### 2. `src/hooks/useDuncanVoice.ts`
- When invoking `chat.send(...)` for a voice turn, pass `{ voiceMode: true }`.

### 3. `supabase/functions/norman-chat/index.ts`
- Read `voiceMode` from request body.
- When `voiceMode === true`:
  - Force model to `gpt-4o-mini` (still streamed).
  - **Tools stay fully enabled** — Duncan must still query Calendar, Workstreams, Gmail, DevOps, etc. during voice turns.
  - Multi-round reasoning loop stays enabled but cap reduced from 5 → 2 iterations (one tool call + one synthesis), so simple voice questions don't burn extra rounds. Two rounds still covers the vast majority of real data lookups.
  - Append a brevity instruction to the system prompt: "You are responding via voice. Reply in 1–3 short sentences, conversational tone, no markdown, no lists, no headings. If you used tools, summarize results aloud — don't read raw data."
- When `voiceMode` is falsy: existing behavior unchanged (gpt-4o + 5-round multi-round + tools).

## Out of scope
- No change to STT, TTS, or any other hook.
- No change to text-chat model, reasoning depth, or tool surface.

## Verification
- Voice turn ("what's on my calendar today?"): logs show `model=gpt-4o-mini`, tool call executed, ≤2 rounds, brevity prompt applied, spoken summary is short.
- Voice turn (chit-chat): single round, fast reply.
- Text turn: logs still show `gpt-4o` with up to 5-round multi-round reasoning intact.

## Expected outcome
Voice-only first-token latency drops from ~1.5–3 s to ~0.7–1.5 s. Tool-backed voice answers still work. Text chat unchanged.
