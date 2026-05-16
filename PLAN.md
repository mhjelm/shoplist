# Plan — Sharing moves into list edit mode, with member history

## Context

Today the user has to decide whether a list is shared **at creation time** via a checkbox on `CreateListForm`. After creation, the choice is fixed: a non-shared list can never invite anyone (the invite form is gated on `lists.is_shared`), and a shared list always shows the invite form whether you want it visible or not. This is the wrong moment to ask — when you create a list you don't yet know if you'll want to share it.

We want:

1. Sharing decisions happen on the list page, not at creation.
2. Any list is shareable at any time — drop the `is_shared` flag entirely. A list is "shared" iff it has members.
3. The share UI lives inside the list's **edit mode** as an inline section, alongside current members and a quick-pick history of people the user has shared with before.
4. Owners can remove members (the RLS already permits this; we just need UI + server action).

This naturally falls out of the existing edit-mode pattern (`EditModeContext`) and the existing `inviteMember` action. The new pieces are a DB migration, one new server action, one component, and a couple of small server-side queries.

## Decisions / scope

- **Drop `lists.is_shared`** in a new migration. A list's "shared" status is derived from whether it has any members. The `/lists` page's "shared" badge becomes a left join on `list_members` (count > 0).
- **Share history = all distinct emails of members across the owner's lists.** Sourced via a `SECURITY DEFINER` RPC because `auth.users` isn't directly queryable from the user-cookie Supabase client.
- **Current members of *this* list** come via a parallel SECURITY DEFINER RPC so we can show emails alongside `user_id`s.
- **No new `is_sharable` UI toggle.** The user said "shareable anytime"; an extra toggle reintroduces the same problem we're solving.
- **The realtime subscription becomes unconditional in code-shape.** It already is at runtime — CLAUDE.md's "private lists skip realtime" line is stale. The `isShared` prop on `ItemList` is dead and gets removed.

## Architecture

### Schema — `supabase/migrations/0012_share_anytime.sql`

```sql
-- Drop is_shared: sharing is now derived from list_members membership.
alter table public.lists drop column is_shared;

-- Members of a single list, with emails. SECURITY DEFINER so the caller can
-- read auth.users.email indirectly. Caller must have access to the list (RLS
-- on list_members already filters this, but we re-check at the function level
-- as a belt-and-braces guard against accidental misuse).
create or replace function public.get_list_members(p_list_id uuid)
returns table (user_id uuid, email text, added_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select lm.user_id, u.email::text, lm.added_at
  from public.list_members lm
  join auth.users u on u.id = lm.user_id
  where lm.list_id = p_list_id
    and public.has_list_access(p_list_id)
  order by lm.added_at asc;
$$;
grant execute on function public.get_list_members(uuid) to authenticated;

-- Distinct emails across every list this user owns. Powers the
-- "previously shared with" quick-pick chips.
create or replace function public.get_my_invitee_emails()
returns table (email text)
language sql
security definer
set search_path = public
as $$
  select distinct u.email::text
  from public.list_members lm
  join public.lists l on l.id = lm.list_id
  join auth.users u on u.id = lm.user_id
  where l.owner_id = auth.uid()
    and u.id <> auth.uid()
  order by 1;
$$;
grant execute on function public.get_my_invitee_emails() to authenticated;
```

Owner-can-delete-members RLS already exists (`supabase/migrations/0001_init.sql:152-158`). No policy change needed.

### Types — drop `is_shared`

- `src/lib/types.ts`: `List` loses `is_shared: boolean`.
- `src/lib/db/types.ts`: `LocalList` loses it too. Old IndexedDB rows that still have the field are harmless — code stops reading it.
- Every `select('id, name, owner_id, is_shared, created_at')` is rewritten to drop the field.

### Server actions — `src/app/lists/actions.ts`

- `createList(formData)` — remove the `is_shared` read and the `is_shared` column from the insert.
- `inviteMember(listId, email)` — unchanged. (RLS already requires the caller to be the owner.)
- **New** `removeMember(listId, userId)`:
  ```ts
  export async function removeMember(listId: string, userId: string) {
    const supabase = await createClient()
    const { error } = await supabase
      .from('list_members')
      .delete()
      .eq('list_id', listId)
      .eq('user_id', userId)
    if (error) return { error: error.message }
    revalidatePath(`/lists/${listId}`)
    return { error: null }
  }
  ```
  RLS guards owner-only deletes; we don't re-check in app code.

