import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem, LocalList, LocalListCatalog, LocalListView, OutboxEntry } from '@/lib/db/types'
import { addConflicts } from './engine'

export async function reconcileList(listId: string): Promise<void> {
  const supabase = createClient()

  // Cheap precheck: list_activity tracks the most recent item write per list.
  // If the server's last_activity isn't newer than our local sync watermark,
  // Dexie is already up-to-date and we can skip the full items refetch.
  //
  // Correctness depends on last_activity being MONOTONIC — bumped to now() on
  // every items INSERT/UPDATE/DELETE by the bump_list_activity_on_items
  // trigger (migration 0017). The earlier view-based definition
  // (max(updated_at) from items) regressed under deletes and silently kept
  // other users' Dexie stuck on rows that had been cleared on the server.
  //
  // Caveat: list-row edits (e.g. renames) don't bump last_activity, and the
  // per-list Realtime channel doesn't watch the `lists` table either — so a
  // rename only surfaces on the next navigation, when page.tsx re-fetches
  // the list row. Acceptable because renames are rare.
  const { data: activity } = await supabase
    .from('list_activity')
    .select('last_activity')
    .eq('list_id', listId)
    .maybeSingle()
  const localMeta = await localDB.sync_meta.get(listId)
  if (
    activity?.last_activity &&
    localMeta?.last_sync_at &&
    activity.last_activity <= localMeta.last_sync_at
  ) {
    return
  }

  const { data: rows, error } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
  if (error || !rows) return

  // Pending outbox entries protect local optimistic state from being overwritten.
  // 'failed' counts too — those are queued retries (e.g. while offline) and
  // their local Dexie state must survive until the retry actually drains.
  const outboxEntries: OutboxEntry[] = await localDB.outbox
    .where('list_id').equals(listId)
    .filter(e => e.status === 'pending' || e.status === 'in_flight' || e.status === 'failed')
    .toArray()

  const pendingByItemId = new Map<string, OutboxEntry>()
  for (const entry of outboxEntries) {
    const p = entry.payload as Record<string, unknown>
    if (p.id) pendingByItemId.set(p.id as string, entry)
    if (p.source_id) pendingByItemId.set(p.source_id as string, entry)
  }

  const conflicts: Array<{ id: string; name: string }> = []

  await localDB.transaction('rw', [localDB.items, localDB.sync_meta, localDB.outbox], async () => {
    const localItems = await localDB.items.where('list_id').equals(listId).toArray()
    const serverIds = new Set(rows.map(r => r.id as string))

    // Remove items the server deleted, unless we have a pending local change for them.
    for (const local of localItems) {
      if (!serverIds.has(local.id) && !pendingByItemId.has(local.id)) {
        await localDB.items.delete(local.id)
      }
    }

    for (const row of rows) {
      const pending = pendingByItemId.get(row.id as string)

      if (!pending) {
        await localDB.items.put(row as LocalItem)
      } else if (pending.type === 'item.delete') {
        // Our delete is pending — keep item gone locally.
        await localDB.items.delete(row.id as string)
      } else if (
        pending.status !== 'in_flight' &&
        row.updated_at &&
        row.updated_at > new Date(pending.created_at).toISOString()
      ) {
        // Server modified this item after we queued our edit → server wins.
        // Skip this for in_flight entries: those are being pushed RIGHT NOW, so
        // a server row newer than our queued-at time is almost certainly our own
        // write echoing back (the server's updated_at is set server-side the
        // moment our push lands, but the outbox entry isn't deleted until the
        // push fully returns). Treating that as a server conflict produced the
        // bogus "uppdaterades på servern medan du var offline" banner — and
        // worse, deleted the entry mid-push. Keep local + leave the entry; the
        // flush will clear it.
        await localDB.items.put(row as LocalItem)
        await localDB.outbox.delete(pending.seq!)
        conflicts.push({ id: row.id as string, name: row.name as string })
      }
      // Else: our edit is newer (or in-flight) — keep Dexie state, outbox syncs it.
    }

    // Store the SERVER's last_activity as the watermark — never the client
    // wall clock. The precheck above compares this against the server's
    // last_activity (server clock), so a client-stamped value breaks the moment
    // the device clock drifts ahead of the server (common on phones): the
    // watermark looks "in the future", every real change is skipped, and e.g.
    // items moved into a shared list never appear for the receiving user. Using
    // the same server timestamp keeps the comparison clock-consistent and
    // monotonic. Fall back to client time only when the list has no activity
    // row yet (a brand-new, never-written list) — harmless, since an empty list
    // has nothing to skip.
    await localDB.sync_meta.put({
      list_id: listId,
      last_sync_at: activity?.last_activity ?? new Date().toISOString(),
    })
  })

  if (conflicts.length > 0) addConflicts(conflicts)
}

