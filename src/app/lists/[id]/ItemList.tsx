'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { localDB } from '@/lib/db/local'
import type { LocalItem } from '@/lib/db/types'
import type { Item, List, ListTextSize, Theme } from '@/lib/types'
import { type CategorySlug, CATEGORIES, categoryLabel } from '@/lib/categories'
import { itemToLocalItem, sortItemsByOrder, groupByCategory } from './itemHelpers'
import { slColorFor } from '@/lib/sl-theme'
import { muUpdateItem, muDeleteItem, muBulkDelete } from '@/lib/sync/mutations'
import { useSyncState } from '@/lib/sync/engine'
import { useEditMode } from './EditModeContext'
import { useStoreMode } from './StoreModeContext'
import { useListItemsSync } from './useListItemsSync'
import { useItemSelection } from './useItemSelection'
import { useAddItems } from './useAddItems'
import { useDragMergeReorder } from './useDragMergeReorder'
import { useItemCelebrations, type GhostItem } from './useItemCelebrations'
import { MeasurementBadge } from './MeasurementBadge'
import PictureInput from './PictureInput'
import RecipeImportModal from './RecipeImportModal'
import TargetListModal from './TargetListModal'
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface FWParticle {
  x: number; y: number; vx: number; vy: number
  size: number; life: number; maxLife: number
  color: string; drag: number; gravity: number; sparkle: boolean
}

const SL_COLORS = ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6']
const FW_PALETTE = [...SL_COLORS, '#ffffff']

function fwRand(min: number, max: number) { return min + Math.random() * (max - min) }
function fwPick() { return FW_PALETTE[Math.floor(Math.random() * FW_PALETTE.length)] }

interface Props {
  list: List
  initialItems: Item[]
  listId: string
  suggestions: string[]
  textSize: ListTextSize
  theme: Theme
  categoryOrder: CategorySlug[]
  availableLists: Pick<List, 'id' | 'name' | 'owner_id'>[]
  currentUserId: string
}

