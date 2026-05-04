
## Goal

Add a dedicated **"Voice Mode"** to Duncan that:
1. Listens to the user via **ElevenLabs Scribe Realtime** (STT)
2. Sends the transcript through the **existing** `useNormanChat` pipeline (no logic changes — Duncan still answers in text in chat)
3. Speaks the assistant reply aloud via **ElevenLabs TTS** using the Jack/John voice already configured

The current Whisper mic button, text typing, attachments, and SSE streaming stay 100% intact and act as the fallback when voice mode is off or fails.

## What changes vs. what stays

```text
KEEP (untouched fallback)
  ChatInput Whisper mic ─► transcribe-audio (Whisper) ─► textarea
  Textarea + Send       ─► useNormanChat.send() ─► norman-chat SSE ─► chat bubble

ADD (new, parallel layer)
  Voice Mode toggle ─► VoiceModeOverlay
    ├─ ElevenLabs Scribe Realtime (mic ► live transcript)
    ├─ on committed transcript ─► useNormanChat.send()  ← reuses existing brain
    ├─ watches messages[] for new assistant text
    └─ streams sentence-by-sentence ─► elevenlabs-tts edge fn ─► <audio> playback
```

If anything in the voice layer fails, we toast the error, close the overlay, and the user still has the existing Whisper button + textarea.

## User experience

- New **microphone-circle button** next to the existing mic in `ChatInput` (clearly labelled "Voice mode" on hover) and a matching entry point on the home dashboard "Talk to Duncan".
- Tapping it opens a full-screen **VoiceModeOverlay**:
  - Pulsing Duncan avatar (idle / listening / thinking / speaking states)
  - Live partial transcript shown as the user speaks
  - Duncan's reply appears as text inside the overlay AND in the underlying chat (because we reuse `useNormanChat`)
  - Duncan's voice plays automatically using Jack/John
  - Buttons: **Mute Duncan**, **Stop speaking** (interrupt), **End voice mode**
- Closing the overlay always: stops Scribe, stops audio playback, releases mic.

## Architecture

### 1. Edge functions (2 new, both `verify_jwt = false` with in-code JWT validation)

**`supabase/functions/elevenlabs-scribe-token/index.ts`**
- POST, requires Supabase auth.
- Calls `POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` with `xi-api-key: ELEVENLABS_API_KEY`.
- Returns `{ token }` (15-min single-use token) — never exposes the API key to the browser.

**`supabase/functions/elevenlabs-tts/index.ts`**
- POST `{ text, voiceId? }`, requires Supabase auth.
- Server-side text sanitiser strips markdown, code fences, table pipes, emojis → plain spoken sentence.
- Calls `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream?output_format=mp3_44100_128` with `eleven_turbo_v2_5` for low latency.
- Pipes the MP3 stream straight back to the client (`Content-Type: audio/mpeg`).
- `voiceId` defaults to a new `ELEVENLABS_VOICE_ID` env var (set to the Jack/John voice ID from the existing agent). If unset, falls back to a hardcoded ID we can edit.

No DB migrations required.

### 2. Client hook: `src/hooks/useDuncanVoice.ts`

Wraps `@elevenlabs/react`'s `useScribe` hook and orchestrates the loop. Exposes:

```ts
{
  state: "idle" | "listening" | "thinking" | "speaking",
  partialTranscript: string,
  muted: boolean,
  start(): Promise<void>,    // fetch scribe token, mic permission, connect
  stop(): Promise<void>,      // disconnect scribe, stop audio, release mic
  toggleMute(): void,
  interrupt(): void,          // stop current TTS audio
}
```

Internal flow:
1. `start()` → calls `elevenlabs-scribe-token`, requests mic, `scribe.connect({ token, microphone: { echoCancellation, noiseSuppression } })` with `commitStrategy: "vad"`.
2. `onPartialTranscript` updates `partialTranscript` for live UI.
3. `onCommittedTranscript` → calls `chat.send(text)` from a passed-in `useNormanChat` instance, sets state to `"thinking"`.
4. A `useEffect` watches `messages[messages.length-1]` while role === `"assistant"`, buffers new tokens, and when a sentence boundary appears (`. ! ? \n\n`) enqueues that sentence to the **TTS playback queue**.
5. TTS queue: serial `<audio>` element. While `audio.playing`, set state `"speaking"`. On `ended`, play next. On final assistant message complete (`isLoading` flips false), drain remaining buffer.
6. **Barge-in**: when Scribe reports a non-empty partial transcript while we're `"speaking"`, pause + clear the audio queue (state → `"listening"`).
7. `muted` skips enqueueing TTS but Duncan still replies in text.

### 3. UI components

**`src/components/chat/VoiceModeButton.tsx`** — small circular button used inside `ChatInput` (added next to the existing Whisper mic, not replacing it) and on the home dashboard. Opens the overlay.

**`src/components/chat/VoiceModeOverlay.tsx`** — full-screen modal:
- Pulsing Duncan avatar (uses existing dog focal-zoom asset, animation tied to `state`)
- Live partial transcript line
- Last assistant message rendered with markdown (read-only; canonical version is in chat)
- Controls: Mute / Interrupt / End

The overlay is mounted at the page level (Index, ProjectWorkspace) and is given the **same `useNormanChat` instance** the page already uses, so messages still appear in the regular chat list — exactly one source of truth.

### 4. Settings (small, optional)

Add a "Voice" tab in `SettingsPanel` with:
- Default voice (text input for ElevenLabs voice ID, prefilled with Jack/John)
- Speaking speed (0.8 – 1.2 slider)
- "Speak Duncan's replies in voice mode" toggle

Stored on `profiles.preferences.voice` (JSON column already exists — no migration).

## Fallback & safety

- If `elevenlabs-scribe-token` returns 4xx/5xx, overlay shows an inline error and a **"Use text chat instead"** button that closes the overlay. Existing Whisper + text input still work.
- If TTS fetch fails, we silently skip playback for that sentence; the assistant text still shows in chat.
- If mic permission is denied, overlay shows the standard permission-required message and closes.
- ElevenLabs key/quota errors are surfaced via toast with a clear reason.

## Files

**New**
- `supabase/functions/elevenlabs-scribe-token/index.ts`
- `supabase/functions/elevenlabs-tts/index.ts`
- `src/hooks/useDuncanVoice.ts`
- `src/lib/ttsTextSanitizer.ts` (strip markdown for natural speech)
- `src/components/chat/VoiceModeButton.tsx`
- `src/components/chat/VoiceModeOverlay.tsx`
- `src/components/settings/SettingsVoice.tsx` (optional but recommended)

**Edited (additive only)**
- `src/components/chat/ChatInput.tsx` — add `<VoiceModeButton />` next to the existing mic; no changes to Whisper / text logic.
- `src/pages/Index.tsx` and `src/pages/ProjectWorkspace.tsx` — mount `<VoiceModeOverlay chat={chat} />` so it shares the page's chat instance.
- `src/components/SettingsPanel.tsx` — add the new Voice tab entry.
- `package.json` — add `@elevenlabs/react`.

**Memory** — add `mem://features/voice-mode-elevenlabs` describing the architecture, default voice ID, and that Whisper remains the fallback.

## Open question (one)

You mentioned "Jack John" — please confirm the **exact ElevenLabs voice ID** from your agent (e.g. `pNInz6obpgDQGcFmaJgB`). I'll set it as the default in `ELEVENLABS_VOICE_ID` and the Settings → Voice prefill. If you'd rather I just use a sensible default (e.g. Liam `TX3LPaxmHKxFdv7VOQHJ`) and let you swap it in Settings, say the word.
