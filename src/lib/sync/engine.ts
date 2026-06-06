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
  lastSyncError: string | null
}

function initialOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

let syncState: SyncState = { isOffline: initialOffline(), pendingCount: 0, recentConflicts: [], lastSyncError: null }
const listeners = new Set<(s: SyncState) => void>()

function setSync(partial: Partial<SyncState>) {
  syncState = { ...syncState, ...partial }
  for (const fn of listeners) fn(syncState)
}

// Test/diagnostic accessor for the current sync snapshot (no React).
export function getSyncState(): SyncState {
  return syncState
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

// Single-flight outbox drain. `draining` is non-null while a drain loop is
// running; `resyncRequested` records that new work (or a fresh flush request)
// arrived during the loop so we re-read the queue instead of dropping the
// signal. Without the rerun flag, an entry committed AFTER the loop snapshotted
// its pending set — and whose own flushOutbox() call was swallowed because a
// drain was already in progress — would be stranded until the next
// connectivity trigger (the "stuck on N syncing" bug on rapid edits).
let draining: Promise<void> | null = null
let resyncRequested = false

function check(result: { error?: string } | undefined | void) {
  if (result && 'error' in result && result.error) {
    throw new Error(result.error)
  }
}

async function dispatch(entry: OutboxEntry) {
  const { addItem, updateItem, setItemCategory, deleteItem, reorderItem, mergeItems, categorizeItem, touchListView } =
    await import('@/app/lists/[id]/actions')
  const p = entry.payload as Record<string, unknown>
  const listId = p.list_id as string

  switch (entry.type) {
    case 'item.insert': {
      const result = await addItem(
        listId,
        p.name as string,
        p.picture_url as string | undefined,
        p.id as string,
        p.quantity as number | undefined,
        p.measurement as string | null | undefined,
        p.category as CategorySlug | null | undefined,
      )
      check(result)
      // Gemini fallback: if the server couldn't find a cached category in
      // user_item_history, classify in the background and patch Dexie when
      // it returns. Skip for merged adds (existing item, already categorized).
      const r = result as { item?: { id: string; category: string | null }; merged?: boolean }
      if (r.item && !r.item.category && !r.merged && !p.skip_categorize) {
        const itemId = r.item.id
        categorizeItem(itemId).then(res => {
          if (res?.category) {
            return localDB.items.update(itemId, { category: res.category })
          }
        }).catch(() => { /* swallow — UI stays in 'ovrigt' until next attempt */ })
      }
      break
    }
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

  // Bump the caller's last_viewed_at AFTER the item write succeeds, so
  // last_viewed_at >= items.updated_at on the server. Without this, the
  // user's own edits briefly show as "NEW" on /lists when navigating back,
  // because the /lists query can race ahead of the unmount-time touch.
  await touchListView(listId).catch(() => {})
}

// Drain the outbox. Safe to call concurrently and fire-and-forget: a single
// drain loop runs at a time, and any call made while it's running is folded in
// (the loop re-reads the queue). Always returns the in-flight drain promise, so
// callers that `await flushOutbox()` (notably triggerSync) genuinely block
// until the queue is drained — never on a resolved no-op that would let a
// reconcile race an in-flight push.
export function flushOutbox(): Promise<void> {
  resyncRequested = true
  if (!draining) {
    draining = drainLoop().finally(() => { draining = null })
  }
  return draining
}

async function drainLoop(): Promise<void> {
  // Reset stuck in-flight entries from a previous crash.
  await localDB.outbox.where('status').equals('in_flight').modify({ status: 'pending' })

  // Re-read the queue while signals keep arriving. Resetting the flag at the
  // top of each pass (then re-checking it as the loop condition) closes the
  // lost-wakeup window: a flushOutbox() call that lands during a pass sets the
  // flag again and triggers one more pass.
  while (resyncRequested) {
    resyncRequested = false

    const pending = await localDB.outbox
      .where('status').anyOf(['pending', 'failed'])
      .sortBy('seq')

    if (pending.length === 0) {
      setSync({ pendingCount: 0, lastSyncError: null })
      markOnlineIfBrowserAgrees()
      continue
    }

    setSync({ pendingCount: pending.length })

    for (const entry of pending) {
      try {
        await localDB.outbox.update(entry.seq!, { status: 'in_flight' })
        await dispatch(entry)
        await localDB.outbox.delete(entry.seq!)
        const remaining = await localDB.outbox.where('status').anyOf(['pending', 'failed']).count()
        setSync({ pendingCount: remaining, lastSyncError: null })
        markOnlineIfBrowserAgrees()
      } catch (err) {
        const errMsg = String(err)
        console.error('[outbox] dispatch failed', {
          type: entry.type,
          seq: entry.seq,
          attempts: entry.attempts + 1,
          payload: entry.payload,
          error: errMsg,
        })
        await localDB.outbox.update(entry.seq!, {
          status: 'failed',
          attempts: entry.attempts + 1,
          last_error: errMsg,
        })
        setSync({ lastSyncError: errMsg })
        markOffline()
        // Hand the retry to the backoff timer and stop this loop. The timer
        // re-enters via flushOutbox once draining has cleared.
        const delay = RETRY_DELAYS[Math.min(entry.attempts, RETRY_DELAYS.length - 1)]
        setTimeout(() => { flushOutbox() }, delay)
        return
      }
    }
  }
}

// ---------------------------------------------------------------------------
// triggerSync — the single ordered entrypoint for connectivity events. Always
// drains the outbox first, *then* reconciles the active list. Running them in
// parallel races: reconcile reads stale server state while flush is mid-push,
// and the local edit gets clobbered.
// ---------------------------------------------------------------------------

// Exported for unit tests only — allows asserting that extended payload fields
// reach the correct server action without going through the full flush flow.
export { dispatch as _dispatchEntry }

export async function triggerSync(): Promise<void> {
  await flushOutbox()
  const { reconcileList, reconcileLists } = await import('./reconcile')
  // Always keep the lists table fresh — the user may be on /lists with no
  // active list registered, and the cached-vs-not affordance depends on it.
  await reconcileLists()
  const listId = activeListId
  if (listId) await reconcileList(listId)
}
