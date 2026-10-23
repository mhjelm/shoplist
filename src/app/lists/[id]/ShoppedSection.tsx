'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Theme } from '@/lib/types'
import { slColorFor, hasDecorativeTheme } from '@/lib/sl-theme'
import { SortableRow } from './SortableRow'
import { ShoppedRow } from './ShoppedRow'

interface Props {
  shopped: Item[]
  editMode: boolean
  storeMode: boolean
  theme: Theme
  itemTextClass: string
  thumbSizeClass: string
  selectedIds: Set<string>
  onClearShopped: () => void
  onToggle: (item: Item, rect: DOMRect) => void
  onDelete: (item: Item) => void
  onToggleSelect: (id: string) => void
  onCombine: (item: Item, combined: string) => void
}

export function ShoppedSection({
  shopped, editMode, storeMode, theme,
  itemTextClass, thumbSizeClass, selectedIds,
  onClearShopped, onToggle, onDelete, onToggleSelect, onCombine,
}: Props) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Shopped</span>
        {!storeMode && (
          <button
            onClick={onClearShopped}
            className="inline-flex items-center gap-1.5 min-h-9 px-3 -my-1 rounded-full border border-gray-300 dark:border-gray-600 text-sm font-medium leading-none text-gray-600 dark:text-gray-300 hover:text-red-500 hover:border-red-400 active:text-red-500 active:border-red-400 transition-colors"
            aria-label="Clear shopped items"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" className="w-3 h-3 shrink-0 -translate-y-[1.5px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
            <span>Clear</span>
          </button>
        )}
      </div>
      {editMode ? (
        <SortableContext items={shopped.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {shopped.map(item => (
              <SortableRow
                key={item.id}
                item={item}
                itemTextClass={itemTextClass}
                thumbSizeClass={thumbSizeClass}
                onToggle={(rect) => onToggle(item, rect)}
                onEdit={() => {}}
                onPicture={() => {}}
                onCombine={combined => onCombine(item, combined)}
                editMode={editMode}
                storeMode={storeMode}
                onDelete={() => onDelete(item)}
                muted
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => onToggleSelect(item.id)}
                slColor={hasDecorativeTheme(theme) ? slColorFor(item.id) : undefined}
              />
            ))}
          </ul>
        </SortableContext>
      ) : (
        <ul className="space-y-1">
          {shopped.map(item => (
            <ShoppedRow
              key={item.id}
              item={item}
              storeMode={storeMode}
              theme={theme}
              itemTextClass={itemTextClass}
              thumbSizeClass={thumbSizeClass}
              onToggle={rect => onToggle(item, rect)}
              onCombine={combined => onCombine(item, combined)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
