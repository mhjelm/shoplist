import { describe, it, expect } from 'vitest'
import { buildItemUpdatePayload } from '@/lib/itemUpdate'

describe('buildItemUpdatePayload', () => {
  it('forwards is_checked — covers the toggle bug that broke offline shopping', () => {
    expect(buildItemUpdatePayload({ is_checked: true })).toEqual({ is_checked: true })
    expect(buildItemUpdatePayload({ is_checked: false })).toEqual({ is_checked: false })
  })

  it('trims string fields', () => {
    expect(buildItemUpdatePayload({ name: '  Mjölk  ' })).toEqual({ name: 'Mjölk' })
    expect(buildItemUpdatePayload({ measurement: '  5 dl  ' })).toEqual({ measurement: '5 dl' })
  })

  it('coerces empty/whitespace strings to null for nullable columns', () => {
    expect(buildItemUpdatePayload({ picture_url: '   ' })).toEqual({ picture_url: null })
    expect(buildItemUpdatePayload({ measurement: '' })).toEqual({ measurement: null })
  })

  it('honours explicit null for picture_url and measurement', () => {
    expect(buildItemUpdatePayload({ picture_url: null })).toEqual({ picture_url: null })
    expect(buildItemUpdatePayload({ measurement: null })).toEqual({ measurement: null })
  })

  it('clamps quantity to a minimum of 1', () => {
    expect(buildItemUpdatePayload({ quantity: 0 })).toEqual({ quantity: 1 })
    expect(buildItemUpdatePayload({ quantity: -5 })).toEqual({ quantity: 1 })
    expect(buildItemUpdatePayload({ quantity: 4 })).toEqual({ quantity: 4 })
  })

  it('returns an empty object for an empty patch (caller can skip the SQL update)', () => {
    expect(buildItemUpdatePayload({})).toEqual({})
  })

  it('composes multiple fields including is_checked', () => {
    expect(buildItemUpdatePayload({
      name: 'Bröd',
      quantity: 2,
      is_checked: true,
      measurement: '500 g',
    })).toEqual({
      name: 'Bröd',
      quantity: 2,
      is_checked: true,
      measurement: '500 g',
    })
  })
})
