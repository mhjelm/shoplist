# Plan — Android share-to-Shoplist via Web Share Target API

## Context

The recipe / list import that just shipped (`PR db52fe0`) handles clipboard text, URLs, manually-picked images, and clipboard images. On Android, users typically encounter content (a recipe URL in Chrome, a photo of a list in Gallery) and use the system **Share** sheet. Today Shoplist isn't a target there — so the user has to copy to clipboard first, switch to the PWA, paste. We want a one-tap "Share → Shoplist" flow.

The mechanism is the **Web Share Target API**: an installed PWA can declare in its manifest that it accepts shared payloads, and Android adds it to the share sheet. The shared payload is delivered as either a GET (query string) or POST (multipart form data) to a URL inside the app. iOS Safari does not support Web Share Target — that's a known platform gap; iOS users keep the clipboard auto-extract path.

Decisions confirmed with user:
- **List picker always shown** after extraction. No auto-pick even with a single list, no last-used memory.
- **Unauthed share → redirect to login**. Payload is dropped; the user re-shares after logging in. No server-side stash.

## Approach

### 1. Manifest declares share target

`src/app/manifest.ts` — add a `share_target` entry. Single entry covers both text/URL shares and image shares because POST + multipart allows both `params` and `files`:

```ts
share_target: {
  action: '/share',
  method: 'POST',
  enctype: 'multipart/form-data',
  params: {
    title: 'title',
    text: 'text',
    url: 'url',
    files: [{ name: 'image', accept: ['image/*'] }],
  },
}
```

Note: `MetadataRoute.Manifest` in Next.js may not type `share_target` natively. Cast with `as MetadataRoute.Manifest` or add `// @ts-expect-error` on the property — verify when implementing. Browser still reads the JSON.

### 2. DB migration — `pending_imports` table

`supabase/migrations/0010_pending_imports.sql` (new file):

```sql
create table pending_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null,
  source text not null check (source in ('image', 'url', 'text')),
  created_at timestamptz not null default now()
);

create index pending_imports_user_idx on pending_imports(user_id, created_at desc);

alter table pending_imports enable row level security;

create policy "users select own pending imports" on pending_imports
  for select to authenticated using (user_id = auth.uid());

create policy "users insert own pending imports" on pending_imports
  for insert to authenticated with check (user_id = auth.uid());

create policy "users delete own pending imports" on pending_imports
  for delete to authenticated using (user_id = auth.uid());
```

A periodic cleanup job is out of scope — rows are small JSON and get deleted on confirm; orphan rows are a tolerable rounding error for now.

### 3. POST handler — `src/app/share/route.ts`

A Next.js route handler (not a page) that receives the POST from the share sheet:

1. Create the server Supabase client (`@/lib/supabase/server`). Call `getUser()`.
2. If unauthed → `NextResponse.redirect(new URL('/auth/login', req.url))`. (Middleware in `src/proxy.ts` would do this too, but doing it inline lets us return 303 explicitly.)
3. Read FormData: `text`, `url`, `title`, `image`.
4. Branch:
   - `image instanceof File && image.size > 0` → build a FormData and call `extractListItemsFromImage` from `src/app/lists/[id]/actions.ts`. `source = 'image'`.
   - Otherwise prefer `url`, then `text`, then `title`. Call `extractRecipeItems(payload)`. `source = url ? 'url' : 'text'`.
5. If extraction errors or yields zero items → redirect to `/lists?shareError=empty` (or similar). The lists page can read the query param and render a toast/banner.
6. Insert the items into `pending_imports` (RLS-authenticated client; user_id will be set explicitly to `user.id` to satisfy the policy).
7. `return NextResponse.redirect(new URL(/share/${id}, req.url), 303)`. 303 forces the browser to GET the new URL.

The extraction call happens server-to-server: `extractRecipeItems` and `extractListItemsFromImage` are server actions, but they're plain async functions when invoked from another server context. They already return `{ items, error }`.

### 4. List-picker + accept/reject page — `src/app/share/[importId]/page.tsx`

Server Component:

1. Auth check (defensive; middleware enforces it). Redirect to `/auth/login` if no user.
2. Load the pending import row by id. RLS guarantees it belongs to the user; `notFound()` if missing.
3. Load the user's lists (same query as `src/app/lists/page.tsx`).
4. Render `<ShareImportClient importId items lists />`.

### 5. Client component — `src/app/share/[importId]/ShareImportClient.tsx`

Reuses the same accept/reject UI patterns from `RecipeImportModal.tsx` — checkbox list, strikethrough on deselect, count in header — but inline on a full page (not a modal), with an additional list-selector on top:

- Two stacked sections inside a centered card:
  - **List picker**: vertical list of the user's lists; one click selects (radio behaviour, stored in local state).
  - **Items to import**: same checkbox-row UI as `RecipeImportModal` lines 127–149, all selected by default.
