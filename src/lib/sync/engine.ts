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

function initialOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

let syncState: SyncState = { isOffline: initialOffline(), pendingCount: 0, recentConflicts: [] }
const listeners = new Set<(s: SyncState) => void>()

function setSync(partial: Partial<SyncState>) {
  syncState = { ...syncState, ...partial }
  for (const fn of listeners) fn(syncState)
}

export function useSyncState(): SyncState {
  const [state, setState] = useState(() => syncState)
  useEffect(() => {
    listeners.add(setState)
    // Snap to current state on mount — initialOffline may have been wrong at
    // module-load (SSR) and the real navigator.onLine is only safe to read here.
    if (typeof navigator !== 'undefined' && navigator.onLine === false && !syncState.isOffline) {
      setSync({ isOffline: true })
    }
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
// Connectivity signals
// ---------------------------------------------------------------------------

export function markOffline() {
  setSync({ isOffline: true })
}

// Don't optimistically declare "online" if the browser still says we're offline
// — wait for the actual `online` event (or a successful dispatch) before
// clearing the flag.
export function markOnlineIfBrowserAgrees() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  setSync({ isOffline: false })
}

// ---------------------------------------------------------------------------
// Active-list registration — so connectivity triggers (in SyncProvider) know
// which list to reconcile. The list-page Client Component registers itself on
// mount and unregisters on unmount.
// ---------------------------------------------------------------------------

let activeListId: string | null = null

export function setActiveList(id: string | null) {
  activeListId = id
}

export function getActiveList(): string | null {
  return activeListId
}

// ---------------------------------------------------------------------------
// Outbox flush
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [1_000, 5_000, 30_000, 300_000]
let isFlushing = false

function check(result: { error?: string } | undefined | void) {
  if (result && 'error' in result && result.error) {
    throw new Error(result.error)
  }
}

async function dispatch(entry: OutboxEntry) {
  const { addItem, updateItem, setItemCategory, deleteItem, reorderItem, mergeItems } =
    await import('@/app/lists/[id]/actions')
  const p = entry.payload as Record<string, unknown>
  const listId = p.list_id as string

  switch (entry.type) {
    case 'item.insert':
      check(await addItem(listId, p.name as string, p.picture_url as string | undefined, p.id as string))
      break
    case 'item.update': {
      const patch = p.patch as Record<string, unknown>
      const { category, ...rest } = patch
      if (Object.keys(rest).length > 0) {
        check(await updateItem(p.id as string, listId, rest as Parameters<typeof updateItem>[2]))
      }
      if (category !== undefined) {
        check(await setItemCategory(p.id as string, listId, category as CategorySlug))
      }
      break
    }
    case 'item.delete':
      check(await deleteItem(p.id as string, listId))
      break
    case 'item.reorder':
      check(await reorderItem(p.id as string, listId, p.sort_order as number))
      break
    case 'item.merge':
      check(await mergeItems(p.source_id as string, p.target_id as string, listId))
      break
    default:
      throw new Error(`[outbox] unknown type: ${entry.type}`)
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
      setSync({ pendingCount: 0 })
      markOnlineIfBrowserAgrees()
      return
    }

    setSync({ pendingCount: pending.length })

    for (const entry of pending) {
      try {
        await localDB.outbox.update(entry.seq!, { status: 'in_flight' })
        await dispatch(entry)
        await localDB.outbox.delete(entry.seq!)
        const remaining = await localDB.outbox.where('status').anyOf(['pending', 'failed']).count()
        setSync({ pendingCount: remaining })
        markOnlineIfBrowserAgrees()
      } catch (err) {
        await localDB.outbox.update(entry.seq!, {
          status: 'failed',
          attempts: entry.attempts + 1,
          last_error: String(err),
        })
        markOffline()
        const delay = RETRY_DELAYS[Math.min(entry.attempts, RETRY_DELAYS.length - 1)]
        setTimeout(() => { isFlushing = false; flushOutbox() }, delay)
        return
      }
    }
  } finally {
    isFlushing = false
  }
}

// ---------------------------------------------------------------------------
// triggerSync — the single ordered entrypoint for connectivity events. Always
// drains the outbox first, *then* reconciles the active list. Running them in
// parallel races: reconcile reads stale server state while flush is mid-push,
// and the local edit gets clobbered.
// ---------------------------------------------------------------------------

export async function triggerSync(): Promise<void> {
  await flushOutbox()
  const { reconcileList, reconcileLists } = await import('./reconcile')
  // Always keep the lists table fresh — the user may be on /lists with no
  // active list registered, and the cached-vs-not affordance depends on it.
  await reconcileLists()
  const listId = activeListId
  if (listId) await reconcileList(listId)
}
