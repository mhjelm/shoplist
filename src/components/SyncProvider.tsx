'use client'

import { useEffect } from 'react'
import { localDB } from '@/lib/db/local'
import { flushOutbox } from '@/lib/sync/engine'

export default function SyncProvider() {
  useEffect(() => {
    // Open the Dexie database and kick off the first outbox flush.
    localDB.open()
      .then(() => flushOutbox())
      .catch(err => console.error('LocalDB open failed:', err))

    // Flush when connectivity is restored.
    const handleOnline = () => {
      flushOutbox()
      // Re-register background sync after reconnect in case items were added while offline.
      navigator.serviceWorker?.ready.then((reg) => {
        // Background Sync API types not in TS lib; progressive enhancement only.
        ;(reg as unknown as { sync?: { register(tag: string): Promise<void> } }).sync?.register('outbox-flush').catch(() => {})
      })
    }
    window.addEventListener('online', handleOnline)

    // Flush when tab regains focus (catches missed events while backgrounded).
    const handleVisible = () => {
      if (document.visibilityState === 'visible') flushOutbox()
    }
    document.addEventListener('visibilitychange', handleVisible)

    // Flush on background sync message from the Service Worker.
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'outbox-flush') flushOutbox()
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisible)
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [])

  return null
}
