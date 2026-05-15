import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem } from '@/lib/db/types'

export async function reconcileList(listId: string): Promise<void> {
  const supabase = createClient()
  const { data: rows, error } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
  if (error || !rows) return

  await localDB.transaction('rw', [localDB.items, localDB.sync_meta], async () => {
    await localDB.items.where('list_id').equals(listId).delete()
    if (rows.length > 0) {
      await localDB.items.bulkPut(rows as LocalItem[])
    }
    await localDB.sync_meta.put({ list_id: listId, last_sync_at: new Date().toISOString() })
  })
}
