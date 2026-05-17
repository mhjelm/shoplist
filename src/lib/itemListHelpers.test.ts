import { describe, it, expect } from 'vitest'
import { computeNewSortOrder, dedupeAddBatch } from './itemListHelpers'

describe('computeNewSortOrder', () => {
  describe('both neighbours have sort_order', () => {
    it('returns midpoint', () => {
      expect(computeNewSortOrder(10, 20, 1)).toBe(15)
    })

    it('handles non-integer midpoint', () => {
      expect(computeNewSortOrder(1, 2, 1)).toBe(1.5)
    })

    it('handles negative values', () => {
      expect(computeNewSortOrder(-4, -2, 1)).toBe(-3)
    })
  })

  describe('before is null (dropped at top of category)', () => {
    it('returns afterOrder - 1', () => {
      expect(computeNewSortOrder(null, 5, 0)).toBe(4)
    })

    it('returns afterOrder - 1 when afterOrder is 0', () => {
      expect(computeNewSortOrder(null, 0, 0)).toBe(-1)
    })
  })

  describe('after is null (dropped at bottom of category)', () => {
    it('returns beforeOrder + 1', () => {
      expect(computeNewSortOrder(10, null, 2)).toBe(11)
    })

    it('returns beforeOrder + 1 when beforeOrder is 0', () => {
      expect(computeNewSortOrder(0, null, 1)).toBe(1)
    })
  })

  describe('both neighbours are null (unsorted category)', () => {
    it('returns newIndex', () => {
      expect(computeNewSortOrder(null, null, 2)).toBe(2)
    })

    it('returns 0 when dropped at top', () => {
      expect(computeNewSortOrder(null, null, 0)).toBe(0)
    })
  })
})

describe('dedupeAddBatch', () => {
  it('returns each unique name with quantity 1 when no duplicates', () => {
    const result = dedupeAddBatch(['mjölk', 'smör', 'ägg'])
    expect(result).toEqual([
      { name: 'mjölk', quantity: 1 },
      { name: 'smör', quantity: 1 },
      { name: 'ägg', quantity: 1 },
    ])
  })

  it('collapses exact duplicates and sums quantity', () => {
    const result = dedupeAddBatch(['mjölk', 'mjölk'])
    expect(result).toEqual([{ name: 'mjölk', quantity: 2 }])
  })

  it('deduplicates case-insensitively', () => {
    const result = dedupeAddBatch(['Mjölk', 'mjölk'])
    expect(result).toEqual([{ name: 'Mjölk', quantity: 2 }])
  })

  it('preserves casing of first occurrence', () => {
    const result = dedupeAddBatch(['SMÖR', 'smör', 'Smör'])
    expect(result).toEqual([{ name: 'SMÖR', quantity: 3 }])
  })

  it('handles three or more duplicates', () => {
    const result = dedupeAddBatch(['ägg', 'ägg', 'ägg'])
    expect(result).toEqual([{ name: 'ägg', quantity: 3 }])
  })

  it('keeps distinct items separate while collapsing duplicates', () => {
    const result = dedupeAddBatch(['mjölk', 'smör', 'mjölk'])
    expect(result).toEqual([
      { name: 'mjölk', quantity: 2 },
      { name: 'smör', quantity: 1 },
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(dedupeAddBatch([])).toEqual([])
  })

  it('handles a single item', () => {
    expect(dedupeAddBatch(['mjölk'])).toEqual([{ name: 'mjölk', quantity: 1 }])
  })
})
