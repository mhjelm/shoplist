'use client'

import type { Item } from '@/lib/types'

interface Props {
  source: Item
  target: Item
  onConfirm: () => void
  onCancel: () => void
}

export function MergeConfirmModal({ source, target, onConfirm, onCancel }: Props) {
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-sm space-y-4 shadow-xl"
      >
        <p className="text-sm text-gray-800 dark:text-gray-200">
          Slå ihop <span className="font-semibold">&ldquo;{source.name}&rdquo;</span> och <span className="font-semibold">&ldquo;{target.name}&rdquo;</span>?
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={onConfirm}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            Slå ihop
          </button>
        </div>
      </div>
    </div>
  )
}
