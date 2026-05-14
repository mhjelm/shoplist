'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Item, ListTextSize } from '@/lib/types'
import { type CategorySlug, CATEGORIES, categoryLabel } from '@/lib/categories'
import { addItem, categorizeItem, clearAllItems, clearShoppedItems, deleteItem, mergeItems, reorderItem, setItemCategory, toggleItem, updateItem } from './actions'
import { useEditMode } from './EditModeContext'
import { MeasurementBadge } from './MeasurementBadge'
import PictureInput from './PictureInput'
import RecipeImportModal from './RecipeImportModal'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  initialItems: Item[]
  listId: string
  isShared: boolean
  suggestions: string[]
  textSize: ListTextSize
  categoryOrder: CategorySlug[]
}

export default function ItemList({ initialItems, listId, isShared, suggestions, textSize, categoryOrder }: Props) {
  const itemTextClass = textSize === 'large' ? 'text-base' : 'text-sm'
  const thumbSizeClass = textSize === 'large' ? 'w-16 h-16' : 'w-12 h-12'
  const [items, setItems] = useState<Item[]>(initialItems)
  const [input, setInput] = useState('')
  const [filtered, setFiltered] = useState<string[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showRecipe, setShowRecipe] = useState(false)
  const [pendingMerge, setPendingMerge] = useState<{ source: Item; target: Item } | null>(null)
  const [editMode] = useEditMode()
  const inputRef = useRef<HTMLInputElement>(null)
  // Refs so handleDragEnd always reads the latest values even if dnd-kit holds a stale callback.
  const editModeRef = useRef(editMode)
  const itemsRef = useRef(items)
  useEffect(() => { editModeRef.current = editMode }, [editMode])
  useEffect(() => { itemsRef.current = items }, [items])

  useEffect(() => {
    if (!isShared) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      console.log('[realtime] session user:', session?.user?.id ?? '(none)')
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token)
      }

      channel = supabase
        .channel(`list-${listId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          (payload) => {
            console.log('[realtime] event:', payload.eventType, payload)
            if (payload.eventType === 'INSERT') {
              const incoming = payload.new as Item
              setItems(prev => {
                if (prev.some(i => i.id === incoming.id)) return prev
                const optIdx = prev.findIndex(i => i.added_by === '' && i.name === incoming.name)
                if (optIdx >= 0) {
                  const next = [...prev]
                  next[optIdx] = incoming
                  return next
                }
                return [...prev, incoming]
              })
            } else if (payload.eventType === 'UPDATE') {
              setItems(prev => prev.map(i => i.id === (payload.new as Item).id ? payload.new as Item : i))
            } else if (payload.eventType === 'DELETE') {
              setItems(prev => prev.filter(i => i.id !== (payload.old as Item).id))
            }
          })
        .subscribe((status, err) => {
          if (err) console.error('[realtime] subscribe error', err)
          else console.log('[realtime] status:', status)
        })
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [listId, isShared])

  useEffect(() => {
    if (!lightboxUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  useEffect(() => {
    if (!pendingMerge) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPendingMerge(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingMerge])

  const sortByOrder = (a: Item, b: Item) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
  const toShop = useMemo(() => items.filter(i => !i.is_checked).sort(sortByOrder), [items])
  const shopped = useMemo(() => items.filter(i => i.is_checked).sort(sortByOrder), [items])

  const groupedToShop = useMemo(() => {
    const groups = new Map<CategorySlug, Item[]>(categoryOrder.map(c => [c, []]))
    if (!groups.has('ovrigt')) groups.set('ovrigt', [])
    for (const item of toShop) {
      const cat = (item.category as CategorySlug | null) ?? 'ovrigt'
      const target = groups.get(cat) ?? groups.get('ovrigt')!
      target.push(item)
    }
    return [...groups.entries()].filter(([, its]) => its.length > 0)
  }, [toShop, categoryOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    if (editModeRef.current) {
      const activeItem = itemsRef.current.find(i => i.id === active.id)
      const overItem = itemsRef.current.find(i => i.id === over.id)
      if (activeItem && overItem) {
        setPendingMerge({ source: activeItem, target: overItem })
      }
      return
    }

    const activeItem = toShop.find(i => i.id === active.id)
    const overItem = toShop.find(i => i.id === over.id)
    if (!activeItem || !overItem) return
    const activeCat = activeItem.category ?? 'ovrigt'
    const overCat = overItem.category ?? 'ovrigt'
    if (activeCat !== overCat) return

    const catItems = toShop.filter(i => (i.category ?? 'ovrigt') === activeCat)
    const oldIndex = catItems.findIndex(i => i.id === active.id)
    const newIndex = catItems.findIndex(i => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(catItems, oldIndex, newIndex)
    const moved = reordered[newIndex]
    const before = reordered[newIndex - 1]
    const after = reordered[newIndex + 1]
    let newSortOrder: number
    if (!before) newSortOrder = (after?.sort_order ?? 1) - 1
    else if (!after) newSortOrder = (before.sort_order ?? 0) + 1
    else newSortOrder = ((before.sort_order ?? 0) + (after.sort_order ?? 0)) / 2
    setItems(prev => prev.map(i => i.id === moved.id ? { ...i, sort_order: newSortOrder } : i))
    reorderItem(moved.id, listId, newSortOrder)
  }

  function handleInputChange(value: string) {
    setInput(value)
    setHighlightIdx(-1)
    if (value.trim().length < 1) { setFiltered([]); return }
    const lower = value.toLowerCase()
    setFiltered(suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 6))
  }

  function selectSuggestion(name: string) {
    setInput(name)
    setFiltered([])
    inputRef.current?.focus()
  }

  async function handleAdd() {
    const name = input.trim()
    if (!name) return
    setLoading(true)
    setInput('')
    setFiltered([])
    const pictureUrl = urlInput.trim() || undefined
    setUrlInput('')

    const lowerName = name.toLowerCase()
    const activeMatch = items.find(i => !i.is_checked && i.name.toLowerCase() === lowerName)
    const shoppedMatch = !activeMatch ? items.find(i => i.is_checked && i.name.toLowerCase() === lowerName) : undefined
    const match = activeMatch ?? shoppedMatch

    if (match) {
      setItems(prev => prev.map(i => i.id === match.id
        ? { ...i, quantity: i.quantity + 1, is_checked: false }
        : i
      ))
      const result = await addItem(listId, name, pictureUrl)
      if (result?.error) {
        setItems(prev => prev.map(i => i.id === match.id ? match : i))
      } else if (result?.item) {
        const real = result.item as Item
        setItems(prev => prev.map(i => i.id === real.id ? real : i))
      }
    } else {
      const tempId = crypto.randomUUID()
      const optimistic: Item = {
        id: tempId,
        list_id: listId,
        added_by: '',
        name,
        is_checked: false,
        created_at: new Date().toISOString(),
        picture_url: pictureUrl ?? null,
        sort_order: null,
        quantity: 1,
        category: null,
        measurement: null,
      }
      setItems(prev => [...prev, optimistic])
      const result = await addItem(listId, name, pictureUrl)
      if (result?.error) {
        setItems(prev => prev.filter(i => i.id !== tempId))
      } else if (result?.item) {
        const real = result.item as Item
        setItems(prev => {
          if (prev.some(i => i.id === real.id)) return prev.filter(i => i.id !== tempId)
          return prev.map(i => i.id === tempId ? real : i)
        })
        if (!real.category && !result.merged) {
          categorizeItem(real.id).then(r => {
            if (r?.category) {
              setItems(prev => prev.map(i => i.id === real.id ? { ...i, category: r.category! } : i))
            }
          })
        }
      }
    }

    setLoading(false)
  }

  async function handleToggle(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: !i.is_checked } : i))
    await toggleItem(item.id, listId, !item.is_checked)
  }

  async function handleDelete(item: Item) {
    const snapshot = [...items]
    setItems(prev => prev.filter(i => i.id !== item.id))
    const result = await deleteItem(item.id, listId)
    if (result?.error) setItems(snapshot)
  }

  async function handleMergeConfirm() {
    if (!pendingMerge) return
    const { source, target } = pendingMerge
    setPendingMerge(null)

    const mergedMeasurement =
      [target.measurement, source.measurement]
        .filter((m): m is string => !!m && m.trim().length > 0)
        .join(' + ') || null
    const mergedQuantity = target.quantity + source.quantity

    const snapshot = [...items]
    setItems(prev =>
      prev
        .filter(i => i.id !== source.id)
        .map(i => i.id === target.id ? { ...i, measurement: mergedMeasurement, quantity: mergedQuantity } : i)
    )

    const result = await mergeItems(source.id, target.id, listId)
    if (result?.error) setItems(snapshot)
  }

  async function handleClearShopped() {
    setItems(prev => prev.filter(i => !i.is_checked))
    await clearShoppedItems(listId)
  }

  async function handleClearAll() {
    setItems([])
    await clearAllItems(listId)
  }

  async function handleMeasurementCombine(item: Item, combined: string) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, measurement: combined } : i))
    const result = await updateItem(item.id, listId, { measurement: combined })
    if (result?.error) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
    }
  }

  async function handleUpdate(item: Item, name: string, pictureUrl: string, quantity: number, category: CategorySlug, measurement: string) {
    const patch = {
      name: name.trim() || item.name,
      picture_url: pictureUrl.trim() || null,
      quantity: Math.max(1, quantity),
      measurement: measurement.trim() || null,
    }
    setEditingItem(null)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch, category } : i))
    const ops: Promise<unknown>[] = [updateItem(item.id, listId, patch)]
    if (category !== item.category) ops.push(setItemCategory(item.id, listId, category))
    const [updateResult] = await Promise.all(ops) as [{ error?: string } | undefined]
    if (updateResult?.error) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
    }
  }

  const isEmpty = toShop.length === 0 && shopped.length === 0

  return (
    <div className="space-y-4">
      {/* Add item */}
      <div className="space-y-2">
        <div className="relative">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, -1)) }
                else if (e.key === 'Enter') {
                  if (highlightIdx >= 0 && filtered[highlightIdx]) selectSuggestion(filtered[highlightIdx])
                  else handleAdd()
                }
                else if (e.key === 'Escape') setFiltered([])
              }}
              placeholder="Add an item…"
              className="flex-1 min-w-0 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => setShowUrlInput(v => !v)}
              title="Lägg till bild"
              className={`border rounded-lg px-3 transition-colors ${showUrlInput ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </button>
            <button
              onClick={() => setShowRecipe(true)}
              title="Importera från recept"
              className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
              </svg>
            </button>
            <button
              onClick={handleAdd}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 transition-colors"
            >
              Add
            </button>
          </div>

          {filtered.length > 0 && (
            <ul className="absolute z-10 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md overflow-hidden">
              {filtered.map((s, idx) => (
                <li
                  key={s}
                  onMouseDown={() => selectSuggestion(s)}
                  className={`px-3 py-2 text-sm cursor-pointer ${idx === highlightIdx ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {showUrlInput && (
          <PictureInput
            value={urlInput}
            onChange={setUrlInput}
            onSuggestName={name => setInput(prev => prev.trim() ? prev : name)}
          />
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {/* Items to shop, grouped by category */}
        {groupedToShop.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            {isEmpty ? 'No items yet.' : 'Everything shopped'}
          </p>
        ) : (
          <div className="space-y-3">
            {groupedToShop.map(([cat, catItems]) => (
              <div key={cat}>
                <div className="px-1 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {categoryLabel(cat)}
                  </span>
                </div>
                <SortableContext items={catItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1">
                    {catItems.map(item => (
                      <SortableRow
                        key={item.id}
                        item={item}
                        itemTextClass={itemTextClass}
                        thumbSizeClass={thumbSizeClass}
                        onToggle={() => handleToggle(item)}
                        onEdit={() => setEditingItem(item)}
                        onPicture={() => item.picture_url && setLightboxUrl(item.picture_url)}
                        onCombine={combined => handleMeasurementCombine(item, combined)}
                        editMode={editMode}
                        onDelete={() => handleDelete(item)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </div>
            ))}
          </div>
        )}

        {/* Shopped */}
        {shopped.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Shopped</span>
              <button
                onClick={handleClearShopped}
                className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
                aria-label="Clear shopped items"
              >
                ×
              </button>
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
                      onToggle={() => handleToggle(item)}
                      onEdit={() => {}}
                      onPicture={() => item.picture_url && setLightboxUrl(item.picture_url)}
                      onCombine={combined => handleMeasurementCombine(item, combined)}
                      editMode={editMode}
                      onDelete={() => handleDelete(item)}
                      muted
                    />
                  ))}
                </ul>
              </SortableContext>
            ) : (
              <ul className="space-y-1">
                {shopped.map(item => (
                  <li
                    key={item.id}
                    onClick={() => handleToggle(item)}
                    className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800/50 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors select-none cursor-pointer"
                  >
                    {item.picture_url && (
                      <img
                        src={item.picture_url}
                        alt=""
                        onError={e => { e.currentTarget.style.display = 'none' }}
                        className={`${thumbSizeClass} rounded object-cover flex-shrink-0 opacity-60`}
                      />
                    )}
                    <span className={`${itemTextClass} flex-1 min-w-0 truncate text-gray-400 dark:text-gray-500`}>
                      {item.name}
                    </span>
                    <MeasurementBadge item={item} muted onCombine={combined => handleMeasurementCombine(item, combined)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DndContext>

      {!isEmpty && (
        <div className="flex justify-center pt-2">
          <button
            onClick={handleClearAll}
            className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors"
          >
            Clear list
          </button>
        </div>
      )}

      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={(name, pictureUrl, quantity, category, measurement) => handleUpdate(editingItem, name, pictureUrl, quantity, category, measurement)}
          onClose={() => setEditingItem(null)}
        />
      )}

      {pendingMerge && (
        <div
          onClick={() => setPendingMerge(null)}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-sm space-y-4 shadow-xl"
          >
            <p className="text-sm text-gray-800 dark:text-gray-200">
              Slå ihop <span className="font-semibold">&ldquo;{pendingMerge.source.name}&rdquo;</span> och <span className="font-semibold">&ldquo;{pendingMerge.target.name}&rdquo;</span>?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingMerge(null)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={handleMergeConfirm}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
              >
                Slå ihop
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecipe && (
        <RecipeImportModal
          listId={listId}
          onClose={() => setShowRecipe(false)}
          onItemsAdded={incoming => setItems(prev => {
            const map = new Map(prev.map(i => [i.id, i] as const))
            for (const it of incoming) map.set(it.id, it)
            return Array.from(map.values())
          })}
        />
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <img
            src={lightboxUrl}
            alt=""
            onClick={() => setLightboxUrl(null)}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}

function SortableRow({
  item, itemTextClass, thumbSizeClass, onToggle, onEdit, onPicture, onCombine, editMode, onDelete, muted,
}: {
  item: Item
  itemTextClass: string
  thumbSizeClass: string
  onToggle: () => void
  onEdit: () => void
  onPicture: () => void
  onCombine: (combined: string) => void
  editMode?: boolean
  onDelete?: () => void
  muted?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: item.id })
  const style = {
    // Suppress sort-preview animation in edit mode so items don't visually shuffle while dragging.
    transform: editMode ? undefined : CSS.Transform.toString(transform),
    transition: editMode ? undefined : transition,
    opacity: isDragging ? 0.4 : undefined,
  }

  const mergeTarget = editMode && isOver && !isDragging

  const bgClass = mergeTarget
    ? 'bg-blue-100 dark:bg-blue-950/60 border-blue-400 dark:border-blue-500'
    : editMode
      ? muted
        ? 'bg-rose-50/40 dark:bg-blue-950/35 border-rose-200/70 dark:border-blue-800/50'
        : 'bg-rose-50/60 dark:bg-blue-950/60 border-rose-200 dark:border-blue-700/70'
      : muted
        ? 'bg-gray-50 dark:bg-gray-900/50 border-gray-100 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/50'
        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
  const nameClass = mergeTarget
    ? 'text-blue-800 dark:text-blue-200 font-medium'
    : muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={editMode ? undefined : onToggle}
      className={`flex items-center gap-3 ${bgClass} rounded-xl border px-4 py-3 transition-colors select-none ${editMode ? 'cursor-default' : 'cursor-pointer'}`}
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
          className={`${thumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0 ${muted ? 'opacity-60' : ''}`}
        />
      )}
      <span className={`${itemTextClass} flex-1 min-w-0 truncate ${nameClass}`}>
        {item.name}
      </span>
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

function EditModal({ item, onSave, onClose }: {
  item: Item
  onSave: (name: string, pictureUrl: string, quantity: number, category: CategorySlug, measurement: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [pictureUrl, setPictureUrl] = useState(item.picture_url ?? '')
  const [quantity, setQuantity] = useState(item.quantity)
  const [category, setCategory] = useState<CategorySlug>(item.category ?? 'ovrigt')
  const [measurement, setMeasurement] = useState(item.measurement ?? '')

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
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Edit item</h2>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Item name"
          autoFocus
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={measurement}
          onChange={e => setMeasurement(e.target.value)}
          placeholder="Mängd (t.ex. 500 g, 2 msk)"
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Quantity</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-7 h-7 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-base leading-none"
            >
              −
            </button>
            <span className="w-8 text-center text-sm text-gray-800 dark:text-gray-200">{quantity}</span>
            <button
              onClick={() => setQuantity(q => q + 1)}
              className="w-7 h-7 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-base leading-none"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Kategori</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as CategorySlug)}
            className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map(c => (
              <option key={c.slug} value={c.slug}>{c.label}</option>
            ))}
          </select>
        </div>
        <PictureInput value={pictureUrl} onChange={setPictureUrl} />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(name, pictureUrl, quantity, category, measurement)}
            disabled={!name.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

