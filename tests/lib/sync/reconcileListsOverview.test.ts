import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LocalListCatalog, LocalListView } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// In-memory Dexie stub — only the tables reconcileListsOverview touches
// ---------------------------------------------------------------------------

const catalog: LocalListCatalog[] = []
const views: LocalListView[] = []

vi.mock('@/lib/db/local', () => ({
  localDB: {
    list_catalog: {
      toArray: async () => [...catalog],
      bulkPut: async (rows: LocalListCatalog[]) => {
        for (const row of rows) {
          const idx = catalog.findIndex(c => c.id === row.id)
          if (idx >= 0) catalog[idx] = row
          else catalog.push(row)
        }
      },
      delete: async (id: string) => {
        const idx = catalog.findIndex(c => c.id === id)
        if (idx >= 0) catalog.splice(idx, 1)
      },
    },
    list_views: {
      bulkPut: async (rows: LocalListView[]) => {
        for (const row of rows) {
          const idx = views.findIndex(v => v.list_id === row.list_id)
          if (idx >= 0) views[idx] = row
          else views.push(row)
        }
      },
      delete: async (listId: string) => {
        const idx = views.findIndex(v => v.list_id === listId)
        if (idx >= 0) views.splice(idx, 1)
      },
    },
    transaction: async (_mode: string, _tables: unknown[], fn: () => Promise<void>) => fn(),
  },
}))

// ---------------------------------------------------------------------------
// Supabase mock — table-aware so parallel queries return separate data
// ---------------------------------------------------------------------------

type TableRows = Array<Record<string, unknown>>

const serverTables = vi.hoisted(
  () => new Map<string, TableRows>([
    ['lists', []],
    ['list_activity', []],
    ['list_views', []],
  ])
)

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'me' } }, error: null }),
    },
    from: (table: string) => {
      const rows = serverTables.get(table) ?? []
      const result = { data: rows, error: null }
      return {
        select: () => ({ data: rows, error: null, eq: () => result }),
        eq: () => ({ select: () => result }),
      }
    },
  }),
}))

import { reconcileListsOverview } from '@/lib/sync/reconcile'

function makeListRow(id: string, name = 'Test') {
  return {
    id,
    name,
    owner_id: 'me',
    created_at: '2024-01-01T00:00:00Z',
    list_members: [{ count: 0 }],
  }
}

beforeEach(() => {
  catalog.length = 0
  views.length = 0
  serverTables.set('lists', [])
  serverTables.set('list_activity', [])
  serverTables.set('list_views', [])
})

describe('reconcileListsOverview — last_activity_by plumbing', () => {
  it('persists last_activity_by from list_activity into Dexie list_catalog', async () => {
    serverTables.set('lists', [makeListRow('list-1')])
    serverTables.set('list_activity', [
      { list_id: 'list-1', last_activity: '2026-05-18T12:00:00Z', last_activity_by: 'user-abc' },
    ])

    await reconcileListsOverview()

    expect(catalog).toHaveLength(1)
    expect(catalog[0].last_activity_by).toBe('user-abc')
    expect(catalog[0].last_activity).toBe('2026-05-18T12:00:00Z')
  })

  it('stores null last_activity_by when the column is null (pre-migration row)', async () => {
    serverTables.set('lists', [makeListRow('list-1')])
    serverTables.set('list_activity', [
      { list_id: 'list-1', last_activity: '2026-05-18T12:00:00Z', last_activity_by: null },
    ])

    await reconcileListsOverview()

    expect(catalog[0].last_activity_by).toBeNull()
  })

  it('overwrites a stale last_activity_by on follow-up reconcile', async () => {
    serverTables.set('lists', [makeListRow('list-1')])
    serverTables.set('list_activity', [
      { list_id: 'list-1', last_activity: '2026-05-18T10:00:00Z', last_activity_by: 'user-old' },
    ])
    await reconcileListsOverview()
    expect(catalog[0].last_activity_by).toBe('user-old')

    // Second reconcile with a fresh actor
    serverTables.set('list_activity', [
      { list_id: 'list-1', last_activity: '2026-05-18T12:00:00Z', last_activity_by: 'user-new' },
    ])
    await reconcileListsOverview()

    expect(catalog[0].last_activity_by).toBe('user-new')
    expect(catalog).toHaveLength(1) // no duplicate rows
  })

  it('stores null last_activity_by when list has no activity row', async () => {
    serverTables.set('lists', [makeListRow('list-1')])
    // list_activity table is empty

    await reconcileListsOverview()

    expect(catalog[0].last_activity).toBeNull()
    expect(catalog[0].last_activity_by).toBeNull()
  })
})
