'use client'

import { useEffect, useState } from 'react'
import ShareSection from './[id]/ShareSection'
import { fetchListMembers, fetchMyInvitees, renameList } from './actions'
import { useSyncState } from '@/lib/sync/engine'

interface Member {
  user_id: string
  email: string
  added_at: string
}

interface Props {
  listId: string
  initialName: string
  onRename: (name: string) => void
}

export default function ListEditPanel({ listId, initialName, onRename }: Props) {
  const { isOffline } = useSyncState()
  const [name, setName] = useState(initialName)
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingShare, setLoadingShare] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [invitees, setInvitees] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    Promise.all([fetchListMembers(listId), fetchMyInvitees()])
      .then(([nextMembers, nextInvitees]) => {
        if (cancelled) return
        setMembers(nextMembers)
        setInvitees(nextInvitees)
      })
      .catch(() => {
        if (!cancelled) setStatus({ type: 'error', message: 'Kunde inte hämta delningsdata.' })
      })
      .finally(() => {
        if (!cancelled) setLoadingShare(false)
      })

    return () => {
      cancelled = true
    }
  }, [listId, initialName])

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (isOffline || saving || !trimmed) return

    setSaving(true)
    setStatus(null)
    const result = await renameList(listId, trimmed)
    setSaving(false)

    if (result?.error) {
      setStatus({ type: 'error', message: result.error })
      return
    }

    setName(trimmed)
    onRename(trimmed)
    setStatus({ type: 'success', message: 'Listnamnet sparades.' })
  }

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60 space-y-4">
      <form onSubmit={handleRename} className="space-y-2">
        <label htmlFor={`list-name-${listId}`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Listnamn
        </label>
        <div className="flex gap-2">
          <input
            id={`list-name-${listId}`}
            value={name}
            onChange={e => setName(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={saving || isOffline || !name.trim()}
            title={isOffline ? 'Kräver anslutning' : undefined}
            className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </form>

      {status && (
        <p className={`text-sm ${status.type === 'error' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {status.message}
        </p>
      )}

      {loadingShare ? (
        <div role="status" className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
          <span
            className="inline-block h-4 w-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin dark:border-gray-700 dark:border-t-gray-300"
            aria-hidden
          />
          Hämtar delning...
        </div>
      ) : (
        <ShareSection
          listId={listId}
          initialMembers={members}
          initialInvitees={invitees}
        />
      )}
    </div>
  )
}
