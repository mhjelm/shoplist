'use client'

import { useState } from 'react'
import { createList } from './actions'

export default function CreateListForm() {
  const [open, setOpen] = useState(false)
  const [isShared, setIsShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setLoading(true)
    formData.set('is_shared', isShared ? 'true' : 'false')
    const result = await createList(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      setOpen(false)
      setIsShared(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
      >
        + New list
      </button>
    )
  }

  return (
    <form action={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <input
        name="name"
        type="text"
        placeholder="List name"
        required
        autoFocus
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isShared}
          onChange={e => setIsShared(e.target.checked)}
          className="rounded"
        />
        Shared list (invite members)
      </label>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          className="px-4 text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
