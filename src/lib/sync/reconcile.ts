import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem, OutboxEntry } from '@/lib/db/types'
import { addConflicts } from './engine'

export async function reconcileList(listId: string): Promise<void> {
  const supabase = createClient()
  const { data: rows, error } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
  if (error || !rows) return

  // Pending outbox entries protect local optimistic state from being overwritten.
  const outboxEntries: OutboxEntry[] = await localDB.outbox
    .where('list_id').equals(listId)
    .filter(e => e.status === 'pending' || e.status === 'in_flight')
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
