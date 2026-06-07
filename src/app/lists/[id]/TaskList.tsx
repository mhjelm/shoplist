'use client'

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Item, List, ListPerson } from '@/lib/types'
import { sortTasks } from '@/lib/taskView'
import { isNewSinceVisit } from '@/lib/listsUnread'
import { useRevealFx } from '@/lib/useRevealFx'
import { useSyncState } from '@/lib/sync/engine'
import { useListItemsSync } from './useListItemsSync'
import { buildLocalItem } from './itemHelpers'
import { muAddItem, muUpdateItem, muDeleteItem, muBulkDelete } from '@/lib/sync/mutations'
import { touchListView } from './actions'
import { TaskRow } from './TaskRow'
import { TaskEditModal } from './TaskEditModal'
import TaskSpeechModal from './TaskSpeechModal'

// Client-only capability read: false during SSR/first paint (avoids a hydration
// mismatch), then the real value once mounted. Mirrors useSpeechSupported in
// AddItemForm.
const noopSubscribe = () => () => {}
function useSpeechSupported() {
  return useSyncExternalStore(
    noopSubscribe,
    () => !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined',
    () => false,
  )
}

interface Props {
  list: List
  listId: string
  people: ListPerson[]
  currentUserId: string
  lastViewedAt: string | null
}

export default function TaskList({ list, listId, people, currentUserId, lastViewedAt }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [showSpeech, setShowSpeech] = useState(false)
  const { items, hasLoaded } = useListItemsSync(list, listId)
  const revealFx = useRevealFx(hasLoaded)
  const { isOffline } = useSyncState()
  const speechSupported = useSpeechSupported()

  // Touch last_viewed on mount and unmount so the /lists NEW marker clears for
  // this user (mirrors ItemList). router.refresh on leave re-fetches /lists so
  // our own just-added tasks don't show as NEW.
  useEffect(() => {
    touchListView(listId).catch(() => {})
    return () => {
      void (async () => {
        await touchListView(listId).catch(() => {})
        router.refresh()
      })()
    }
  }, [listId, router])

  const todo = useMemo(() => sortTasks(items.filter(i => !i.is_checked)), [items])
  const done = useMemo(
    () => items.filter(i => i.is_checked).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [items],
  )

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    setDraft('')
    await muAddItem(buildLocalItem(listId, name), { skipCategorize: true })
  }

  function handleToggle(item: Item) {
    muUpdateItem(listId, item.id, { is_checked: !item.is_checked })
  }

  function handleSave(patch: { name: string; assignee_id: string | null; due_date: string | null }) {
    if (editing) muUpdateItem(listId, editing.id, { ...patch, name: patch.name.trim() })
    setEditing(null)
  }

  function handleDelete() {
    if (editing) muDeleteItem(listId, editing.id)
    setEditing(null)
  }

  async function handleClearDone() {
    await muBulkDelete(listId, done.map(i => i.id))
    setConfirmingClear(false)
  }

  return (
    <div className={`space-y-6${revealFx ? ' ' + revealFx : ''}`}>
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 min-w-0 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            Add
          </button>
        </div>
        {speechSupported && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowSpeech(true)}
              disabled={isOffline}
              title={isOffline ? 'Requires a connection' : 'Speak to add tasks'}
              aria-label="Speak to add tasks"
              className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-30"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            </button>
          </div>
        )}
      </form>

      {hasLoaded && todo.length === 0 && done.length === 0 && (
        <p className="task-muted text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          No tasks yet. Add one above.
        </p>
      )}

      {todo.length > 0 && (
        <ul className="space-y-2">
          {todo.map(item => (
            <TaskRow
              key={item.id}
              item={item}
              people={people}
              isNew={isNewSinceVisit(item, currentUserId, lastViewedAt)}
              onToggle={() => handleToggle(item)}
              onEdit={() => setEditing(item)}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="task-muted text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Done ({done.length})
            </span>
            {confirmingClear ? (
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClearDone}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                Clear done
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {done.map(item => (
              <TaskRow
                key={item.id}
                item={item}
                people={people}
                done
                onToggle={() => handleToggle(item)}
                onEdit={() => setEditing(item)}
              />
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <TaskEditModal
          item={editing}
          people={people}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {showSpeech && (
        <TaskSpeechModal listId={listId} onClose={() => setShowSpeech(false)} />
      )}
    </div>
  )
}
