'use client'

import { useEffect, useRef, useState } from 'react'

// Companion to StoreModeContext's reload-survival: keep the scroll position too,
// so an OS reload of the backgrounded PWA lands you back at the same spot in the
// list instead of at the top. Keyed alongside the store-mode flag — we only
// restore when a store-mode restore for this same list is pending.
const MODE_KEY = 'shoplist:store-mode'
const SCROLL_KEY = 'shoplist:store-mode-scroll'

export function useStoreModeScroll({
  listId,
  storeMode,
  hasLoaded,
}: {
  listId: string
  storeMode: boolean
  hasLoaded: boolean
}) {
  // Capture the saved offset once, at mount (lazy initialiser — runs before the
  // save effect below can overwrite it with the still-zero scroll of the freshly
  // loaded page). Only honour it if a store-mode restore for THIS list is pending
  // — that's the only time the keys are pre-populated before mount, so a normal
  // mid-session toggle never triggers a jump. -1 means "nothing to restore".
  // It's never rendered, so reading sessionStorage here can't cause a mismatch.
  const [initialPendingY] = useState<number>(() => {
    if (typeof window === 'undefined') return -1
    try {
      if (sessionStorage.getItem(MODE_KEY) !== listId) return -1
      const y = parseInt(sessionStorage.getItem(SCROLL_KEY) ?? '', 10)
      return Number.isFinite(y) ? y : -1
    } catch {
      return -1
    }
  })
  const pendingYRef = useRef<number>(initialPendingY)

  // Persist the live scroll offset while shopping (throttled via rAF, plus a
  // flush when the tab is hidden — the moment right before the OS may discard
  // us). Clear it when store mode ends so a later restore can't use a stale y.
  useEffect(() => {
    if (!storeMode) {
      try { sessionStorage.removeItem(SCROLL_KEY) } catch {}
      return
    }

    let raf = 0
    const write = () => {
      raf = 0
      try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)) } catch {}
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(write) }
    const onHidden = () => { if (document.visibilityState === 'hidden') write() }

    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [storeMode])

  // Apply the captured offset once the list has actually rendered (and thus has
  // the height to scroll into). Runs once.
  useEffect(() => {
    if (!hasLoaded) return
    const y = pendingYRef.current
    if (y <= 0) return
    pendingYRef.current = -1
    requestAnimationFrame(() => window.scrollTo(0, y))
  }, [hasLoaded])
}
