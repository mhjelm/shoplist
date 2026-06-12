'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { localDB } from '@/lib/db/local'
import type { Item, List, ListTextSize, Theme } from '@/lib/types'
import { type CategorySlug } from '@/lib/categories'
import { itemToLocalItem, sortItemsByOrder, groupByCategory } from './itemHelpers'
import { touchListView, clearShoppedItems } from './actions'
import { touchListViewLocal } from '@/lib/sync/overviewLocal'
import { muUpdateItem, muDeleteItem, muBulkDelete } from '@/lib/sync/mutations'
import { hasDecorativeTheme, FIREWORK_PALETTES } from '@/lib/sl-theme'
import { isNewSinceVisit } from '@/lib/listsUnread'
import { log } from '@/lib/log'
import { useRevealFx } from '@/lib/useRevealFx'
import { useSyncState } from '@/lib/sync/engine'
import { useEditMode } from './EditModeContext'
import { useStoreMode } from './StoreModeContext'
import { useStoreModeScroll } from './useStoreModeScroll'
import { useListItemsSync } from './useListItemsSync'
import { useItemSelection } from './useItemSelection'
import { useAddItems } from './useAddItems'
import { useDragMergeReorder } from './useDragMergeReorder'
import { useItemCelebrations } from './useItemCelebrations'
import { AddItemForm } from './AddItemForm'
import { CategoryGroup } from './CategoryGroup'
import { EmptyState } from './EmptyState'
import { ShoppedSection } from './ShoppedSection'
import { ClearListControl } from './ClearListControl'
import { SelectionBar } from './SelectionBar'
import { MergeConfirmModal } from './MergeConfirmModal'
import { Lightbox } from './Lightbox'
import { EditModal } from './EditModal'
import { GhostOverlay } from './GhostOverlay'
import { FireworkCanvas } from './FireworkCanvas'
import RecipeImportModal from './RecipeImportModal'
import SpeechModal from './SpeechModal'
import TargetListModal from './TargetListModal'
import { DndContext, closestCenter } from '@dnd-kit/core'

interface Props {
  list: List
  listId: string
  suggestions: string[]
  textSize: ListTextSize
  theme: Theme
  categoryOrder: CategorySlug[]
  availableLists: Pick<List, 'id' | 'name' | 'owner_id'>[]
  currentUserId: string
  lastViewedAt: string | null
}

