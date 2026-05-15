# Plan — Extend recipe import to also import lists from images and arbitrary web pages

## Context

Today the import modal (`src/app/lists/[id]/RecipeImportModal.tsx`) only takes a recipe URL or pasted recipe text. The user wants the same modal to additionally accept:

1. **An image** containing a shopping list (uploaded from the device, or auto-grabbed from the clipboard on open).
2. **Web pages that are not recipes** but contain a shopping list (so the URL/text path should not only target recipes).

The existing URL/recipe text path must keep working unchanged. After extraction, all sources funnel into the same accept/reject UI that already exists.

Decisions confirmed with user:
- Image button is rendered **prominent, above the textarea**, with an `eller` divider between the two input modes.
- When the modal opens and the clipboard already holds an image, **auto-extract immediately** (skip the form, go straight to a "Bearbetar bild från klippbord…" state, then to the accept/reject screen).

## Approach

### 1. Generalise the existing URL/text extractor

`src/app/lists/[id]/actions.ts` — `extractRecipeItems` (lines 504–542):
- Rename for clarity to `extractListItems`. Re-export the old name as an alias to keep existing tests/imports painless, or update call sites — see "Files modified" below.
- Broaden the Gemini system prompt: replace `"Extract grocery shopping list items from this recipe…"` with `"Extract grocery shopping list items from this recipe or shopping list…"`. Keep the rest of the prompt identical (categories, VERBATIM measurement rule, few-shot example, JSON shape).
- Reuse `fetchRecipeText` (lines 480–502) unchanged: the JSON-LD fast path still wins for recipe sites; the HTML fallback now correctly serves arbitrary shopping-list pages too.

### 2. New server action: extract list items from an image

Add `extractListItemsFromImage(formData: FormData)` to `src/app/lists/[id]/actions.ts`. Pattern is a hybrid of the existing `suggestItemName` (lines 544–586, for the image plumbing) and `extractRecipeItems` (for the JSON shape and category validation):

- Read `image` from FormData, validate `File && size > 0 && size <= 5 MB` (mirrors `uploadImage` at lines 588–604).
- Base64-encode (`Buffer.from(buf).toString('base64')`) and POST to `gemini-2.5-flash` `:generateContent` with `inline_data` part + text prompt part. Direct fetch — `callGemini` in `src/lib/gemini.ts` only supports text-only prompts, so the image action calls the REST endpoint directly like `suggestItemName` already does.
- Use `generationConfig: { temperature: 0, maxOutputTokens: 4000, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }`.
- Prompt mirrors the recipe prompt but adapted for an image of a list:

  > Extract grocery shopping list items from this image of a shopping list or recipe. Reply in Swedish. Keep names short (1-4 words each). Classify each item into one of these category slugs: `frukt-gront, mejeri, kott-fisk, brod, frys, skafferi, drycker, snacks, hushall, hygien, ovrigt`.
  >
  > For each item, include a `measurement` field with the quantity/unit phrase if visible. COPY the measurement VERBATIM. Never modify, round, paraphrase, or invent numbers. Preserve fractions (½, ¼), ranges (350-400), approximations (ca), parentheticals (à 500 g), and Swedish decimal commas (1,5) exactly. Set `measurement` to null when no amount is shown.
  >
  > Skip handwritten strikethroughs / crossed-out items. Skip header text, dates, or store names.
  >
  > Return JSON only: `{"items": [{"name": "...", "category": "slug", "measurement": "..." or null}, ...]}`

- Validate the response identically to `extractRecipeItems` (lines 524–537): require array, filter to objects with string `name`, validate category via `isValidCategorySlug`, trim measurement to string-or-null. Return `{ items }` or `{ error }`. Handle 429 with the same retry pattern as `callGemini` (lines 56–63).

### 3. Modal UI changes — `RecipeImportModal.tsx`

- **Title**: replace `'Importera från recept'` (line 85) with `'Importera från recept eller lista'`. The post-extract title (`Lägg till N varor`) stays as-is.
- **Tooltip on the trigger button** in `ItemList.tsx` (line 425, `title="Importera från recept"`) becomes `title="Importera från recept eller lista"`.
- **New top section** above the textarea (inside the `!extracted` branch, lines 96–122):

  ```
  ┌──────────────────────────────────────┐
  │  📷  Hämta lista från bild           │
  └──────────────────────────────────────┘
                ─── eller ───
  [existing textarea + Hämta varor row]
  ```

  - The button is a `<label htmlFor={fileInputId}>` so a hidden `<input type="file" accept="image/*">` opens the device picker (on mobile this includes Camera). Mirrors `PictureInput.tsx` lines 87–108.
  - The `eller` divider is a centered text-on-line element (`<div class="relative"><hr /><span class="absolute…">eller</span></div>`).
  - Hide both the image button and the divider while `loading` so the accept/reject screen stays uncluttered (the button block lives inside the existing `!extracted` conditional).

- **New state**:
  - `imageLoading: boolean` — true while a chosen / pasted / clipboard image is being processed. Reuse the existing `loading` flag if simpler; the only practical difference is a separate placeholder text ("Bearbetar bild…" vs "Bearbetar…"). Tentative: keep one `loading` flag + a `loadingLabel` string.
