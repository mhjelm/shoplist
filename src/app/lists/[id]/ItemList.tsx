'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { localDB } from '@/lib/db/local'
import type { Item, List, ListTextSize, Theme } from '@/lib/types'
import { type CategorySlug } from '@/lib/categories'
import { itemToLocalItem, sortItemsByOrder, groupByCategory } from './itemHelpers'
import { muUpdateItem, muDeleteItem, muBulkDelete } from '@/lib/sync/mutations'
import { useSyncState } from '@/lib/sync/engine'
import { useEditMode } from './EditModeContext'
import { useStoreMode } from './StoreModeContext'
import { useListItemsSync } from './useListItemsSync'
import { useItemSelection } from './useItemSelection'
import { useAddItems } from './useAddItems'
import { useDragMergeReorder } from './useDragMergeReorder'
import { useItemCelebrations } from './useItemCelebrations'
import { AddItemForm } from './AddItemForm'
import { CategoryGroup } from './CategoryGroup'
import { ShoppedSection } from './ShoppedSection'
import { ClearListControl } from './ClearListControl'
import { SelectionBar } from './SelectionBar'
import { MergeConfirmModal } from './MergeConfirmModal'
import { Lightbox } from './Lightbox'
import { EditModal } from './EditModal'
import { GhostOverlay } from './GhostOverlay'
import { FireworkCanvas } from './FireworkCanvas'
import RecipeImportModal from './RecipeImportModal'
import TargetListModal from './TargetListModal'
import { DndContext, closestCenter } from '@dnd-kit/core'

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
  const addItems = useAddItems({ listId, items, suggestions, isOffline })
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
    <div className="space-y-4">
      {!storeMode && (
        <AddItemForm
          {...addItems}
          isOffline={isOffline}
          onOpenRecipe={() => setShowRecipe(true)}
        />
      )}

      <DndContext id="items-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {groupedToShop.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            {isEmpty ? 'No items yet.' : 'Everything shopped'}
          </p>
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
              .catch(err => console.error('Failed to put recipe items in local db:', err))
          }}
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

      {theme === 'shoplist' && <FireworkCanvas ref={fwCanvasRef} />}
    </div>
  )
}
