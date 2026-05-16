'use client'

import { useRouter } from 'next/navigation'
import { useSyncState } from '@/lib/sync/engine'
import { leaveList } from '../actions'

export default function LeaveListButton({ listId }: { listId: string }) {
  const router = useRouter()
  const { isOffline } = useSyncState()

  async function handleLeave() {
    if (!confirm('Leave this list?')) return
    await leaveList(listId)
    router.push('/lists')
  }

  return (
    <button
      onClick={handleLeave}
      disabled={isOffline}
      title={isOffline ? 'Kräver anslutning' : undefined}
      className="text-sm text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-40"
    >
      Leave
    </button>
  )
}