- Bottom action row:
  - "Avbryt" → `confirmShareImport(importId, null, [])` server action (deletes the pending row, redirects to `/lists`). Or simpler: a separate `cancelShareImport(importId)` action.
  - "Lägg till" disabled until a list is picked and ≥1 item selected. Calls `confirmShareImport(importId, selectedListId, selectedItems)`.

### 6. Server actions — `src/app/share/actions.ts`

```ts
'use server'
export async function confirmShareImport(
  importId: string,
  listId: string,
  items: Array<{ name: string; category: string | null; measurement: string | null }>,
)
```

Implementation:
1. `createClient()`, `getUser()`.
2. Call `addItems(listId, items)` (imported from `@/app/lists/[id]/actions`). RLS on `items.list_id` enforces that user has access; no extra check needed.
3. On success, delete the `pending_imports` row by id (RLS scopes it to user).
4. `redirect('/lists/${listId}')`.

Separate `cancelShareImport(importId)` that just deletes the row and redirects to `/lists`.

### 7. Middleware proxy

`src/proxy.ts` matcher already covers `/share`. `updateSession` redirects unauthed users to `/auth/login` automatically — the share handler's own auth check is belt-and-braces. Nothing to change.

### 8. Tests

Per project convention (`CLAUDE.md` — Testing section), server actions and route handlers aren't unit-tested (they need a real Supabase connection). Component-level coverage:

- `tests/components/ShareImportClient.test.tsx` (new) — mock `@/app/share/actions` wholesale (same pattern as the existing `RecipeImportModal.test.tsx` at lines 5–13). Cover:
  - List picker renders all lists.
  - Confirm disabled until a list is picked.
  - Toggling items updates the selected count.
  - Clicking confirm calls `confirmShareImport` with the chosen list id and selected items.
  - "Avbryt" calls `cancelShareImport` with just the import id.

Manual / end-to-end verification is the primary signal here (see Verification).

## Critical files

- `src/app/manifest.ts` — add `share_target`.
- `supabase/migrations/0010_pending_imports.sql` — new migration.
- `src/app/share/route.ts` — new POST handler.
- `src/app/share/[importId]/page.tsx` — new Server Component (list picker + items).
- `src/app/share/[importId]/ShareImportClient.tsx` — new Client Component.
- `src/app/share/actions.ts` — `confirmShareImport`, `cancelShareImport`.
- `tests/components/ShareImportClient.test.tsx` — new component tests.
- `CLAUDE.md` — document the share flow under "Architecture", mention `share_target` declaration in the manifest.

## Existing utilities reused

- `extractListItemsFromImage` (`src/app/lists/[id]/actions.ts`) — handles the image branch unchanged.
- `extractRecipeItems` (same file) — handles the URL/text branch unchanged.
- `addItems` (same file) — the universal sink. Same dedupe / append / revive / insert behaviour.
- `createClient` (`@/lib/supabase/server`) — Supabase server client.
- `updateSession` (`@/lib/supabase/middleware`) — auth redirect for unauthed POSTs is already enforced; no change.
- `RecipeImportModal.tsx` lines 127–149 — visual reference for the checkbox-row item list to mirror in `ShareImportClient`.

## Verification

1. `npm run lint`, `npm test`, `npm run build` — all clean (new tests added).
2. **Apply the migration**: run `0010_pending_imports.sql` against the Supabase project. Verify the table exists and RLS policies are listed in the dashboard.
3. **Local PWA install** (Android with Chrome):
   - Open the deployed app in Chrome.
   - Install (Add to Home screen).
   - Open Chrome on a recipe page (e.g. koket.se) → Share → confirm Shoplist appears in the sheet.
   - Tap Shoplist → app opens at `/share/[id]` → pick a list → confirm → items land in the list.
   - Repeat with Gallery → Share image of a list → Shoplist appears → flow completes.
   - Repeat unauthed: log out in the PWA, share again → should land on `/auth/login` (payload dropped).
4. **Edge cases**:
   - Share something with no extractable items (e.g. an empty page) → land on `/lists?shareError=empty` (or whatever error UX we land on).
   - Cancel from the share UI → returns to `/lists`, no items added, pending row deleted.

## Out of scope

- iOS support (platform limitation — no Web Share Target API in Safari).
- Resuming a share after login (payload is dropped on unauthed POST).
- Cleanup job for orphan `pending_imports` rows.
- Creating a new list from the share UI (only existing lists are listed).
- Memorising last-used destination list.

## Follow-up after approval

- Mirror plan to `PLAN.md` at project root.
- Update the project `CLAUDE.md` "Active plan" entry with today's date and the new plan name.
