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

  it('forwards task fields assignee_id and due_date', () => {
    expect(buildItemUpdatePayload({ assignee_id: 'u-1' })).toEqual({ assignee_id: 'u-1' })
    expect(buildItemUpdatePayload({ due_date: '2026-06-09' })).toEqual({ due_date: '2026-06-09' })
  })

  it('clears task fields on explicit null or empty string (Unassigned / no due date)', () => {
    expect(buildItemUpdatePayload({ assignee_id: null })).toEqual({ assignee_id: null })
    expect(buildItemUpdatePayload({ assignee_id: '' })).toEqual({ assignee_id: null })
    expect(buildItemUpdatePayload({ due_date: null })).toEqual({ due_date: null })
    expect(buildItemUpdatePayload({ due_date: '' })).toEqual({ due_date: null })
  })

  it('omits task fields entirely when not present in the patch', () => {
    const payload = buildItemUpdatePayload({ name: 'Mow lawn' })
    expect('assignee_id' in payload).toBe(false)
    expect('due_date' in payload).toBe(false)
  })

  it('forwards and trims notes fields url and note', () => {
    expect(buildItemUpdatePayload({ url: '  https://x.test  ' })).toEqual({ url: 'https://x.test' })
    expect(buildItemUpdatePayload({ note: '  remember this  ' })).toEqual({ note: 'remember this' })
  })

  it('clears notes fields on explicit null or empty/whitespace string', () => {
    expect(buildItemUpdatePayload({ url: null })).toEqual({ url: null })
    expect(buildItemUpdatePayload({ url: '   ' })).toEqual({ url: null })
    expect(buildItemUpdatePayload({ note: null })).toEqual({ note: null })
    expect(buildItemUpdatePayload({ note: '' })).toEqual({ note: null })
  })

  it('omits notes fields entirely when not present in the patch', () => {
    const payload = buildItemUpdatePayload({ name: 'A link' })
    expect('url' in payload).toBe(false)
    expect('note' in payload).toBe(false)
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
