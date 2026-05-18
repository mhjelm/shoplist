import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OutboxEntry } from '@/lib/db/types'

vi.mock('@/app/lists/[id]/actions', () => ({
  addItem: vi.fn().mockResolvedValue({ item: { id: 'item-1', category: 'mejeri' }, merged: false }),
  updateItem: vi.fn().mockResolvedValue(undefined),
  setItemCategory: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  reorderItem: vi.fn().mockResolvedValue(undefined),
  mergeItems: vi.fn().mockResolvedValue(undefined),
  categorizeItem: vi.fn().mockResolvedValue({}),
  touchListView: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    items: { update: vi.fn().mockResolvedValue(undefined) },
  },
}))

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    seq: 1,
    list_id: 'list-1',
    type: 'item.insert',
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
    idempotency_key: 'key-1',
    payload: {},
    ...overrides,
  }
}

describe('outbox dispatcher — item.insert', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('forwards name, picture_url, and clientId to addItem', async () => {
    const { _dispatchEntry } = await import('./engine')
    const { addItem } = await import('@/app/lists/[id]/actions')

    await _dispatchEntry(makeEntry({
      payload: { id: 'item-1', list_id: 'list-1', name: 'Mjölk', picture_url: null },
    }))

    expect(vi.mocked(addItem)).toHaveBeenCalledOnce()
    const [listId, name,, clientId] = vi.mocked(addItem).mock.calls[0]
    expect(listId).toBe('list-1')
    expect(name).toBe('Mjölk')
    expect(clientId).toBe('item-1')
  })

  it('forwards quantity, measurement, and category to addItem', async () => {
    const { _dispatchEntry } = await import('./engine')
    const { addItem } = await import('@/app/lists/[id]/actions')

    await _dispatchEntry(makeEntry({
      payload: {
        id: 'item-2',
        list_id: 'list-1',
        name: 'Mjölk',
        picture_url: null,
        quantity: 3,
        measurement: '1 l',
        category: 'mejeri',
      },
    }))

    expect(vi.mocked(addItem)).toHaveBeenCalledOnce()
    const call = vi.mocked(addItem).mock.calls[0]
    // addItem(listId, name, pictureUrl, clientId, quantity, measurement, category)
    expect(call[4]).toBe(3)           // quantity
    expect(call[5]).toBe('1 l')       // measurement
    expect(call[6]).toBe('mejeri')    // category
  })

  it('passes undefined for optional fields when not present in payload', async () => {
    const { _dispatchEntry } = await import('./engine')
    const { addItem } = await import('@/app/lists/[id]/actions')

    await _dispatchEntry(makeEntry({
      payload: { id: 'item-3', list_id: 'list-1', name: 'Smör', picture_url: null },
    }))

    const call = vi.mocked(addItem).mock.calls[0]
    expect(call[4]).toBeUndefined()   // quantity
    expect(call[5]).toBeUndefined()   // measurement
    expect(call[6]).toBeUndefined()   // category
  })

  it('bumps touchListView AFTER the item write so own edits are pre-seen', async () => {
    const { _dispatchEntry } = await import('./engine')
    const { addItem, touchListView } = await import('@/app/lists/[id]/actions')

    const callOrder: string[] = []
    vi.mocked(addItem).mockImplementationOnce(async () => {
      callOrder.push('addItem')
      return { item: { id: 'x', category: null }, merged: false }
    })
    vi.mocked(touchListView).mockImplementationOnce(async () => {
      callOrder.push('touchListView')
      return {}
    })

    await _dispatchEntry(makeEntry({
      payload: { id: 'x', list_id: 'list-1', name: 'Item', picture_url: null },
    }))

    expect(callOrder).toEqual(['addItem', 'touchListView'])
    expect(vi.mocked(touchListView)).toHaveBeenCalledWith('list-1')
  })
})

describe('outbox dispatcher — list_views bump on every mutation type', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each([
    ['item.update', { id: 'i', list_id: 'l', patch: { name: 'x' } }],
    ['item.delete', { id: 'i', list_id: 'l' }],
    ['item.reorder', { id: 'i', list_id: 'l', sort_order: 1 }],
    ['item.merge', { source_id: 's', target_id: 't', list_id: 'l' }],
  ] as const)('bumps touchListView after a %s', async (type, payload) => {
    const { _dispatchEntry } = await import('./engine')
    const { touchListView } = await import('@/app/lists/[id]/actions')

    await _dispatchEntry(makeEntry({ type, payload }))

    expect(vi.mocked(touchListView)).toHaveBeenCalledWith('l')
  })
})
