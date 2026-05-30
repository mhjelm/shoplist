'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Theme } from '@/lib/types'
import { type CategorySlug, categoryLabel } from '@/lib/categories'
import { slColorFor, hasDecorativeTheme } from '@/lib/sl-theme'
import { SortableRow } from './SortableRow'

interface Props {
  category: CategorySlug
  items: Item[]
  itemTextClass: string
  thumbSizeClass: string
  editMode: boolean
  storeMode: boolean
  theme: Theme
  selectedIds: Set<string>
  recentlyAdded?: Set<string>
  recentlyUnchecked?: Set<string>
  newItemIds?: Set<string>
  onToggle: (item: Item, rect: DOMRect) => void
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  onToggleSelect: (id: string) => void
  onPicture: (item: Item) => void
  onCombine: (item: Item, combined: string) => void
}

const EMPTY_SET: Set<string> = new Set()

export function CategoryGroup({
  category, items, itemTextClass, thumbSizeClass,
  editMode, storeMode, theme, selectedIds,
  recentlyAdded = EMPTY_SET, recentlyUnchecked = EMPTY_SET, newItemIds = EMPTY_SET,
  onToggle, onEdit, onDelete, onToggleSelect, onPicture, onCombine,
}: Props) {
  return (
    <div>
      <div className="px-1 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {categoryLabel(category)}
        </span>
      </div>
      <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {items.map(item => (
            <SortableRow
              key={item.id}
              item={item}
              itemTextClass={itemTextClass}
              thumbSizeClass={thumbSizeClass}
              onToggle={(rect) => onToggle(item, rect)}
              onEdit={() => onEdit(item)}
              onPicture={() => onPicture(item)}
              onCombine={combined => onCombine(item, combined)}
              editMode={editMode}
              storeMode={storeMode}
              onDelete={() => onDelete(item)}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              slColor={hasDecorativeTheme(theme) ? slColorFor(item.id) : undefined}
              rowAnim={recentlyUnchecked.has(item.id) ? 'uncheck' : recentlyAdded.has(item.id) ? 'new' : undefined}
              isNew={newItemIds.has(item.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  )
}
