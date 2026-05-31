'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

type StoreModeContextValue = [boolean, (next: boolean) => void]

const StoreModeContext = createContext<StoreModeContextValue>([false, () => {}])

// We persist the id of the list that is currently in store mode so a reload
// (typically the OS discarding the backgrounded PWA while the phone slept)
// lands the user back in store mode on the same list instead of silently
// dropping out. sessionStorage = same-tab only: a fresh tab/relaunch starts
// normal; a survive-the-sleep reload restores.
const STORAGE_KEY = 'shoplist:store-mode'

export function StoreModeProvider({ listId, children }: { listId?: string; children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  // The setter every entry/exit path goes through (toggle, swipe, Back). It
  // owns persistence so storage can't drift from state.
  const setStoreMode = useCallback((next: boolean) => {
    setActive(next)
    if (!listId) return
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, listId)
      else if (sessionStorage.getItem(STORAGE_KEY) === listId) sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [listId])

  // Restore store mode after a reload if this is the list we left it on. This
  // must be a post-mount effect, not a lazy useState initialiser: store mode
  // changes the rendered chrome, so seeding `true` during render would mismatch
  // the server-rendered (always-false) HTML on hydration. The one extra render
  // is intentional — hence the set-state-in-effect disable.
  useEffect(() => {
    if (!listId) return
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionStorage.getItem(STORAGE_KEY) === listId) setActive(true)
    } catch {}
  }, [listId])

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

  // Make Back exit store mode instead of leaving the list. On activation we
  // push a throwaway history entry; a hardware/browser Back press pops it and
  // we drop out of store mode without navigating. If store mode is exited any
  // other way (toggle button, or the in-app arrow calling setStoreMode(false)),
  // the cleanup removes the entry we added so Back isn't a dead press.
  useEffect(() => {
    if (!active) return
    if (typeof window === 'undefined') return

    let popped = false
    window.history.pushState({ __storeMode: true }, '')

    const onPop = () => { popped = true; setStoreMode(false) }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      if (!popped) window.history.back()
    }
  }, [active, setStoreMode])

  return <StoreModeContext.Provider value={[active, setStoreMode]}>{children}</StoreModeContext.Provider>
}

export function useStoreMode(): StoreModeContextValue {
  return useContext(StoreModeContext)
}
