'use client'

// Back-nav from /lists/[id] to /lists used to visibly scroll-jump on the
// leaving page during Next.js's React-tree teardown (see "Known issues" in
// CLAUDE.md — 8 failed attempts to *fix* it). We no longer try to fix it: we
// MASK it with a full-screen, theme-matched loading overlay shown over the
// leaving page until /lists has painted.
//
// The overlay is built as DETACHED DOM (vanilla, appended to <body>) — not
// React-rendered. window.history.back() fires popstate, Next.js unmounts this
// page's React tree, and any React-managed overlay would be torn down
// mid-transition. Detached DOM survives the unmount. ListsView removes the
// overlay (#backnav-loading) in its pre-paint useLayoutEffect, so it lasts
// exactly until /lists is ready; a 1.5s timeout is a safety net only.

import type { Theme } from '@/lib/types'
import { useStoreMode } from './StoreModeContext'

function bgClassFor(theme: Theme): string {
  switch (theme) {
    case 'polar': return 'loading-bg-polar'
    case 'dusk': return 'loading-bg-dusk'
    case 'dark': return 'bg-black'
    default: return 'bg-white' // light + shoplist
  }
}

export function BackLink({ theme }: { theme: Theme }) {
  const [storeMode, setStoreMode] = useStoreMode()
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle modifier-key clicks (open in new tab etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()

    // In store mode, Back exits store mode and stays on the list rather than
    // navigating to /lists. The StoreModeProvider effect cleans up the history
    // entry it pushed on activation. No overlay — we're not navigating.
    if (storeMode) {
      setStoreMode(false)
      return
    }

    if (typeof window !== 'undefined' && window.history.length > 1) {
      showBackNavOverlay(theme)
      window.history.back()
    } else {
      // Deep-link with no in-app history: fall back to full navigation.
      window.location.assign('/lists')
    }
  }
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/lists"
      onClick={onClick}
      aria-label="Tillbaka"
      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 -ml-1 px-1"
    >
      ←
    </a>
  )
}

function showBackNavOverlay(theme: Theme) {
  if (document.getElementById('backnav-loading')) return
  const overlay = document.createElement('div')
  overlay.id = 'backnav-loading'
  overlay.setAttribute('role', 'status')
  overlay.setAttribute('aria-live', 'polite')
  overlay.className = `loading-overlay fixed inset-0 flex items-center justify-center ${bgClassFor(theme)}`
  overlay.style.zIndex = '9999'

  const glass = document.createElement('span')
  glass.className = 'backnav-glass select-none'
  glass.setAttribute('aria-hidden', 'true')
  glass.textContent = '⏳'
  overlay.appendChild(glass)

  document.body.appendChild(overlay)
  // Safety net: ListsView removes this on mount (its pre-paint useLayoutEffect).
  // This only fires if /lists never mounts (error path).
  setTimeout(() => overlay.remove(), 1500)
}
