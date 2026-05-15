'use client'

import { useState } from 'react'
import { useSyncState, dismissConflicts } from '@/lib/sync/engine'

export default function ConflictBanner() {
  const { recentConflicts } = useSyncState()
  const [expanded, setExpanded] = useState(false)

  if (recentConflicts.length === 0) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-amber-50 dark:bg-amber-950/80 border-b border-amber-200 dark:border-amber-700 px-4 py-2 flex items-start gap-3 shadow-sm">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-amber-800 dark:text-amber-200">
          {recentConflicts.length === 1
            ? '1 vara uppdaterades på servern medan du var offline.'
            : `${recentConflicts.length} varor uppdaterades på servern medan du var offline.`}
          {' '}
          <button
            onClick={() => setExpanded(v => !v)}
            className="underline font-medium"
          >
            {expanded ? 'Dölj' : 'Visa'}
          </button>
        </p>
        {expanded && (
          <ul className="mt-1 space-y-0.5">
            {recentConflicts.map(c => (
              <li key={c.id} className="text-xs text-amber-700 dark:text-amber-300">
                {c.name} — serverns version gäller
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={() => { setExpanded(false); dismissConflicts() }}
        className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 text-lg leading-none flex-shrink-0"
        aria-label="Stäng"
      >
        ×
      </button>
    </div>
  )
}
