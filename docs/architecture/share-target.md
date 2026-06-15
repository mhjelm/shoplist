# Android share-to-Shoplist (Web Share Target)

`src/app/manifest.ts` declares a `share_target` entry so the installed PWA appears in Android's system share sheet. The share sheet POSTs `multipart/form-data` to `/share` with any of `text`, `url`, `title`, `image`.

Flow:
1. **`src/app/share/route.ts`** — POST handler. Auth-checks, parses FormData, logs `share.received` (booleans only), then branches by payload type:
   - **image** → `extractListItemsFromImage` → items checklist (grocery).
   - **link** (the `url` field, OR a URL found anywhere in `text` via `firstUrlIn`) → store the raw link (`source:'link'`, `items:[]`, `url`, `title`); **no extraction at the route**, and it **never bails on "empty"**.
   - **plain text** (no URL) → `extractRecipeItems` → items checklist (grocery).
2. The payload (items blob or raw link) is stored in `pending_imports` (`supabase/migrations/0010` + `0030` for the `'link'` source and `url`/`title` columns). RLS scopes rows to the inserting user.
3. The handler 303-redirects to `/share/[importId]`.
4. **`src/app/share/[importId]/page.tsx`** — Server Component loads the pending row (incl. `kind`/`url`/`title`) + user's lists.
5. **`ShareImportClient.tsx`** — two modes:
   - **Items mode** (image/text): list-picker + item accept/reject. Confirm → `confirmShareImport` → `addItems()`.
   - **Link mode** (`source:'link'`): link preview + **all lists** as targets. The chosen **destination kind decides what happens** — a shopping/task list runs `confirmShareLinkAsRecipe` (extract via `extractRecipeItems` *at confirm time*, then `addItems`), a notes/scrapbook list runs `confirmShareLink` (unfurl via `unfurlLink`, insert one scrap). Both delete the pending row and redirect.
   Cancelling calls `cancelShareImport(importId)` which just deletes the row.

> **Design note (2026-06-15):** a shared link is *not* hard-routed to one outcome. Extraction is deferred to confirm so the picker stays instant and we only pay Gemini when a shopping/task target is actually chosen. This restored recipe-link sharing (briefly lost when an earlier pass forced every link to a scrap). Surfacing of `?shareError` lives in `src/app/lists/ShareErrorToast.tsx`.

Caveats:
- iOS Safari does not implement Web Share Target — iOS users still use the in-app clipboard auto-extract.
- Unauthed shares redirect to `/auth/login` and the payload is dropped (no server-side resume).
- Orphan `pending_imports` rows are tolerated; there's no cleanup job yet.
