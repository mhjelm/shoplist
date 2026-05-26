'use client'

import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Item } from '@/lib/types'
import { MeasurementBadge } from './MeasurementBadge'
import { useStoreModeSwipe } from './useStoreModeSwipe'

export function SortableRow({
  item, itemTextClass, thumbSizeClass, onToggle, onEdit, onPicture, onCombine, editMode, storeMode, onDelete, muted, selected, onToggleSelect, slColor, rowAnim,
}: {
  item: Item
  itemTextClass: string
  thumbSizeClass: string
  onToggle: (rect: DOMRect) => void
  onEdit: () => void
  onPicture: () => void
  onCombine: (combined: string) => void
  editMode?: boolean
  storeMode?: boolean
  onDelete?: () => void
  muted?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  slColor?: 0 | 1 | 2 | 3
  rowAnim?: 'new' | 'uncheck'
}) {
  const [showHint, setShowHint] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }, [])

  const swipeHandlers = useStoreModeSwipe({
    enabled: !!storeMode,
    transformRef: contentRef,
    onCommit: () => { const rect = contentRef.current?.getBoundingClientRect(); if (rect) onToggle(rect) },
    onTap: () => {
      setShowHint(true)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setShowHint(false), 1000)
    },
  })

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: item.id })
  const style = {
    transform: editMode ? undefined : CSS.Transform.toString(transform),
    transition: editMode ? undefined : transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const mergeTarget = editMode && isOver && !isDragging
  const isSelected = editMode && selected

  const bgClass = mergeTarget
    ? 'bg-blue-100 dark:bg-blue-950/60 border-blue-400 dark:border-blue-500'
    : isSelected
      ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-400 dark:border-blue-500'
      : editMode
        ? muted
          ? 'bg-rose-50/40 dark:bg-blue-950/35 border-rose-200/70 dark:border-blue-800/50'
          : 'bg-rose-50/60 dark:bg-blue-950/60 border-rose-200 dark:border-blue-700/70'
        : muted
          ? 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/50'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
  const nameClass = mergeTarget
    ? 'text-blue-800 dark:text-blue-200 font-medium'
    : isSelected
      ? 'text-blue-800 dark:text-blue-100 font-medium'
      : muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'

  const rowItemTextClass = storeMode ? 'text-lg' : itemTextClass
  const rowThumbSizeClass = storeMode ? 'w-16 h-16' : thumbSizeClass

  if (storeMode) {
    return (
      <li
        ref={setNodeRef}
        style={{ ...style, touchAction: 'pan-y' }}
        className={`${bgClass} rounded-xl border overflow-hidden relative select-none`}
        data-sl-color={slColor}
        data-muted={muted ? 'true' : undefined}
        data-row-anim={!transform ? rowAnim : undefined}
        {...swipeHandlers}
      >
        {/* Green reveal layer, exposed as the content slides right */}
        <div className="absolute inset-0 flex items-center pl-5 bg-emerald-500" aria-hidden="true">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        {/* Content wrapper — slides right to reveal the green layer behind it */}
        <div
          ref={contentRef}
          className="relative flex items-center gap-3 px-4 py-3 w-full"
          style={{ background: 'inherit' }}
        >
          {item.picture_url && (
            <img
              src={item.picture_url}
              alt=""
              onPointerDown={e => e.stopPropagation()}
              onPointerUp={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onPicture() }}
              onError={e => { e.currentTarget.style.display = 'none' }}
              className={`${rowThumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0 ${muted ? 'opacity-60' : ''}`}
            />
          )}
          <span className={`${rowItemTextClass} flex-1 min-w-0 truncate ${nameClass}`}>{item.name}</span>
          <MeasurementBadge item={item} muted={muted} onCombine={onCombine} />
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
      ref={setNodeRef}
      style={style}
      onClick={editMode ? onToggleSelect : e => onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())}
      className={`flex items-center gap-3 ${bgClass} rounded-xl border px-4 py-3 transition-colors select-none cursor-pointer`}
      data-sl-color={slColor}
      data-muted={muted ? 'true' : undefined}
      data-row-anim={!transform ? rowAnim : undefined}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        aria-label={editMode ? 'Drag to merge' : 'Reorder item'}
        className="touch-none cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 -ml-1 px-1 py-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
        </svg>
      </button>
      {item.picture_url && (
        <img
          src={item.picture_url}
          alt=""
          onClick={e => { e.stopPropagation(); onPicture() }}
          onError={e => { e.currentTarget.style.display = 'none' }}
          className={`${rowThumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0 ${muted ? 'opacity-60' : ''}`}
        />
      )}
      <span className={`${rowItemTextClass} flex-1 min-w-0 truncate ${nameClass}`}>
        {item.name}
      </span>
      {item.shared_group_id && (
        <span
          aria-label="Delad mellan listor"
          title="Delad mellan listor"
          className="shrink-0 sl-shared-icon"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 015.656 5.656l-3 3a4 4 0 01-5.656 0M10.172 13.828a4 4 0 01-5.656-5.656l3-3a4 4 0 015.656 0" />
          </svg>
        </span>
      )}
      <MeasurementBadge item={item} muted={muted} onCombine={onCombine} />
      {editMode ? (
        <button
          onClick={e => { e.stopPropagation(); onDelete?.() }}
          className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          aria-label="Delete item"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="text-gray-300 dark:text-gray-600 hover:text-blue-400 dark:hover:text-blue-400 transition-colors"
          aria-label="Edit item"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
          </svg>
        </button>
      )}
    </li>
  )
}
