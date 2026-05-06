## Option 1: Scribe Config Tuning

Single-file change to `src/hooks/useDuncanVoice.ts`. Updates the `scribe.connect()` call inside `start()` (currently lines ~205-213) and the `useScribe({...})` options block (currently lines ~149-152).

### Change 1 — `useScribe` hook options (top-level)

**Before:**
```ts
const scribe = useScribe({
  modelId: "scribe_v2_realtime",
  commitStrategy: CommitStrategy.VAD,
  onPartialTranscript: (data: any) => {
```

**After:**
```ts
const scribe = useScribe({
  modelId: "scribe_v2_realtime",
  commitStrategy: CommitStrategy.VAD,
  vadThreshold: 0.6,
  minSpeechDurationMs: 300,
  noVerbatim: true,
  languageCode: "en",
  onPartialTranscript: (data: any) => {
```

### Change 2 — `scribe.connect()` microphone options

**Before:**
```ts
await scribe.connect({
  token,
  microphone: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
  },
});
```

**After:**
```ts
await scribe.connect({
  token,
  microphone: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
});
```

### Notes
- No other files touched.
- `vadThreshold`, `minSpeechDurationMs`, `noVerbatim`, `languageCode` belong on the `useScribe` hook (session-level config), not on `microphone` (which is a `MediaTrackConstraints`-shaped object).
- `autoGainControl` and `channelCount` belong on `microphone` (browser `getUserMedia` constraints).
- If TypeScript flags any of the new `useScribe` props as unknown in the SDK's type definitions, I'll cast the options object to `any` rather than dropping the field — please confirm that's acceptable, or I can omit any field the SDK rejects.

Approve to apply.