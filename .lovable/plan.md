## Goal
Stop ElevenLabs Scribe from sending background noise (HVAC, keyboard taps, breaths, single-syllable artifacts) to Duncan as if it were real user speech.

## Scope
Frontend-only changes inside `src/hooks/useDuncanVoice.ts`. No edge function or backend changes. No UI/visual changes to `VoiceModeOverlay.tsx`.

---

## Fix Plan (4 layers of defense)

### 1. Tighten microphone capture
In `scribe.connect({ microphone: ... })`:
- Keep `echoCancellation: true`
- Keep `noiseSuppression: true`
- **Disable `autoGainControl`** → currently amplifying ambient silence into "speech-like" energy

### 2. Filter committed transcripts before sending to Duncan
In `onCommittedTranscript`, before calling `chat.send(...)`, reject the utterance if ANY of these are true:
- Length < 2 words **and** < 6 characters (drops "uh", "ok", "mm", single-syllable noise)
- Matches a filler/noise blacklist (case-insensitive, punctuation-stripped):
  `uh, um, hmm, mm, mhm, ah, oh, eh, huh, ok, okay, yeah, yep, nope, no, yes, hi, hey, bye, thanks, thank you, [music], [noise], [silence]`
- Consists only of repeated single characters (e.g. "aaa", "...")

When rejected:
- Do NOT send to chat
- Do NOT change state to `thinking`
- Stay in `listening`
- Log at debug level only (no toast)

### 3. Smarter barge-in (reduce false interrupts)
In `onPartialTranscript`, only call `stopAudio()` when partial transcript:
- Has ≥ 2 words **OR** ≥ 8 characters
- AND is not in the filler blacklist

This prevents a cough/keystroke partial from cutting Duncan off mid-sentence.

### 4. Defensive guards
- Track last committed text + timestamp; if identical text commits within 1.5s, drop as duplicate (Scribe sometimes double-fires on noise tails)
- Trim trailing punctuation/whitespace before all checks

---

## What we are NOT changing
- VAD threshold / silence duration → not exposed by `@elevenlabs/react` `useScribe` options in current SDK; would require server-side config we don't control
- Token refresh, TTS retry loop, auto-start race → separate issues from earlier audit, out of scope for this fix
- Edge functions (`elevenlabs-scribe-token`, `elevenlabs-tts`) → untouched
- UI in `VoiceModeOverlay.tsx` → untouched

---

## Technical Section

**File:** `src/hooks/useDuncanVoice.ts`

**New helper (top of file):**
```ts
const FILLER_BLACKLIST = new Set([
  "uh","um","hmm","mm","mhm","ah","oh","eh","huh",
  "ok","okay","yeah","yep","nope","hi","hey","bye",
  "[music]","[noise]","[silence]"
]);

function isLikelyNoise(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[.,!?…]+$/g, "").trim();
  if (!t) return true;
  if (FILLER_BLACKLIST.has(t)) return true;
  const words = t.split(/\s+/);
  if (words.length < 2 && t.length < 6) return true;
  if (/^(.)\1+$/.test(t.replace(/\s/g, ""))) return true; // "aaaa", "...."
  return false;
}
```

**Refs added:**
```ts
const lastCommitRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
```

**`onCommittedTranscript` guard:**
```ts
const text = (data?.text || "").trim();
if (!text || isLikelyNoise(text)) return;
const now = Date.now();
if (text === lastCommitRef.current.text && now - lastCommitRef.current.at < 1500) return;
lastCommitRef.current = { text, at: now };
// ...existing send logic
```

**`onPartialTranscript` guard:**
```ts
const text = (data?.text || "").trim();
if (!text || isLikelyNoise(text)) return;
if (playingRef.current) { stopAudio(); setState("listening"); }
```

**Microphone config change:**
```ts
microphone: {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false, // was true — amplified ambient noise
}
```

---

## Expected Outcome
- Background HVAC, keystrokes, breaths → no longer trigger Duncan
- Single "uh" / "ok" → no longer sent to LLM
- Duncan no longer cut off mid-reply by random room noise
- Real user speech (≥2 words or substantive single words) → unaffected
