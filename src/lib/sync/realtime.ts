import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem, LocalListCatalog } from '@/lib/db/types'
import { log } from '@/lib/log'

// Re-assert a FRESH access token on the realtime socket. getSession() refreshes
// an expired token (GoTrue), and setAuth() rewrites EVERY channel's rejoin
// payload — so the next auto-rejoin uses current credentials instead of the
// stale token captured at subscribe time. Called both at subscribe time and on
// CHANNEL_ERROR: after a device sleeps past the ~1h JWT lifetime, the socket
// reconnects (on network `online`) and rejoins with the expired token before
// GoTrue's visibility-gated refresh fires, producing a transient
// `realtime.subscribe_error`. Refreshing here closes that window. Never throws
// (offline → the channel keeps retrying on its own backoff).
export async function applyRealtimeAuth(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) supabase.realtime.setAuth(session.access_token)
  } catch {
    // transient (offline / refresh failure) — recovery happens on a later rejoin
  }
}

// Push every fresh access token to the realtime socket as soon as the auth
// client mints one. The per-channel CHANNEL_ERROR → applyRealtimeAuth path is
// only *reactive*: after a long suspend the socket rejoins with the expired
// token, errors, and `getSession()` may still return the stale token before the
// background refresh completes — so the channel can stay errored (dead page)
// until a manual reload re-runs the middleware cookie refresh. Listening for
// TOKEN_REFRESHED/SIGNED_IN closes that gap: when GoTrue's visibility-gated
// refresh finishes, setAuth re-arms the socket and errored channels rejoin (on
// their backoff) with valid credentials — no reload needed. Mounted once,
// app-wide, from SyncProvider. Returns an unsubscribe.
export function keepRealtimeAuthFresh(): () => void {
  const supabase = createClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (
      session?.access_token &&
      (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
    ) {
      supabase.realtime.setAuth(session.access_token)
    }
  })
  return () => subscription.unsubscribe()
}

export function subscribeToList(
  listId: string,
  onReconnect: () => void,
): () => void {
  const supabase = createClient()
  let channel: ReturnType<typeof supabase.channel> | null = null
  let cancelled = false
  let everSubscribed = false

  ;(async () => {
    await applyRealtimeAuth(supabase)
    if (cancelled) return

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
        if (err) {
          log.warn('realtime.subscribe_error', { scope: 'list', status, error: String(err?.message ?? err) })
          // Likely a stale/expired token after reconnect — refresh it so the
          // channel's next auto-rejoin uses fresh credentials.
          void applyRealtimeAuth(supabase)
        }
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
    await applyRealtimeAuth(supabase)
    if (cancelled) return

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
        if (err) {
          log.warn('realtime.subscribe_error', { scope: 'lists-overview', status, error: String(err?.message ?? err) })
          // Likely a stale/expired token after reconnect — refresh it so the
          // channel's next auto-rejoin uses fresh credentials.
          void applyRealtimeAuth(supabase)
        }
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
