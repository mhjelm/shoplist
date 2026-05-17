import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import { reconcileList } from '@/lib/sync/reconcile'
import { subscribeToList } from '@/lib/sync/realtime'
import { setActiveList } from '@/lib/sync/engine'
import type { Item, List } from '@/lib/types'
import { itemToLocalItem, localItemToItem } from './itemHelpers'

export function useListItemsSync(
  list: List,
  listId: string,
  initialItems: Item[],
): { items: Item[] } {
  // Register this list as the active one so SyncProvider connectivity
  // triggers (online/visibilitychange) know which list to reconcile.
  useEffect(() => {
    setActiveList(listId)
    return () => { setActiveList(null) }
  }, [listId])

  // Seed Dexie from SSR data on first visit, then reconcile from the server.
  // The seed is skipped if Dexie already has rows (idempotent); reconcile heals
  // stale Dexie state after a refresh.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await localDB.lists.put(list)
      if (initialItems.length > 0) {
        const existing = await localDB.items.where('list_id').equals(listId).count()
        if (!cancelled && existing === 0) {
          await localDB.items.bulkPut(initialItems.map(itemToLocalItem))
        }
      }
      if (cancelled) return
      reconcileList(listId).catch(err => console.error('reconcile failed:', err))
    })()
    return () => { cancelled = true }
  }, [list, listId, initialItems])

  // Subscribe to Realtime; on reconnect, reconcile to catch missed events.
  useEffect(() => {
    return subscribeToList(listId, () => { reconcileList(listId) })
  }, [listId])

  // Live reactive read from Dexie. Falls back to SSR data while IndexedDB hydrates.
  const liveItems = useLiveQuery(
    () => localDB.items.where('list_id').equals(listId).toArray(),
    [listId],
  )
  const items: Item[] = useMemo(
    () => liveItems ? liveItems.map(localItemToItem) : initialItems,
    [liveItems, initialItems],
  )

  return { items }
}
