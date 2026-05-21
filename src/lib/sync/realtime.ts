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
// Handles item events optimistically (bump last_activity in Dexie).
// Calls onReconcile() for structural changes (new/deleted lists, member changes)
// and on reconnect to heal any missed events.
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
          } else {
            // INSERT or UPDATE: reconcile to get fresh has_members + activity
            onReconcile()
          }
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
          const row = (payload.eventType !== 'DELETE' ? payload.new : payload.old) as { list_id?: string; updated_at?: string }
          if (!row?.list_id) return
          const lastActivity = row.updated_at ?? new Date().toISOString()
          // Only bump if the catalog row exists; reconcile will fix it if not.
          await localDB.list_catalog
            .where('id').equals(row.list_id)
            .modify((c: LocalListCatalog) => { c.last_activity = lastActivity })
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
