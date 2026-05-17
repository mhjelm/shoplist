'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'

type StoreModeContextValue = [boolean, (next: boolean) => void]

const StoreModeContext = createContext<StoreModeContextValue>([false, () => {}])

export function StoreModeProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  // While store mode is on, hold a screen wake lock so the phone doesn't dim
  // mid-shop. The lock auto-releases when the tab is hidden — re-acquire on
  // visibilitychange. Silently no-op where the API is unsupported (older iOS).
  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false

    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request('screen')
        if (cancelled) {
          s.release().catch(() => {})
          return
        }
        sentinelRef.current = s
        s.addEventListener('release', () => {
          if (sentinelRef.current === s) sentinelRef.current = null
        })
      } catch {
        // denied (low battery, no user gesture, etc.) — ignore
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        acquire()
      }
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const s = sentinelRef.current
      sentinelRef.current = null
      if (s) s.release().catch(() => {})
    }
  }, [active])

  return <StoreModeContext.Provider value={[active, setActive]}>{children}</StoreModeContext.Provider>
}

export function useStoreMode(): StoreModeContextValue {
  return useContext(StoreModeContext)
}
