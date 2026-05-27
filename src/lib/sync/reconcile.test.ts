import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LocalItem, OutboxEntry, SyncMeta } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Mutable stores the fakes read. Reset in beforeEach; each test seeds them.
// ---------------------------------------------------------------------------
let itemsStore: LocalItem[] = []
let outboxStore: OutboxEntry[] = []
let syncMeta: Record<string, SyncMeta> = {}
let serverRows: Record<string, unknown>[] = []
let serverActivity: { last_activity: string } | null = null

const conflictSpy = vi.fn()

vi.mock('./engine', () => ({
  addConflicts: (...args: unknown[]) => conflictSpy(...args),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'items') {
        return { select: () => ({ eq: () => Promise.resolve({ data: serverRows, error: null }) }) }
      }
      // list_activity
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: serverActivity }) }) }),
      }
    },
  }),
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    sync_meta: {
      get: async (id: string) => syncMeta[id],
      put: async (m: SyncMeta) => { syncMeta[m.list_id] = m },
    },
    outbox: {
      where: () => ({
        equals: (listId: string) => ({
          filter: (fn: (e: OutboxEntry) => boolean) => ({
            toArray: async () => outboxStore.filter(e => e.list_id === listId && fn(e)),
          }),
        }),
      }),
      delete: async (seq: number) => {
        const i = outboxStore.findIndex(e => e.seq === seq)
        if (i >= 0) outboxStore.splice(i, 1)
      },
    },
    items: {
      where: () => ({
        equals: (listId: string) => ({
          toArray: async () => itemsStore.filter(i => i.list_id === listId),
        }),
      }),
      delete: async (id: string) => {
        const i = itemsStore.findIndex(x => x.id === id)
        if (i >= 0) itemsStore.splice(i, 1)
      },
      put: async (row: LocalItem) => {
        const i = itemsStore.findIndex(x => x.id === row.id)
        if (i >= 0) itemsStore[i] = row
        else itemsStore.push(row)
      },
    },
    transaction: async (_mode: string, _tables: unknown, cb: () => Promise<void>) => cb(),
  },
}))

function makeItem(overrides: Partial<LocalItem> & { id: string }): LocalItem {
  return {
    list_id: 'list-1',
    added_by: 'user-1',
    name: 'Mjölk',
    is_checked: false,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    picture_url: null,
    sort_order: 0,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    seq: 1,
    list_id: 'list-1',
    type: 'item.update',
    status: 'pending',
    attempts: 0,
    // Queued at 2020-06-01 — BEFORE the server row's updated_at below.
    created_at: Date.parse('2020-06-01T00:00:00.000Z'),
    idempotency_key: 'key-1',
    payload: { id: 'X', list_id: 'list-1', patch: { is_checked: true } },
    ...overrides,
  }
}

describe('reconcileList — own in-flight push must not look like a server conflict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    itemsStore = []
    outboxStore = []
    syncMeta = {} // no local watermark → precheck proceeds to full refetch
    serverRows = []
    serverActivity = { last_activity: '2020-12-01T00:00:00.000Z' }
  })

  it('does NOT flag a conflict for an in_flight entry whose server row is newer', async () => {
    const { reconcileList } = await import('./reconcile')

    itemsStore = [makeItem({ id: 'X', is_checked: false })] // optimistic local value
    outboxStore = [makeEntry({ status: 'in_flight' })]
    serverRows = [makeItem({ id: 'X', is_checked: true, updated_at: '2020-12-01T00:00:00.000Z' })]

    await reconcileList('list-1')

    expect(conflictSpy).not.toHaveBeenCalled()
    // Entry left intact for the in-flight push to clear itself.
    expect(outboxStore).toHaveLength(1)
    // Local optimistic value kept (not overwritten by the server echo).
    expect(itemsStore.find(i => i.id === 'X')!.is_checked).toBe(false)
  })

  it.each(['pending', 'failed'] as const)(
    'STILL flags a conflict for a %s entry whose server row is newer',
    async (status) => {
      const { reconcileList } = await import('./reconcile')

      itemsStore = [makeItem({ id: 'X', is_checked: false })]
      outboxStore = [makeEntry({ status })]
      serverRows = [makeItem({ id: 'X', is_checked: true, updated_at: '2020-12-01T00:00:00.000Z' })]

      await reconcileList('list-1')

      expect(conflictSpy).toHaveBeenCalledTimes(1)
      expect(conflictSpy).toHaveBeenCalledWith([{ id: 'X', name: 'Mjölk' }])
      // Server wins: entry dropped, local row replaced.
      expect(outboxStore).toHaveLength(0)
      expect(itemsStore.find(i => i.id === 'X')!.is_checked).toBe(true)
    },
  )

  it('keeps an item gone locally when a delete is pending in-flight (no conflict)', async () => {
    const { reconcileList } = await import('./reconcile')

    itemsStore = [makeItem({ id: 'X' })]
    outboxStore = [makeEntry({ type: 'item.delete', status: 'in_flight', payload: { id: 'X', list_id: 'list-1' } })]
    serverRows = [makeItem({ id: 'X', updated_at: '2020-12-01T00:00:00.000Z' })]

    await reconcileList('list-1')

    expect(conflictSpy).not.toHaveBeenCalled()
    expect(itemsStore.find(i => i.id === 'X')).toBeUndefined()
  })
})
