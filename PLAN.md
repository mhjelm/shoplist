# Plan — Scrapbook list (`kind = 'notes'`)

**Status: EXECUTING — 2026-06-15.**

A third list kind alongside `'shopping'` and `'task'`: a freeform collection of
saved scraps — typed notes, voice memos, and links (auto-unfurled into rich
cards). UI name **"Scrapbook"**; internal discriminator `kind = 'notes'`.

A scrap row reuses the `items` table:
- `name` — the title / short label (the bold line on the card)
- `note` — optional longer body (typed or spoken) — **new column**
- `url` — optional link — **new column**
- `picture_url` — optional preview/photo (existing)

Like task lists, notes reuse the entire sync substrate (outbox, `useListItemsSync`,
`reconcileList`, realtime, Dexie) untouched — only the presentation differs, branched
at the page level (`page.tsx`). No store mode, edit-merge, AI categorization, or
measurement.

## Steps

1. **Migration `0029_notes_lists.sql`**
   - Drop & re-add the `lists.kind` CHECK → `in ('shopping','task','notes')`.
   - `items add column url text`, `add column note text` (nullable).
   - Extend the `bump_item_history` guard (0026 pattern) → skip `kind in ('task','notes')`.

2. **Types & local mirrors**
   - `types.ts`: `'notes'` in `ListKind`; `url`/`note` on `Item`.
   - `db/types.ts`: `url`/`note` on `LocalItem`; Dexie `version(7)` bump (no new index).
   - `itemHelpers.ts`: adapters + `buildLocalItem` carry `url`/`note`.

3. **Mutation plumbing (the silent-failure spots)**
   - `itemUpdate.ts`: `url`/`note` in `ItemUpdatePatch` + `buildItemUpdatePayload`.
   - `mutations.ts`: `muAddItem` `item.insert` payload forwards `url`/`note` (conditional spread — shopping payloads byte-unchanged).
   - `engine.ts` `item.insert`: pass `url`/`note` through to `addItem`.
   - `actions/items.ts` `addItem`: accept `url`/`note`, insert them; **gate the name-merge + history-category fast path on `kind === 'shopping'`** (notes/tasks must never dedupe by name — also fixes a latent task dedupe).

4. **Server actions** (in `actions/import.ts`, re-exported from `index.ts`)
   - `transcribeNote(audioBase64, mimeType)` — Gemini audio → one free-text transcript (`{"text": "..."}`).
   - `unfurlLink(url)` — fetch + parse OpenGraph (`og:title`/`og:description`/`og:image`, `<title>` fallback), resolve relative image URLs.

5. **Presentation** (siblings of the Task* set)
   - `page.tsx`: third branch `if (kind === 'notes') return <NoteList/>`.
   - `NoteList.tsx`, `NoteCard.tsx`, `NoteEditModal.tsx`, `NoteSpeechModal.tsx`.
   - `src/lib/notesView.ts`: `isUrl`, `splitNoteText`, `noteHostname` helpers.
   - Adds via `muAddItem(item, { skipCategorize: true })`; a URL input triggers `unfurlLink` (best-effort, skipped offline → raw link saved).

6. **Overview & creation**
   - `ListsView`: 📎 `NOTE` marker + notes glyph in the nav loading overlay.
   - `CreateListForm` + `lists/actions.ts`: third kind option.

7. **Tests**
   - `itemUpdate.test.ts`: `url`/`note` cases.
   - `notesView.test.ts`: URL detection + note splitting.
   - `NoteCard` component smoke test.

## Pending manual task after merge
- Apply `0029_notes_lists.sql` (also still-pending: `0028`).
