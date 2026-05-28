# Android share-to-Shoplist (Web Share Target)

`src/app/manifest.ts` declares a `share_target` entry so the installed PWA appears in Android's system share sheet. The share sheet POSTs `multipart/form-data` to `/share` with any of `text`, `url`, `title`, `image`.

Flow:
1. **`src/app/share/route.ts`** — POST handler. Auth-checks, parses FormData, then branches to `extractListItemsFromImage` (when an image file is present) or `extractRecipeItems` (URL/text). The same extractors used by the in-app import modal.
2. The extracted items are stored as a JSON blob in `pending_imports` (`supabase/migrations/0010_pending_imports.sql`). RLS scopes rows to the inserting user.
3. The handler 303-redirects to `/share/[importId]`.
4. **`src/app/share/[importId]/page.tsx`** — Server Component loads the pending row + user's lists.
5. **`ShareImportClient.tsx`** — list-picker on top, item accept/reject below. Confirming calls `confirmShareImport(importId, listId, items)` which fans out to `addItems()` and deletes the pending row; cancelling calls `cancelShareImport(importId)` which just deletes the row.

Caveats:
- iOS Safari does not implement Web Share Target — iOS users still use the in-app clipboard auto-extract.
- Unauthed shares redirect to `/auth/login` and the payload is dropped (no server-side resume).
- Orphan `pending_imports` rows are tolerated; there's no cleanup job yet.
