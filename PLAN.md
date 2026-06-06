# Task lists alongside shopping lists

_Started 2026-06-07._

## Context

Today every list in Shoplist is a grocery shopping list. We're adding **task/chore lists** ("mow the lawn", "call the plumber") for families to share, reusing the existing sharing + realtime + offline infrastructure. Scope is deliberately held to a shared checklist with an optional **assignee** and **due date** (visual + sort only — no reminders/notifications). This is not a Todoist competitor.

UI directions (explored in `docs/task-lists-ui-exploration.html` + `docs/task-list-detail-exploration.html`):
- **`/lists` overview → Mixed · A:** one recency-sorted stream; each row carries a 🛒/✓ icon + `SHOP`/`TASK` pill.
- **Task detail → variant B:** explicit-checkbox checklist; each task can carry an assignee avatar + due-date pill (amber soon / red overdue / grey future), sorted by due, with a struck-through "Done" section; edited via a dedicated **TaskEditModal**.

`kind` column on `lists` (`'shopping' | 'task'`, default `'shopping'`). Tasks reuse `items` (`name` + `is_checked` = done) + new nullable `assignee_id`, `due_date`.

## Key reuse / gotchas

- `muAddItem` / `muUpdateItem(listId, itemId, patch)` / `muDeleteItem` already take arbitrary item fields → assignee/due flow through `item.update` with **no engine changes**.
- **GOTCHA:** `updateItem` runs patches through `buildItemUpdatePayload` / `ItemUpdatePatch` (`src/lib/itemUpdate.ts`), which **drops unlisted fields**. `assignee_id`/`due_date` MUST be added there or the server write silently no-ops.
- Reads flow free: `reconcileList` does `.select('*')` + raw `put`; realtime channel watches `items` with `replica identity full`.
- `itemToLocalItem` / `localItemToItem` / `buildLocalItem` (`itemHelpers.ts`) enumerate fields by hand — add the two there.
- `reconcileListsOverview` + `/lists` `page.tsx` use explicit `lists` SELECTs — add `kind`.
- `get_list_members` excludes the owner → new `get_list_people` RPC (owner ∪ members, emails) for the assignee picker.

## Approach

Branch by `kind` at the page level, rendering a separate, simpler `TaskList` tree for tasks rather than threading `kind` through `ItemList`'s grocery hooks. Shared sync/reconcile/realtime/outbox/Dexie reused as-is.

### 1. Migration `0025_task_lists.sql`
- `lists.kind text not null default 'shopping'` + `check (kind in ('shopping','task'))`.
- `items.assignee_id uuid null references auth.users(id) on delete set null`; `items.due_date date null`.
- `get_list_people(p_list_id uuid) returns table(user_id uuid, email text)` — owner ∪ members, `security definer`, grant to `authenticated` (model on `get_list_members`, migration 0012).

### 2. Types & Dexie
- `types.ts`: `List += kind: ListKind` (`type ListKind = 'shopping' | 'task'`); `Item += assignee_id, due_date`.
- `db/types.ts`: `LocalListCatalog += kind`; `LocalItem += assignee_id, due_date`.
- `db/local.ts`: `this.version(6).stores({})` (non-indexed fields).
- `itemHelpers.ts`: add fields to both adapters + `buildLocalItem` opts (default null).

### 3. Write path
- `itemUpdate.ts`: add `assignee_id?: string | null`, `due_date?: string | null` to `ItemUpdatePatch`; handle via `'field' in patch` so explicit null clears. Extend `itemUpdate.test.ts`.

### 4. `/lists` overview + create (Mixed · A)
- `CreateListForm.tsx`: 🛒/✓ segmented kind toggle (hidden `kind`, default shopping); `createList` action inserts `kind`.
- `page.tsx` + `reconcileListsOverview`: add `kind` to SELECT + catalog seed/map.
- `ListsView.tsx` `ListRow`: leading kind icon + `SHOP`/`TASK` pill. No regrouping.

### 5. Task detail (variant B)
- `page.tsx`: branch on `list.kind`. Task → simplified header (BackLink + name + OfflineBadge + LeaveListButton; no EditModeToggle/StoreMode) + `<TaskList people={…} … />` (people via `get_list_people`). Filter copy/move `otherLists` to `kind === 'shopping'`.
- New `TaskList.tsx` (reuses `useListItemsSync`, minimal plain add → `buildLocalItem` + `muAddItem`, due-sorted to-do + struck-through Done), `TaskRow.tsx` (checkbox toggles `is_checked`, due pill, assignee avatar, pencil → modal), `TaskEditModal.tsx` (name + assignee select + date input + delete/save → `muUpdateItem`/`muDeleteItem`).
- New `src/lib/taskView.ts`: `dueStatus(due_date, now)` + `sortTasks(items)` (due asc, nulls last, then created_at). Unit-tested.

### 6. Docs
- CLAUDE.md: migration 0025 → Pending manual tasks; next number → 0026; architecture note (kind branch, TaskList vs ItemList, itemUpdate whitelist rule).
- Update `PRD.md` (task lists were a non-goal).

## Verification
1. `npm test` — new unit tests (`itemUpdate`, `taskView`) + component tests (`TaskRow`, `TaskEditModal`, `TaskList` smoke).
2. `npm run lint` + **`npm run build`** (build catches `'use server'` violations).
3. Apply migration `0025`.
4. Manual (two profiles / shared list): create ✓ vs 🛒 list → pills on `/lists`; add tasks, assign, set due → pill colors; check → Done section; share + assign to member → realtime + avatar resolves; offline add/check/assign → outbox drains; copy/move picker excludes task lists.

## Progress
- [x] Setup: archive prior plan, write PLAN.md, CLAUDE.md active-plan entry (2026-06-07)
- [x] 1. Migration 0025 (`lists.kind`, `items.assignee_id`/`due_date`, `get_list_people` RPC)
- [x] 2. Types & Dexie (ListKind, new item/catalog fields, v6, itemHelpers adapters)
- [x] 3. itemUpdate whitelist + tests
- [x] 4. /lists overview + create (KindIcon/KindPill, kind toggle, reconcile/SSR `kind`)
- [x] 5. Task detail view (TaskList/TaskRow/TaskEditModal/TaskAvatar) + taskView helper, page.tsx kind branch
- [x] 6. Docs (CLAUDE.md architecture note + data model, PRD.md)
- [x] Tests (504 pass, +20 new) + lint clean + `npm run build` clean
- [x] Migration `0025` applied to Supabase
- [x] Post-impl fix: task adds skip Gemini categorize (`skip_categorize` flag, `engine.ts` gate)
- [x] Post-impl fix: migration `0026` guards `bump_item_history` so task names stay out of grocery autocomplete
- [ ] **Apply migration `0026` to Supabase** (manual)
- [ ] Report ready (no auto-commit) — awaiting user approval to commit/push
