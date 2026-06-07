'use client'

import { useEffect } from 'react'
import { localDB } from '@/lib/db/local'
import { triggerSync, markOffline, markOnlineIfBrowserAgrees } from '@/lib/sync/engine'
import { log } from '@/lib/log'

export default function SyncProvider() {
  useEffect(() => {
    // Open the Dexie database and kick off the first sync cycle.
    localDB.open()
      .then(() => triggerSync())
      .catch(err => {
        // The single most important client error to capture: if Dexie won't
        // open, the whole local-first app is dead (blocked upgrade, quota,
        // private-mode storage block, corruption). name = Dexie error class.
        log.error('idb.open_failed', { name: err?.name, error: String(err?.message ?? err) })
      })

    const handleOnline = () => {
      markOnlineIfBrowserAgrees()
      triggerSync()
      // Re-register background sync after reconnect in case items were added while offline.
      navigator.serviceWorker?.ready.then((reg) => {
        ;(reg as unknown as { sync?: { register(tag: string): Promise<void> } }).sync?.register('outbox-flush').catch(() => {})
      })
    }
    const handleOffline = () => markOffline()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Sync when the tab regains focus (catches missed events while backgrounded).
    const handleVisible = () => {
      if (document.visibilityState === 'visible') triggerSync()
    }
    document.addEventListener('visibilitychange', handleVisible)

    // Sync on a background-sync ping from the Service Worker.
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'outbox-flush') triggerSync()
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisible)
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [])

  return null
}
