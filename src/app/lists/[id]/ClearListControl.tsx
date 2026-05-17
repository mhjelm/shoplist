'use client'

import { useState } from 'react'

interface Props {
  isEmpty: boolean
  storeMode: boolean
  onClearAll: () => Promise<void>
  onToggleStore: () => void
}

export function ClearListControl({ isEmpty, storeMode, onClearAll, onToggleStore }: Props) {
  const [confirmingClear, setConfirmingClear] = useState(false)

  return (
    <div className="flex justify-center items-center gap-4 pt-2">
      {!isEmpty && (confirmingClear ? (
        <div className="flex items-center gap-3">
          <button
            onClick={async () => { await onClearAll(); setConfirmingClear(false) }}
            className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
          >
            Clear
          </button>
          <button
            onClick={() => setConfirmingClear(false)}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingClear(true)}
          className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors"
        >
          Clear list
        </button>
      ))}
      <button
        onClick={onToggleStore}
        className={`text-xs transition-colors ${storeMode ? 'text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
      >
        {storeMode ? 'Sluta handla' : 'Handla'}
      </button>
    </div>
  )
}
