'use client'

import { useEffect, useRef, useState } from 'react'
import type { Item, Theme } from '@/lib/types'
import { slColorFor } from '@/lib/sl-theme'
import { MeasurementBadge } from './MeasurementBadge'
import { useStoreModeSwipe } from './useStoreModeSwipe'

export function ShoppedRow({
  item, storeMode, theme, itemTextClass, thumbSizeClass, onToggle, onCombine,
}: {
  item: Item
  storeMode: boolean
  theme: Theme
  itemTextClass: string
  thumbSizeClass: string
  onToggle: (rect: DOMRect) => void
  onCombine: (combined: string) => void
}) {
  const [showHint, setShowHint] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const liRef = useRef<HTMLLIElement>(null)
  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }, [])

  const swipeHandlers = useStoreModeSwipe({
    enabled: storeMode,
    transformRef: contentRef,
    onCommit: () => {
      const rect = contentRef.current?.getBoundingClientRect() ?? liRef.current?.getBoundingClientRect() ?? new DOMRect()
      onToggle(rect)
    },
    onTap: () => {
      setShowHint(true)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setShowHint(false), 1000)
    },
  })

  const slColor = theme === 'shoplist' ? slColorFor(item.id) : undefined
  const thumbClass = storeMode ? 'w-16 h-16' : thumbSizeClass
  const textClass = storeMode ? 'text-lg' : itemTextClass

  if (storeMode) {
    return (
      <li
        ref={liRef}
        className="bg-gray-50 dark:bg-gray-950 rounded-xl border border-gray-100 dark:border-gray-800/50 overflow-hidden relative select-none"
        style={{ touchAction: 'pan-y' }}
        data-sl-color={slColor}
        data-muted="true"
        {...swipeHandlers}
      >
        <div className="absolute inset-0 flex items-center pl-5 bg-emerald-500" aria-hidden="true">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <div
          ref={contentRef}
          className="relative flex items-center gap-3 px-4 py-3 w-full"
          style={{ background: 'inherit' }}
        >
          {item.picture_url && (
            <img src={item.picture_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }}
              className={`${thumbClass} rounded object-cover flex-shrink-0 opacity-60`} />
          )}
          <span className={`${textClass} flex-1 min-w-0 truncate text-gray-400 dark:text-gray-500`}>{item.name}</span>
          <MeasurementBadge item={item} muted onCombine={onCombine} />
          {showHint && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30 rounded-xl">
              <span className="text-white text-sm font-medium">Svep för att bocka av</span>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <li
      ref={liRef}
      onClick={e => onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())}
      className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800/50 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors select-none cursor-pointer"
      data-sl-color={slColor}
      data-muted="true"
    >
      {item.picture_url && (
        <img src={item.picture_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }}
          className={`${thumbClass} rounded object-cover flex-shrink-0 opacity-60`} />
      )}
      <span className={`${textClass} flex-1 min-w-0 truncate text-gray-400 dark:text-gray-500`}>{item.name}</span>
      <MeasurementBadge item={item} muted onCombine={onCombine} />
    </li>
  )
}
