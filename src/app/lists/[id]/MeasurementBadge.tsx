'use client'

import { useEffect, useRef, useState } from 'react'
import type { Item } from '@/lib/types'
import { tryCombine } from '@/lib/measurement'

export function MeasurementBadge({ item, muted, onCombine }: {
  item: Item
  muted?: boolean
  onCombine: (combined: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const combined = item.measurement ? tryCombine(item.measurement) : null
  const textColor = muted
    ? 'text-gray-300 dark:text-gray-600'
    : 'text-gray-400 dark:text-gray-500'

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!item.measurement && item.quantity <= 1) return null

  const badgeText = item.measurement
    ? `${item.measurement}${item.quantity > 1 ? ` (× ${item.quantity})` : ''}`
    : `× ${item.quantity}`

  if (!combined) {
    return <span className={`text-xs ${textColor} ml-1`} onClick={e => e.stopPropagation()}>{badgeText}</span>
  }

  return (
    <div ref={ref} className="relative ml-1">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className={`text-xs ${textColor} hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1.5 -mx-1.5 transition-colors`}
        title="Slå ihop mängder"
      >
        {badgeText}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 min-w-[140px]">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 whitespace-nowrap">
            → <span className="font-medium text-gray-800 dark:text-gray-200">{combined}</span>
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={e => { e.stopPropagation(); setOpen(false) }}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Avbryt
            </button>
            <button
              onClick={e => { e.stopPropagation(); setOpen(false); onCombine(combined) }}
              className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              Slå ihop
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
