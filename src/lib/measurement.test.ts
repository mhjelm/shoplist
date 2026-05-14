import { describe, it, expect } from 'vitest'
import { parseMeasurement, tryCombine } from './measurement'

describe('parseMeasurement', () => {
  describe('basic numeric parsing', () => {
    it('parses integer with unit', () => {
      expect(parseMeasurement('500 g')).toEqual({ value: 500, unit: 'g' })
    })

    it('parses decimal with period', () => {
      expect(parseMeasurement('1.5 dl')).toEqual({ value: 1.5, unit: 'dl' })
    })

    it('parses bare number without unit', () => {
      expect(parseMeasurement('5')).toEqual({ value: 5, unit: '' })
    })

    it('handles surrounding whitespace', () => {
      expect(parseMeasurement('  500 g  ')).toEqual({ value: 500, unit: 'g' })
    })

    it('lowercases the unit', () => {
      expect(parseMeasurement('500 G')).toEqual({ value: 500, unit: 'g' })
    })

    it('accepts Swedish letters in units', () => {
      expect(parseMeasurement('2 förp')).toEqual({ value: 2, unit: 'förp' })
    })
  })

  describe('Swedish decimal commas', () => {
    it('converts decimal comma to period', () => {
      expect(parseMeasurement('1,5 dl')).toEqual({ value: 1.5, unit: 'dl' })
    })

    it('handles 0,5', () => {
      expect(parseMeasurement('0,5 kg')).toEqual({ value: 0.5, unit: 'kg' })
    })
  })

  describe('unicode fractions', () => {
    it('parses ½', () => {
      expect(parseMeasurement('½ dl')).toEqual({ value: 0.5, unit: 'dl' })
    })

    it('parses ¼', () => {
      expect(parseMeasurement('¼ tsk')).toEqual({ value: 0.25, unit: 'tsk' })
    })

    it('parses ¾', () => {
      expect(parseMeasurement('¾ kg')).toEqual({ value: 0.75, unit: 'kg' })
    })

    it('parses ⅛', () => {
      expect(parseMeasurement('⅛ tsk')).toEqual({ value: 0.125, unit: 'tsk' })
    })

    it('parses mixed numbers like 2½', () => {
      expect(parseMeasurement('2½ dl')).toEqual({ value: 2.5, unit: 'dl' })
    })

    it('parses ⅓ as 1/3', () => {
      const r = parseMeasurement('⅓ dl')
      expect(r?.value).toBeCloseTo(1 / 3)
      expect(r?.unit).toBe('dl')
    })
  })

  describe('approximation prefixes', () => {
    it('strips "ca"', () => {
      expect(parseMeasurement('ca 500 g')).toEqual({ value: 500, unit: 'g' })
    })

    it('strips "cirka"', () => {
      expect(parseMeasurement('cirka 500 g')).toEqual({ value: 500, unit: 'g' })
    })

    it('strips "ungefär"', () => {
      expect(parseMeasurement('ungefär 500 g')).toEqual({ value: 500, unit: 'g' })
    })

    it('is case-insensitive', () => {
      expect(parseMeasurement('CA 500 g')).toEqual({ value: 500, unit: 'g' })
    })

    it('does not strip mid-word', () => {
      // 'ca' inside another word stays put
      expect(parseMeasurement('cake 500 g')).toBeNull()
    })
  })

  describe('rejected inputs', () => {
    it('returns null for ranges (350-400)', () => {
      expect(parseMeasurement('350-400 g')).toBeNull()
    })

    it('returns null for parentheticals', () => {
      expect(parseMeasurement('500 g (2 förp)')).toBeNull()
    })

    it('returns null for compound "à"', () => {
      expect(parseMeasurement('2 förp à 500 g')).toBeNull()
    })

    it('returns null for non-numeric input', () => {
      expect(parseMeasurement('abc')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseMeasurement('')).toBeNull()
    })

    it('returns null for unit-only input', () => {
      expect(parseMeasurement('g')).toBeNull()
    })

    it('returns null for trailing junk', () => {
      expect(parseMeasurement('500 g extra')).toBeNull()
    })
  })
})

describe('tryCombine', () => {
  describe('inert cases (returns null)', () => {
    it('returns null for a single segment', () => {
      expect(tryCombine('500 g')).toBeNull()
    })

    it('returns null when nothing combines (all distinct units)', () => {
      // groups stay 1-each; result === input
      expect(tryCombine('500 g + 2 msk')).toBeNull()
    })

    it('returns null when any segment is unparseable', () => {
      expect(tryCombine('500 g + 350-400 g')).toBeNull()
    })

    it('returns null when a parenthetical is in any segment', () => {
      expect(tryCombine('500 g + 2 förp à 500 g')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(tryCombine('')).toBeNull()
    })
  })

  describe('combining same units', () => {
    it('sums two integers with the same unit', () => {
      expect(tryCombine('500 g + 200 g')).toBe('700 g')
    })

    it('sums three segments', () => {
      expect(tryCombine('1 dl + 5 dl + 3 dl')).toBe('9 dl')
    })

    it('sums Swedish-comma decimals', () => {
      expect(tryCombine('1,5 dl + 0,5 dl')).toBe('2 dl')
    })

    it('sums unicode fractions', () => {
      expect(tryCombine('½ dl + ½ dl')).toBe('1 dl')
    })

    it('strips trailing zeros from non-integer sums', () => {
      // 0.25 + 0.25 = 0.5, not "0.50"
      expect(tryCombine('¼ tsk + ¼ tsk')).toBe('0.5 tsk')
    })

    it('handles bare numbers (no unit) summed', () => {
      expect(tryCombine('2 + 3')).toBe('5')
    })
  })

  describe('mixed units that partly combine', () => {
    it('combines matching units, keeps others separate, preserves order', () => {
      expect(tryCombine('500 g + 2 msk + 300 g')).toBe('800 g + 2 msk')
    })

    it('three units, two of which collapse', () => {
      expect(tryCombine('1 dl + 200 g + 2 dl + 100 g')).toBe('3 dl + 300 g')
    })
  })
})
