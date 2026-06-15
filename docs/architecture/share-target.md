# Android share-to-Shoplist (Web Share Target)

`src/app/manifest.ts` declares a `share_target` entry so the installed PWA appears in Android's system share sheet. The share sheet POSTs `multipart/form-data` to `/share` with any of `text`, `url`, `title`, `image`.

Flow:
1. **`src/app/share/route.ts`** — POST handler. Auth-checks, parses FormData, logs `share.received` (booleans only), then branches by payload type:
   - **image** → `extractListItemsFromImage` → items checklist (grocery).
   - **link** (the `url` field, OR a URL found anywhere in `text` via `firstUrlIn`) → `extractRecipeItems` **and** `unfurlLink` run **in parallel** (both parse the same page; latency is bounded to the slower) → store `source:'link'` with the extracted `items`, the raw `url`/`title`, and the `unfurl` jsonb (`{title,description,image}`, migration `0031`). The stored unfurl powers the picker's rich preview (image) immediately and is reused by `confirmShareLink` so the scrap insert needs no second fetch.
   - **plain text** (no URL) → `extractRecipeItems` → items checklist (grocery).
2. The payload (items blob or raw link) is stored in `pending_imports` (`supabase/migrations/0010` + `0030` for the `'link'` source and `url`/`title` columns). RLS scopes rows to the inserting user.
3. The handler 303-redirects to `/share/[importId]`.
4. **`src/app/share/[importId]/page.tsx`** — Server Component loads the pending row (incl. `kind`/`url`/`title`) + user's lists.
5. **`ShareImportClient.tsx`** — two modes:
   - **Items mode** (image/text): list-picker + item accept/reject. Confirm → `confirmShareImport` → `addItems()`.
   - **Link mode** (`source:'link'`): link preview + **all lists** as targets. The chosen **destination kind decides what happens** — a shopping/task list shows the route-extracted items as an **accept/reject checklist** and confirm runs `confirmShareImport` (the *same* reviewed-import path as image/text shares), a notes/scrapbook list hides the checklist and runs `confirmShareLink` (unfurl via `unfurlLink`, insert one scrap). Both delete the pending row and redirect.
   Cancelling calls `cancelShareImport(importId)` which just deletes the row.

**Two cross-cutting rules:** (a) **task lists are never share targets** — the router filters `kind === 'task'` out of both pickers and neither create-new toggle offers it (a new list from a share is shopping or, for links, shopping/scrap). (b) The picker is a one-shot interstitial whose pending row is deleted on confirm/cancel, so all confirm/cancel **redirects use `RedirectType.replace`** — otherwise Back from the destination list lands on the consumed picker (`ShareGone`) instead of `/lists`. Both are locked by tests (`ShareImportClient.test.tsx` "does not show task lists…", `tests/lib/actions/shareConfirmRedirect.test.ts`).

> **Design note (2026-06-15):** a shared link is *not* hard-routed to one outcome, and a shared **recipe is always reviewable** — items are extracted at the route and shown as an accept/reject checklist before import (identical UX to image/text shares), with a scrapbook as an additional target. Two earlier passes regressed this (first forced every link to a notes-only scrap; second deferred extraction and dropped the checklist). The durable requirement is locked by the `REQUIREMENT:` block in `tests/components/ShareImportClient.test.tsx` — that test must fail (not be rewritten) if the checklist is ever dropped again. Surfacing of `?shareError` lives in `src/app/lists/ShareErrorToast.tsx`.

Caveats:
- iOS Safari does not implement Web Share Target — iOS users still use the in-app clipboard auto-extract.
- Unauthed shares redirect to `/auth/login` and the payload is dropped (no server-side resume).
- Orphan `pending_imports` rows are tolerated; there's no cleanup job yet.
