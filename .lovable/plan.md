## Root Cause
"Duncan took too long to respond" is fired by `getChatErrorMessage` in `src/hooks/useNormanChat.ts` whenever the chat `fetch` throws `AbortError`. Two real causes:

1. **90 s general-mode timeout is too short.** Tool-using requests (calendar, meetings, workstreams, briefing) routinely take 30–60 s on the LLM side alone, plus tool round-trips. Anything that doesn't hit the "heavy" classifier (input ≤ 300 chars, mode = general, no attachments) is killed at 90 s — even though the edge function is still streaming successfully.
2. **Self-abort surfaces as a timeout error.** When a second `send()` starts while one is in flight (especially in voice mode and on accidental double-sends), the old controller is aborted on purpose — but the resulting `AbortError` is rendered as "took too long". This is misleading and noisy.

The server-side `stream controller cannot close or enqueue` and `Http: connection closed` errors in `norman-chat` logs are downstream symptoms of the client aborting — fixing the client behaviour resolves both.

## Scope
Frontend only — `src/hooks/useNormanChat.ts`. No edge function changes, no UI changes.

---

## Fix Plan

### 1. Raise the general-mode timeout
- `NORMAL_TIMEOUT_MS`: **90 s → 180 s** (3 minutes)
- `HEAVY_TIMEOUT_MS`: keep at 300 s
- Rationale: server is streaming; 3 minutes is well within Supabase Edge Function limits (~150 s wall but with `EdgeRuntime.waitUntil` patterns it survives), and matches actual observed LLM latency for tool-heavy turns.

### 2. Expand "heavy" classifier so meeting/calendar/briefing intents get the 5-minute budget
Add a keyword-based escalation in `isHeavyChatRequest`. If the input matches any of the following (case-insensitive), treat as heavy:
- `meeting`, `meetings`, `calendar`, `diary`, `availability`, `schedule`
- `brief`, `briefing`, `summary`, `summarise`, `summarize`, `recap`
- `workstream`, `kanban`, `overdue`, `tasks`
- `report`, `analyse`, `analyze`, `compare`, `cv`, `candidate`, `recruit`
- `email`, `gmail`, `inbox`, `draft`
- `devops`, `ado`, `azure devops`, `basecamp`

These all map to tool-using flows that take longer than chit-chat.

### 3. Distinguish user-initiated abort from real timeout
- Track an `intentionalAbortRef = useRef(false)`.
- In `send()`, when aborting a previous in-flight controller (line 221–224), set `intentionalAbortRef.current = true` **just before** calling `controller.abort()`, then immediately reset on the *new* request start.
- In the `catch` block, if the AbortError matches the **superseded** controller (i.e. `intentionalAbortRef` was set), **silently swallow** — no toast, no error message in chat.
- Only show "took too long" when the abort came from the real timeout `setTimeout`.

Implementation detail: tag each controller with a `wasTimeout` boolean property. The timeout callback sets `controller.wasTimeout = true` before aborting. The catch block checks `controller.wasTimeout` to decide between:
- `wasTimeout === true` → show "Duncan took too long…" toast
- `wasTimeout !== true` → silent (it's a deliberate supersede)

### 4. Cleaner error copy when timeout actually fires
When a real timeout does occur, change the message slightly to be honest about the cause:
> "That request took longer than expected. Duncan may still be working — try again or rephrase."

(Avoids implying Duncan crashed.)

---

## What we are NOT changing
- `norman-chat` edge function (server-side) — the stream/connection errors are caused by client aborts; they disappear once 1 & 3 land.
- Voice mode hook — it benefits automatically because it calls `chat.send` through this same hook.
- Any UI components.

---

## Technical Section

**File:** `src/hooks/useNormanChat.ts`

**Constants:**
```ts
const NORMAL_TIMEOUT_MS = 180_000; // was 90_000
const HEAVY_TIMEOUT_MS = 300_000;  // unchanged

const HEAVY_KEYWORDS = /\b(meeting|meetings|calendar|diary|availability|schedule|brief|briefing|summary|summari[sz]e|recap|workstream|kanban|overdue|tasks?|report|analy[sz]e|compare|cv|candidate|recruit|email|gmail|inbox|draft|devops|ado|basecamp)\b/i;
```

**Heavy classifier:**
```ts
function isHeavyChatRequest(mode, input, attachments) {
  return (
    HEAVY_MODES.includes(mode) ||
    (input?.length ?? 0) > 300 ||
    (Array.isArray(attachments) && attachments.length > 0) ||
    HEAVY_KEYWORDS.test(input || "")
  );
}
```

**Controller tagging:**
```ts
type TaggedController = AbortController & { wasTimeout?: boolean };
const controller = new AbortController() as TaggedController;
const timeoutId = window.setTimeout(() => {
  controller.wasTimeout = true;
  controller.abort();
}, timeoutMs);
```

**Catch handling:**
```ts
catch (err) {
  if (err instanceof DOMException && err.name === "AbortError") {
    if (!(controller as TaggedController).wasTimeout) {
      // Superseded by a newer send — silent
      return;
    }
    toast.error("That request took longer than expected. Duncan may still be working — try again or rephrase.");
    return;
  }
  toast.error(getChatErrorMessage(err));
}
```

`getChatErrorMessage` is updated to return the same friendlier copy for AbortError (in case any other path hits it).

---

## Expected Outcome
- Tool-using requests (meetings, calendar, briefings, workstreams) → 5 min budget instead of 90 s; no premature "took too long".
- Plain short messages → 3 min budget instead of 90 s; covers normal LLM streaming with multi-round reasoning.
- User-initiated re-sends (and voice mode partial re-fires) → silent, no false timeout toast.
- Server-side `stream controller cannot close or enqueue` errors should drop sharply because client stops aborting healthy streams.
