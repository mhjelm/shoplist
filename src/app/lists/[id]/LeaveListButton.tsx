'use client'

import { useRouter } from 'next/navigation'
import { leaveList } from '../actions'

export default function LeaveListButton({ listId }: { listId: string }) {
  const router = useRouter()

  async function handleLeave() {
    if (!confirm('Leave this list?')) return
    await leaveList(listId)
    router.push('/lists')
  }

  return (
    <button onClick={handleLeave} className="text-sm text-gray-400 hover:text-red-500 transition-colors">
      Leave
    </button>
  )
}
