# PLAN — SpeechModal: adopt the `useAudioRecorder` hook (REFACTOR: dedup)

**Created:** 2026-06-08
**Status:** awaiting go-ahead (not started)
**Source:** `REFACTOR.md` → "Up next: SpeechModal: adopt the `useAudioRecorder` hook"

## Goal

Delete the inline audio-capture lifecycle in `SpeechModal.tsx` (grocery voice
add) and have it consume `src/app/lists/[id]/useAudioRecorder.ts` — the hook
already extracted and in production use by `TaskSpeechModal.tsx`. Removes a
second copy of subtle ref-guard logic (getUserMedia, MediaRecorder,
max-duration auto-stop, abort-vs-intentional-stop guard, codec-suffix strip,
`blobToBase64`) so the two can't drift.

Pure dedup. No user-facing behaviour or string changes intended.

## What's duplicated today (verified 2026-06-08)

`SpeechModal.tsx` lines 28–157 reimplement, nearly verbatim, what the hook
already does:
- `blobToBase64` (identical to the hook's copy, lines 28–39)
- refs: `recorderRef`, `streamRef`, `chunksRef`, `timerRef`, `abortedRef`
- `releaseMic`, `startRecording` (mic acquire → MediaRecorder → onstop blob
  handling → base64 → bare-MIME), `stopRecording`
- local `elapsed` state + the 1 s interval with max-duration auto-stop
- the mount-start / unmount-release `useEffect`

The hook (`useAudioRecorder`) owns all of this and exposes
`{ elapsed, stop, restart }`, taking `{ maxSeconds, onResult, onError }`.
`TaskSpeechModal.tsx` (lines 29–61) is the reference consumer.

## Migration — `SpeechModal.tsx` only

Mirror `TaskSpeechModal`'s shape exactly.

### Remove
- `blobToBase64` helper (lines 28–39).
- All five refs, `releaseMic`, `startRecording`, `stopRecording`, `handleClose`,
  the mount/unmount `useEffect` (lines 147–157), and the local `elapsed` /
  `setElapsed` state. The `react-hooks/set-state-in-effect` eslint-disable goes
  away with the effect.

### Add
- `import { useAudioRecorder } from './useAudioRecorder'`.
- `handleResult = useCallback(async (base64, mimeType) => { ... })` — the body of
  the current `onstop` handler **from `setStage('processing')` onward** (the blob
  build / size-0 check / abort / releaseMic all move into the hook). i.e.:
  `setStage('processing')` → `extractItemsFromAudio(base64, mimeType)` → error /
  empty / `setParsed(...selected:true)` → `setStage('results')`. Deps `[]`
  (matches TaskSpeechModal — setState + action import are stable).
- `handleRecordError = useCallback((message) => { setError(message); setStage('error') }, [])`.
  The hook already emits the same Swedish strings the inline code used
  (`'Mikrofonåtkomst nekades…'`, `'Hörde inget. Försök igen.'`), so messages are
  unchanged.
- `const { elapsed, stop, restart } = useAudioRecorder({ maxSeconds: MAX_SECONDS, onResult: handleResult, onError: handleRecordError })`.
- `handleRetry = () => { setError(null); setStage('recording'); restart() }`
  (`restart` resets `elapsed` inside the hook).

### Rewire the JSX
- Backdrop `onClick`, header `×`, results "Avbryt", error "Avbryt", and the
  Escape-key effect: `handleClose` → **`onClose`** (matches TaskSpeechModal —
  closing unmounts the modal, and the hook's unmount cleanup releases the mic).
  Escape effect dep `[handleClose]` → `[onClose]`.
- "Klar" button `onClick={stopRecording}` → `onClick={stop}`.
- Error "Försök igen" button inline handler → `onClick={handleRetry}`.

Everything else (the `Parsed` type with quantity/measurement/category, `handleAdd`
with its `findExistingItem` name-merge, all markup/styles) stays untouched —
that's the grocery-specific logic the hook deliberately doesn't own.

## One behaviour note (equivalent, not a change)

Today `handleClose` stops the recorder synchronously *before* `onClose()`. After
the refactor, closing calls `onClose()` → the modal unmounts → the hook's
unmount cleanup (`abortedRef = true`, `recorder.stop()`, `releaseMic`) runs.
Unmount on close is synchronous, and this is exactly how `TaskSpeechModal` has
worked in production — so mic-release timing is functionally identical. Calling
this out so it's a conscious decision, not an accident.

## Tests

`SpeechModal` currently has **no** dedicated test (only `TaskSpeechModal.test.tsx`
exists). Once it consumes the hook, the same jsdom-friendly mock pattern applies
(mock `useAudioRecorder` to capture `onResult`/`onError`, drive past the
browser-only capture stage). **Add `tests/components/SpeechModal.test.tsx`**
mirroring `TaskSpeechModal.test.tsx`:
- starts in recording stage,
- after `onResult` → results render the parsed items,
- selecting + "Lägg till" calls `muAddItem` / `muUpdateItem` appropriately
  (incl. the name-merge path via a pre-existing item — the one bit of logic
  unique to the grocery modal worth locking).

This turns "manual smoke only" into automated coverage and is cheap given the
existing template. (If the merge-path assertion proves fiddly, ship the two
basic cases and keep the manual smoke for the merge.)

## Verification (REFACTOR.md checklist)

1. `npm run lint` — clean.
2. `npm test` — all pass, incl. the new SpeechModal test.
3. `npm run build` — passes (mandatory).
4. **Manual browser smoke** (the hook touches real `getUserMedia`, untestable in
   jsdom): grocery voice add — open mic, speak items, "Klar" → results → "Lägg
   till"; plus the retry path (deny mic / "Försök igen") and close-mid-recording
   (confirm the mic indicator turns off, i.e. tracks released).

## Out of scope
- Any change to `useAudioRecorder` itself or to `TaskSpeechModal`.
- Touching `handleAdd` / grocery merge logic beyond what's needed to wire the hook.

## Done criteria
- `SpeechModal.tsx` consumes `useAudioRecorder`; inline copy deleted.
- New `SpeechModal.test.tsx` added and passing.
- All verification steps pass (incl. manual smoke).
- Update the hook's doc comment (lines 42–44) — drop the "(SpeechModal itself
  still has its own copy for now — see REFACTOR.md.)" caveat.
- `REFACTOR.md`: mark the item `done — 2026-06-08`, move to Completed, advance
  "Up next" to **#4 (decouple `engine.ts` from `actions.ts`)**.
- Tell the user it's ready; do **not** commit/push without explicit go.
