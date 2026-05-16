'use client'

import { useState, useRef } from 'react'
import { inviteMember, removeMember } from '../actions'
import { useSyncState } from '@/lib/sync/engine'

interface Member {
  user_id: string
  email: string
  added_at: string
}

interface Props {
  listId: string
  initialMembers: Member[]
  initialInvitees: string[]
}

export default function ShareSection({ listId, initialMembers, initialInvitees }: Props) {
  const { isOffline } = useSyncState()
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Chips = previously-invited emails not already in this list's members.
  const currentEmails = new Set(members.map(m => m.email))
  const chips = initialInvitees.filter(e => !currentEmails.has(e))

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (isOffline || !email.trim()) return
    setStatus(null)
    setLoading(true)
    const result = await inviteMember(listId, email.trim())
    setLoading(false)
    if (result?.error) {
      setStatus({ type: 'error', message: result.error })
    } else {
      // Optimistic: append a placeholder until SSR revalidates with the real row.
      setMembers(prev => [...prev, { user_id: '', email: email.trim(), added_at: new Date().toISOString() }])
      setStatus({ type: 'success', message: 'Inbjuden!' })
      setEmail('')
    }
  }

  async function handleRemove(member: Member) {
    if (isOffline) return
    const snapshot = members
    setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
    const result = await removeMember(listId, member.user_id)
    if (result?.error) {
      setMembers(snapshot)
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Dela listan</h2>

      {/* Current members */}
      <div className="space-y-2">
        {members.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Inga medlemmar än.</p>
        ) : (
          <ul className="space-y-1">
            {members.map(m => (
              <li key={m.user_id || m.email} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-300 truncate">{m.email}</span>
                <button
                  onClick={() => handleRemove(m)}
                  disabled={isOffline}
                  title={isOffline ? 'Kräver anslutning' : `Ta bort ${m.email}`}
                  className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-colors"
                  aria-label={`Ta bort ${m.email}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex gap-2">
        <input
          ref={inputRef}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="member@example.com"
          required
          className="flex-1 min-w-0 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || isOffline}
          title={isOffline ? 'Kräver anslutning' : undefined}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 transition-colors whitespace-nowrap shrink-0"
        >
          Bjud in
        </button>
      </form>

      {status && (
        <p className={`text-sm ${status.type === 'error' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {status.message}
        </p>
      )}

      {/* Quick-pick chips for previously invited emails */}
      {chips.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-400 dark:text-gray-500">Tidigare inbjudna:</p>
          <div className="flex flex-wrap gap-2">
            {chips.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => {
                  setEmail(chip)
                  inputRef.current?.focus()
                }}
                className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full px-3 py-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
