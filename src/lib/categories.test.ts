import { describe, it, expect } from 'vitest'
import { CATEGORIES, DEFAULT_CATEGORY_ORDER, categoryLabel, isValidCategorySlug } from './categories'

describe('CATEGORIES', () => {
  it('has 11 entries', () => {
    expect(CATEGORIES).toHaveLength(11)
  })

  it('has unique slugs', () => {
    const slugs = CATEGORIES.map(c => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('includes the ovrigt fallback slug', () => {
    expect(CATEGORIES.some(c => c.slug === 'ovrigt')).toBe(true)
  })
})

describe('DEFAULT_CATEGORY_ORDER', () => {
  it('matches CATEGORIES length', () => {
    expect(DEFAULT_CATEGORY_ORDER).toHaveLength(CATEGORIES.length)
  })

  it('contains every defined slug', () => {
    for (const c of CATEGORIES) {
      expect(DEFAULT_CATEGORY_ORDER).toContain(c.slug)
    }
  })
})

describe('isValidCategorySlug', () => {
  it('accepts every defined slug', () => {
    for (const c of CATEGORIES) {
      expect(isValidCategorySlug(c.slug)).toBe(true)
    }
  })

  it('rejects an unknown slug', () => {
    expect(isValidCategorySlug('not-a-real-slug')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidCategorySlug('')).toBe(false)
  })

  it('rejects a label (labels are not slugs)', () => {
    expect(isValidCategorySlug('Frukt & grönt')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isValidCategorySlug('OVRIGT')).toBe(false)
  })
})

describe('categoryLabel', () => {
  it('returns the Swedish label for a known slug', () => {
    expect(categoryLabel('frukt-gront')).toBe('Frukt & grönt')
    expect(categoryLabel('mejeri')).toBe('Mejeri')
    expect(categoryLabel('ovrigt')).toBe('Övrigt')
  })

  it('falls back to the input string for an unknown slug', () => {
    expect(categoryLabel('not-a-real-slug')).toBe('not-a-real-slug')
  })

  it('falls back to empty string for empty input', () => {
    expect(categoryLabel('')).toBe('')
  })
})
