'use client'

// KNOWN ISSUE: this snapshot-clone approach was the 8th attempt at preventing
// the leaving page from visibly scrolling to top during back-nav, and it still
// doesn't fully fix the jump. See "Back-nav from /lists/[id] still visibly
// scrolls to top" under "Known issues" in CLAUDE.md for the full list of
// failed attempts and untested hypotheses BEFORE trying another fix here.

import { useStoreMode } from './StoreModeContext'

export function BackLink() {
  const [storeMode, setStoreMode] = useStoreMode()
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle modifier-key clicks (open in new tab etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()

    // In store mode, Back exits store mode and stays on the list rather than
    // navigating to /lists. The StoreModeProvider effect cleans up the history
    // entry it pushed on activation.
    if (storeMode) {
      setStoreMode(false)
      return
    }

    if (typeof window !== 'undefined' && window.history.length > 1) {
      // Clone the route-root into a fixed-position overlay so Next.js's
      // teardown of the React tree can't cause a visible scroll jump.
      // The clone is a detached DOM snapshot — not React-managed — so it
      // survives the popstate-driven unmount until we remove it ourselves.
      const root = document.querySelector<HTMLElement>('[data-route-root]')
      if (root) {
        const y = window.scrollY
        const clone = root.cloneNode(true) as HTMLElement
        clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'))
        clone.style.position = 'fixed'
        clone.style.top = `-${y}px`
        clone.style.left = '0'
        clone.style.right = '0'
        clone.style.width = '100%'
        clone.style.zIndex = '9999'
        clone.style.pointerEvents = 'none'
        document.body.appendChild(clone)
        root.style.visibility = 'hidden'
        setTimeout(() => clone.remove(), 250)
      }
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
