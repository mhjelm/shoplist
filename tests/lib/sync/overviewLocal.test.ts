import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LocalListCatalog, LocalListView } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// In-memory Dexie stub — only the tables overviewLocal touches
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
      update: async (id: string, patch: Partial<LocalListCatalog>) => {
        const idx = catalog.findIndex(c => c.id === id)
        if (idx >= 0) catalog[idx] = { ...catalog[idx], ...patch }
      },
    },
    list_views: {
      toArray: async () => [...views],
      get: async (listId: string) => views.find(v => v.list_id === listId),
      put: async (row: LocalListView) => {
        const idx = views.findIndex(v => v.list_id === row.list_id)
        if (idx >= 0) views[idx] = row
        else views.push(row)
      },
      bulkPut: async (rows: LocalListView[]) => {
        for (const row of rows) {
          const idx = views.findIndex(v => v.list_id === row.list_id)
          if (idx >= 0) views[idx] = row
          else views.push(row)
        }
      },
    },
    transaction: async (_mode: string, _tables: unknown[], fn: () => Promise<void>) => fn(),
  },
}))

vi.mock('@/lib/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), fallback: vi.fn() },
}))

function makeCatalogRow(overrides: Partial<LocalListCatalog> = {}): LocalListCatalog {
  return {
    id: 'list-1',
    name: 'Hemma',
    owner_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    kind: 'shopping',
    has_members: false,
    last_add_at: null,
    last_add_by: null,
    ...overrides,
  }
}

function makeViewRow(overrides: Partial<LocalListView> = {}): LocalListView {
  return { list_id: 'list-1', last_viewed_at: '2026-01-01T10:00:00Z', ...overrides }
}

// Reset in-memory state before each test
beforeEach(() => {
  catalog.length = 0
  views.length = 0
})

// ---------------------------------------------------------------------------
// seedListsOverview
// ---------------------------------------------------------------------------

describe('seedListsOverview — cold path (empty Dexie)', () => {
  it('writes all catalog rows verbatim on first visit', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    const rows = [makeCatalogRow(), makeCatalogRow({ id: 'list-2', name: 'Jobb' })]
    await seedListsOverview(rows, [])
    expect(catalog).toHaveLength(2)
    expect(catalog.find(c => c.id === 'list-1')?.name).toBe('Hemma')
    expect(catalog.find(c => c.id === 'list-2')?.name).toBe('Jobb')
  })

  it('writes view rows via max-merge on cold path', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow()], [makeViewRow({ last_viewed_at: '2026-01-02T00:00:00Z' })])
    expect(views.find(v => v.list_id === 'list-1')?.last_viewed_at).toBe('2026-01-02T00:00:00Z')
  })
})

describe('seedListsOverview — warm path (Dexie has rows)', () => {
  beforeEach(() => {
    catalog.push(makeCatalogRow({ name: 'LocalName', has_members: true, last_add_at: '2026-01-05T00:00:00Z', last_add_by: 'user-2' }))
    views.push(makeViewRow({ last_viewed_at: '2026-01-10T00:00:00Z' }))
  })

  it('does NOT insert a catalog row missing from Dexie (no deleted-list resurrection)', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow({ id: 'deleted-list', name: 'Ghost' })], [])
    expect(catalog.find(c => c.id === 'deleted-list')).toBeUndefined()
  })

  it('leaves name/kind/has_members untouched even if SSR has different values', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow({ name: 'SsrName', has_members: false })], [])
    const row = catalog.find(c => c.id === 'list-1')!
    expect(row.name).toBe('LocalName')
    expect(row.has_members).toBe(true)
  })

  it('forward-bumps last_add_at/last_add_by together when SSR is newer', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow({ last_add_at: '2026-01-10T00:00:00Z', last_add_by: 'user-3' })], [])
    const row = catalog.find(c => c.id === 'list-1')!
    expect(row.last_add_at).toBe('2026-01-10T00:00:00Z')
    expect(row.last_add_by).toBe('user-3')
  })

  it('does NOT bump last_add_at when SSR is older', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow({ last_add_at: '2026-01-01T00:00:00Z', last_add_by: 'user-x' })], [])
    const row = catalog.find(c => c.id === 'list-1')!
    expect(row.last_add_at).toBe('2026-01-05T00:00:00Z')
    expect(row.last_add_by).toBe('user-2')
  })

  it('does NOT bump last_add_at when SSR is null', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([makeCatalogRow({ last_add_at: null, last_add_by: null })], [])
    const row = catalog.find(c => c.id === 'list-1')!
    expect(row.last_add_at).toBe('2026-01-05T00:00:00Z')
  })

  it('keeps max last_viewed_at (stale SSR loses)', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([], [makeViewRow({ last_viewed_at: '2026-01-01T00:00:00Z' })])
    expect(views.find(v => v.list_id === 'list-1')?.last_viewed_at).toBe('2026-01-10T00:00:00Z')
  })

  it('keeps max last_viewed_at (fresh SSR wins)', async () => {
    const { seedListsOverview } = await import('@/lib/sync/overviewLocal')
    await seedListsOverview([], [makeViewRow({ last_viewed_at: '2026-01-20T00:00:00Z' })])
    expect(views.find(v => v.list_id === 'list-1')?.last_viewed_at).toBe('2026-01-20T00:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// touchListViewLocal
// ---------------------------------------------------------------------------

describe('touchListViewLocal', () => {
  it('inserts a row when none exists', async () => {
    const { touchListViewLocal } = await import('@/lib/sync/overviewLocal')
    await touchListViewLocal('list-new')
    expect(views.find(v => v.list_id === 'list-new')).toBeDefined()
  })

  it('advances last_viewed_at forward', async () => {
    views.push({ list_id: 'list-1', last_viewed_at: '2020-01-01T00:00:00Z' })
    const { touchListViewLocal } = await import('@/lib/sync/overviewLocal')
    await touchListViewLocal('list-1')
    const after = views.find(v => v.list_id === 'list-1')!.last_viewed_at
    expect(after > '2020-01-01T00:00:00Z').toBe(true)
  })

  it('does not regress last_viewed_at when existing is already in the future (clock skew guard)', async () => {
    const futureTime = new Date(Date.now() + 9_000_000).toISOString()
    views.push({ list_id: 'list-1', last_viewed_at: futureTime })
    const { touchListViewLocal } = await import('@/lib/sync/overviewLocal')
    await touchListViewLocal('list-1')
    expect(views.find(v => v.list_id === 'list-1')!.last_viewed_at).toBe(futureTime)
  })
})
