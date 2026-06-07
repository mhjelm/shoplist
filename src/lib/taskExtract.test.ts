import { describe, it, expect } from 'vitest'
import { normalizeTaskNames } from './taskExtract'

describe('normalizeTaskNames', () => {
  it('returns [] when tasks is missing or not an array', () => {
    expect(normalizeTaskNames({})).toEqual([])
    expect(normalizeTaskNames({ tasks: 'nope' as unknown })).toEqual([])
    expect(normalizeTaskNames({ tasks: null as unknown })).toEqual([])
  })

  it('trims names and drops empties / non-strings', () => {
    expect(
      normalizeTaskNames({ tasks: ['  Ring rörmokaren  ', '', '   ', 42, null, 'Vattna blommorna'] }),
    ).toEqual(['Ring rörmokaren', 'Vattna blommorna'])
  })

  it('dedupes case-insensitively, keeping the first occurrence', () => {
    expect(
      normalizeTaskNames({ tasks: ['Hämta tvätten', 'hämta tvätten', 'HÄMTA TVÄTTEN', 'Diska'] }),
    ).toEqual(['Hämta tvätten', 'Diska'])
  })

  it('clamps a single name to 200 chars', () => {
    const long = 'a'.repeat(250)
    const [out] = normalizeTaskNames({ tasks: [long] })
    expect(out).toHaveLength(200)
  })

  it('caps the number of tasks at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Task ${i}`)
    expect(normalizeTaskNames({ tasks: many })).toHaveLength(50)
  })
})
