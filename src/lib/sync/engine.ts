import { useState, useEffect } from 'react'
import { localDB } from '@/lib/db/local'
import type { OutboxEntry } from '@/lib/db/types'
import type { CategorySlug } from '@/lib/categories'

// ---------------------------------------------------------------------------
// Sync state store — tiny pub/sub, no external dependency
// ---------------------------------------------------------------------------

export type ConflictItem = { id: string; name: string }

type SyncState = {
  isOffline: boolean
  pendingCount: number
  recentConflicts: ConflictItem[]
}

let syncState: SyncState = { isOffline: false, pendingCount: 0, recentConflicts: [] }
const listeners = new Set<(s: SyncState) => void>()

function setSync(partial: Partial<SyncState>) {
  syncState = { ...syncState, ...partial }
  for (const fn of listeners) fn(syncState)
}

export function useSyncState(): SyncState {
  const [state, setState] = useState(() => syncState)
  useEffect(() => {
    listeners.add(setState)
    return () => { listeners.delete(setState) }
  }, [])
  return state
}

export function addConflicts(items: ConflictItem[]) {
  setSync({ recentConflicts: [...syncState.recentConflicts, ...items] })
  const ids = new Set(items.map(i => i.id))
  setTimeout(() => {
    setSync({ recentConflicts: syncState.recentConflicts.filter(c => !ids.has(c.id)) })
  }, 30_000)
}

export function dismissConflicts() {
  setSync({ recentConflicts: [] })
}

// ---------------------------------------------------------------------------
// Outbox flush
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1_000, 5_000, 30_000, 300_000]
let isFlushing = false

async function dispatch(entry: OutboxEntry) {
  const { addItem, updateItem, setItemCategory, deleteItem, reorderItem, mergeItems } =
    await import('@/app/lists/[id]/actions')
  const p = entry.payload as Record<string, unknown>
  const listId = p.list_id as string

  switch (entry.type) {
    case 'item.insert':
      await addItem(listId, p.name as string, p.picture_url as string | undefined, p.id as string)
      break
    case 'item.update': {
      const patch = p.patch as Record<string, unknown>
      const { category, ...rest } = patch
      if (Object.keys(rest).length > 0) {
        await updateItem(p.id as string, listId, rest as Parameters<typeof updateItem>[2])
      }
      if (category !== undefined) {
        await setItemCategory(p.id as string, listId, category as CategorySlug)
      }
      break
    }
    case 'item.delete':
      await deleteItem(p.id as string, listId)
      break
    case 'item.reorder':
      await reorderItem(p.id as string, listId, p.sort_order as number)
      break
    case 'item.merge':
      await mergeItems(p.source_id as string, p.target_id as string, listId)
      break
    default:
      console.warn('[outbox] unknown type:', entry.type)
  }
}

export async function flushOutbox(): Promise<void> {
  if (isFlushing) return
  isFlushing = true

  try {
    // Reset stuck in-flight entries from a previous crash.
    await localDB.outbox.where('status').equals('in_flight').modify({ status: 'pending' })

    const pending = await localDB.outbox
      .where('status').anyOf(['pending', 'failed'])
      .sortBy('seq')

    if (pending.length === 0) {
      setSync({ isOffline: false, pendingCount: 0 })
      return
    }

    setSync({ pendingCount: pending.length })

    for (const entry of pending) {
      try {
        await localDB.outbox.update(entry.seq!, { status: 'in_flight' })
        await dispatch(entry)
        await localDB.outbox.delete(entry.seq!)
        const remaining = await localDB.outbox.where('status').anyOf(['pending', 'failed']).count()
        setSync({ isOffline: false, pendingCount: remaining })
      } catch (err) {
        await localDB.outbox.update(entry.seq!, {
          status: 'failed',
          attempts: entry.attempts + 1,
          last_error: String(err),
        })
        setSync({ isOffline: true })
        const delay = RETRY_DELAYS[Math.min(entry.attempts, RETRY_DELAYS.length - 1)]
        setTimeout(() => { isFlushing = false; flushOutbox() }, delay)
        return
      }
    }
  } finally {
    isFlushing = false
  }
}
