import { useState } from 'react'
import { localDB } from '@/lib/db/local'
import { copyItemsToList, moveItemsToList, shareItemsToList } from './actions'
import type { Item } from '@/lib/types'

export function useItemSelection({
  editMode,
  items,
  listId,
}: {
  editMode: boolean
  items: Item[]
  listId: string
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pickerMode, setPickerMode] = useState<'copy' | 'move' | 'share' | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)

  // Clear selection when leaving edit mode (render-time derived-state pattern —
  // idempotent setters so this is safe to run during render).
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
      // Direct server action — no outbox (cross-list operation; see CLAUDE.md mutation-path notes).
      const res = await moveItemsToList(listId, targetListId, ids, payload)
      if (res?.error) {
        setPickerError(res.error)
        throw new Error(res.error)
      }
      await localDB.items.bulkDelete(ids)
    } else if (mode === 'share') {
      // Sharing stamps a shared_group_id on the source row (server-side) and
      // creates a linked sibling in the target list. No local Dexie mutation
      // needed — realtime UPDATE on the source list refreshes the row's
      // shared_group_id, and the target list's own subscription/reconcile
      // surfaces the new sibling when the user navigates there.
      const res = await shareItemsToList(listId, targetListId, ids)
      if (res?.error) {
        setPickerError(res.error)
        throw new Error(res.error)
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

  return {
    selectedIds,
    setSelectedIds,
    pickerMode,
    setPickerMode,
    pickerError,
    setPickerError,
    toggleSelect,
    handlePickTarget,
  }
}
