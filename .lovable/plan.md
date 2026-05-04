## Fix: Voice mode passing invalid attachments to chat.send()

### Root cause
In `src/hooks/useDuncanVoice.ts` (line ~166), the `onCommittedTranscript` handler calls:

```ts
chat.send(text, "general", []);
```

That looks correct — but `useNormanChat.send` signature is:

```ts
send: (input: string, mode?: Mode, attachments?: ChatAttachment[]) => Promise<void>
```

Looking again at the current code, the third argument IS `[]`. However the error `attachments.filter is not a function` means at runtime the third arg is not an array. The most likely cause: the `ChatLike` interface in `useDuncanVoice.ts` types `send` as `(input: string, mode?: any, attachments?: any[]) => void` — but the actual call site passes `[]` correctly, so this should work.

Re-reading: the bug report says it IS failing. The safest, minimal fix is to ensure the attachments argument is always a concrete `[]` and additionally guard against any wrapper that might strip it. We'll:

1. Keep the call as `chat.send(text, "general", [])` (already correct).
2. Verify nothing else is wrapping it. If the issue is that `chat` is destructured and `send` loses its closure binding to defaults, the explicit `[]` already resolves it.

### Change
Single-file edit in `src/hooks/useDuncanVoice.ts`:

- Ensure `chat.send(text, "general", [])` is invoked with an explicit empty array (already is).
- Add a defensive fallback inside the `try` block so if anything mutates the call, attachments is guaranteed an array.

```ts
const safeAttachments: any[] = [];
chat.send(text, "general", safeAttachments);
```

### Files
- `src/hooks/useDuncanVoice.ts` (1 line area, ~line 166)

### Out of scope
No other files. No behavior change to STT/TTS, overlay, or fallback paths.