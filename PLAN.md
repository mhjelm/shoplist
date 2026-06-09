# PLAN — Fix BUG-001: Share-import → 404 when navigating Back

**Created:** 2026-06-10
**Status:** DONE — executed 2026-06-10 (recommended fix applied; optional history-replace enhancement deferred). BUG-001 moved to Fixed in `BUGS.md`.
**Source:** `BUGS.md` → BUG-001

## Context

After a user confirms (or cancels) a shared-image/text import, the server actions
`confirmShareImport` / `cancelShareImport` (`src/app/share/actions.ts`) delete the `pending_imports`
row and `redirect()` to `/lists/[id]` (or `/lists`). The browser keeps `/share/[importId]` in its
history stack. Pressing **Back** re-renders `SharePage` (`src/app/share/[importId]/page.tsx`), which
re-queries `pending_imports`, finds nothing, and calls **`notFound()` → 404**.

The same `notFound()` path also fires for: a hard refresh of `/share/[importId]` after import, a
double-confirm, and genuinely stale / invalid / not-owned share links. Goal: **never show a 404 there**
— gracefully route the user to their lists instead.

## Root cause

`src/app/share/[importId]/page.tsx:22` — `if (!pending) notFound()`. The pending row is *intentionally*
gone after a handled import, so `notFound()` is the wrong response for the "already handled" case (and
unfriendly for bad links). This is kind-agnostic — nothing to do with task vs shopping targets, so the
"is it task-specific?" question in the BUG-001 note is moot once the missing row is handled gracefully.

## Fix (recommended)

Replace the `notFound()` with a graceful "this share is no longer available" state.

- **`src/app/share/[importId]/page.tsx`** — when `pending` is null, render a small friendly view
  instead of `notFound()`. Drop the now-unused `notFound` import.
- **(new) `src/app/share/[importId]/ShareGone.tsx`** — a tiny presentational component: a short message
  (e.g. _"Den här delningen är redan hanterad eller hittades inte."_) and a primary link/button to
  `/lists` (_"Till mina listor"_). Reuse the Tailwind classes already used in `ShareImportClient`'s
  header/buttons for visual consistency. (Could be inlined in `page.tsx`, but a separate component keeps
  the page lean and matches the file-per-concern style already used in this route.)

This single change covers confirm, cancel, refresh, double-submit, and bogus IDs — no path left to a
404 on this route.

## Optional enhancement (nicer UX, larger touch — NOT required to fix the bug)

Make Back skip the dead `/share/[importId]` entry entirely by replacing it in history on success:
- Change `confirmShareImport` to return `{ listId }` instead of calling server `redirect()`, and have
  `ShareImportClient.handleConfirm` call `router.replace('/lists/[id]')`; likewise cancel →
  `router.replace('/lists')`.
- **Trade-off:** changes the action's success contract and the client success path. The graceful-state
  fix already removes the 404, so this is pure polish (Back wouldn't even flash the share screen).
  **Recommend deferring** unless we specifically want that.

## Verification

- `npm run lint` · `npm test` · `npm run build` all green (build is the only thing that catches
  `'use server'` violations).
- Manual (the original repro needs the Android share target, so also exercise the route directly):
  1. Share an image → confirm → on `/lists/[id]` press **Back** → expect the friendly "redan hanterad"
     page with a working "Till mina listor" link, **not** a 404.
  2. Same for **cancel**.
  3. Hard-refresh `/share/[importId]` after an import → friendly page, not 404.
  4. Visit `/share/<made-up-uuid>` while logged in → friendly page, not 404.

## Notes

- No DB/schema change. Happy-path import behavior is untouched.
- On completion: move **BUG-001** to the **Fixed** section in `BUGS.md` with the date + a one-line
  description of the approach.
