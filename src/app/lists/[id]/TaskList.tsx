'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import type { Item, List, ListPerson, Theme } from '@/lib/types'
import {
  sortTasksManual, taskDateSections, type TaskSort, type TaskSectionTone,
} from '@/lib/taskView'
import { isNewSinceVisit } from '@/lib/listsUnread'
import { useRevealFx } from '@/lib/useRevealFx'
import { useSyncState } from '@/lib/sync/engine'
import { hasDecorativeTheme, FIREWORK_PALETTES } from '@/lib/sl-theme'
import { computeNewSortOrder } from '@/lib/itemListHelpers'
import { useListItemsSync } from './useListItemsSync'
import { buildLocalItem } from './itemHelpers'
import { muAddItem, muUpdateItem, muDeleteItem, muBulkDelete, muReorderItem } from '@/lib/sync/mutations'
import { touchListView, setTaskSort } from './actions'
import { TaskRow } from './TaskRow'
import { SortableTaskRow } from './SortableTaskRow'
import { TaskEditModal } from './TaskEditModal'
import { useItemCelebrations } from './useItemCelebrations'
import { GhostOverlay } from './GhostOverlay'
import { FireworkCanvas } from './FireworkCanvas'
import TaskSpeechModal from './TaskSpeechModal'
import TaskImageImportModal from './TaskImageImportModal'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

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

// Colored section-header bar styling (the "D2" exploration) per due tone.
const SECTION_BAR: Record<TaskSectionTone, string> = {
  over:   'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900',
  today:  'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  soon:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  future: 'bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  none:   'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700',
}

interface Props {
  list: List
  listId: string
  people: ListPerson[]
  currentUserId: string
  lastViewedAt: string | null
  theme: Theme
  initialSort: TaskSort
}

