## Goal
Force Duncan voice mode to transcribe English only (reject other languages).

## Findings
In `src/hooks/useDuncanVoice.ts`, `useScribe` is already configured with `languageCode: "en"`. However, ElevenLabs Scribe expects **ISO 639-3** codes (e.g. `"eng"`), not ISO 639-1 (`"en"`) — see the batch STT docs (`language_code: 'eng'`). With an unrecognized code, Scribe likely falls back to auto-detect, which is why non-English speech still gets transcribed.

## Plan
1. **`src/hooks/useDuncanVoice.ts`** — change `languageCode: "en"` → `languageCode: "eng"` in the `useScribe({...})` config.
2. (Optional safety net) In `onCommittedTranscript`, drop commits whose detected language (if Scribe returns one on the payload, e.g. `data.language_code`) is not `eng`. I'll only add this if the SDK exposes it; otherwise the model-level lock above is sufficient.

## Out of scope
- TTS voice (`elevenlabs-tts`) — already English voice, no change.
- UI / overlay copy — no change.

## Verification
- Open voice mode, speak English → transcribes normally.
- Speak a non-English phrase → Scribe should either ignore it or return garbled English (no foreign-language commits sent to chat).
