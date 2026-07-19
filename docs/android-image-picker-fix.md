# PWA image picker on Android Chrome — the full fix (transferable notes)

Context: React/Next.js PWA. An in-app "pick an image" control (hidden file input
+ styled button) that resizes the picked image on a `<canvas>` and uploads it.
Worked on desktop/iOS; broke in many different ways on Android Chrome (both the
browser tab and the installed PWA/WebAPK). Took ~6 iterations to fully solve.
Each fix below is load-bearing — removing any one reintroduces a specific failure.

Source of truth in this repo: `src/app/lists/[id]/PictureInput.tsx` and
`src/lib/resize-image.ts`. Commit trail:
`652cff9` → `10a3b19` → `817a710` → `e94e04e` → `a2cb3ae` → `da730d8`.

## Problem 1 — Picker won't even open
Android Chrome will NOT open the native file picker when you call `.click()`
programmatically on a `display:none` input.
**Fix:** Don't script the click. Use a real `<label htmlFor={inputId}>` styled as
the button, linked to a visually-hidden (`sr-only`, NOT `display:none`) `<input
type="file">`. The label triggers the native picker reliably on mobile.

## Problem 2 — Short-lived read permission gets revoked mid-read
Android 13's system Photo Picker grants a short-lived `content://` read URI that
can be revoked between picker-close and your read → `NotReadableError`.
**Fix:** Start the read SYNCHRONOUSLY inside the input's `onChange`, before any
setState / React re-render. Kick off `resizeImage(file)` immediately, attach a
no-op `.catch(() => {})`, and thread that in-flight Promise into your async
handler. Starting the read in the same tick as picker-close wins the race.

## Problem 3 — Remounting the input killed the read (self-inflicted regression)
To avoid stale `content://` permission state on a SECOND pick, we bump a `key`
on the file input to force a fresh DOM node after each pick. But doing that
remount synchronously in `onChange` tears down the element that OWNS the picked
file's read permission → revoked the file mid-read, breaking EVERY read path.
**Fix:** Defer the remount until the read finishes:
`handleFile(f, p).finally(() => setPickerNonce(n => n + 1))`. Remount still
happens well before the next pick, so it keeps its purpose without racing.

## Problem 4 — Android Photo Picker returns unreadable URIs; SAF "Files" doesn't
Even with the race won, Android 13's Photo Picker hands Chrome `content://` URIs
that throw `NotReadableError` on every read path. Chrome routes
`accept="image/*"` to the Photo Picker; with NO `accept` it uses the SAF "Files"
picker, which returns READABLE URIs.
**Fix:** Render the input WITH `accept="image/*"` (correct for desktop/iOS + needed
for SSR/hydration parity), then imperatively `removeAttribute('accept')`
post-mount ONLY on Android (`/Android/i.test(navigator.userAgent)`), re-running
the effect on each remount (keyed on the `pickerNonce`). Because you dropped
`accept`, the Files picker can return non-images — guard in `onChange`:
`if (f.type && !f.type.startsWith('image/')) { reject cleanly }`.

## Robust read/resize pipeline (belt-and-suspenders)
`resizeImage()` tries paths in this order, because Android permission quirks hit
each differently:
1. `<img>` + `URL.createObjectURL` FIRST — Chrome's image loader reads the
   underlying `content://` internally and handles Android quirks better than JS
   byte reads. Draw to canvas → `toBlob`.
2. Fallback: materialise bytes in JS — `file.arrayBuffer()`, then `FileReader`,
   then `FileReader` again after a 150ms delay (transient `NotReadableError`
   often clears). Wrap bytes in a fresh Blob → `createImageBitmap` → canvas →
   `toBlob`.

Downscale to `maxEdge` 1024, JPEG quality 0.85.

## Diagnosis was impossible without device logs
None of this reproduces on desktop or in an emulator reliably. What unblocked it
was an isomorphic logger that forwards client events to a server endpoint +
durable store, emitting ONE rich, PII-safe event per attempt
(type/size/timings/which-stage-failed/error-message). Add
`picture.picked` / `picture.resize_ok` / `picture.resize_failed{stage}` style
events so a single real-device repro pinpoints WHERE and WHEN the read dies
instead of guessing.

## Also worth adding
A user-facing fallback tip: when reads still fail, point users to the
"Share image from Gallery → app" (Web Share Target) flow, which hands over a
readable file and sidesteps the picker entirely.

## Checklist to port to another app
- [ ] `<label htmlFor>` + `sr-only` input, never `.click()` a `display:none` input
- [ ] Start resize/read synchronously in `onChange`; thread the Promise
- [ ] If you remount the input via `key`, defer the bump to `.finally()`
- [ ] Render with `accept="image/*"`, strip it post-mount on Android only
- [ ] Guard non-image files when `accept` is stripped
- [ ] Multi-path read: `<img>`/objectURL first, then `arrayBuffer`→`FileReader`→retry
- [ ] Add PII-safe per-attempt telemetry (stage + timings + error message)
- [ ] Offer a Web Share Target fallback path