export default function TaskList({ list, listId, people, currentUserId, lastViewedAt, theme, initialSort }: Props) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [showSpeech, setShowSpeech] = useState(false)
  const [showImage, setShowImage] = useState(false)
  const [sort, setSort] = useState<TaskSort>(initialSort)
  const [recentlyUnchecked, setRecentlyUnchecked] = useState<Set<string>>(() => new Set())
  const { items, hasLoaded } = useListItemsSync(list, listId)
  const revealFx = useRevealFx(hasLoaded)
  const { isOffline } = useSyncState()
  const speechSupported = useSpeechSupported()

  // Celebration on completing a task — reuses the shopping primitives. Tasks have
  // no thumbnail/measurement, so the ghost is just the name flying up.
  const { ghosts, setGhosts, fwCanvasRef, spawnGhost } = useItemCelebrations({ itemTextClass: 'text-sm', thumbSizeClass: '' })

  // dnd-kit holds onDragEnd in an internal ref that can lag a React render; read
  // items from a ref inside the handler so the first drag isn't stale.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

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

  const undone = useMemo(() => items.filter(i => !i.is_checked), [items])
  const manualTodo = useMemo(() => sortTasksManual(undone), [undone])
  const dateSections = useMemo(() => taskDateSections(undone), [undone])
  const done = useMemo(
    () => items.filter(i => i.is_checked).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [items],
  )

  function flagRecentlyUnchecked(id: string) {
    setRecentlyUnchecked(s => { const n = new Set(s); n.add(id); return n })
    setTimeout(() => {
      setRecentlyUnchecked(s => { const n = new Set(s); n.delete(id); return n })
    }, 500)
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    setDraft('')
    await muAddItem(buildLocalItem(listId, name), { skipCategorize: true })
  }

  function handleToggle(item: Item, sourceRect?: DOMRect) {
    // Honor the user's reduce-motion setting (the ghost uses the Web Animations
    // API, which the .reduce-motion CSS rule can't stop; FireworkCanvas self-guards).
    const reduceMotion = typeof document !== 'undefined'
      && document.documentElement.classList.contains('reduce-motion')
    if (!item.is_checked && sourceRect && !reduceMotion) {
      spawnGhost(item, sourceRect)
      if (hasDecorativeTheme(theme)) {
        fwCanvasRef.current?.explode(
          sourceRect.left + sourceRect.width / 2,
          sourceRect.top + sourceRect.height / 2,
        )
      }
    } else if (item.is_checked) {
      flagRecentlyUnchecked(item.id)
    }
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

  function handleSetSort(next: TaskSort) {
    if (next === sort) return
    setSort(next)
    setTaskSort(listId, next).catch(() => {})
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const list = sortTasksManual(itemsRef.current.filter(i => !i.is_checked))
    const oldIndex = list.findIndex(i => i.id === active.id)
    const newIndex = list.findIndex(i => i.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(list, oldIndex, newIndex)
    const newSortOrder = computeNewSortOrder(
      reordered[newIndex - 1]?.sort_order ?? null,
      reordered[newIndex + 1]?.sort_order ?? null,
      newIndex,
    )
    muReorderItem(listId, reordered[newIndex].id, newSortOrder)
  }

  const rowAnimFor = (id: string): 'uncheck' | undefined => (recentlyUnchecked.has(id) ? 'uncheck' : undefined)

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowImage(true)}
            disabled={isOffline}
            title={isOffline ? 'Requires a connection' : 'Import tasks from a picture'}
            aria-label="Import tasks from a picture"
            className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-30"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
            </svg>
          </button>
          {speechSupported && (
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
          )}
        </div>
      </form>

      {/* View switcher (segmented): Manual (hand-reorderable) vs By date. */}
      {undone.length > 0 && (
        <div className="flex gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5" role="radiogroup" aria-label="Sort tasks">
          {([['manual', 'Manual', 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5'],
             ['date', 'By date', 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5']] as const).map(([mode, label, icon]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={sort === mode}
              onClick={() => handleSetSort(mode)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors ${
                sort === mode
                  ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-300 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>
      )}

      {hasLoaded && undone.length === 0 && done.length === 0 && (
        <p className="task-muted text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          No tasks yet. Add one above.
        </p>
      )}

      {/* Manual view — drag to reorder. */}
      {sort === 'manual' && manualTodo.length > 0 && (
        <DndContext id="tasks-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={manualTodo.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {manualTodo.map(item => (
                <SortableTaskRow
                  key={item.id}
                  item={item}
                  people={people}
                  isNew={isNewSinceVisit(item, currentUserId, lastViewedAt)}
                  rowAnim={rowAnimFor(item.id)}
                  onToggle={rect => handleToggle(item, rect)}
                  onEdit={() => setEditing(item)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* By-date view — colored section bars, Overdue pinned on top. */}
      {sort === 'date' && dateSections.length > 0 && (
        <div className="space-y-4">
          {dateSections.map(section => (
            <section key={section.key} className="space-y-2">
              <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${SECTION_BAR[section.tone]}`}>
                <span>{section.label}</span>
                <span className="ml-auto opacity-80">{section.items.length}</span>
              </div>
              <ul className="space-y-2">
                {section.items.map(item => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    people={people}
                    isNew={isNewSinceVisit(item, currentUserId, lastViewedAt)}
                    rowAnim={rowAnimFor(item.id)}
                    onToggle={rect => handleToggle(item, rect)}
                    onEdit={() => setEditing(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
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
                onToggle={rect => handleToggle(item, rect)}
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

      {showImage && (
        <TaskImageImportModal listId={listId} onClose={() => setShowImage(false)} />
      )}

      {typeof document !== 'undefined' && ghosts.length > 0 && createPortal(
        <>
          {ghosts.map(ghost => (
            <GhostOverlay
              key={ghost.key}
              ghost={ghost}
              onDone={() => setGhosts(g => g.filter(x => x.key !== ghost.key))}
            />
          ))}
        </>,
        document.body,
      )}

      {hasDecorativeTheme(theme) && <FireworkCanvas ref={fwCanvasRef} palette={FIREWORK_PALETTES[theme]} />}
    </div>
  )
}