export default function ItemList({ list, initialItems, listId, suggestions, textSize, theme, categoryOrder, availableLists, currentUserId }: Props) {
  const itemTextClass = textSize === 'large' ? 'text-base' : 'text-sm'
  const thumbSizeClass = textSize === 'large' ? 'w-16 h-16' : 'w-12 h-12'
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showRecipe, setShowRecipe] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [editMode, setEditMode] = useEditMode()
  const [storeMode, setStoreMode] = useStoreMode()
  const { isOffline } = useSyncState()

  useEffect(() => {
    if (storeMode) {
      document.body.classList.add('store-mode')
      setEditMode(false)
    } else {
      document.body.classList.remove('store-mode')
    }
    return () => { document.body.classList.remove('store-mode') }
  }, [storeMode, setEditMode])

  useEffect(() => {
    if (!lightboxUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  const { items } = useListItemsSync(list, listId, initialItems)
  const { input, setInput, filtered, setFiltered, highlightIdx, setHighlightIdx, loading, addError, showUrlInput, setShowUrlInput, urlInput, setUrlInput, inputRef, handleInputChange, selectSuggestion, handleDeleteSuggestion, handleAdd } = useAddItems({ listId, items, suggestions, isOffline })
  const { selectedIds, setSelectedIds, pickerMode, setPickerMode, pickerError, setPickerError, toggleSelect, handlePickTarget } = useItemSelection({ editMode, items, listId })
  const { sensors, handleDragEnd, pendingMerge, setPendingMerge, handleMergeConfirm } = useDragMergeReorder({ listId, items, editMode })
  const { ghosts, setGhosts, fwCanvasRef, spawnGhost } = useItemCelebrations({ itemTextClass, thumbSizeClass })

  const toShop = useMemo(() => items.filter(i => !i.is_checked).sort(sortItemsByOrder), [items])
  const shopped = useMemo(() => items.filter(i => i.is_checked).sort(sortItemsByOrder), [items])
  const groupedToShop = useMemo(() => groupByCategory(toShop, categoryOrder), [toShop, categoryOrder])

  async function handleToggle(item: Item, sourceRect?: DOMRect) {
    if (!item.is_checked && sourceRect) {
      spawnGhost(item, sourceRect)
      if (theme === 'shoplist') {
        const cx = sourceRect.left + sourceRect.width / 2
        const cy = sourceRect.top + sourceRect.height / 2
        fwCanvasRef.current?.explode(cx, cy)
      }
    }
    await muUpdateItem(listId, item.id, { is_checked: !item.is_checked })
  }

  async function handleDelete(item: Item) {
    await muDeleteItem(listId, item.id)
  }

  async function handleClearShopped() {
    await muBulkDelete(listId, items.filter(i => i.is_checked).map(i => i.id))
  }

  async function handleClearAll() {
    await muBulkDelete(listId, items.map(i => i.id))
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
  }

  const isEmpty = toShop.length === 0 && shopped.length === 0

  return (
    <div className="space-y-4">
      {/* Add item */}
      {!storeMode && <div className="flex flex-col gap-2">
        <div className="relative">
          <div className="flex gap-2 items-stretch">
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
                placeholder="Add items…"
                autoComplete="off"
                className="block w-full h-9 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden leading-normal pr-7"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                  tabIndex={-1}
                  aria-label="Rensa"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={handleAdd}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-1.5 h-9 self-start transition-colors"
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

        <div className="flex gap-2">
          <button
            onClick={() => setShowUrlInput(v => !v)}
            disabled={isOffline}
            title={isOffline ? 'Kräver anslutning' : 'Lägg till bild'}
            className={`border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-30 ${showUrlInput ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shoplist:border-pink-300 shoplist:text-pink-500 shoplist:hover:text-pink-600'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </button>
          <button
            onClick={() => setShowRecipe(true)}
            disabled={isOffline}
            title={isOffline ? 'Kräver anslutning' : 'Importera från recept eller lista'}
            className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-30 shoplist:border-teal-300 shoplist:text-teal-500 shoplist:hover:text-teal-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
            </svg>
          </button>
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
      </div>}

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
                        storeMode={storeMode}
                        onDelete={() => handleDelete(item)}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelect(item.id)}
                        slColor={theme === 'shoplist' ? slColorFor(item.id) : undefined}
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
                      storeMode={storeMode}
                      onDelete={() => handleDelete(item)}
                      muted
                      selected={selectedIds.has(item.id)}
                      onToggleSelect={() => toggleSelect(item.id)}
                      slColor={theme === 'shoplist' ? slColorFor(item.id) : undefined}
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
                    onToggle={rect => handleToggle(item, rect)}
                    onCombine={combined => handleMeasurementCombine(item, combined)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </DndContext>

      <div className="flex justify-center items-center gap-4 pt-2">
        {!isEmpty && (confirmingClear ? (
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
        ))}
        <button
          onClick={() => setStoreMode(!storeMode)}
          className={`text-xs transition-colors ${storeMode ? 'text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
        >
          {storeMode ? 'Sluta handla' : 'Handla'}
        </button>
      </div>

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

      {theme === 'shoplist' && <FireworkCanvas ref={fwCanvasRef} />}
    </div>
  )
}

function useStoreModeSwipe({
  enabled,
  transformRef,
  onCommit,
  onTap,
}: {
  enabled: boolean
  transformRef: React.RefObject<HTMLDivElement | null>
  onCommit: () => void
  onTap: () => void
}): React.HTMLAttributes<HTMLLIElement> {
  const g = useRef({ active: false, locked: false, aborted: false, startX: 0, startY: 0, startT: 0, pid: -1, dx: 0 })

  if (!enabled) return {}

  function slide(dx: number) {
    const el = transformRef.current
    if (el) el.style.transform = dx > 0 ? `translateX(${dx}px)` : ''
  }

  function snapBack() {
    const el = transformRef.current
    if (!el) return
    el.style.transition = 'transform 180ms ease-out'
    el.style.transform = 'translateX(0)'
    setTimeout(() => { const e = transformRef.current; if (e) { e.style.transition = ''; e.style.transform = '' } }, 200)
  }

  return {
    onPointerDown(e: React.PointerEvent<HTMLLIElement>) {
      if (e.pointerType === 'mouse') return
      const s = g.current
      s.active = true; s.locked = false; s.aborted = false
      s.startX = e.clientX; s.startY = e.clientY; s.startT = e.timeStamp; s.pid = e.pointerId; s.dx = 0
    },
    onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || s.aborted || e.pointerId !== s.pid) return
      const adx = Math.abs(e.clientX - s.startX)
      const ady = Math.abs(e.clientY - s.startY)
      if (!s.locked) {
        if (ady > 6 && ady > adx) { s.aborted = true; return }
        if (adx > 6 && adx > ady) { s.locked = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }
        else return
      }
      s.dx = Math.max(0, e.clientX - s.startX)
      slide(s.dx)
    },
    onPointerUp(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || e.pointerId !== s.pid) return
      s.active = false
      const adx = Math.abs(e.clientX - s.startX)
      const ady = Math.abs(e.clientY - s.startY)
      const elapsed = e.timeStamp - s.startT
      if (!s.locked && !s.aborted && adx < 6 && ady < 6 && elapsed < 250) { onTap(); return }
      if (!s.locked || s.aborted) { snapBack(); return }
      const w = transformRef.current?.getBoundingClientRect().width ?? 300
      const velocity = elapsed > 0 ? s.dx / elapsed : 0
      if (s.dx >= w * 0.4 || (s.dx >= 60 && velocity >= 0.5)) {
        const el = transformRef.current
        if (el) { el.style.transition = 'transform 120ms ease-out'; el.style.transform = `translateX(${w}px)` }
        setTimeout(() => { slide(0); const e2 = transformRef.current; if (e2) e2.style.transition = ''; onCommit() }, 130)
      } else {
        snapBack()
      }
    },
    onPointerCancel(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || e.pointerId !== s.pid) return
      s.active = false
      snapBack()
    },
  }
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

const FireworkCanvas = forwardRef<{ explode: (x: number, y: number) => void }, object>(
  function FireworkCanvas(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const stateRef = useRef({ particles: [] as FWParticle[], rafId: 0, dpr: 1, w: 0, h: 0 })

    useEffect(() => {
      const canvas = canvasRef.current!
      const s = stateRef.current

      function resize() {
        s.dpr = Math.min(window.devicePixelRatio || 1, 2)
        s.w = window.innerWidth
        s.h = window.innerHeight
        canvas.width  = Math.floor(s.w * s.dpr)
        canvas.height = Math.floor(s.h * s.dpr)
        canvas.style.width  = `${s.w}px`
        canvas.style.height = `${s.h}px`
        canvas.getContext('2d')!.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      }
      resize()
      window.addEventListener('resize', resize)
      return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(s.rafId) }
    }, [])

    useImperativeHandle(ref, () => ({
      explode(x: number, y: number) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const s = stateRef.current
        const color = fwPick()
        const secondary = fwPick()
        for (let i = 0; i < 52; i++) {
          const angle = (Math.PI * 2 * i) / 52 + fwRand(-0.08, 0.08)
          const speed = fwRand(1.8, 6.0)
          s.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: fwRand(1.4, 3.2),
            life: fwRand(38, 62),
            maxLife: 62,
            color: Math.random() > 0.65 ? secondary : color,
            drag: fwRand(0.966, 0.980),
            gravity: fwRand(0.032, 0.068),
            sparkle: Math.random() > 0.86,
          })
        }
        if (s.rafId) return
        function loop() {
          const canvas = canvasRef.current
          if (!canvas) return
          const ctx = canvas.getContext('2d')!
          ctx.globalCompositeOperation = 'source-over'
          ctx.clearRect(0, 0, s.w, s.h)
          for (let i = s.particles.length - 1; i >= 0; i--) {
            const p = s.particles[i]
            p.x  += p.vx
            p.y  += p.vy
            p.vx *= p.drag
            p.vy  = p.vy * p.drag + p.gravity
            p.life -= 1
            const alpha = Math.max(p.life / p.maxLife, 0)
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.fillStyle   = p.color
            ctx.shadowColor = p.color
            ctx.shadowBlur  = p.sparkle ? 14 : 6
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * alpha + 0.4, 0, Math.PI * 2)
            ctx.fill()
            if (p.sparkle && Math.random() > 0.6) {
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth   = 0.9
              ctx.beginPath()
              ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y)
              ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4)
              ctx.stroke()
            }
            ctx.restore()
            if (p.life <= 0 || p.y > s.h + 24) s.particles.splice(i, 1)
          }
          if (s.particles.length > 0) {
            s.rafId = requestAnimationFrame(loop)
          } else {
            s.rafId = 0
          }
        }
        s.rafId = requestAnimationFrame(loop)
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none', display: 'block' }}
      />
    )
  }
)

