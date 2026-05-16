'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createList } from './actions'
import { useSyncState } from '@/lib/sync/engine'

export default function CreateListForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { isOffline } = useSyncState()

  async function handleSubmit(formData: FormData) {
    if (isOffline) return
    setError(null)
    setLoading(true)
    const result = await createList(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else if (result?.list?.id) {
      router.push(`/lists/${result.list.id}`)
    } else {
      setError('Listan skapades, men kunde inte öppnas automatiskt.')
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={isOffline}
        title={isOffline ? 'Kräver anslutning' : undefined}
        className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl py-3 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-500 dark:disabled:hover:border-gray-700 dark:disabled:hover:text-gray-400"
      >
        + New list
      </button>
    )
  }

  return (
    <form action={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <input
        name="name"
        type="text"
        placeholder="List name"
        required
        autoFocus
        className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {isOffline && (
        <p className="text-amber-700 dark:text-amber-400 text-xs">Kräver anslutning</p>
      )}
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || isOffline}
          title={isOffline ? 'Kräver anslutning' : undefined}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg py-2 transition-colors"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          className="px-4 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
