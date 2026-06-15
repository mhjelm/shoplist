# Plan — Fix sharing + share a link as a scrap (Web Share Target)

**Status: DONE — 2026-06-15.** Migration `0030` applied.

**Correction (2026-06-15, same day):** the original "a shared link **always** becomes
a scrap, never grocery extraction" decision was too aggressive — it made the link
picker notes-only and silently killed **recipe-link sharing** (share a recipe URL →
ingredients into a shopping list). Revised design: a link share offers **all lists**,
and the **destination kind decides** — shopping/task → recipe extraction at confirm
(`confirmShareLinkAsRecipe`), notes → unfurl into a scrap (`confirmShareLink`). Scrap
is now an *additional* target, not the only one.

## Problems

1. **Sharing a link silently does nothing.** `/share/route.ts` ran `extractRecipeItems(url)`
   on *every* shared link. A non-recipe link yields 0 grocery items → redirect to
   `/lists?shareError=empty`. `shareError` was read **nowhere** in the app.
2. **Notes (scrapbook) lists can't be a share target.** The picker only offered 🛒/✓ kinds
   and `confirmShareImport` only mapped `task`/`shopping`.
3. **App lost as a share target on a family member's phone.** Manifest + middleware are
   correct in code. Web Share Target lives in the **WebAPK**, minted at install;
   Android/Chrome can drop it. Most likely device-side → reinstall.

## Steps

1. ✅ **Migration `0030_share_link_payload.sql`** — extend `source` CHECK + add `url`/`title` columns.
2. ✅ **`src/app/share/route.ts`** — add `share.received` log; branch image → grocery;
   link (url or bare-URL text) → link path (no extraction, never empty-bail); text → grocery.
3. ✅ **`src/app/share/[importId]/page.tsx`** — select `kind` + `url`/`title` from pending.
4. ✅ **`src/app/share/[importId]/ShareImportClient.tsx`** — `LinkImportMode` component
   (notes-only picker, no checklist, `confirmShareLink`); `ItemsImportMode` for existing
   grocery/task flow; top-level router picks based on `source`.
5. ✅ **`src/app/share/actions.ts`** — `confirmShareLink(importId, destination, link)`:
   resolve/create notes list, unfurl, insert scrap, delete pending, redirect.
   Factored `resolveList` helper; `confirmShareImport` now uses it too.
6. ✅ **Surface `shareError` (Bug #1 feedback)** — `ShareErrorToast.tsx` + wired into
   `lists/page.tsx` via `searchParams.shareError`.
7. **Bug #3 — lost share target** — `share.received` log shipped (step 2). Device-side:
   uninstall + reinstall PWA on the family member's phone; confirm it's a real WebAPK
   install. Document in CLAUDE.md once confirmed.
8. ✅ **Tests** — `ShareImportClient` items-mode tests updated (`kind` on lists); new
   link-mode describe block (11 tests: header, link preview, notes-only filtering,
   auto-select, create-new, confirmShareLink calls, error surface, cancel).

## Pending manual tasks after merge
- **Apply `0030_share_link_payload.sql`** in Supabase.
- **Reinstall the PWA on the family member's phone**; verify share target returns.
