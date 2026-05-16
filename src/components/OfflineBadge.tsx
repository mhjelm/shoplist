'use client'

import { useSyncState, triggerSync } from '@/lib/sync/engine'

export default function OfflineBadge() {
  const { isOffline, pendingCount, lastSyncError } = useSyncState()
  if (!isOffline && pendingCount === 0) return null

  const label = isOffline
    ? pendingCount > 0
      ? `Offline · ${pendingCount}`
      : 'Offline'
    : `Syncar ${pendingCount}…`

  const title = lastSyncError
    ? `Sync-fel: ${lastSyncError}`
    : isOffline
      ? 'Klicka för att försöka igen'
      : undefined

  return (
    <button
      onClick={() => triggerSync()}
      title={title}
      className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors cursor-pointer"
    >
      {label}
    </button>
  )
}
