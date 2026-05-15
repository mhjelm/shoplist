'use client'

import { useSyncState } from '@/lib/sync/engine'

export default function OfflineBadge() {
  const { isOffline, pendingCount } = useSyncState()
  if (!isOffline && pendingCount === 0) return null
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
      {isOffline
        ? pendingCount > 0
          ? `Offline · ${pendingCount}`
          : 'Offline'
        : `Syncar ${pendingCount}…`}
    </span>
  )
}
