import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import { reconcileList } from '@/lib/sync/reconcile'
import { subscribeToList } from '@/lib/sync/realtime'
import { setActiveList } from '@/lib/sync/engine'
import type { Item, List } from '@/lib/types'
import { localItemToItem } from './itemHelpers'

export function useListItemsSync(
  list: List,
  listId: string,
): { items: Item[]; hasLoaded: boolean } {
  // Register this list as the active one so SyncProvider connectivity
  // triggers (online/visibilitychange) know which list to reconcile.
  useEffect(() => {
    setActiveList(listId)
    return () => { setActiveList(null) }
  }, [listId])

  // Mirror the list row into Dexie so loading.tsx-less navigation can still
  // paint the header from cache on the next visit.
  useEffect(() => {
    localDB.lists.put(list).catch(() => {})
  }, [list])

  // Background reconcile on mount — keeps Dexie fresh. Items come from the
  // live query below; we no longer accept SSR items, so this is the only
  // path that pulls server state into the cache.
  useEffect(() => {
    reconcileList(listId).catch(err => console.error('reconcile failed:', err))
  }, [listId])

  // Subscribe to Realtime; on reconnect, reconcile to catch missed events.
  useEffect(() => {
    return subscribeToList(listId, () => { reconcileList(listId) })
  }, [listId])

  const liveItems = useLiveQuery(
    () => localDB.items.where('list_id').equals(listId).toArray(),
    [listId],
  )
  const items: Item[] = useMemo(
    () => liveItems ? liveItems.map(localItemToItem) : [],
    [liveItems],
  )

  return { items, hasLoaded: liveItems !== undefined }
}
