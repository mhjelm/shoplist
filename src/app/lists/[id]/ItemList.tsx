'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import type { LocalItem } from '@/lib/db/types'
import { reconcileList } from '@/lib/sync/reconcile'
import { subscribeToList } from '@/lib/sync/realtime'
import type { Item, List, ListTextSize } from '@/lib/types'
import { type CategorySlug, CATEGORIES, categoryLabel } from '@/lib/categories'
import { addItems, copyItemsToList, deleteHistoryItem, extractAddItems, moveItemsToList } from './actions'
import { splitPlainItems } from '@/lib/parseAddInput'
import { muAddItem, muUpdateItem, muSetCategory, muDeleteItem, muBulkDelete, muReorderItem, muMergeItems } from '@/lib/sync/mutations'
import { useSyncState, setActiveList } from '@/lib/sync/engine'
import { useEditMode } from './EditModeContext'
import { MeasurementBadge } from './MeasurementBadge'
import PictureInput from './PictureInput'
import RecipeImportModal from './RecipeImportModal'
import TargetListModal from './TargetListModal'
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

interface GhostItem {
  key: string
  name: string
  picture_url: string | null
  measurement: string | null
  rect: DOMRect
  itemTextClass: string
  thumbSizeClass: string
}

interface Props {
  list: List
  initialItems: Item[]
  listId: string
  suggestions: string[]
  textSize: ListTextSize
  categoryOrder: CategorySlug[]
  availableLists: Pick<List, 'id' | 'name' | 'owner_id'>[]
  currentUserId: string
}

let ghostSeq = 0

function itemToLocalItem(item: Item): LocalItem {
  return {
    id: item.id,
    list_id: item.list_id,
    added_by: item.added_by,
    name: item.name,
    is_checked: item.is_checked,
    created_at: item.created_at,
    updated_at: item.updated_at ?? '',
    picture_url: item.picture_url,
    sort_order: item.sort_order,
    quantity: item.quantity,
    category: item.category,
    measurement: item.measurement,
  }
}

function localItemToItem(li: LocalItem): Item {
  return {
    id: li.id,
    list_id: li.list_id,
    added_by: li.added_by,
    name: li.name,
    is_checked: li.is_checked,
    created_at: li.created_at,
    picture_url: li.picture_url,
    sort_order: li.sort_order,
    quantity: li.quantity,
    category: li.category,
    measurement: li.measurement,
  }
}

