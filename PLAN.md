# Shared-items follow-ups: NEW-marker fixes + UI polish

## Context

Smoke-testing the shared-items feature (migration 0018, commit 5789236) surfaced four issues. Three of them are NEW-marker false positives on `/lists`, with one shared root cause; the fourth is a layout bug; and the user wants a new "this item is shared" indicator on item rows.

The NEW-marker bug shows up three ways:

1. **Share to one of my own lists →** target list shows NEW (I caused the change).
2. **Mark-shopped on a shared list with linked items →** the source list shows NEW (my action propagated via the 0018 trigger to a sibling list I haven't viewed).
3. **Edit-mode-delete on a shared list (unshare) →** original list still shows NEW even though nothing user-visible changed there (an earlier share-action stamped `shared_group_id` on the source row, which bumped its list's `last_activity`).

Root cause: `lists.last_activity` is monotonic but has no actor attribution. `computeUnread` in `src/lib/listsUnread.ts:11` only suppresses NEW for personal lists (you own AND no members) — it has no way to suppress same-user actions on shared lists. Every items write fires `bump_list_activity_on_items` (migration 0017), and the 0018 propagation trigger fires it on sibling lists too, all without recording who did it.

## Design overview

- **Bug fix (1, 3, 4)**: Add `lists.last_activity_by uuid` populated by the `bump_list_activity` trigger from `auth.uid()`. Extend the `list_activity` view to expose it. `computeUnread` skips lists whose `last_activity_by === currentUserId`. One fix kills all three reports.
- **Bug fix (2)**: Shorten SelectionBar button labels from `"Kopiera till…" / "Dela till…" / "Flytta till…"` to `"Kopiera" / "Dela" / "Flytta"` (the modal that opens already says "till lista"). Tighter gap so 360px viewports fit cleanly.
- **Feature**: Discreet chain-link SVG (w-3.5 h-3.5, muted gray, theme-aware) on rows where `item.shared_group_id !== null`. Placed between item name and `MeasurementBadge` in both `SortableRow.tsx` and `ShoppedRow.tsx`.

## 1. Migration `supabase/migrations/0019_last_activity_by.sql`

```sql
-- Track who caused the most recent items-write that bumped last_activity.
-- Used by /lists NEW-marker computation to suppress same-user actions
-- (especially trigger-propagated edits across shared-item siblings).
--
-- auth.uid() inside a trigger reads the JWT claims of the originating request,
-- so it stays correct even when called from the SECURITY DEFINER
-- propagate_shared_item_update trigger (0018) — that function changes the
-- role but not the JWT claim source.

alter table public.lists
  add column if not exists last_activity_by uuid null
  references auth.users(id) on delete set null;

create or replace function public.bump_list_activity()
returns trigger
language plpgsql
as $$
begin
  update public.lists
     set last_activity = now(),
         last_activity_by = auth.uid()
   where id = coalesce(new.list_id, old.list_id);
  return null;
end;
$$;

-- Keep the trigger declaration; only the function body changed.

create or replace view public.list_activity as
select id as list_id, last_activity, last_activity_by from public.lists;
```

## 2. TypeScript / Dexie updates

- **`src/lib/db/types.ts`** — add `last_activity_by: string | null` to `LocalListCatalog`.
- **`src/lib/db/local.ts`** — bump Dexie to `version(4)` (additive field, no new index needed).

## 3. `computeUnread` — same-user suppression

**`src/lib/listsUnread.ts`** — extend the signature:

```ts
export function computeUnread({
  lists, memberCounts, lastActivity, lastActivityBy, lastViewed, currentUserId,
}: {
  ...
  lastActivityBy: Map<string, string | null>
  ...
}): Record<string, boolean> {
  for (const list of lists) {
    const isShared = list.owner_id !== currentUserId || memberCounts[list.id]
    if (!isShared) continue
    // NEW: suppress if the last activity was caused by the viewing user
    // themselves (including trigger-propagated edits from sibling lists).
    if (lastActivityBy.get(list.id) === currentUserId) continue
    ...
  }
}
```

## 4. Sync layer plumbing

- **`src/lib/sync/reconcile.ts`** (`reconcileListsOverview`) — select `last_activity_by` from `list_activity` (the updated view). Persist on the catalog row.
- **`src/lib/sync/realtime.ts`** (`subscribeToListsOverview`):
  - Lists UPDATE handler: relax the "skip reconcile" predicate to `changedKeys ⊆ {last_activity, last_activity_by}`. When it skips, also bump the local catalog's `last_activity_by` from `payload.new.last_activity_by`.
  - Items UPDATE handler: leave the optimistic `last_activity` bump as-is (we still don't have actor on items payloads), but rely on the lists-UPDATE event firing immediately after to correct the actor. This guarantees the catalog converges to the right `(last_activity, last_activity_by)` pair within one realtime round-trip — no stale "NEW for my own action" state visible to the user once the lists event lands.

## 5. ListsView wiring

`src/app/lists/ListsView.tsx` (or wherever `computeUnread` is called) — build `lastActivityBy: Map<string, string | null>` from the same Dexie/SSR source that produces `lastActivity`, pass it through. Trivial mechanical change.

Also audit `src/app/lists/page.tsx` for the SSR-seed equivalent.

## 6. SelectionBar label trim

**`src/app/lists/[id]/SelectionBar.tsx`** — change the three button labels:

| Before | After |
|---|---|
| `Kopiera till…` | `Kopiera` |
| `Dela till…` | `Dela` |
| `Flytta till…` | `Flytta` |

The TargetListModal title ("Kopiera till lista" / "Dela till lista" / "Flytta till lista") already carries the "to a list" context, so the trim is informationally complete. Gap stays at `gap-2`; if it's still tight on 360px, drop to `gap-1.5` and `px-2.5` on the buttons — final tuning verified by manual inspection.

## 7. Shared-item indicator

Tiny chain-link inline SVG, muted gray, between the item name and `MeasurementBadge`:

**`src/app/lists/[id]/SortableRow.tsx`** — insert after the name span, before `<MeasurementBadge>`:

```tsx
{item.shared_group_id && (
  <span
    aria-label="Delad mellan listor"
    title="Delad mellan listor"
    className="shrink-0 text-gray-300 dark:text-gray-600"
  >
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656 0M10.172 13.828a4 4 0 01-5.656-5.656l3-3a4 4 0 015.656 0" />
    </svg>
  </span>
)}
```

**`src/app/lists/[id]/ShoppedRow.tsx`** — same snippet; the parent row's muted text-color (`text-gray-400 dark:text-gray-500`) inherits, so the icon naturally desaturates further in the shopped section. No theme-specific palette work needed; the muted-gray inherits and stays unobtrusive across light/dark/shoplist/polar/dusk.

## Files touched

- `supabase/migrations/0019_last_activity_by.sql` *(new)*
- `src/lib/db/types.ts`
- `src/lib/db/local.ts`
- `src/lib/listsUnread.ts`
- `src/lib/sync/reconcile.ts`
- `src/lib/sync/realtime.ts`
- `src/app/lists/ListsView.tsx`
- `src/app/lists/page.tsx` *(verify SSR-seed wiring)*
- `src/app/lists/[id]/SelectionBar.tsx`
- `src/app/lists/[id]/SortableRow.tsx`
- `src/app/lists/[id]/ShoppedRow.tsx`

### Tests

**`src/lib/listsUnread.test.ts`** *(extend — same-user suppression is the headline regression guard for bugs 1/3/4)*. Add these cases against `computeUnread`:

1. **Same-user activity is suppressed even when `lastActivity > lastViewed`** — a shared list (`owner_id !== currentUserId` OR `memberCounts[id]` truthy) with `lastActivityBy === currentUserId` returns `false` for unread. This is the direct repro of bug #1 (I shared → my own action → no NEW).
2. **Other-user activity still surfaces NEW** — same shared list, `lastActivityBy === 'other-user'`, `lastActivity > lastViewed` → returns `true`. Regression guard so the suppression doesn't over-fire.
3. **Null `lastActivityBy` does not auto-suppress** — `lastActivityBy.get(id)` returns `null` (e.g. row hasn't been touched since migration runs, or admin action without auth context). With `lastActivity > lastViewed`, returns `true`. Prevents accidental suppression of legitimate updates that pre-date the column.
4. **Personal-list suppression still wins regardless of `lastActivityBy`** — a list owned by current user with no members stays suppressed even if `lastActivityBy === 'someone-else'` (impossible in practice but a defensive assertion that the existing rule still short-circuits first).
5. **Bug #3 repro** — shared list, `lastActivityBy === currentUserId` (sibling-propagated trigger ran in my session), `lastActivity > lastViewed`, `lastViewed` exists (I've viewed it before). Returns `false`. Named test: `'does not mark NEW when my own action propagated via shared-item trigger'`.
6. **Bug #4 repro** — shared list, `lastActivityBy === currentUserId`, `lastActivity > lastViewed`, `lastViewed` is `undefined` (I've never opened that list since the action). Returns `false`. Named test: `'does not mark NEW for previously-unviewed list whose activity was caused by me'`.

The two named scenario tests (5, 6) are belt-and-braces alongside the unit-level cases (1–4) so a regression in either layer fails loudly with a bug-tagged name in the output.

**`tests/lib/sync/reconcileLists.test.ts`** — extend the existing `last_activity` plumbing test: assert `last_activity_by` flows from a server-side `list_activity` row into Dexie's `list_catalog` row (forward path) and that a follow-up reconcile overwrites an old `last_activity_by` with the new value (catalog stays fresh).

**`tests/components/SelectionBar.test.tsx`** — update label assertions: `/kopiera/i` → `/^Kopiera$/`, `/dela/i` → `/^Dela$/`, `/flytta/i` → `/^Flytta$/` (the `^…$` anchors catch accidental "till…" survivors).

**`tests/components/SortableRow.test.tsx`** — two new cases:
- Renders the chain-link `aria-label="Delad mellan listor"` element when `item.shared_group_id` is a uuid.
- Does NOT render it when `item.shared_group_id` is `null`.

**`tests/components/ShoppedSection.test.tsx`** — same two cases for the shopped section (rendered via `ShoppedRow`).

## Verification

1. `npm test` — extended unit suite passes.
2. `npm run build` — required per memory rule for `'use server'` validation.
3. **Manual** (two browsers, same user, two shared lists L1+L2):
   - Share item from L1 → L2. After redirect to /lists, **L2 is NOT marked NEW** (was bug #1).
   - From L1, toggle is_checked on a shared item. Go to /lists. **L1 NOT marked NEW** (was bug #3).
   - From L2, edit-mode-delete a shared row. Go to /lists. **L1 NOT marked NEW** (was bug #4).
   - Counter-check with a SECOND user editing the shared item: L1/L2 SHOULD mark NEW for the first user — verify suppression doesn't over-fire.
4. **Visual** (360px viewport in DevTools): SelectionBar buttons fit on one line, gap is uniform, no overlap (was bug #2).
5. **Visual**: open a list with mixed shared/unshared items, confirm the chain-link icon appears only on shared rows, sits between the name and the measurement badge, stays muted in all five themes.

## Post-plan housekeeping

Migration 0019 is pending manual apply. Add an entry to `CLAUDE.md` Pending manual tasks when the implementation lands.
