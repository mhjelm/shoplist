import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Item } from '@/lib/types'
import {
  itemToLocalItem,
  localItemToItem,
  sortItemsByOrder,
  groupByCategory,
  findExistingItem,
  buildLocalItem,
  buildMergePatch,
} from './itemHelpers'
import type { LocalItem } from '@/lib/db/types'
import { DEFAULT_CATEGORY_ORDER } from '@/lib/categories'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    list_id: 'list-1',
    added_by: 'user-1',
    name: 'Mjölk',
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    ...overrides,
  }
}

function makeLocalItem(overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id: 'item-1',
    list_id: 'list-1',
    added_by: 'user-1',
    name: 'Mjölk',
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// itemToLocalItem
// ---------------------------------------------------------------------------

describe('itemToLocalItem', () => {
  it('maps all fields', () => {
    const item = makeItem({ id: 'x', name: 'Smör', quantity: 2, measurement: '200 g', category: 'mejeri' })
    const li = itemToLocalItem(item)
    expect(li.id).toBe('x')
    expect(li.name).toBe('Smör')
    expect(li.quantity).toBe(2)
    expect(li.measurement).toBe('200 g')
    expect(li.category).toBe('mejeri')
  })

  it('coerces null updated_at to empty string', () => {
    const item = makeItem({ updated_at: undefined })
    expect(itemToLocalItem(item).updated_at).toBe('')
  })

  it('preserves non-null updated_at', () => {
    const item = makeItem({ updated_at: '2024-06-01T12:00:00Z' } as Item & { updated_at: string })
    expect(itemToLocalItem(item).updated_at).toBe('2024-06-01T12:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// localItemToItem
// ---------------------------------------------------------------------------

describe('localItemToItem', () => {
  it('maps all fields', () => {
    const li = makeLocalItem({ id: 'y', name: 'Ägg', quantity: 6, sort_order: 3 })
    const item = localItemToItem(li)
    expect(item.id).toBe('y')
    expect(item.name).toBe('Ägg')
    expect(item.quantity).toBe(6)
    expect(item.sort_order).toBe(3)
  })

  it('round-trips: item → localItem → item', () => {
    const original = makeItem({ id: 'round', name: 'Smör', measurement: '250 g', category: 'mejeri' })
    const roundtripped = localItemToItem(itemToLocalItem(original))
    expect(roundtripped.id).toBe(original.id)
    expect(roundtripped.name).toBe(original.name)
    expect(roundtripped.measurement).toBe(original.measurement)
    expect(roundtripped.category).toBe(original.category)
  })
})

// ---------------------------------------------------------------------------
// sortItemsByOrder
// ---------------------------------------------------------------------------

describe('sortItemsByOrder', () => {
  it('sorts ascending by sort_order', () => {
    const items = [
      { sort_order: 3 },
      { sort_order: 1 },
      { sort_order: 2 },
    ]
    expect([...items].sort(sortItemsByOrder).map(i => i.sort_order)).toEqual([1, 2, 3])
  })

  it('treats null as Infinity (sorts last)', () => {
    const items = [
      { sort_order: null },
      { sort_order: 1 },
      { sort_order: null },
      { sort_order: 2 },
    ]
    expect([...items].sort(sortItemsByOrder).map(i => i.sort_order)).toEqual([1, 2, null, null])
  })

  it('multiple null-ordered items retain their original relative order', () => {
    const items = [
      { sort_order: null, name: 'a' },
      { sort_order: null, name: 'b' },
      { sort_order: 1, name: 'c' },
    ]
    const sorted = [...items].sort(sortItemsByOrder)
    expect(sorted[0].name).toBe('c')
    // a and b both have null sort_order; their relative order is not specified
    // but both must follow c
    expect(sorted.slice(1).map(i => i.name).sort()).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// groupByCategory
// ---------------------------------------------------------------------------

describe('groupByCategory', () => {
  it('groups items into their category buckets', () => {
    const items = [
      makeItem({ id: '1', category: 'mejeri' }),
      makeItem({ id: '2', category: 'brod' }),
      makeItem({ id: '3', category: 'mejeri' }),
    ]
    const groups = groupByCategory(items, DEFAULT_CATEGORY_ORDER)
    const mejeriGroup = groups.find(([cat]) => cat === 'mejeri')
    const brodGroup = groups.find(([cat]) => cat === 'brod')
    expect(mejeriGroup?.[1]).toHaveLength(2)
    expect(brodGroup?.[1]).toHaveLength(1)
  })

  it('puts items with null category into ovrigt', () => {
    const items = [makeItem({ id: '1', category: null })]
    const groups = groupByCategory(items, DEFAULT_CATEGORY_ORDER)
    const ovrigt = groups.find(([cat]) => cat === 'ovrigt')
    expect(ovrigt?.[1]).toHaveLength(1)
  })

  it('puts items with unknown category slug into ovrigt', () => {
    const items = [makeItem({ id: '1', category: 'okänd-kategori' })]
    const groups = groupByCategory(items, DEFAULT_CATEGORY_ORDER)
    const ovrigt = groups.find(([cat]) => cat === 'ovrigt')
    expect(ovrigt?.[1]).toHaveLength(1)
  })

  it('omits empty category buckets from the result', () => {
    const items = [makeItem({ id: '1', category: 'mejeri' })]
    const groups = groupByCategory(items, DEFAULT_CATEGORY_ORDER)
    const cats = groups.map(([cat]) => cat)
    expect(cats).toContain('mejeri')
    expect(cats).not.toContain('brod')
  })

  it('preserves categoryOrder ordering', () => {
    const customOrder = ['brod', 'mejeri', 'ovrigt'] as const
    const items = [
      makeItem({ id: '1', category: 'mejeri' }),
      makeItem({ id: '2', category: 'brod' }),
    ]
    const groups = groupByCategory(items, [...customOrder])
    expect(groups[0][0]).toBe('brod')
    expect(groups[1][0]).toBe('mejeri')
  })

  it('returns empty array when no items', () => {
    expect(groupByCategory([], DEFAULT_CATEGORY_ORDER)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findExistingItem
// ---------------------------------------------------------------------------

describe('findExistingItem', () => {
  it('finds an active (unchecked) item by name', () => {
    const items = [makeItem({ id: '1', name: 'mjölk', is_checked: false })]
    expect(findExistingItem(items, 'mjölk')?.id).toBe('1')
  })

  it('is case-insensitive', () => {
    const items = [makeItem({ id: '1', name: 'Mjölk', is_checked: false })]
    expect(findExistingItem(items, 'mjölk')?.id).toBe('1')
    expect(findExistingItem(items, 'MJÖLK')?.id).toBe('1')
  })

  it('prefers active item over shopped item with the same name', () => {
    const items = [
      makeItem({ id: 'shopped', name: 'mjölk', is_checked: true }),
      makeItem({ id: 'active', name: 'mjölk', is_checked: false }),
    ]
    expect(findExistingItem(items, 'mjölk')?.id).toBe('active')
  })

  it('falls back to shopped item when no active match', () => {
    const items = [makeItem({ id: 'shopped', name: 'mjölk', is_checked: true })]
    expect(findExistingItem(items, 'mjölk')?.id).toBe('shopped')
  })

  it('returns undefined when no match', () => {
    const items = [makeItem({ id: '1', name: 'smör', is_checked: false })]
    expect(findExistingItem(items, 'mjölk')).toBeUndefined()
  })

  it('returns undefined for empty list', () => {
    expect(findExistingItem([], 'mjölk')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildLocalItem
// ---------------------------------------------------------------------------

describe('buildLocalItem', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>)
  })

  it('creates a fresh item with sensible defaults', () => {
    const li = buildLocalItem('list-1', 'Mjölk')
    expect(li.list_id).toBe('list-1')
    expect(li.name).toBe('Mjölk')
    expect(li.quantity).toBe(1)
    expect(li.is_checked).toBe(false)
    expect(li.added_by).toBe('')
    expect(li.sort_order).toBeNull()
    expect(li.category).toBeNull()
    expect(li.measurement).toBeNull()
    expect(li.picture_url).toBeNull()
  })

  it('uses crypto.randomUUID for the id', () => {
    const li = buildLocalItem('list-1', 'Mjölk')
    expect(li.id).toBe('test-uuid')
  })

  it('applies opts when provided', () => {
    const li = buildLocalItem('list-1', 'Smör', {
      quantity: 3,
      pictureUrl: 'https://example.com/img.jpg',
      category: 'mejeri',
      measurement: '250 g',
    })
    expect(li.quantity).toBe(3)
    expect(li.picture_url).toBe('https://example.com/img.jpg')
    expect(li.category).toBe('mejeri')
    expect(li.measurement).toBe('250 g')
  })

  it('created_at and updated_at are ISO strings', () => {
    const li = buildLocalItem('list-1', 'Ägg')
    expect(() => new Date(li.created_at)).not.toThrow()
    expect(() => new Date(li.updated_at)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// buildMergePatch
// ---------------------------------------------------------------------------

describe('buildMergePatch', () => {
  it('sums quantities', () => {
    const source = makeItem({ quantity: 2, measurement: null })
    const target = makeItem({ quantity: 3, measurement: null })
    expect(buildMergePatch(source, target).quantity).toBe(5)
  })

  it('joins non-null measurements with " + "', () => {
    const source = makeItem({ measurement: '200 g' })
    const target = makeItem({ measurement: '100 g' })
    expect(buildMergePatch(source, target).measurement).toBe('100 g + 200 g')
  })

  it('returns null measurement when both are null', () => {
    const source = makeItem({ measurement: null })
    const target = makeItem({ measurement: null })
    expect(buildMergePatch(source, target).measurement).toBeNull()
  })

  it('skips empty/whitespace-only measurements', () => {
    const source = makeItem({ measurement: '  ' })
    const target = makeItem({ measurement: '500 g' })
    expect(buildMergePatch(source, target).measurement).toBe('500 g')
  })

  it('uses target measurement alone when source has none', () => {
    const source = makeItem({ measurement: null })
    const target = makeItem({ measurement: '1 dl' })
    expect(buildMergePatch(source, target).measurement).toBe('1 dl')
  })

  it('uses source measurement alone when target has none', () => {
    const source = makeItem({ measurement: '1 dl' })
    const target = makeItem({ measurement: null })
    expect(buildMergePatch(source, target).measurement).toBe('1 dl')
  })
})
