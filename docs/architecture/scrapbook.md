# Scrapbook (notes) lists (`lists.kind === 'notes'`)

The third `lists.kind` value (migration `0029`), UI name **"Scrapbook"**: a freeform feed of saved scraps — typed notes, voice memos, and links. Like task lists it reuses the whole sync substrate unchanged and is a **page-level branch** in `page.tsx` (no store/edit-mode, no AI/category/measurement, no assignees/due dates).

> The load-bearing rules (the `itemUpdate.ts` whitelist GOTCHA, the `addItem` merge gate) are stated inline in `CLAUDE.md` under "Scrapbook (notes) lists". This doc is the full detail.

- **Two new `items` columns (0029):** `url` (the link) and `note` (a longer typed/spoken body). `name` is the title/short label. `picture_url` (existing) holds the link's unfurled preview image or a photo. A scrap is a link (`url` set) or a plain note; both render as a `NoteCard`.
- **UI:** `NoteList.tsx` (feed + add textarea + voice button), `NoteCard.tsx` (title/link + body + host pill + thumbnail), `NoteEditModal.tsx` (title/body/url/remove-image), `NoteSpeechModal.tsx` (record → `transcribeNote` → editable transcript → add). Pure helpers in `src/lib/notesView.ts` (`isUrl`, `splitNoteText`, `noteHostname`). Sorted newest-first (no reorder, no done-section).
- **GOTCHA enforced:** `url`/`note` are in the `ItemUpdatePatch` whitelist (`itemUpdate.ts`) and the `muAddItem` `item.insert` payload (conditional spread — shopping/task payloads byte-unchanged) and the `addItem` dispatch args. Same rule as task fields — miss any and the server write silently no-ops.
- **Link unfurling:** adding a bare URL calls the `unfurlLink` server action (fetch + OpenGraph `og:title`/`og:description`/`og:image`, `<title>` fallback) → fills `name`/`note`/`picture_url`. Best-effort: skipped offline or on failure, the raw link is still saved.
- **No Gemini-categorize / no history:** notes adds use `muAddItem(item, { skipCategorize: true })`; the `bump_item_history` guard (0029) skips `'notes'` too, so scraps stay out of grocery autocomplete.
- **`addItem` merge gate:** the name-merge + cached-category fast path in `addItem` (`actions/items.ts`) now runs **only for `kind === 'shopping'`** (one cheap kind read) — notes (and tasks) must never dedupe by name, since titles can repeat or be empty.
- **`/lists`:** `ListsView` renders a 📎 `NoteMarker` and a 📎 glyph in the nav loading overlay (`navGlyph`). `CreateListForm` offers a third "📎 Scrapbook" kind.