export default function ItemList({ list, listId, suggestions, textSize, theme, categoryOrder, availableLists, currentUserId, lastViewedAt }: Props) {
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [showRecipe, setShowRecipe] = useState(false)
  const [showSpeech, setShowSpeech] = useState(false)
  const [editMode, setEditMode] = useEditMode()
  const [storeMode, setStoreMode] = useStoreMode()

  // Item-row sizing. The 'large-store-xlarge' preference renders 'large' while
  // browsing but 'x-large' once in store mode; every other value applies the
  // same size in both modes. Store mode keeps a text-lg floor below x-large.
  const effectiveSize: 'normal' | 'large' | 'x-large' =
    textSize === 'large-store-xlarge' ? (storeMode ? 'x-large' : 'large') : textSize
  const itemTextClass = storeMode
    ? (effectiveSize === 'x-large' ? 'text-2xl' : 'text-lg')
    : (effectiveSize === 'x-large' ? 'text-xl' : effectiveSize === 'large' ? 'text-base' : 'text-sm')
  const thumbSizeClass = storeMode
    ? (effectiveSize === 'x-large' ? 'w-20 h-20' : 'w-16 h-16')
    : (effectiveSize === 'x-large' ? 'w-20 h-20' : effectiveSize === 'large' ? 'w-16 h-16' : 'w-12 h-12')
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

  useEffect(() => {
    touchListView(listId).catch(() => {})
    touchListViewLocal(listId)
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        touchListView(listId).catch(() => {})
        touchListViewLocal(listId)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      // Advance last_viewed_at past items other users added during the visit.
      // Local write makes it visible to /lists immediately; server write keeps
      // cross-device state correct. No router.refresh() — the /lists router
      // cache is intentionally preserved for instant back-nav.
      touchListView(listId).catch(() => {})
      touchListViewLocal(listId)
    }
  }, [listId])

  const { items, hasLoaded } = useListItemsSync(list, listId)
  // Restore scroll position after a store-mode reload, once the list has height.
  useStoreModeScroll({ listId, storeMode, hasLoaded })
  // Random one-of-six reveal animation once Dexie has loaded the list.
  const revealFx = useRevealFx(hasLoaded)
  const addItems = useAddItems({ listId, items, suggestions, isOffline })
  const { selectedIds, setSelectedIds, pickerMode, setPickerMode, pickerError, setPickerError, toggleSelect, handlePickTarget } = useItemSelection({ editMode, items, listId })
  const { sensors, handleDragStart, handleDragEnd, pendingMerge, setPendingMerge, handleMergeConfirm, showMergeHint } = useDragMergeReorder({ listId, items, editMode })
  const { ghosts, setGhosts, fwCanvasRef, spawnGhost } = useItemCelebrations({ itemTextClass, thumbSizeClass })

  const toShop = useMemo(() => items.filter(i => !i.is_checked).sort(sortItemsByOrder), [items])
  const shopped = useMemo(() => items.filter(i => i.is_checked).sort(sortItemsByOrder), [items])
  const groupedToShop = useMemo(() => groupByCategory(toShop, categoryOrder), [toShop, categoryOrder])

  // "NEW" dot: items another user added since this visit started. Freeze the
  // last-viewed baseline on first render so it can't move as the mount effect's
  // touchListView / realtime echoes fire during the visit (show-once semantics).
  const [baselineViewedAt] = useState(lastViewedAt)
  const newItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const i of items) {
      if (isNewSinceVisit(i, currentUserId, baselineViewedAt)) ids.add(i.id)
    }
    return ids
  }, [items, currentUserId, baselineViewedAt])

  // Entrance + undo animations: track row ids that should briefly carry a
  // data-row-anim attribute. The set self-clears after the animation duration.
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(() => new Set())
  const [recentlyUnchecked, setRecentlyUnchecked] = useState<Set<string>>(() => new Set())
  const prevIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const currentIds = new Set(items.map(i => i.id))
    // First effect run: seed prev so initial render doesn't animate every row.
    if (prevIdsRef.current === null) {
      prevIdsRef.current = currentIds
      return
    }
    const prev = prevIdsRef.current
    const now = Date.now()
    const fresh: string[] = []
    for (const item of items) {
      if (!prev.has(item.id) && !item.is_checked) {
        const age = now - new Date(item.created_at).getTime()
        if (age < 5_000 || Number.isNaN(age)) fresh.push(item.id)
      }
    }
    prevIdsRef.current = currentIds
    if (fresh.length === 0) return
    // Defer state writes to the next tick so we're not calling setState
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    const tAdd = setTimeout(() => {
      setRecentlyAdded(s => {
        const next = new Set(s); for (const id of fresh) next.add(id); return next
      })
    }, 0)
    const tClear = setTimeout(() => {
      setRecentlyAdded(s => {
        const next = new Set(s); for (const id of fresh) next.delete(id); return next
      })
    }, 700)
    return () => { clearTimeout(tAdd); clearTimeout(tClear) }
  }, [items])

  function flagRecentlyUnchecked(id: string) {
    setRecentlyUnchecked(s => { const n = new Set(s); n.add(id); return n })
    setTimeout(() => {
      setRecentlyUnchecked(s => { const n = new Set(s); n.delete(id); return n })
    }, 500)
  }

  async function handleToggle(item: Item, sourceRect?: DOMRect) {
    if (!item.is_checked && sourceRect) {
      spawnGhost(item, sourceRect)
      if (hasDecorativeTheme(theme)) {
        const cx = sourceRect.left + sourceRect.width / 2
        const cy = sourceRect.top + sourceRect.height / 2
        fwCanvasRef.current?.explode(cx, cy)
      }
    } else if (item.is_checked) {
      flagRecentlyUnchecked(item.id)
    }
    await muUpdateItem(listId, item.id, { is_checked: !item.is_checked })
  }

  async function handleDelete(item: Item) {
    await muDeleteItem(listId, item.id)
  }

  async function handleClearShopped() {
    const shoppedIds = items.filter(i => i.is_checked).map(i => i.id)
    if (shoppedIds.length === 0) return
    // Optimistic local delete.
    await localDB.items.bulkDelete(shoppedIds)
    // Direct server action — cascades to shared siblings (cross-list op, so
    // no outbox; mirrors copy/move). If it fails, pull state back via reconcile.
    const res = await clearShoppedItems(listId)
    if (res?.error) {
      const { reconcileList } = await import('@/lib/sync/reconcile')
      await reconcileList(listId)
    }
  }

  async function handleClearAll() {
    await muBulkDelete(listId, items.map(i => i.id))
  }

  async function handleMeasurementCombine(item: Item, combined: string) {
    await muUpdateItem(listId, item.id, { measurement: combined })
  }

  async function handleUpdate(item: Item, name: string, pictureUrl: string, quantity: number, category: CategorySlug, measurement: string) {
    setEditingItem(null)
    const patch: Partial<{ name: string; picture_url: string | null; quantity: number; measurement: string | null; category: CategorySlug }> = {
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
    // revealFx is one of six subtle entrance animations, chosen at random once
    // Dexie has loaded (see useRevealFx + hasLoaded); '' otherwise.
    <div className={`space-y-4${revealFx ? ' ' + revealFx : ''}`}>
      {!storeMode && (
        <AddItemForm
          {...addItems}
          isOffline={isOffline}
          onOpenRecipe={() => setShowRecipe(true)}
          onOpenSpeech={() => setShowSpeech(true)}
        />
      )}

      <DndContext id="items-dnd" sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {groupedToShop.length === 0 ? (
          // Don't flash the "empty" copy while Dexie is still hydrating on
          // first mount — only show EmptyState once we know the cache is empty.
          hasLoaded ? <EmptyState theme={theme} variant={isEmpty ? 'no-items' : 'all-shopped'} /> : null
        ) : (
          <div className="space-y-3">
            {groupedToShop.map(([cat, catItems]) => (
              <CategoryGroup
                key={cat}
                category={cat}
                items={catItems}
                itemTextClass={itemTextClass}
                thumbSizeClass={thumbSizeClass}
                editMode={editMode}
                storeMode={storeMode}
                theme={theme}
                selectedIds={selectedIds}
                recentlyAdded={recentlyAdded}
                recentlyUnchecked={recentlyUnchecked}
                newItemIds={newItemIds}
                onToggle={(item, rect) => handleToggle(item, rect)}
                onEdit={item => setEditingItem(item)}
                onDelete={item => handleDelete(item)}
                onToggleSelect={id => toggleSelect(id)}
                onPicture={item => item.picture_url && setLightboxUrl(item.picture_url)}
                onCombine={(item, combined) => handleMeasurementCombine(item, combined)}
              />
            ))}
          </div>
        )}

        {shopped.length > 0 && (
          <ShoppedSection
            shopped={shopped}
            editMode={editMode}
            storeMode={storeMode}
            theme={theme}
            itemTextClass={itemTextClass}
            thumbSizeClass={thumbSizeClass}
            selectedIds={selectedIds}
            onClearShopped={handleClearShopped}
            onToggle={(item, rect) => handleToggle(item, rect)}
            onDelete={item => handleDelete(item)}
            onToggleSelect={id => toggleSelect(id)}
            onCombine={(item, combined) => handleMeasurementCombine(item, combined)}
          />
        )}
      </DndContext>

      {showMergeHint && (
        <div role="status" className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
          <div className="merge-hint-toast pointer-events-none flex items-center gap-2 rounded-full bg-gray-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm dark:bg-gray-100/95 dark:text-gray-900">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 0 0 2 2h6m0 0-3-3m3 3-3 3" />
            </svg>
            Släpp på en annan vara för att slå ihop dem
          </div>
        </div>
      )}

      <ClearListControl
        isEmpty={isEmpty}
        storeMode={storeMode}
        onClearAll={handleClearAll}
        onToggleStore={() => setStoreMode(!storeMode)}
      />

      {editMode && selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          isOffline={isOffline}
          onCopy={() => { setPickerError(null); setPickerMode('copy') }}
          onMove={() => { setPickerError(null); setPickerMode('move') }}
          onShare={() => { setPickerError(null); setPickerMode('share') }}
          onClear={() => setSelectedIds(new Set())}
        />
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
        <MergeConfirmModal
          source={pendingMerge.source}
          target={pendingMerge.target}
          onConfirm={handleMergeConfirm}
          onCancel={() => setPendingMerge(null)}
        />
      )}

      {showRecipe && (
        <RecipeImportModal
          listId={listId}
          onClose={() => setShowRecipe(false)}
          onItemsAdded={incoming => {
            localDB.items.bulkPut(incoming.map(itemToLocalItem))
              .catch(err => log.error('idb.write_failed', { table: 'items', op: 'recipe_bulkPut', error: String(err?.message ?? err) }))
          }}
        />
      )}

      {showSpeech && (
        <SpeechModal
          listId={listId}
          items={items}
          onClose={() => setShowSpeech(false)}
        />
      )}

      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
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

      {hasDecorativeTheme(theme) && <FireworkCanvas ref={fwCanvasRef} palette={FIREWORK_PALETTES[theme]} />}
    </div>
  )
}
