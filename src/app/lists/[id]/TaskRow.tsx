'use client'

import type { Item, ListPerson } from '@/lib/types'
import { dueStatus, formatDueLabel, type DueStatus } from '@/lib/taskView'
import { TaskAvatar } from './TaskAvatar'

const DUE_PILL: Record<DueStatus, string> = {
  overdue: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900',
  today:   'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  soon:    'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  future:  'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
}

export function TaskRow({
  item, people, done = false, isNew = false, onToggle, onEdit,
}: {
  item: Item
  people: ListPerson[]
  done?: boolean
  isNew?: boolean
  onToggle: () => void
  onEdit: () => void
}) {
  const status = dueStatus(item.due_date)
  const dueLabel = formatDueLabel(item.due_date)

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
        done
          ? 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800/60'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${item.name} not done` : `Mark ${item.name} done`}
        className={`shrink-0 grid place-items-center w-[22px] h-[22px] rounded-md border-2 transition-colors ${
          done
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-gray-300 dark:border-gray-600 hover:border-emerald-400'
        }`}
      >
        {done && (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </button>

      {isNew && !done && (
        <span
          aria-label="Tillagd sedan ditt senaste besök"
          title="Tillagd sedan ditt senaste besök"
          className="inline-block h-2 w-2 rounded-full bg-[#EC4899] shrink-0"
        />
      )}

      <span
        className={`flex-1 min-w-0 break-words text-sm ${
          done ? 'task-muted text-gray-500 dark:text-gray-400 line-through' : 'text-gray-800 dark:text-gray-200'
        }`}
      >
        {item.name}
      </span>

      {!done && status && dueLabel && (
        <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${DUE_PILL[status]}`}>
          {dueLabel}
        </span>
      )}

      <TaskAvatar assigneeId={item.assignee_id} people={people} size={done ? 20 : 24} />

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${item.name}`}
        className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-indigo-400 dark:hover:text-indigo-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
        </svg>
      </button>
    </li>
  )
}
