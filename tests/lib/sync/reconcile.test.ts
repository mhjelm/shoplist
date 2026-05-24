import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LocalItem, OutboxEntry } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Shared mutable state for mocks — vi.hoisted makes it available before
// the vi.mock factories run.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  outboxEntries: [] as OutboxEntry[],
  localItems: [] as LocalItem[],
}))

const serverData = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  activity: null as { last_activity: string } | null,
  itemsQueryCalls: 0,
}))

const localData = vi.hoisted(() => ({
  syncMeta: undefined as { list_id: string; last_sync_at: string } | undefined,
}))

const mockAddConflicts = vi.hoisted(() => vi.fn())

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === 'list_activity') {
            // Chainable that supports both .maybeSingle() and direct awaiting.
            // Tests set serverData.activity to drive the precheck branch.
            const activityResult = { data: serverData.activity, error: null }
            return {
              maybeSingle: () => Promise.resolve(activityResult),
              then: (resolve: (v: typeof activityResult) => unknown) => Promise.resolve(activityResult).then(resolve),
            }
          }
          serverData.itemsQueryCalls++
          return Promise.resolve({ data: serverData.rows, error: null })
        },
      }),
    }),
  }),
}))

vi.mock('@/lib/sync/engine', () => ({
  addConflicts: mockAddConflicts,
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    outbox: {
      where: (field: string) => ({
        equals: (val: string) => ({
          filter: (fn: (e: OutboxEntry) => boolean) => ({
            toArray: async () =>
              db.outboxEntries
                .filter(e => (e as Record<string, unknown>)[field] === val)
                .filter(fn),
          }),
        }),
      }),
      delete: async (seq: number) => {
        const idx = db.outboxEntries.findIndex(e => e.seq === seq)
        if (idx >= 0) db.outboxEntries.splice(idx, 1)
      },
    },
    items: {
      where: (field: string) => ({
        equals: (val: string) => ({
          toArray: async () =>
            db.localItems.filter(e => (e as Record<string, unknown>)[field] === val),
        }),
      }),
      put: async (item: LocalItem) => {
        const idx = db.localItems.findIndex(e => e.id === item.id)
        if (idx >= 0) db.localItems[idx] = item
        else db.localItems.push(item)
      },
      delete: async (id: string) => {
        const idx = db.localItems.findIndex(e => e.id === id)
        if (idx >= 0) db.localItems.splice(idx, 1)
      },
    },
    sync_meta: {
      get: vi.fn(async (listId: string) =>
        localData.syncMeta?.list_id === listId ? localData.syncMeta : undefined,
      ),
      put: vi.fn().mockResolvedValue(undefined),
    },
    transaction: async (_mode: string, _tables: unknown[], fn: () => Promise<void>) => fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { reconcileList } from '@/lib/sync/reconcile'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServerRow(id: string, name: string, updatedAt: string): Record<string, unknown> {
  return {
    id,
    list_id: 'list-1',
    name,
    is_checked: false,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: updatedAt,
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    added_by: 'user-1',
  }
}

function makeLocalItem(id: string, name: string): LocalItem {
  return {
    id,
    list_id: 'list-1',
    name,
    is_checked: false,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    added_by: 'user-1',
    shared_group_id: null,
  }
}

function makeOutboxEntry(
  seq: number,
  itemId: string,
  type: OutboxEntry['type'] = 'item.update',
  createdAt: number = Date.now(),
): OutboxEntry {
  return {
    seq,
    list_id: 'list-1',
    type,
    payload: type === 'item.delete'
      ? { id: itemId, list_id: 'list-1' }
      : { id: itemId, list_id: 'list-1', patch: { name: 'Local edit' } },
    status: 'pending',
    attempts: 0,
    created_at: createdAt,
    idempotency_key: `key-${seq}`,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  db.outboxEntries = []
  db.localItems = []
  serverData.rows = []
  serverData.activity = null
  serverData.itemsQueryCalls = 0
  localData.syncMeta = undefined
  mockAddConflicts.mockReset()
})

describe('reconcileList', () => {
  it('writes server rows to Dexie when no pending local changes', async () => {
    serverData.rows = [makeServerRow('item-1', 'Mjölk', '2024-06-01T10:00:00.000Z')]

    await reconcileList('list-1')

    expect(db.localItems).toHaveLength(1)
    expect(db.localItems[0].id).toBe('item-1')
    expect(db.localItems[0].name).toBe('Mjölk')
    expect(mockAddConflicts).not.toHaveBeenCalled()
  })

  it('removes a local item that is absent from the server response', async () => {
    db.localItems = [makeLocalItem('item-stale', 'Stale')]
    serverData.rows = []

    await reconcileList('list-1')

    expect(db.localItems).toHaveLength(0)
  })

  it('keeps a local item when the server deleted it but we have a pending change', async () => {
    db.localItems = [makeLocalItem('item-1', 'Local edit')]
    db.outboxEntries = [makeOutboxEntry(1, 'item-1', 'item.update')]
    serverData.rows = [] // server no longer has the item

    await reconcileList('list-1')

    // Should NOT be deleted — outbox protects it
    expect(db.localItems).toHaveLength(1)
    expect(db.localItems[0].id).toBe('item-1')
  })

  it('keeps item deleted locally when pending type is item.delete', async () => {
    // Server still has the item, but we have a pending delete
    db.outboxEntries = [makeOutboxEntry(1, 'item-1', 'item.delete')]
    serverData.rows = [makeServerRow('item-1', 'Mjölk', '2024-06-01T10:00:00.000Z')]

    await reconcileList('list-1')

    // The local delete should be honoured — item stays absent
    expect(db.localItems.find(i => i.id === 'item-1')).toBeUndefined()
  })

  it('server wins and records conflict when server updated_at is newer than our outbox entry', async () => {
    const now = Date.now()
    const pendingCreatedAt = now - 10_000         // queued 10 s ago
    const serverUpdatedAt = new Date(now - 5_000).toISOString()  // server updated 5 s ago

    db.localItems = [makeLocalItem('item-1', 'Local edit')]
    db.outboxEntries = [makeOutboxEntry(1, 'item-1', 'item.update', pendingCreatedAt)]
    serverData.rows = [makeServerRow('item-1', 'Server name', serverUpdatedAt)]

    await reconcileList('list-1')

    // Local item should be replaced by server version
    expect(db.localItems[0].name).toBe('Server name')
    // Outbox entry should be gone
    expect(db.outboxEntries).toHaveLength(0)
    // Conflict should be recorded
    expect(mockAddConflicts).toHaveBeenCalledOnce()
    expect(mockAddConflicts).toHaveBeenCalledWith([{ id: 'item-1', name: 'Server name' }])
  })

  it('keeps local state when our outbox entry is newer than the server row', async () => {
    const now = Date.now()
    const pendingCreatedAt = now - 2_000              // queued 2 s ago
    const serverUpdatedAt = new Date(now - 10_000).toISOString()  // server last updated 10 s ago

    db.localItems = [makeLocalItem('item-1', 'Local edit')]
    db.outboxEntries = [makeOutboxEntry(1, 'item-1', 'item.update', pendingCreatedAt)]
    serverData.rows = [makeServerRow('item-1', 'Old server name', serverUpdatedAt)]

    await reconcileList('list-1')

    // Our edit should be preserved — no overwrite
    expect(db.localItems[0].name).toBe('Local edit')
    // Outbox entry should still be there
    expect(db.outboxEntries).toHaveLength(1)
    // No conflict
    expect(mockAddConflicts).not.toHaveBeenCalled()
  })

  it('protects a local item when its outbox entry is marked failed (offline retry)', async () => {
    // Regression: reconcile used to filter to status pending|in_flight, so an
    // entry left in 'failed' (e.g. by a previous offline dispatch attempt)
    // looked invisible — the parallel reconnect-time reconcile then clobbered
    // the local edit with stale server data.
    const now = Date.now()
    const pendingCreatedAt = now - 2_000
    const serverUpdatedAt = new Date(now - 10_000).toISOString()

    db.localItems = [makeLocalItem('item-1', 'Local edit')]
    db.outboxEntries = [{
      ...makeOutboxEntry(1, 'item-1', 'item.update', pendingCreatedAt),
      status: 'failed',
      attempts: 1,
      last_error: 'network error',
    }]
    serverData.rows = [makeServerRow('item-1', 'Old server name', serverUpdatedAt)]

    await reconcileList('list-1')

    // Local edit must survive — the outbox will retry it.
    expect(db.localItems[0].name).toBe('Local edit')
    expect(db.outboxEntries).toHaveLength(1)
    expect(mockAddConflicts).not.toHaveBeenCalled()
  })

  it('does not delete a local item the server is missing when its outbox entry is failed', async () => {
    db.localItems = [makeLocalItem('item-1', 'Local insert')]
    db.outboxEntries = [{
      ...makeOutboxEntry(1, 'item-1', 'item.update'),
      status: 'failed',
      attempts: 2,
    }]
    serverData.rows = []

    await reconcileList('list-1')

    expect(db.localItems).toHaveLength(1)
    expect(db.outboxEntries).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // Cheap-precheck branch: list_activity vs. local sync_meta watermark
  // ---------------------------------------------------------------------------

  it('precheck: skips the items refetch when local sync_meta is at or newer than list_activity', async () => {
    const now = Date.now()
    serverData.activity = { last_activity: new Date(now - 5_000).toISOString() }
    localData.syncMeta = { list_id: 'list-1', last_sync_at: new Date(now - 1_000).toISOString() }
    // Items the server would return if we asked — but we shouldn't ask.
    serverData.rows = [makeServerRow('item-x', 'Should-not-appear', new Date(now - 5_000).toISOString())]

    await reconcileList('list-1')

    expect(serverData.itemsQueryCalls).toBe(0)
    expect(db.localItems).toHaveLength(0)
    expect(mockAddConflicts).not.toHaveBeenCalled()
  })

  it('precheck: refetches items when list_activity is newer than local sync_meta', async () => {
    const now = Date.now()
    serverData.activity = { last_activity: new Date(now - 1_000).toISOString() }
    localData.syncMeta = { list_id: 'list-1', last_sync_at: new Date(now - 5_000).toISOString() }
    serverData.rows = [makeServerRow('item-1', 'Mjölk', new Date(now - 1_000).toISOString())]

    await reconcileList('list-1')

    expect(serverData.itemsQueryCalls).toBe(1)
    expect(db.localItems).toHaveLength(1)
    expect(db.localItems[0].name).toBe('Mjölk')
  })

  it('precheck: refetches and prunes local items when server activity is bumped AFTER all items were deleted (regression: shared-list clear-shopped)', async () => {
    // Regression for the bug fixed in migration 0017: another user cleared
    // shopped items on a shared list. With the old `list_activity` view
    // (max(updated_at) from items), that DELETE made last_activity regress
    // (or go NULL), so the precheck below short-circuited and User 2's
    // Dexie kept stale rows forever — refresh and app restart didn't help.
    //
    // Migration 0017 made last_activity monotonic via a trigger on items
    // INSERT/UPDATE/DELETE that sets it to now(). This test simulates the
    // expected post-trigger state: server activity > local sync watermark
    // even though server has NO items. Reconcile must refetch and prune.
    const now = Date.now()
    // User 2 last synced 5 minutes ago; server was cleared 10 s ago.
    serverData.activity = { last_activity: new Date(now - 10_000).toISOString() }
    localData.syncMeta = { list_id: 'list-1', last_sync_at: new Date(now - 300_000).toISOString() }
    db.localItems = [
      makeLocalItem('item-1', 'Mjölk'),
      makeLocalItem('item-2', 'Bröd'),
    ]
    serverData.rows = []

    await reconcileList('list-1')

    // Precheck must NOT short-circuit — items must be refetched and pruned.
    expect(serverData.itemsQueryCalls).toBe(1)
    expect(db.localItems).toHaveLength(0)
  })

  it('precheck: refetches items when there is no local sync watermark yet (first reconcile)', async () => {
    serverData.activity = { last_activity: '2024-06-01T10:00:00.000Z' }
    // localData.syncMeta intentionally left undefined
    serverData.rows = [makeServerRow('item-1', 'Mjölk', '2024-06-01T10:00:00.000Z')]

    await reconcileList('list-1')

    expect(serverData.itemsQueryCalls).toBe(1)
    expect(db.localItems).toHaveLength(1)
  })

  it('handles multiple items with mixed conflict and clean scenarios', async () => {
    const now = Date.now()
    const oldTime = new Date(now - 10_000).toISOString()
    const recentTime = new Date(now - 2_000).toISOString()

    // item-a: conflict (server newer)
    db.outboxEntries.push(makeOutboxEntry(1, 'item-a', 'item.update', now - 8_000))
    serverData.rows.push(makeServerRow('item-a', 'Server A', recentTime))

    // item-b: no pending → clean apply
    serverData.rows.push(makeServerRow('item-b', 'Server B', oldTime))

    await reconcileList('list-1')

    expect(db.localItems.find(i => i.id === 'item-a')?.name).toBe('Server A')
    expect(db.localItems.find(i => i.id === 'item-b')?.name).toBe('Server B')
    expect(mockAddConflicts).toHaveBeenCalledWith([{ id: 'item-a', name: 'Server A' }])
  })
})
