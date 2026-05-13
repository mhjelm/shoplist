'use client'

import { useState } from 'react'
import { inviteMember } from '../actions'

export default function InviteForm({ listId }: { listId: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus(null)
    setLoading(true)
    const result = await inviteMember(listId, email.trim())
    setLoading(false)
    if (result?.error) {
      setStatus({ type: 'error', message: result.error })
    } else {
      setStatus({ type: 'success', message: 'Invited!' })
      setEmail('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="member@example.com"
        required
        className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 transition-colors"
      >
        Invite
      </button>
      {status && (
        <p className={`text-sm self-center ${status.type === 'error' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {status.message}
        </p>
      )}
    </form>
  )
}