export function SortableRow({
  item, itemTextClass, thumbSizeClass, onToggle, onEdit, onPicture, onCombine, editMode, storeMode, onDelete, muted, selected, onToggleSelect, slColor,
}: {
  item: Item
  itemTextClass: string
  thumbSizeClass: string
  onToggle: (rect: DOMRect) => void
  onEdit: () => void
  onPicture: () => void
  onCombine: (combined: string) => void
  editMode?: boolean
  storeMode?: boolean
  onDelete?: () => void
  muted?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  slColor?: 0 | 1 | 2 | 3
}) {
  const [showHint, setShowHint] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }, [])

  const swipeHandlers = useStoreModeSwipe({
    enabled: !!storeMode,
    transformRef: contentRef,
    onCommit: () => { const rect = contentRef.current?.getBoundingClientRect(); if (rect) onToggle(rect) },
    onTap: () => {
      setShowHint(true)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setShowHint(false), 1000)
    },
  })

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

  const rowItemTextClass = storeMode ? 'text-lg' : itemTextClass
  const rowThumbSizeClass = storeMode ? 'w-16 h-16' : thumbSizeClass

  if (storeMode) {
    return (
      <li
        ref={setNodeRef}
        style={{ ...style, touchAction: 'pan-y' }}
        className={`${bgClass} rounded-xl border overflow-hidden relative select-none`}
        data-sl-color={slColor}
        data-muted={muted ? 'true' : undefined}
        {...swipeHandlers}
      >
        {/* Green reveal layer, exposed as the content slides right */}
        <div className="absolute inset-0 flex items-center pl-5 bg-emerald-500" aria-hidden="true">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        {/* Content wrapper — slides right to reveal the green layer behind it */}
        <div
          ref={contentRef}
          className="relative flex items-center gap-3 px-4 py-3 w-full"
          style={{ background: 'inherit' }}
        >
          {item.picture_url && (
            <img
              src={item.picture_url}
              alt=""
              onError={e => { e.currentTarget.style.display = 'none' }}
              className={`${rowThumbSizeClass} rounded object-cover flex-shrink-0 ${muted ? 'opacity-60' : ''}`}
            />
          )}
          <span className={`${rowItemTextClass} flex-1 min-w-0 truncate ${nameClass}`}>{item.name}</span>
          <MeasurementBadge item={item} muted={muted} onCombine={onCombine} />
          {showHint && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30 rounded-xl">
              <span className="text-white text-sm font-medium">Svep för att bocka av</span>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={editMode ? onToggleSelect : e => onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())}
      className={`flex items-center gap-3 ${bgClass} rounded-xl border px-4 py-3 transition-colors select-none cursor-pointer`}
      data-sl-color={slColor}
      data-muted={muted ? 'true' : undefined}
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
          className={`${rowThumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0 ${muted ? 'opacity-60' : ''}`}
        />
      )}
      <span className={`${rowItemTextClass} flex-1 min-w-0 truncate ${nameClass}`}>
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

