import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LocalItem, LocalList } from '@/lib/db/types'

const db = vi.hoisted(() => ({
  lists: [] as LocalList[],
  items: [] as LocalItem[],
}))

const serverData = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>> | null,
  shouldThrow: false,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => {
        if (serverData.shouldThrow) return Promise.reject(new Error('network'))
        return Promise.resolve({ data: serverData.rows, error: null })
      },
    }),
  }),
}))

vi.mock('@/lib/sync/engine', () => ({
  addConflicts: vi.fn(),
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    lists: {
      toArray: async () => [...db.lists],
      put: async (row: LocalList) => {
        const idx = db.lists.findIndex(l => l.id === row.id)
        if (idx >= 0) db.lists[idx] = row
        else db.lists.push(row)
      },
      delete: async (id: string) => {
        const idx = db.lists.findIndex(l => l.id === id)
        if (idx >= 0) db.lists.splice(idx, 1)
      },
    },
    items: {
      where: (field: string) => ({
        equals: (val: string) => ({
          toArray: async () =>
            db.items.filter(i => (i as Record<string, unknown>)[field] === val),
        }),
      }),
      bulkDelete: async (ids: string[]) => {
        for (const id of ids) {
          const idx = db.items.findIndex(i => i.id === id)
          if (idx >= 0) db.items.splice(idx, 1)
        }
      },
    },
    transaction: async (_mode: string, _tables: unknown[], fn: () => Promise<void>) => fn(),
  },
}))

import { reconcileLists } from '@/lib/sync/reconcile'

function makeList(id: string, name: string, ownerId = 'user-1'): LocalList {
  return { id, name, owner_id: ownerId, is_shared: false, created_at: '2024-01-01T00:00:00.000Z' }
}

function makeItem(id: string, listId: string): LocalItem {
  return {
    id,
    list_id: listId,
    name: 'x',
    is_checked: false,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    added_by: 'user-1',
  }
}

beforeEach(() => {
  db.lists = []
  db.items = []
  serverData.rows = []
  serverData.shouldThrow = false
})

describe('reconcileLists', () => {
  it('does NOT insert server lists Dexie has never seen', async () => {
    // Dexie's `lists` table only tracks lists the user has actually opened on
    // this device — that drives the offline "cached" indicator. Reconcile must
    // not seed unknown lists here, otherwise every server-visible list would
    // appear cached and the offline gating on /lists would be a no-op.
    serverData.rows = [makeList('a', 'Veckohandling'), makeList('b', 'Helghandling')]

    await reconcileLists()

    expect(db.lists).toHaveLength(0)
  })

  it('refreshes an existing local list with server values', async () => {
    db.lists = [makeList('a', 'Stale')]
    serverData.rows = [makeList('a', 'Fresh')]

    await reconcileLists()

    expect(db.lists).toHaveLength(1)
    expect(db.lists[0].name).toBe('Fresh')
  })

  it('only refreshes locally-known lists, ignoring unknown server rows', async () => {
    db.lists = [makeList('known', 'Stale')]
    serverData.rows = [makeList('known', 'Fresh'), makeList('unknown', 'New')]

    await reconcileLists()

    expect(db.lists.map(l => l.id).sort()).toEqual(['known'])
    expect(db.lists.find(l => l.id === 'known')?.name).toBe('Fresh')
  })

  it('deletes a Dexie list row that the server no longer has', async () => {
    db.lists = [makeList('a', 'Gone'), makeList('b', 'Kept')]
    serverData.rows = [makeList('b', 'Kept')]

    await reconcileLists()

    expect(db.lists.map(l => l.id)).toEqual(['b'])
  })

  it('also drops orphan items for a deleted list', async () => {
    db.lists = [makeList('a', 'Gone')]
    db.items = [makeItem('i1', 'a'), makeItem('i2', 'a'), makeItem('i3', 'a')]
    serverData.rows = []

    await reconcileLists()

    expect(db.lists).toHaveLength(0)
    expect(db.items).toHaveLength(0)
  })

  it('leaves items from other list_ids untouched when reconciling', async () => {
    db.lists = [makeList('gone', 'X'), makeList('kept', 'Y')]
    db.items = [makeItem('i1', 'gone'), makeItem('i2', 'kept')]
    serverData.rows = [makeList('kept', 'Y')]

    await reconcileLists()

    expect(db.items.map(i => i.id)).toEqual(['i2'])
  })

  it('handles an empty server response by clearing Dexie', async () => {
    db.lists = [makeList('a', 'X'), makeList('b', 'Y')]
    serverData.rows = []

    await reconcileLists()

    expect(db.lists).toHaveLength(0)
  })

  it('swallows a network error and leaves Dexie untouched', async () => {
    db.lists = [makeList('a', 'X')]
    serverData.shouldThrow = true

    await expect(reconcileLists()).resolves.toBeUndefined()
    expect(db.lists).toHaveLength(1)
  })
})
