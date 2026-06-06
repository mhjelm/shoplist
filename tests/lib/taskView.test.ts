import { describe, it, expect } from 'vitest'
import { dueStatus, formatDueLabel, sortTasks } from '@/lib/taskView'
import type { Item } from '@/lib/types'

const NOW = new Date(2026, 5, 7) // 2026-06-07, local

function task(partial: Partial<Item>): Item {
  return {
    id: partial.id ?? crypto.randomUUID(),
    list_id: 'l1',
    added_by: '',
    name: partial.name ?? 'task',
    is_checked: false,
    created_at: partial.created_at ?? '2026-06-01T00:00:00.000Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    assignee_id: partial.assignee_id ?? null,
    due_date: partial.due_date ?? null,
  }
}

describe('dueStatus', () => {
  it('returns null with no due date', () => {
    expect(dueStatus(null, NOW)).toBeNull()
  })
  it('buckets past dates as overdue', () => {
    expect(dueStatus('2026-06-06', NOW)).toBe('overdue')
    expect(dueStatus('2026-01-01', NOW)).toBe('overdue')
  })
  it('buckets the same day as today', () => {
    expect(dueStatus('2026-06-07', NOW)).toBe('today')
  })
  it('buckets 1–2 days out as soon', () => {
    expect(dueStatus('2026-06-08', NOW)).toBe('soon')
    expect(dueStatus('2026-06-09', NOW)).toBe('soon')
  })
  it('buckets >2 days out as future', () => {
    expect(dueStatus('2026-06-10', NOW)).toBe('future')
    expect(dueStatus('2026-12-31', NOW)).toBe('future')
  })
  it('tolerates a full ISO timestamp', () => {
    expect(dueStatus('2026-06-07T12:00:00Z', NOW)).toBe('today')
  })
})

describe('formatDueLabel', () => {
  it('uses Today / Tomorrow for 0 and 1 days', () => {
    expect(formatDueLabel('2026-06-07', NOW)).toBe('Today')
    expect(formatDueLabel('2026-06-08', NOW)).toBe('Tomorrow')
  })
  it('returns null without a date', () => {
    expect(formatDueLabel(null, NOW)).toBeNull()
  })
})

describe('sortTasks', () => {
  it('orders by due date ascending with undated tasks last', () => {
    const items = [
      task({ id: 'none', due_date: null, created_at: '2026-06-01T00:00:00Z' }),
      task({ id: 'late', due_date: '2026-06-20' }),
      task({ id: 'soon', due_date: '2026-06-08' }),
    ]
    expect(sortTasks(items).map(i => i.id)).toEqual(['soon', 'late', 'none'])
  })
  it('breaks ties by created_at', () => {
    const items = [
      task({ id: 'b', due_date: null, created_at: '2026-06-05T00:00:00Z' }),
      task({ id: 'a', due_date: null, created_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(sortTasks(items).map(i => i.id)).toEqual(['a', 'b'])
  })
  it('does not mutate the input array', () => {
    const items = [task({ id: 'x', due_date: '2026-06-09' }), task({ id: 'y', due_date: '2026-06-08' })]
    const copy = [...items]
    sortTasks(items)
    expect(items).toEqual(copy)
  })
})
