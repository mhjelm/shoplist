'use client'

import { useState } from 'react'
import { deleteList } from './actions'

export default function DeleteListButton({ listId }: { listId: string }) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={async () => { await deleteList(listId); setConfirming(false) }}
          className="text-xs text-red-600 hover:text-red-700 font-medium"
        >
          Delete
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs text-gray-400 hover:text-gray-600">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="ml-2 text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
      aria-label="Delete list"
    >
      ×
    </button>
  )
}