### `CreateListForm.tsx` — strip the checkbox

Drop the "Shared list (invite members)" checkbox and its state. The form becomes name-only.

### `ListsView.tsx` — derive "shared" from member count

The SSR query on `src/app/lists/page.tsx` switches to:
```ts
const { data: lists } = await supabase
  .from('lists')
  .select('id, name, owner_id, created_at, list_members(count)')
  .order('created_at', { ascending: false })
```
Then we map `list_members[0]?.count > 0` → a `hasMembers: boolean` we pass to `ListsView`. The "shared" badge renders when `hasMembers` is true (for owned lists; not-owned lists are in the "Shared with me" section already, where the badge is redundant).

Alternative if Supabase aggregate select is awkward: do two queries (lists, then `list_members` filtered to those ids) and join client-side. Same outcome.

### `src/app/lists/[id]/page.tsx` — drop the share gate

Replace this block:
```tsx
{isOwner && list.is_shared && (
  <section>
    <h2>Invite member</h2>
    <InviteForm listId={id} />
  </section>
)}
```
with a single mount of the new `ShareSection`, owner-only, loading members + invitee history server-side:
```tsx
{isOwner && (
  <ShareSection
    listId={id}
    members={await fetchListMembers(id)}
    invitees={await fetchMyInvitees()}
  />
)}
```
`fetchListMembers` and `fetchMyInvitees` are thin server helpers calling the two new RPCs. They live in `src/app/lists/[id]/actions.ts` (or a new `members.ts` if the actions file is already huge).

### `ShareSection.tsx` (new, Client Component)

Reads `useEditMode()`; renders nothing if edit mode is off — so the user enters edit mode to see/use it. When edit mode is on:

```
┌────────────────────────────────────────────────┐
│ Dela listan                                    │
│                                                │
│ Medlemmar                                      │
│  • alice@example.com         [×]               │
│  • bob@example.com           [×]               │
│  (or: "Inga medlemmar än.")                    │
│                                                │
│ [ email                       ] [Bjud in]      │
│                                                │
│ Tidigare inbjudna:                             │
│  [alice@…] [carol@…] [dan@…]   (clickable      │
│                                 chips that      │
│                                 fill the input) │
└────────────────────────────────────────────────┘
```

Behaviour:
- Members list: each row shows email + an × button (only for the owner; component is owner-only by virtue of the page-level gate).
- × → calls `removeMember(listId, userId)`; optimistic remove with rollback on `{ error }`.
- Invite form: email + button. Submits to existing `inviteMember`. On success: append to members list, clear input. Same status-message UX as the current `InviteForm`.
- Chips: filtered to emails not already in the current list's members. Click fills the input but does NOT auto-submit (one click to fill, one to confirm).

Folds in the existing `InviteForm.tsx`. Either delete `InviteForm.tsx` and inline the form into `ShareSection`, or keep it and have `ShareSection` render it — implementer's choice.

### `ItemList.tsx` cleanup

- Drop the `isShared` prop from `Props` and the call site in `page.tsx`.
- Drop `is_shared` from the `availableLists` `Pick<…>`.
- Verify the realtime subscription is unconditional (the agent report confirmed it is); no behavioural change here, just remove the dead prop.

### Client-side data (Dexie / IndexedDB)

No Dexie schema migration is required:

- The Dexie schema for `lists` is `'id, owner_id'` (`src/lib/db/local.ts:16`). `is_shared` is not indexed, so dropping the field from the `LocalList` type does **not** require a `db.version()` bump — Dexie/IndexedDB stores arbitrary object shapes per row; only indexed fields are part of the formal schema.
- Old rows in users' IndexedDB will carry a stale `is_shared` boolean for a while. Code stops reading it (TypeScript drops the field), so this is harmless. The next `reconcileLists()` overwrites each surviving row with the fresh server shape (which has no `is_shared` column), so stale data naturally disappears as users open lists.
- The `list_members` Dexie table (`local.ts:18`) exists but is unused today. This plan does **not** start writing to it — `ShareSection` fetches members server-side and renders them as props with optimistic local state. Leaving the Dexie table unused is consistent with current behaviour; offline-syncing membership changes is out of scope.

