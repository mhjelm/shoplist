'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Item, ListPerson } from '@/lib/types'
import { TaskRow } from './TaskRow'

// Manual-view-only sortable wrapper around the presentational TaskRow. Mirrors
// shopping's SortableRow: useSortable drives transform/transition; the drag
// handle (built here, with listeners spread on it) is handed to TaskRow.
export function SortableTaskRow(props: {
  item: Item
  people: ListPerson[]
  isNew?: boolean
  rowAnim?: 'uncheck'
  onToggle: (rect?: DOMRect) => void
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id })

  const handle = (
    <button
      type="button"
      aria-label={`Reorder ${props.item.name}`}
      {...attributes}
      {...listeners}
      className="shrink-0 -ml-1 touch-none cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
      </svg>
    </button>
  )

  return (
    <TaskRow
      {...props}
      drag={{
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.5 : undefined,
          zIndex: isDragging ? 10 : undefined,
          position: 'relative',
        },
        handle,
      }}
    />
  )
}
