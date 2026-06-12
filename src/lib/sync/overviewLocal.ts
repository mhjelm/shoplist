import { localDB } from '@/lib/db/local'
import type { LocalListCatalog, LocalListView } from '@/lib/db/types'
import { log } from '@/lib/log'

// Max-merge put for list_views: advance last_viewed_at only, never regress it.
// A server-clock-ahead value from reconcileListsOverview must not be overwritten
// by a skewed device clock — hence "max" semantics instead of blind put.
export async function touchListViewLocal(listId: string): Promise<void> {
  const now = new Date().toISOString()
  try {
    const existing = await localDB.list_views.get(listId)
    if (!existing || existing.last_viewed_at < now) {
      await localDB.list_views.put({ list_id: listId, last_viewed_at: now })
    }
  } catch (err) {
    log.error('idb.write_failed', { table: 'list_views', op: 'touchLocal', error: String((err as Error)?.message ?? err) })
  }
}

// Non-regressive seed of list_catalog + list_views from SSR props.
// Called by ListsView's mount useLayoutEffect instead of blind bulkPut, so
// a stale cached RSC payload can't undo live Dexie state on back-nav.
//
// Warm path (Dexie has rows — the normal back-nav case):
//   - Never insert catalog rows that are missing from Dexie (prevents
//     resurrecting a list the user just deleted). New lists from another
//     device appear ~1 s later via reconcileListsOverview.
//   - For rows present in both: only forward-bump the last_add_at/last_add_by
//     pair (together — they're a semantic unit) when SSR carries a newer value.
//     Never touch name/kind/has_members — Dexie is at least as fresh.
//   - list_views: per-row max(last_viewed_at) always. This is the key
//     non-regression that replaces router.refresh().
//
// Cold path (empty Dexie — first visit or wiped IndexedDB): write all rows
// verbatim. SSR is the only source of truth here.
export async function seedListsOverview(
  catalogRows: LocalListCatalog[],
  viewRows: LocalListView[],
): Promise<void> {
  try {
    await localDB.transaction('rw', [localDB.list_catalog, localDB.list_views], async () => {
      const existingCatalog = await localDB.list_catalog.toArray()
      const isCold = existingCatalog.length === 0

      if (isCold) {
        await localDB.list_catalog.bulkPut(catalogRows)
      } else {
        const existingMap = new Map(existingCatalog.map(r => [r.id, r]))
        for (const ssr of catalogRows) {
          const local = existingMap.get(ssr.id)
          if (!local) continue // never resurrect a deleted list

          // Forward-bump the add-activity pair only; leave everything else alone.
          const ssrAddAt = ssr.last_add_at ?? ''
          const localAddAt = local.last_add_at ?? ''
          if (ssrAddAt > localAddAt) {
            await localDB.list_catalog.update(ssr.id, {
              last_add_at: ssr.last_add_at,
              last_add_by: ssr.last_add_by,
            })
          }
        }
      }

      // list_views: max-merge always (both cold and warm).
      const existingViews = await localDB.list_views.toArray()
      const viewMap = new Map(existingViews.map(v => [v.list_id, v.last_viewed_at]))
      const toWrite: LocalListView[] = []
      for (const v of viewRows) {
        const local = viewMap.get(v.list_id) ?? ''
        if (v.last_viewed_at > local) toWrite.push(v)
      }
      if (toWrite.length > 0) await localDB.list_views.bulkPut(toWrite)
    })
  } catch (err) {
    log.error('idb.write_failed', { table: 'list_catalog', op: 'seedOverview', error: String((err as Error)?.message ?? err) })
  }
}
