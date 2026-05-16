import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem, LocalList, OutboxEntry } from '@/lib/db/types'
import { addConflicts } from './engine'

export async function reconcileList(listId: string): Promise<void> {
  const supabase = createClient()
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
      } else if (row.updated_at && row.updated_at > new Date(pending.created_at).toISOString()) {
        // Server modified this item after we queued our edit → server wins.
        await localDB.items.put(row as LocalItem)
        await localDB.outbox.delete(pending.seq!)
        conflicts.push({ id: row.id as string, name: row.name as string })
      }
      // Else: our edit is newer — keep Dexie state, outbox will sync it.
    }

    await localDB.sync_meta.put({ list_id: listId, last_sync_at: new Date().toISOString() })
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
