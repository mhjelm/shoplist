import { useEffect, useRef, useState } from 'react'
import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { muMergeItems, muReorderItem } from '@/lib/sync/mutations'
import { computeNewSortOrder } from '@/lib/itemListHelpers'
import { buildMergePatch, sortItemsByOrder } from './itemHelpers'
import type { Item } from '@/lib/types'

export function useDragMergeReorder({
  listId,
  items,
  editMode,
}: {
  listId: string
  items: Item[]
  editMode: boolean
}) {
  const [pendingMerge, setPendingMerge] = useState<{ source: Item; target: Item } | null>(null)

  // Refs so handleDragEnd always reads the latest values even when dnd-kit
  // holds a stale callback (see CLAUDE.md "Edit mode" notes).
  const editModeRef = useRef(editMode)
  const itemsRef = useRef(items)
  useEffect(() => { editModeRef.current = editMode }, [editMode])
  useEffect(() => { itemsRef.current = items }, [items])

  useEffect(() => {
    if (!pendingMerge) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPendingMerge(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingMerge])

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
    const currentToShop = allItems.filter(i => !i.is_checked).sort(sortItemsByOrder)
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
    const newSortOrder = computeNewSortOrder(
      before?.sort_order ?? null,
      after?.sort_order ?? null,
      newIndex,
    )
    muReorderItem(listId, moved.id, newSortOrder)
  }

  async function handleMergeConfirm() {
    if (!pendingMerge) return
    const { source, target } = pendingMerge
    setPendingMerge(null)
    const { measurement: mergedMeasurement, quantity: mergedQuantity } = buildMergePatch(source, target)
    await muMergeItems(listId, source.id, target.id, mergedMeasurement, mergedQuantity)
  }

  return { sensors, handleDragEnd, pendingMerge, setPendingMerge, handleMergeConfirm }
}
