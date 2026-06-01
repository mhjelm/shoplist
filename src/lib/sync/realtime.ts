import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem, LocalListCatalog } from '@/lib/db/types'

export function subscribeToList(
  listId: string,
  onReconnect: () => void,
): () => void {
  const supabase = createClient()
  let channel: ReturnType<typeof supabase.channel> | null = null
  let cancelled = false
  let everSubscribed = false

  ;(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (cancelled) return
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }

    channel = supabase
      .channel(`list-${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
        async (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            await localDB.items.put(payload.new as LocalItem)
          } else if (payload.eventType === 'DELETE') {
            await localDB.items.delete((payload.old as { id: string }).id)
          }
        },
      )
      .subscribe((status, err) => {
        if (err) console.error('[realtime] subscribe error', err)
        if (status === 'SUBSCRIBED') {
          if (everSubscribed) {
            onReconnect()
          } else {
            everSubscribed = true
          }
        }
      })
  })()

  return () => {
    cancelled = true
    if (channel) supabase.removeChannel(channel)
  }
}

// Subscribes to lists/list_members/items for the /lists overview page.
// Handles item INSERTs optimistically (bump last_add_* in Dexie for the NEW
// marker). Calls onReconcile() for structural changes (new/deleted lists,
// member changes) and on reconnect to heal any missed events.
export function subscribeToListsOverview(
  userId: string,
  onReconcile: () => void,
): () => void {
  const supabase = createClient()
  let channel: ReturnType<typeof supabase.channel> | null = null
  let cancelled = false

  ;(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (cancelled) return
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }

    channel = supabase
      .channel(`lists-overview-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lists' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            await localDB.list_catalog.delete(id)
            await localDB.list_views.delete(id)
            return
          }
          if (payload.eventType === 'UPDATE') {
            // last_activity* / last_add_* updates are produced by the items
            // triggers (migrations 0017, 0019, 0024). When the lists row exposes
            // its full old image (replica identity full) we can resolve these
            // optimistically and skip a reconcile; otherwise oldRow holds only
            // the PK, every key looks "changed", and we fall through to reconcile
            // (which refetches last_add_* anyway — still correct, just heavier).
            const newRow = payload.new as Record<string, unknown>
            const oldRow = payload.old as Record<string, unknown>
            const changedKeys = Object.keys(newRow).filter(
              k => newRow[k] !== oldRow[k],
            )
            const activityOnlyChange = changedKeys.length > 0 && changedKeys.every(
              k => k === 'last_activity' || k === 'last_activity_by'
                || k === 'last_add_at' || k === 'last_add_by',
            )
            if (activityOnlyChange) {
              // Only an add (last_add_*) moves the NEW marker; reflect it straight
              // from the payload so Dexie converges within one realtime round-trip.
              // A pure last_activity bump (delete/edit) needs no catalog change.
              if (changedKeys.includes('last_add_at') || changedKeys.includes('last_add_by')) {
                const listId = newRow.id as string
                const lastAddAt = (newRow.last_add_at as string | null) ?? null
                const lastAddBy = (newRow.last_add_by as string | null) ?? null
                await localDB.list_catalog
                  .where('id').equals(listId)
                  .modify((c: LocalListCatalog) => { c.last_add_at = lastAddAt; c.last_add_by = lastAddBy })
                  .catch(() => { /* row not in catalog yet */ })
              }
              return
            }
          }
          // INSERT or structural UPDATE: reconcile for fresh has_members + add signal
          onReconcile()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_members' },
        () => {
          // has_members may have changed; reconcile to recompute
          onReconcile()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        async (payload) => {
          // Only INSERTs move the NEW marker. Deletes/updates are deliberately
          // ignored here (they bump last_activity for sync, not last_add).
          if (payload.eventType !== 'INSERT') return
          const row = payload.new as { list_id?: string; created_at?: string; added_by?: string }
          if (!row?.list_id) return
          const lastAddAt = row.created_at ?? new Date().toISOString()
          const lastAddBy = row.added_by ?? null
          // Only bump if the catalog row exists; reconcile will fix it if not.
          await localDB.list_catalog
            .where('id').equals(row.list_id)
            .modify((c: LocalListCatalog) => { c.last_add_at = lastAddAt; c.last_add_by = lastAddBy })
            .catch(() => { /* row not in catalog yet */ })
        },
      )
      .subscribe((status, err) => {
        if (err) console.error('[realtime] lists-overview subscribe error', err)
        if (status === 'SUBSCRIBED') {
          onReconcile()
        }
      })
  })()

  return () => {
    cancelled = true
    if (channel) supabase.removeChannel(channel)
  }
}
