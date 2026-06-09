# BUGS.md

Bug tracker for shoplist — the single source of truth for known **functional** bugs worth fixing.
(Architectural smells live in `REFACTOR.md`; deep, deliberately-masked issues live under
`docs/known-issues/` and are linked from `CLAUDE.md` → Known issues.)

**Conventions**
- Append new bugs to **Open** with the next `BUG-NNN` id (ids are never reused).
- When fixed, set `Status: fixed — YYYY-MM-DD`, note the fixing commit/approach, and move the entry
  to **Fixed**.
- Each entry: id + one-line title, status, date reported, severity, repro steps, suspected cause,
  and scope/notes.

---

## Open

### BUG-001 — Share-image import → 404 when navigating Back
- **Status:** open
- **Reported:** 2026-06-09
- **Severity:** low (the import itself succeeds; only the later Back navigation 404s)
- **Repro:**
  1. Share an image containing a list of items to the app (Android Web Share Target).
  2. On the share-import screen, select a target list — observed while picking a **task** list.
  3. Confirm. The import works and lands on `/lists/[id]`.
  4. Press Back at some later point → **404 not found**.
- **Suspected cause:** the Back stack returns to `/share/[importId]`, whose `pending_imports` row
  was deleted on confirm (`confirmShareImport` in `src/app/share/actions.ts`), so
  `src/app/share/[importId]/page.tsx` hits `notFound()`. Likely **not** task-specific — probably
  affects the whole share-confirm flow regardless of target kind; needs confirmation.
- **Notes / possible fixes:** confirm whether it reproduces for shopping targets too. Candidate
  fixes: use `redirect`'s replace semantics / strip `/share/[importId]` from history after confirm,
  or have the `[importId]` page render a friendly "already imported" state instead of `notFound()`
  when the pending row is gone. Triage before fixing.

---

## Fixed

_None yet._
