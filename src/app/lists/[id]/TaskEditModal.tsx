'use client'

import { useEffect, useState } from 'react'
import type { Item, ListPerson } from '@/lib/types'

interface Props {
  item: Item
  people: ListPerson[]
  onSave: (patch: { name: string; assignee_id: string | null; due_date: string | null }) => void
  onDelete: () => void
  onClose: () => void
}

export function TaskEditModal({ item, people, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(item.name)
  const [assigneeId, setAssigneeId] = useState<string>(item.assignee_id ?? '')
  const [dueDate, setDueDate] = useState<string>(item.due_date ?? '')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-md space-y-3 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Edit task</h2>

        <input
          type="search"
          name="sl-task-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Task name"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 [&::-webkit-search-cancel-button]:hidden"
        />

        <label className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400 w-20 shrink-0">Assignee</span>
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {people.map(p => (
              <option key={p.user_id} value={p.user_id}>{p.email}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400 w-20 shrink-0">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {dueDate && (
            <button
              type="button"
              onClick={() => setDueDate('')}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Clear
            </button>
          )}
        </label>

        <div className="flex gap-2 justify-between pt-1">
          <button
            onClick={onDelete}
            className="text-sm px-4 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave({
                name,
                assignee_id: assigneeId || null,
                due_date: dueDate || null,
              })}
              disabled={!name.trim()}
              className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
