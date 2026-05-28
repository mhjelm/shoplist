# Recipe / list import (`RecipeImportModal.tsx` + `extractRecipeItems` / `extractListItemsFromImage` actions)

The single modal accepts three input types — a URL or pasted text, an image picked from the device, or an image already on the clipboard. All three converge on the same accept/reject screen and then `addItems()`.

URL / text path (`extractRecipeItems`):
1. **URL detection**: if the input looks like an `http(s)://` URL, fetch it server-side. The modal also auto-fills from `navigator.clipboard.readText()` on open if the clipboard contains a URL (only as a fallback — see clipboard image below).
2. **JSON-LD first**: parse `<script type="application/ld+json">` and pull `recipeIngredient` from any `Recipe`-typed node (handles `@graph` wrappers and arrays). Most Swedish recipe sites (koket.se, ica.se, arla.se, mathem.se) have this — way more reliable than scraping HTML.
3. **HTML fallback**: if no JSON-LD, strip `<script>`/`<style>` and pass the first 30 KB to Gemini. The prompt is broad enough to also extract from non-recipe pages that contain a shopping list.
4. **Gemini extracts** `{ name, category, measurement }` per ingredient with `temperature: 0` and a few-shot example. The system prompt forbids modifying measurement strings — keep `5 dl` as `5 dl`, never round or paraphrase.

Image path (`extractListItemsFromImage`):
1. **Clipboard auto-extract on open**: `navigator.clipboard.read()` is checked first; if it returns a `ClipboardItem` with an `image/*` type, the image is sent straight through the pipeline and the modal jumps to the accept/reject screen. Requires the clipboard-read permission, falls back silently when denied.
2. **Manual upload**: the "Hämta lista från bild" label triggers a hidden `<input type="file" accept="image/*">` which on mobile includes the camera. The chosen file is downscaled by `resizeImage()` to keep the base64 payload small.
3. **Gemini vision call**: direct REST POST to `gemini-2.5-flash:generateContent` with an `inline_data` part — `callGemini` in `src/lib/gemini.ts` is text-only. Same JSON schema and validation as the text path (category via `isValidCategorySlug`, verbatim measurement rule).

Both paths end with **`addItems()` server action**, which dedupes by lowercased name within the batch, then either appends to existing active items (measurements joined with ` + `, quantities summed), revives shopped items (replacing the measurement), or inserts new rows.
