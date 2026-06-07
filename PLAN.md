# Speech-to-task: voice-add multiple tasks at once

_Planned 2026-06-08. Status: **implemented — ready to commit** (2026-06-08). Manual smoke (step 7, device) still pending._

## Context

Task lists (`lists.kind === 'task'`) currently support adding **one task at a time** via a single-line
text input in `TaskList.tsx`. The user wants to **speak several tasks at once** and have Gemini segment
the spoken audio into discrete tasks — solving the "what's a task vs. filler, and where does the next
one start" problem, which the LLM handles well.

The grocery side already has a complete, production-tested **speech-to-list** pipeline
(`SpeechModal.tsx` → `extractItemsFromAudio` → `callGeminiWithAudio` on `gemini-3.5-flash`). This plan
**reuses that spine** and only swaps the prompt + output shape.

**Scope decisions (confirmed with user 2026-06-08):**
- Speech-to-task **only** (no push notifications — that remains a PRD non-goal).
- **Task names only** — do NOT parse assignee or due date from speech. User sets those manually
  afterward via the existing `TaskEditModal`.
- Spoken input is **Swedish**; pin the prompt to Swedish (see §1). Android is the target.

## Implementation

### 1. New server action: `extractTasksFromAudio`

File: `src/app/lists/[id]/actions/import.ts` (add alongside `extractItemsFromAudio`).

- Signature: `extractTasksFromAudio(audioBase64: string, mimeType: string)` → `{ tasks: string[] }` or
  `{ error: string }`. Guard on empty audio + missing `GEMINI_API_KEY` (mirror `extractItemsFromAudio`).
- Call `callGeminiWithAudio(prompt, audioBase64, mimeType, { temperature: 0 })` — reuses the
  `AUDIO_MODELS` chain (`gemini-3.5-flash` primary; the only model confirmed to handle inline audio).
- On error: `log.error('extract.tasks_audio_failed', { error })`, return `{ error }`. Add the key to
  `docs/logging.md`'s catalogue (extend the existing `extract.*` row).
- **Prompt:** audio is a person speaking **Swedish**, listing to-do tasks/chores, possibly rambling
  with filler, connectors, self-corrections. Rules: extract distinct **actionable** tasks; one short
  phrase each; ignore filler ("öh", "och sen", "jag måste också", "vänta"); fold a clarification into
  its task; on a self-correction keep the corrected version; never invent tasks; **transcribe and
  return each task in Swedish** (don't translate); concise (≈ max 8 words). Return JSON only
  `{"tasks": ["..."]}`. Include one Swedish example → `{"tasks":["Ring rörmokaren","Vattna
  blommorna","Hämta tvätten"]}`. (Swedish pin removes occasional English translation + stabilizes
  short utterances/loanwords; matches the grocery prompt convention.)
- **`normalizeTaskNames(parsed: { tasks?: unknown })`** helper (parallel to `normalizeExtractedItems`):
  keep strings only, trim, drop empties, cap length (~200), case-insensitive dedupe, cap count (~50).

### 2. Shared recording hook: `useAudioRecorder`

File: `src/app/lists/[id]/useAudioRecorder.ts` (new). Extract the capture mechanics from
`SpeechModal.tsx` (`abortedRef` guard, `releaseMic`, `onstop` handler, 30 s auto-stop, codec-suffix
strip, `blobToBase64`) so the subtle lifecycle isn't duplicated.
- Input: `{ maxSeconds, onResult(base64, mimeType), onError(msg) }`. Returns `{ elapsed, stop, restart }`;
  starts on mount, releases mic on unmount.
- **Risk control:** use the hook in the new `TaskSpeechModal` only for now; leave `SpeechModal`
  untouched (zero grocery regression). Note in `REFACTOR.md` that `SpeechModal` should later adopt it.

### 3. New component: `TaskSpeechModal`

File: `src/app/lists/[id]/TaskSpeechModal.tsx` (new) — adapt `SpeechModal.tsx`, simplified.
- Props `{ listId, onClose }` (no `items`/merge). `Parsed = { name; selected }` (no qty/measurement/cat).
- Uses `useAudioRecorder`; on result calls `extractTasksFromAudio`; results stage = checkbox list of
  task names.
- `handleAdd`: loop selected → `await muAddItem(buildLocalItem(listId, name), { skipCategorize: true })`
  (matches `TaskList.tsx:56` exactly; no update/merge branch).
- Copy in English to match TaskList chrome ("Add tasks", "Speak to add tasks…", "Add N", "Cancel").

### 4. Wire into `TaskList.tsx`

- `const { isOffline } = useSyncState()` (from `@/lib/sync/engine`).
- `speechSupported` via `useSyncExternalStore` (copy `useSpeechSupported` pattern from `AddItemForm.tsx`).
- Mic button beside "Add" in the form row, gated by `speechSupported && !isOffline` (reuse mic SVG +
  styling from `AddItemForm.tsx`, indigo accent to match task UI).
- `const [showSpeech, setShowSpeech] = useState(false)`; render
  `{showSpeech && <TaskSpeechModal listId={listId} onClose={() => setShowSpeech(false)} />}`.

## Critical files

- `src/app/lists/[id]/actions/import.ts` — `extractTasksFromAudio` + `normalizeTaskNames`
- `src/app/lists/[id]/useAudioRecorder.ts` — new hook
- `src/app/lists/[id]/TaskSpeechModal.tsx` — new modal
- `src/app/lists/[id]/TaskList.tsx` — mic button + modal wiring
- `docs/logging.md` — register `extract.tasks_audio_failed`; `REFACTOR.md` — SpeechModal→hook note
- Reference (unchanged): `SpeechModal.tsx`, `src/lib/gemini.ts`, `src/lib/sync/mutations.ts`,
  `src/app/lists/[id]/itemHelpers.ts`

## Tests

- Unit-test `normalizeTaskNames` (pure): trims, drops empties, dedupes case-insensitively, caps count.
- Light `TaskSpeechModal` component test: `vi.mock` the action → `{ tasks: [...] }`, drive to results,
  assert `muAddItem` called once per selected task with `skipCategorize`. (Recording path uses browser
  APIs absent in jsdom — same limitation as `SpeechModal`; don't test capture.)

## Verification

1. `npm run lint`
2. `npm test`
3. `npm run build` — **required**: only `next build` catches `'use server'` violations.
4. Manual (needs `GEMINI_API_KEY`): `npm run dev`, open a **task** list, tap mic, speak several Swedish
   tasks with filler, confirm discrete tasks parsed + added. Spot-check on installed Android PWA.

## Out of scope (later)

- Parsing assignee / due date from speech.
- Typed multi-task add in the TaskList input.
- Migrating `SpeechModal` onto `useAudioRecorder`.

## Progress

- [x] Step 0: bookkeeping (PLAN.md + CLAUDE.md active entry + archive observability) — _done 2026-06-08_
- [x] 1. `extractTasksFromAudio` + `normalizeTaskNames` (in `src/lib/taskExtract.ts`, imported by `import.ts`; barrel re-exports the action)
- [x] 2. `useAudioRecorder` hook
- [x] 3. `TaskSpeechModal`
- [x] 4. Wire mic button into `TaskList.tsx`
- [x] 5. Docs: `docs/logging.md` event key + `REFACTOR.md` note
- [x] 6. Tests (5 `normalizeTaskNames` unit + 4 `TaskSpeechModal` component)
- [x] 7. lint clean + 525 tests pass (+9) + `npm run build` clean; **manual device smoke still pending**