function ShoppedRow({
  item, storeMode, theme, itemTextClass, thumbSizeClass, onToggle, onCombine,
}: {
  item: Item
  storeMode: boolean
  theme: Theme
  itemTextClass: string
  thumbSizeClass: string
  onToggle: (rect: DOMRect) => void
  onCombine: (combined: string) => void
}) {
  const [showHint, setShowHint] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const liRef = useRef<HTMLLIElement>(null)
  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }, [])

  const swipeHandlers = useStoreModeSwipe({
    enabled: storeMode,
    transformRef: contentRef,
    onCommit: () => {
      const rect = contentRef.current?.getBoundingClientRect() ?? liRef.current?.getBoundingClientRect() ?? new DOMRect()
      onToggle(rect)
    },
    onTap: () => {
      setShowHint(true)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => setShowHint(false), 1000)
    },
  })

  const slColor = theme === 'shoplist' ? slColorFor(item.id) : undefined
  const thumbClass = storeMode ? 'w-16 h-16' : thumbSizeClass
  const textClass = storeMode ? 'text-lg' : itemTextClass

  if (storeMode) {
    return (
      <li
        ref={liRef}
        className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800/50 overflow-hidden relative select-none"
        style={{ touchAction: 'pan-y' }}
        data-sl-color={slColor}
        data-muted="true"
        {...swipeHandlers}
      >
        <div className="absolute inset-0 flex items-center pl-5 bg-emerald-500" aria-hidden="true">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <div
          ref={contentRef}
          className="relative flex items-center gap-3 px-4 py-3 w-full"
          style={{ background: 'inherit' }}
        >
          {item.picture_url && (
            <img src={item.picture_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }}
              className={`${thumbClass} rounded object-cover flex-shrink-0 opacity-60`} />
          )}
          <span className={`${textClass} flex-1 min-w-0 truncate text-gray-400 dark:text-gray-500`}>{item.name}</span>
          <MeasurementBadge item={item} muted onCombine={onCombine} />
          {showHint && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30 rounded-xl">
              <span className="text-white text-sm font-medium">Svep för att bocka av</span>
            </div>
          )}
        </div>
      </li>
    )
  }

  return (
    <li
      ref={liRef}
      onClick={e => onToggle((e.currentTarget as HTMLElement).getBoundingClientRect())}
      className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800/50 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors select-none cursor-pointer"
      data-sl-color={slColor}
      data-muted="true"
    >
      {item.picture_url && (
        <img src={item.picture_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }}
          className={`${thumbClass} rounded object-cover flex-shrink-0 opacity-60`} />
      )}
      <span className={`${textClass} flex-1 min-w-0 truncate text-gray-400 dark:text-gray-500`}>{item.name}</span>
      <MeasurementBadge item={item} muted onCombine={onCombine} />
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
          autoComplete="off"
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          value={measurement}
          onChange={e => setMeasurement(e.target.value)}
          placeholder="Mängd (t.ex. 500 g, 2 msk)"
          autoComplete="off"
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