### Offline behaviour of `ShareSection`

`inviteMember` and `removeMember` both require the network. There is no outbox path for membership changes — adding one would mean handling delayed `find_user_by_email` resolution, which has its own UX problems (the user types an email offline; we can't validate it until we reconnect). Out of scope.

Instead, when `useSyncState().isOffline` is true:

- The invite "Bjud in" button is `disabled` with `title="Kräver anslutning"`.
- The × remove button on each member is `disabled` with the same tooltip.
- The "Tidigare inbjudna" chips still render (they're SSR-baked into the cached HTML) but tapping one only fills the input — it never submits, so this needs no extra gating.

Same pattern as the `+ New list` and recipe-import affordances from PR5.

### Stale CLAUDE.md text

Edit the "Optimistic UI + Realtime" and "Data Model" sections of `CLAUDE.md` to reflect:
- Realtime subscribes for every list.
- `lists` has no `is_shared` column; shared = has members.

## Critical files

New:
- `supabase/migrations/0012_share_anytime.sql`
- `src/app/lists/[id]/ShareSection.tsx`
- `tests/components/ShareSection.test.tsx`

Modified:
- `src/lib/types.ts` — drop `is_shared` from `List`.
- `src/lib/db/types.ts` — drop from `LocalList`.
- `src/app/lists/actions.ts` — remove `is_shared` from `createList`; add `removeMember`.
- `src/app/lists/CreateListForm.tsx` — remove the checkbox + state.
- `src/app/lists/page.tsx` — new SSR query that derives `hasMembers`.
- `src/app/lists/ListsView.tsx` — accept derived `hasMembers`, render badge from it.
- `src/app/lists/[id]/page.tsx` — drop `is_shared` from selects; mount `ShareSection` (owner-only); call new fetch helpers.
- `src/app/lists/[id]/actions.ts` (or new `members.ts`) — helpers wrapping the two RPCs.
- `src/app/lists/[id]/ItemList.tsx` — drop `isShared` prop + `is_shared` from `availableLists`.
- `src/app/lists/[id]/InviteForm.tsx` — folded into `ShareSection` (delete the file if no longer used).
- `CLAUDE.md` — update the realtime + data-model paragraphs.

Existing tests that reference `is_shared` (Vitest will fail-loud if any are missed) — update them.

## Tests

- `tests/lib/sync/reconcile*.test.ts` — adjust fixtures to drop `is_shared`.
- `tests/components/ShareSection.test.tsx` (new):
  - Renders nothing when edit mode is off.
  - In edit mode + owner: renders member list, invite input, chips.
  - Clicking × on a member calls `removeMember(listId, userId)` (mocked) and removes the row optimistically; on error, the row reappears.
  - Submitting invite calls `inviteMember(listId, email)`; success appends the row.
  - Clicking a chip fills the input without submitting.
  - Chips exclude emails already in the members list.
- `tests/components/CreateListForm.test.tsx` — adjust assertions that mention the checkbox; ensure the disabled-when-offline behaviour from PR5 still passes.

## Verification (manual)

1. **Create a list.** Confirm there's no "Shared list" checkbox. Open the list — there's no visible share UI yet.
2. **Toggle edit mode.** A "Dela listan" section appears with empty members and a "Tidigare inbjudna" empty state.
3. **Invite someone you've never invited before.** They appear in members; on `/lists` your owned list now shows the "shared" badge.
4. **Invite again on a different list.** The previous invitee shows up as a chip.
5. **Click the chip on a third list.** The input fills; submit invites them.
6. **Remove a member with ×.** Row disappears; that member's `/lists` no longer shows the list under "Shared with me".
7. **Last member removed → "shared" badge disappears** on `/lists`.
8. **`npm test`, `npm run lint`, `npm run build`** all clean.
