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
          className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
        >
          Delete
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="ml-2 text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
      aria-label="Delete list"
    >
      ×
    </button>
  )
}
