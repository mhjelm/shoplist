'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Theme } from '@/lib/types'
import { type CategorySlug, categoryLabel } from '@/lib/categories'
import { slColorFor } from '@/lib/sl-theme'
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
  onToggle: (item: Item, rect: DOMRect) => void
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  onToggleSelect: (id: string) => void
  onPicture: (item: Item) => void
  onCombine: (item: Item, combined: string) => void
}

export function CategoryGroup({
  category, items, itemTextClass, thumbSizeClass,
  editMode, storeMode, theme, selectedIds,
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
              slColor={theme === 'shoplist' ? slColorFor(item.id) : undefined}
            />
          ))}
        </ul>
      </SortableContext>
    </div>
  )
}
