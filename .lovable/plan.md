# Reduce Duncan voice latency — apply A, C, E, F

Targeted, low-risk frontend-only changes. No edge function or LLM changes.

## A. Cut STT commit latency
File: `src/hooks/useDuncanVoice.ts` (`useScribe` config, ~line 160)
- Add `silenceDurationMs: 350` (currently unset → ElevenLabs default ~700–1000 ms).
- Lower `minSpeechDurationMs` from `300` → `200`.
- Keep `vadThreshold: 0.6`.

Expected: ~400–700 ms saved per turn.

## C. Speak earlier — flush at phrase boundaries
File: `src/hooks/useDuncanVoice.ts` (assistant-watch effect, ~lines 123–147) and `src/lib/ttsTextSanitizer.ts` if `extractSentences` needs an "early flush" mode.
- During streaming (`chat.isLoading === true`), if no full sentence boundary has been hit but the unspoken buffer is ≥ 60 chars and ends with `, ` / `; ` / `: ` / ` — `, flush the chunk up to that boundary as a TTS sentence.
- Keep current behavior on full sentence boundaries (`. ! ?`).
- Final remainder still flushed when `chat.isLoading` flips to false.
- Guard so we never flush mid-word (only after whitespace following punctuation).

Implementation: small helper `extractSpeakable(fresh, { eager: chat.isLoading })` that wraps existing `extractSentences` and, in eager mode, additionally accepts soft-boundary cuts.

Expected: Duncan starts speaking ~500–1000 ms sooner on multi-sentence answers.

## E. Trim per-call overhead
File: `src/hooks/useDuncanVoice.ts`
- Add `tokenRef = useRef<string | null>(null)`. Populate in `start()` from `supabase.auth.getSession()`. Reuse in `playNext()` instead of calling `getSession()` for every TTS chunk.
- Add a Supabase `onAuthStateChange` subscription inside the hook to refresh `tokenRef.current` when the access token rotates; clear on `SIGNED_OUT`.
- On TTS 401, do a one-shot refresh (`getSession()`) and retry once.

Expected: removes ~50–150 ms of auth lookup per spoken chunk; meaningful when a reply has 4–6 sentences.

## F. Pre-warm on overlay open
File: `src/hooks/useDuncanVoice.ts` (inside `start()`, after scribe connects)
- Fire-and-forget: `fetch(TTS_URL, { method: "POST", headers, body: JSON.stringify({ text: ".", voiceId, speed }) }).then(r => r.body?.cancel())`.
- Wrapped in try/catch, no `await`, no playback. Purpose: warm Supabase edge function + ElevenLabs HTTPS connection so the first real TTS chunk skips cold-start.
- Gate behind a `hasWarmedRef` so we only warm once per session.

Expected: ~200–500 ms saved on the very first reply of a voice session.

## Files touched
- `src/hooks/useDuncanVoice.ts` — all four changes.
- `src/lib/ttsTextSanitizer.ts` — add optional eager mode to `extractSentences` (or new helper); only if needed to keep logic clean.

## Out of scope (per your decision)
- B: streaming MP3 playback via MediaSource.
- D: `voiceMode` flag through `norman-chat` (model swap, brevity prompt).

## Verification
- Manually open voice overlay, speak one short utterance, confirm Duncan starts replying noticeably sooner.
- Check console: no extra `getSession` calls per TTS chunk; warm-up request visible once on overlay open.
- Confirm long replies still sound natural (no mid-word cuts, no stuttering between phrase chunks).

Approve and I'll implement.
