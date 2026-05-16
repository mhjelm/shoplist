import { describe, it, expect } from 'vitest'
import { splitPlainItems } from './parseAddInput'

describe('splitPlainItems', () => {
  it('splits by newline', () => {
    const input = 'Chicken bacon bbq wrap\nTwister fries large\nMozarella sticks\nChili mayonäsdip'
    expect(splitPlainItems(input)).toEqual([
      'Chicken bacon bbq wrap',
      'Twister fries large',
      'Mozarella sticks',
      'Chili mayonäsdip',
    ])
  })

  it('splits by comma', () => {
    expect(splitPlainItems('mjölk, banan, ägg')).toEqual(['mjölk', 'banan', 'ägg'])
  })

  it('prefers newline over comma when both present', () => {
    const input = 'mjölk, fil\nbanan\nsmör, margarin'
    expect(splitPlainItems(input)).toEqual(['mjölk, fil', 'banan', 'smör, margarin'])
  })

  it('drops empty segments from trailing comma', () => {
    expect(splitPlainItems('mjölk, banan,')).toEqual(['mjölk', 'banan'])
  })

  it('drops empty segments from blank lines', () => {
    expect(splitPlainItems('mjölk\n\nbanan\n')).toEqual(['mjölk', 'banan'])
  })

  it('trims whitespace from each segment', () => {
    expect(splitPlainItems('  mjölk  ,  banan  ')).toEqual(['mjölk', 'banan'])
  })

  it('returns single item for plain name with no delimiters', () => {
    expect(splitPlainItems('Chicken bacon bbq wrap')).toEqual(['Chicken bacon bbq wrap'])
  })
})
