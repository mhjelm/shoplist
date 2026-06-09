'use client'

import { useEffect, useRef } from 'react'
import type { GhostItem } from './useItemCelebrations'

export function GhostOverlay({ ghost, onDone }: { ghost: GhostItem; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // No Web Animations API (e.g. jsdom, or a stripped-down browser) → skip the
    // fly-up and just clean up immediately rather than throwing.
    if (typeof el.animate !== 'function') { onDone(); return }
    const anim = el.animate(
      [
        { opacity: 0.75, transform: 'translateY(0px)' },
        { opacity: 0, transform: 'translateY(36px)' },
      ],
      { duration: 450, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'forwards' },
    )
    anim.onfinish = onDone
    return () => { anim.cancel() }
  // Animation runs exactly once on mount; onDone captured at mount is correct for this ghost's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3"
      style={{
        position: 'fixed',
        top: ghost.rect.top,
        left: ghost.rect.left,
        width: ghost.rect.width,
        height: ghost.rect.height,
        pointerEvents: 'none',
        zIndex: 60,
        overflow: 'hidden',
        opacity: 0,
      }}
    >
      {ghost.picture_url && (
        <img
          src={ghost.picture_url}
          alt=""
          className={`${ghost.thumbSizeClass} rounded object-cover flex-shrink-0`}
        />
      )}
      <span className={`${ghost.itemTextClass} flex-1 min-w-0 break-words text-gray-800 dark:text-gray-200`}>
        {ghost.name}
      </span>
      {ghost.measurement && (
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{ghost.measurement}</span>
      )}
    </div>
  )
}
