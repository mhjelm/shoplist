'use client'

import { useState } from 'react'

const MESSAGES: Record<string, string> = {
  empty: 'Hittade inga varor att importera.',
  extract: 'Kunde inte tolka delningen. Försök igen.',
  db: 'Något gick fel. Försök igen.',
}

export function ShareErrorToast({ code }: { code: string }) {
  const [visible, setVisible] = useState(true)

  function dismiss() {
    setVisible(false)
    // Strip ?shareError so a refresh doesn't resurface the toast.
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('shareError')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch {
      /* SSR / unavailable history — ignore */
    }
  }

  if (!visible) return null
  const message = MESSAGES[code] ?? 'Något gick fel med delningen.'
  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-xl bg-red-600 px-4 py-3 text-white shadow-lg">
      <p className="flex-1 text-sm">{message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Stäng"
        className="shrink-0 text-white/80 hover:text-white"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