- **New handler**: `handleImageFile(file: File)`:
  1. Set loading.
  2. `await resizeImage(file)` from `src/lib/resize-image.ts` to compress to 1024px max edge before sending — keeps base64 payload small.
  3. Build a FormData with key `image`, call `extractListItemsFromImage(fd)`.
  4. On success, populate `extracted` exactly like `handleExtract` does at line 49. On error, set `error` and stay on the form.
- **File input `onChange`** calls `handleImageFile(file)`.

### 4. Clipboard image auto-extract on open

Replace the current `useEffect` at lines 21–26 with a single effect that checks the clipboard for an image first, then falls back to text:

```ts
useEffect(() => {
  (async () => {
    // 1. Try clipboard image (modern browsers, https / localhost only).
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'))
          if (imgType) {
            const blob = await item.getType(imgType)
            const file = new File([blob], 'clipboard.png', { type: imgType })
            await handleImageFile(file)  // auto-extract, jump to accept/reject
            return
          }
        }
      } catch { /* permission denied or no image — fall through */ }
    }
    // 2. Fall back to existing URL auto-fill behaviour.
    try {
      const clip = await navigator.clipboard.readText()
      if (/^https?:\/\/\S+$/i.test(clip.trim())) setText(clip.trim())
    } catch {}
  })()
}, [])  // intentionally once-on-mount; handleImageFile is stable enough for this scope
```

Notes:
- `navigator.clipboard.read()` requires user permission on desktop browsers; the `catch` is essential because it throws when permission is denied or the user hasn't interacted yet. The graceful failure mirrors how the existing `readText()` is wrapped.
- Auto-extract on open behaves correctly with Escape — the user can still close the modal mid-extract; the in-flight request will resolve into discarded state.
- The textarea URL auto-fill only runs when no clipboard image was found, so we don't double-trigger.

### 5. Tests

`tests/components/RecipeImportModal.test.tsx`:
- Update the existing `vi.mock('@/app/lists/[id]/actions', ...)` to also export `extractListItemsFromImage: vi.fn()`.
- Add cases:
  - Title now reads "Importera från recept eller lista".
  - "Hämta lista från bild" button is rendered above the textarea.
  - Clipboard with an image triggers `extractListItemsFromImage` and jumps to the accept/reject screen. (Mock `navigator.clipboard.read` returning a fake `ClipboardItem`-like object with `types` and `getType`.)
  - Clipboard with a URL but no image still fills the textarea (existing behaviour preserved).
  - File picker `onChange` calls `extractListItemsFromImage` with FormData containing the file.
- Keep the existing "URL/text extraction" tests untouched — proves backward compatibility.

The existing `vi.mock` pattern at lines 5–13 makes mocking a third server action a one-line addition. `resizeImage` lives in `src/lib/resize-image.ts` and uses `canvas.toBlob`, which is not available in jsdom — for the new image tests, mock `@/lib/resize-image` to return the input blob unchanged.

## Critical files modified

- `src/app/lists/[id]/RecipeImportModal.tsx` — title, image button, divider, file input, clipboard-image effect, `handleImageFile`.
- `src/app/lists/[id]/actions.ts` — broaden `extractRecipeItems` prompt; add `extractListItemsFromImage`.
- `src/app/lists/[id]/ItemList.tsx` — update trigger button tooltip (line 425).
- `tests/components/RecipeImportModal.test.tsx` — extend mocks and add image-flow tests.
- `CLAUDE.md` — update the "Recipe import" architecture section to reflect the new image / general-list scope and the new server action.

## Existing utilities reused

- `resizeImage` (`src/lib/resize-image.ts`) — client-side downscale before upload.
- `fetchRecipeText` (`actions.ts:480`) — JSON-LD + HTML fallback pipeline, unchanged.
- `isValidCategorySlug` (`src/lib/categories.ts`) — response validation.
- `addItems` (`actions.ts:213`) — unchanged; same accept/reject screen feeds it for every source.
- File-input + label pattern from `PictureInput.tsx:87-108`.
- 429 retry pattern from `callGemini` (`src/lib/gemini.ts:54-64`).

## Verification

1. `npm run lint` and `npm test` — existing recipe tests must still pass; new image-path tests added.
2. `npm run dev`, open a list, click the import icon:
   - Existing path: paste a koket.se URL → still extracts via JSON-LD.
   - Existing path: paste raw recipe text → still extracts.
   - New path: click `Hämta lista från bild` and pick a photo of a handwritten or printed shopping list → items appear in the accept/reject screen with categories and measurements.
   - New path: on mobile, choose Camera from the picker, take a photo of a list → same flow.
   - New path: copy an image to the clipboard (Win+Shift+S on Windows, screenshot tools, image from a webpage), open the modal → modal jumps straight to the accept/reject screen after a brief "Bearbetar bild…" state.
   - New path: paste a URL to a non-recipe page that contains a list (e.g. a blog post or notes page) → broadened prompt should extract its items.
3. Reject some items in the selection screen, confirm `addItems` deduping/append/revive behaviour still works (e.g. add a list containing an item that already exists active or shopped).

## Out of scope / explicit non-goals

- No persistence of the source image (not uploaded to ImgBB).
- No OCR fallback if Gemini vision misreads — single Gemini call, single retry on 429.
- No new "list" entity or separate "recipe vs list" mode in the data model — items still land in `items` exactly as today.

## Follow-up after approval

When the user gives the go-ahead, I'll also:
- Copy this plan to `PLAN.md` at the project root (per the user's global CLAUDE.md convention).
- Add an "Active plan" entry to project `CLAUDE.md` with today's date.