// Mirrors reconcileList but for the lists table. Drives the offline "which
// lists are cached?" affordance on /lists — a list counts as cached if Dexie
// has its row OR any of its items. Dexie's `lists` table is only ever
// populated by ItemList mount (i.e. the user actually opened that list); we
// must not insert here, otherwise every server-visible list would look
// "cached" and the offline gating would be a no-op. We only refresh rows that
// already exist and prune ones the server has dropped.
export async function reconcileLists(): Promise<void> {
  let rows: Array<Record<string, unknown>> | null
  try {
    const supabase = createClient()
    const result = await supabase.from('lists').select('*')
    if (result.error || !result.data) return
    rows = result.data
  } catch {
    // Network errors here are expected (e.g. just-went-offline). Stay quiet
    // and leave Dexie untouched — the next reconcile will refresh it.
    return
  }

  await localDB.transaction('rw', [localDB.lists, localDB.items], async () => {
    const serverById = new Map<string, Record<string, unknown>>()
    for (const row of rows!) serverById.set(row.id as string, row)

    const localLists = await localDB.lists.toArray()
    const localIds = new Set(localLists.map(l => l.id))

    // Drop lists the server no longer reports, plus any orphan items they had.
    for (const local of localLists) {
      if (!serverById.has(local.id)) {
        await localDB.lists.delete(local.id)
        const orphanIds = (await localDB.items.where('list_id').equals(local.id).toArray()).map(i => i.id)
        if (orphanIds.length > 0) await localDB.items.bulkDelete(orphanIds)
      }
    }

    // Refresh existing rows with server values, but do NOT insert new ones —
    // see the comment above. Discovering a list locally is the user's job
    // (open it once online → ItemList mount writes the row).
    for (const row of rows!) {
      if (localIds.has(row.id as string)) {
        await localDB.lists.put(row as unknown as LocalList)
      }
    }
  })
}

// Mirrors the /lists page SSR queries into Dexie's list_catalog + list_views
// tables so ListsView can render instantly from IndexedDB on back-nav.
// Safe to call repeatedly; all writes are idempotent bulkPut / delete.
export async function reconcileListsOverview(): Promise<void> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [listsResult, activityResult, viewsResult] = await Promise.all([
      supabase.from('lists').select('id, name, owner_id, created_at, list_members(count)'),
      supabase.from('list_activity').select('list_id, last_activity, last_activity_by'),
      supabase.from('list_views').select('list_id, last_viewed_at').eq('user_id', user.id),
    ])

    if (listsResult.error || !listsResult.data) return

    const activityMap = new Map<string, { last_activity: string; last_activity_by: string | null }>()
    for (const r of activityResult.data ?? []) {
      activityMap.set(r.list_id as string, {
        last_activity: r.last_activity as string,
        last_activity_by: (r.last_activity_by as string | null) ?? null,
      })
    }
    const viewsMap = new Map<string, string>(
      (viewsResult.data ?? []).map(r => [r.list_id as string, r.last_viewed_at as string]),
    )

    const catalogRows: LocalListCatalog[] = listsResult.data.map(row => {
      const { list_members, ...rest } = row as typeof row & { list_members: Array<{ count: number }> }
      const act = activityMap.get(rest.id)
      return {
        id: rest.id,
        name: rest.name,
        owner_id: rest.owner_id,
        created_at: rest.created_at,
        has_members: (list_members?.[0]?.count ?? 0) > 0,
        last_activity: act?.last_activity ?? null,
        last_activity_by: act?.last_activity_by ?? null,
      }
    })

    const viewRows: LocalListView[] = Array.from(viewsMap.entries()).map(([list_id, last_viewed_at]) => ({
      list_id,
      last_viewed_at,
    }))

    const serverIds = new Set(catalogRows.map(r => r.id))

    await localDB.transaction('rw', [localDB.list_catalog, localDB.list_views], async () => {
      const existing = await localDB.list_catalog.toArray()
      for (const row of existing) {
        if (!serverIds.has(row.id)) {
          await localDB.list_catalog.delete(row.id)
          await localDB.list_views.delete(row.id)
        }
      }
      await localDB.list_catalog.bulkPut(catalogRows)
      if (viewRows.length > 0) await localDB.list_views.bulkPut(viewRows)
    })
  } catch {
    // Network errors expected when offline; leave Dexie untouched.
  }
}