export default function ItemList({ list, initialItems, listId, suggestions, textSize, categoryOrder, availableLists, currentUserId }: Props) {
  const itemTextClass = textSize === 'large' ? 'text-base' : 'text-sm'
  const thumbSizeClass = textSize === 'large' ? 'w-16 h-16' : 'w-12 h-12'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pickerMode, setPickerMode] = useState<'copy' | 'move' | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [ghosts, setGhosts] = useState<GhostItem[]>([])
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [editMode] = useEditMode()
  const { isOffline } = useSyncState()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Register this list as the active one so the SyncProvider's connectivity
  // triggers (online/visibilitychange) know which list to reconcile.
  useEffect(() => {
    setActiveList(listId)
    return () => { setActiveList(null) }
  }, [listId])

  // Seed Dexie from SSR data so the first paint is correct, then always
  // reconcile from the server. The seed is harmless if Dexie already has rows
  // for this list (bulkPut is idempotent); reconcile is the authoritative pass
  // that heals stale Dexie state after a refresh.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Cache the list row itself so /lists can show this list as "cached"
      // when offline. Done unconditionally — even a list with no items still
      // counts as cached once the user has visited it.
      await localDB.lists.put(list)
      if (initialItems.length > 0) {
        const existing = await localDB.items.where('list_id').equals(listId).count()
        if (!cancelled && existing === 0) {
          await localDB.items.bulkPut(initialItems.map(itemToLocalItem))
        }
      }
      if (cancelled) return
      reconcileList(listId).catch(err => console.error('reconcile failed:', err))
    })()
    return () => { cancelled = true }
  }, [list, listId, initialItems])

  // Subscribe to Realtime for all lists (private channels stay silent but are ready).
  // On reconnect, reconcile to catch any missed events.
  useEffect(() => {
    return subscribeToList(listId, () => { reconcileList(listId) })
  }, [listId])

  // Live reactive read from Dexie. Falls back to SSR data while IndexedDB hydrates.
  const liveItems = useLiveQuery(
    () => localDB.items.where('list_id').equals(listId).toArray(),
    [listId],
  )
  const items: Item[] = useMemo(
    () => liveItems ? liveItems.map(localItemToItem) : initialItems,
    [liveItems, initialItems],
  )

  // Refs so handleDragEnd always reads the latest values even if dnd-kit holds a stale callback.
  const editModeRef = useRef(editMode)
  const itemsRef = useRef(items)
  useEffect(() => { editModeRef.current = editMode }, [editMode])
  useEffect(() => { itemsRef.current = items }, [items])

  // Clear selection when leaving edit mode.
  const [prevEditMode, setPrevEditMode] = useState(editMode)
  if (prevEditMode !== editMode) {
    setPrevEditMode(editMode)
    if (!editMode) {
      setSelectedIds(new Set())
      setPickerMode(null)
      setPickerError(null)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

    const allItems = itemsRef.current
    const currentToShop = allItems.filter(i => !i.is_checked).sort(sortByOrder)
    const activeItem = currentToShop.find(i => i.id === active.id)
    const overItem = currentToShop.find(i => i.id === over.id)
    if (!activeItem || !overItem) return
    const activeCat = activeItem.category ?? 'ovrigt'
    const overCat = overItem.category ?? 'ovrigt'
    if (activeCat !== overCat) return

    const catItems = currentToShop.filter(i => (i.category ?? 'ovrigt') === activeCat)
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

    muReorderItem(listId, moved.id, newSortOrder)
  }

  function handleInputChange(value: string) {
    setInput(value)
    setHighlightIdx(-1)
    if (value.trim().length < 1 || /[,\n\d]/.test(value)) { setFiltered([]); return }
    const lower = value.toLowerCase()
    setFiltered(suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 6))
  }

  function selectSuggestion(name: string) {
    setInput(name)
    setFiltered([])
    inputRef.current?.focus()
  }

  function handleDeleteSuggestion(name: string) {
    setFiltered(f => f.filter(s => s !== name))
    if (!isOffline) deleteHistoryItem(name)
    inputRef.current?.focus()
  }

  async function handleAdd() {
    const raw = input.trim()
    if (!raw) return
    setAddError(null)

    const hasSplit = /[,\n]/.test(raw)
    const hasDigit = /\d/.test(raw)

    if (!hasSplit && !hasDigit) {
      // Fast path: plain single name, works offline via local outbox.
      setLoading(true)
      setInput('')
      setFiltered([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
      const pictureUrl = urlInput.trim() || undefined
      setUrlInput('')

      const lowerName = raw.toLowerCase()
      const activeMatch = items.find(i => !i.is_checked && i.name.toLowerCase() === lowerName)
      const shoppedMatch = !activeMatch ? items.find(i => i.is_checked && i.name.toLowerCase() === lowerName) : undefined
      const match = activeMatch ?? shoppedMatch

      if (match) {
        await muUpdateItem(listId, match.id, { quantity: match.quantity + 1, is_checked: false })
      } else {
        const newItem: LocalItem = {
          id: crypto.randomUUID(),
          list_id: listId,
          added_by: '',
          name: raw,
          is_checked: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          picture_url: pictureUrl ?? null,
          sort_order: null,
          quantity: 1,
          category: null,
          measurement: null,
        }
        await muAddItem(newItem)
      }
      setLoading(false)
      return
    }

    // Multi-item or digit-bearing: requires a server call.
    setLoading(true)
    setInput('')
    setFiltered([])
    if (inputRef.current) inputRef.current.style.height = 'auto'

    let itemsToAdd: Array<{ name: string; quantity?: number; measurement?: string | null; category?: string | null }>

    if (hasSplit && !hasDigit) {
      // Plain names only — route through local outbox so it works offline too.
      for (const name of splitPlainItems(raw)) {
        const lowerName = name.toLowerCase()
        const activeMatch = items.find(i => !i.is_checked && i.name.toLowerCase() === lowerName)
        const shoppedMatch = !activeMatch ? items.find(i => i.is_checked && i.name.toLowerCase() === lowerName) : undefined
        const match = activeMatch ?? shoppedMatch
        if (match) {
          await muUpdateItem(listId, match.id, { quantity: match.quantity + 1, is_checked: false })
        } else {
          await muAddItem({
            id: crypto.randomUUID(), list_id: listId, added_by: '', name,
            is_checked: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            picture_url: null, sort_order: null, quantity: 1, category: null, measurement: null,
          })
        }
      }
      setLoading(false)
      return
    } else {
      const extracted = await extractAddItems(raw)
      if (extracted.error || !extracted.items) {
        setAddError(extracted.error ?? 'Kunde inte tolka listan')
        setInput(raw)
        setLoading(false)
        return
      }
      itemsToAdd = extracted.items
    }

    if (itemsToAdd.length === 0) {
      setLoading(false)
      return
    }

    const result = await addItems(listId, itemsToAdd)
    setLoading(false)
    if (result.error) {
      setAddError(result.error)
      return
    }
    if (result.items) {
      localDB.items.bulkPut((result.items as Item[]).map(itemToLocalItem))
        .catch(err => console.error('Failed to put items in local db:', err))
    }
  }

  function spawnGhost(item: Item, rect: DOMRect) {
    const ghost: GhostItem = {
      key: `ghost-${ghostSeq++}`,
      name: item.name,
      picture_url: item.picture_url,
      measurement: item.measurement,
      rect,
      itemTextClass,
      thumbSizeClass,
    }
    setGhosts(g => [...g, ghost])
  }

  async function handleToggle(item: Item, sourceRect?: DOMRect) {
    if (!item.is_checked && sourceRect) {
      spawnGhost(item, sourceRect)
    }
    await muUpdateItem(listId, item.id, { is_checked: !item.is_checked })
  }

  async function handleDelete(item: Item) {
    await muDeleteItem(listId, item.id)
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
    await muMergeItems(listId, source.id, target.id, mergedMeasurement, mergedQuantity)
  }

  async function handleClearShopped() {
    const ids = items.filter(i => i.is_checked).map(i => i.id)
    await muBulkDelete(listId, ids)
  }

  async function handleClearAll() {
    const ids = items.map(i => i.id)
    await muBulkDelete(listId, ids)
  }

  async function handleMeasurementCombine(item: Item, combined: string) {
    await muUpdateItem(listId, item.id, { measurement: combined })
  }

  async function handleUpdate(item: Item, name: string, pictureUrl: string, quantity: number, category: CategorySlug, measurement: string) {
    setEditingItem(null)
    const patch: Partial<LocalItem> = {
      name: name.trim() || item.name,
      picture_url: pictureUrl.trim() || null,
      quantity: Math.max(1, quantity),
      measurement: measurement.trim() || null,
    }
    if (category !== item.category) patch.category = category
    await muUpdateItem(listId, item.id, patch)
    if (category !== item.category) {
      await muSetCategory(listId, item.id, category)
    }
  }

  async function handlePickTarget(targetListId: string) {
    const mode = pickerMode
    if (!mode || selectedIds.size === 0) return
    const ids = [...selectedIds]
    const selectedItems = items.filter(i => selectedIds.has(i.id))
    const payload = selectedItems.map(i => ({
      name: i.name,
      picture_url: i.picture_url,
      quantity: i.quantity,
      category: i.category,
      measurement: i.measurement,
    }))

    setPickerError(null)
    if (mode === 'move') {
      await muBulkDelete(listId, ids)
      try {
        const res = await moveItemsToList(listId, targetListId, ids, payload)
        if (res?.error) {
          await localDB.items.bulkPut(selectedItems.map(itemToLocalItem))
          setPickerError(res.error)
          throw new Error(res.error)
        }
      } catch (e) {
        // Restore items on network throw (res?.error path re-throws, caught here too — bulkPut is idempotent).
        await localDB.items.bulkPut(selectedItems.map(itemToLocalItem))
        throw e
      }
    } else {
      const res = await copyItemsToList(targetListId, payload)
      if (res?.error) {
        setPickerError(res.error)
        throw new Error(res.error)
      }
    }
    setSelectedIds(new Set())
    setPickerMode(null)
  }

  const isEmpty = toShop.length === 0 && shopped.length === 0

  return (
    <div className="space-y-4">
      {/* Add item */}
      <div className="space-y-2">
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={e => {
                  handleInputChange(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown' && !e.shiftKey) { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)) }
                  else if (e.key === 'ArrowUp' && !e.shiftKey) { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, -1)) }
                  else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (highlightIdx >= 0 && filtered[highlightIdx]) selectSuggestion(filtered[highlightIdx])
                    else handleAdd()
                  }
                  else if (e.key === 'Escape') setFiltered([])
                }}
                placeholder="Add an item…"
                className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden leading-normal pr-7"
              />
              {input && (
                <button
                  onMouseDown={e => {
                    e.preventDefault()
                    setInput('')
                    setFiltered([])
                    if (inputRef.current) inputRef.current.style.height = 'auto'
                    inputRef.current?.focus()
                  }}
                  className="absolute right-2 top-2 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                  tabIndex={-1}
                  aria-label="Rensa"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={() => setShowUrlInput(v => !v)}
              disabled={isOffline}
              title={isOffline ? 'Kräver anslutning' : 'Lägg till bild'}
              className={`border rounded-lg px-3 transition-colors disabled:opacity-30 ${showUrlInput ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </button>
            <button
              onClick={() => setShowRecipe(true)}
              disabled={isOffline}
              title={isOffline ? 'Kräver anslutning' : 'Importera från recept eller lista'}
              className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-30"
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
                  className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${idx === highlightIdx ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  <span className="flex-1">{s}</span>
                  <button
                    onMouseDown={e => { e.stopPropagation(); handleDeleteSuggestion(s) }}
                    className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors flex-shrink-0"
                    tabIndex={-1}
                    aria-label={`Ta bort ${s} från historik`}
                  >
                    ×
                  </button>
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

        {addError && (
          <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>
        )}
      </div>

      <DndContext id="items-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                        onToggle={(rect) => handleToggle(item, rect)}
                        onEdit={() => setEditingItem(item)}
                        onPicture={() => item.picture_url && setLightboxUrl(item.picture_url)}
                        onCombine={combined => handleMeasurementCombine(item, combined)}
                        editMode={editMode}
                        onDelete={() => handleDelete(item)}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
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
                      onToggle={(rect) => handleToggle(item, rect)}
                      onEdit={() => {}}
                      onPicture={() => item.picture_url && setLightboxUrl(item.picture_url)}
                      onCombine={combined => handleMeasurementCombine(item, combined)}
                      editMode={editMode}
                      onDelete={() => handleDelete(item)}
                      muted
                      selected={selectedIds.has(item.id)}
                      onToggleSelect={() => toggleSelect(item.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            ) : (
              <ul className="space-y-1">
                {shopped.map(item => (
                  <li
                    key={item.id}
                    onClick={e => handleToggle(item, (e.currentTarget as HTMLElement).getBoundingClientRect())}
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
          {confirmingClear ? (
            <div className="flex items-center gap-3">
              <button
                onClick={async () => { await handleClearAll(); setConfirmingClear(false) }}
                className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
              >
                Clear
              </button>
              <button
                onClick={() => setConfirmingClear(false)}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              className="text-xs text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors"
            >
              Clear list
            </button>
          )}
        </div>
      )}

      {editMode && selectedIds.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 pt-3 flex items-center gap-2 shadow-lg"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 min-w-0">{selectedIds.size} valda</span>
          <button
            onClick={() => { setPickerError(null); setPickerMode('copy') }}
            disabled={isOffline}
            title={isOffline ? 'Kräver anslutning' : undefined}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Kopiera till…
          </button>
          <button
            onClick={() => { setPickerError(null); setPickerMode('move') }}
            disabled={isOffline}
            title={isOffline ? 'Kräver anslutning' : undefined}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40"
          >
            Flytta till…
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            aria-label="Avmarkera alla"
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>
      )}

      {pickerError && !pickerMode && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white text-xs px-3 py-2 rounded-lg shadow-lg">
          {pickerError}
        </div>
      )}

      {pickerMode && (
        <TargetListModal
          mode={pickerMode}
          availableLists={availableLists}
          currentUserId={currentUserId}
          onPick={handlePickTarget}
          onClose={() => { setPickerMode(null); setPickerError(null) }}
        />
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
          onItemsAdded={incoming => {
            localDB.items.bulkPut(incoming.map(itemToLocalItem))
              .catch(err => console.error('Failed to put recipe items in local db:', err))
          }}
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
        document.body
      )}
    </div>
  )
}

function GhostOverlay({ ghost, onDone }: { ghost: GhostItem; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const anim = el.animate(
      [
        { opacity: 0.75, transform: 'translateY(0px)' },
        { opacity: 0, transform: 'translateY(36px)' },
      ],
      { duration: 450, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'forwards' },
    )
    anim.onfinish = onDone
    return () => { anim.cancel() }
  // Animation runs exactly once on mount; onDone captured at mount is correct for this ghost's lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3"
      style={{
        position: 'fixed',
        top: ghost.rect.top,
        left: ghost.rect.left,
        width: ghost.rect.width,
        height: ghost.rect.height,
        pointerEvents: 'none',
        zIndex: 60,
        overflow: 'hidden',
        opacity: 0,
      }}
    >
      {ghost.picture_url && (
        <img
          src={ghost.picture_url}
          alt=""
          className={`${ghost.thumbSizeClass} rounded object-cover flex-shrink-0`}
        />
      )}
      <span className={`${ghost.itemTextClass} flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200`}>
        {ghost.name}
      </span>
      {ghost.measurement && (
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{ghost.measurement}</span>
      )}
    </div>
  )
}

function SortableRow({
  item, itemTextClass, thumbSizeClass, onToggle, onEdit, onPicture, onCombine, editMode, onDelete, muted, selected, onToggleSelect,
}: {
  item: Item
  itemTextClass: string
  thumbSizeClass: string
  onToggle: (rect: DOMRect) => void
  onEdit: () => void
  onPicture: () => void
  onCombine: (combined: string) => void
  editMode?: boolean
  onDelete?: () => void
  muted?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={editMode ? onToggleSelect : e => onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())}
      className={`flex items-center gap-3 ${bgClass} rounded-xl border px-4 py-3 transition-colors select-none cursor-pointer`}
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
