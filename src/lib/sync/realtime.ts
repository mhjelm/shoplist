import { createClient } from '@/lib/supabase/client'
import { localDB } from '@/lib/db/local'
import type { LocalItem } from '@/lib/db/types'

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
