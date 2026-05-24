import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAddItems } from './useAddItems'
import type { Item } from '@/lib/types'

vi.mock('@/lib/sync/mutations', () => ({
  muAddItem: vi.fn().mockResolvedValue(undefined),
  muUpdateItem: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./actions', () => ({
  extractAddItems: vi.fn(),
  deleteHistoryItem: vi.fn(),
}))
vi.mock('@/lib/db/local', () => ({
  localDB: { items: { bulkPut: vi.fn().mockResolvedValue(undefined) } },
}))

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    list_id: 'list-1',
    added_by: 'user-1',
    name: `Item ${id}`,
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    ...overrides,
  }
}

const defaultProps = {
  listId: 'list-1',
  items: [] as Item[],
  suggestions: ['mjölk', 'smör', 'ägg'],
  isOffline: false,
}

describe('useAddItems', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ---------------------------------------------------------------------------
  // handleInputChange / filtering
  // ---------------------------------------------------------------------------

  it('updates input on handleInputChange', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('mj') })
    expect(result.current.input).toBe('mj')
  })

  it('filters suggestions by input', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('mj') })
    expect(result.current.filtered).toEqual(['mjölk'])
  })

  it('clears suggestions when input is empty', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('mj') })
    act(() => { result.current.handleInputChange('') })
    expect(result.current.filtered).toEqual([])
  })

  it('clears suggestions when input contains a digit', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('2 mj') })
    expect(result.current.filtered).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // handleAdd — plain single name (outbox path)
  // ---------------------------------------------------------------------------

  it('plain add inserts a new item via muAddItem', async () => {
    const { muAddItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() => useAddItems(defaultProps))

    act(() => { result.current.handleInputChange('mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muAddItem)).toHaveBeenCalledOnce()
    expect(vi.mocked(muAddItem).mock.calls[0][0]).toMatchObject({ name: 'mjölk', list_id: 'list-1', quantity: 1 })
    expect(result.current.input).toBe('')
  })

  it('plain add bumps quantity if active item already exists', async () => {
    const { muUpdateItem } = await import('@/lib/sync/mutations')
    const existingItem = makeItem('x', { name: 'mjölk', quantity: 2, is_checked: false })
    const { result } = renderHook(() => useAddItems({ ...defaultProps, items: [existingItem] }))

    act(() => { result.current.handleInputChange('mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muUpdateItem)).toHaveBeenCalledWith('list-1', 'x', { quantity: 3, is_checked: false })
  })

  it('plain add keeps existing measurement when bumping quantity', async () => {
    const { muUpdateItem } = await import('@/lib/sync/mutations')
    const existing = makeItem('p', { name: 'Potatis', quantity: 1, measurement: '300 g' })
    const { result } = renderHook(() => useAddItems({ ...defaultProps, items: [existing] }))

    act(() => { result.current.handleInputChange('potatis') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muUpdateItem)).toHaveBeenCalledWith('list-1', 'p', { quantity: 2, is_checked: false })
  })

  it('plain add revives a shopped item (case-insensitive, bumps quantity)', async () => {
    const { muUpdateItem } = await import('@/lib/sync/mutations')
    const shoppedItem = makeItem('y', { name: 'Mjölk', quantity: 1, is_checked: true })
    const { result } = renderHook(() => useAddItems({ ...defaultProps, items: [shoppedItem] }))

    act(() => { result.current.handleInputChange('mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muUpdateItem)).toHaveBeenCalledWith('list-1', 'y', { quantity: 2, is_checked: false })
  })

  it('does nothing on handleAdd when input is empty', async () => {
    const { muAddItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() => useAddItems(defaultProps))
    await act(async () => { await result.current.handleAdd() })
    expect(vi.mocked(muAddItem)).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // handleAdd — plain multi-add (comma separated)
  // ---------------------------------------------------------------------------

  it('multi-add inserts each unique name', async () => {
    const { muAddItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() => useAddItems(defaultProps))

    act(() => { result.current.handleInputChange('mjölk, smör') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muAddItem)).toHaveBeenCalledTimes(2)
  })

  it('multi-add deduplicates names within the batch', async () => {
    const { muAddItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() => useAddItems(defaultProps))

    act(() => { result.current.handleInputChange('mjölk, mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muAddItem)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(muAddItem).mock.calls[0][0]).toMatchObject({ name: 'mjölk', quantity: 2 })
  })

  // ---------------------------------------------------------------------------
  // handleAdd — digit-bearing (AI extraction path)
  // ---------------------------------------------------------------------------

  it('digit-bearing add calls extractAddItems then muAddItem per parsed item', async () => {
    const { extractAddItems } = await import('./actions')
    const { muAddItem } = await import('@/lib/sync/mutations')
    vi.mocked(extractAddItems).mockResolvedValue({
      items: [{ name: 'mjölk', quantity: 2, measurement: 'dl', category: 'mejeri' }],
    })

    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('2 dl mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(extractAddItems)).toHaveBeenCalledWith('2 dl mjölk')
    expect(vi.mocked(muAddItem)).toHaveBeenCalledOnce()
    expect(vi.mocked(muAddItem).mock.calls[0][0]).toMatchObject({
      name: 'mjölk',
      quantity: 2,
      measurement: 'dl',
      category: 'mejeri',
      list_id: 'list-1',
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.input).toBe('')
  })

  it('digit-bearing add merges measurement into existing item via muUpdateItem', async () => {
    const { extractAddItems } = await import('./actions')
    const { muAddItem, muUpdateItem } = await import('@/lib/sync/mutations')
    vi.mocked(extractAddItems).mockResolvedValue({
      items: [{ name: 'potatis', quantity: 1, measurement: '500 g', category: 'frukt-gront' }],
    })
    const existing = makeItem('p', { name: 'Potatis', quantity: 1, measurement: '300 g' })
    const { result } = renderHook(() => useAddItems({ ...defaultProps, items: [existing] }))

    act(() => { result.current.handleInputChange('potatis 500g') })
    await act(async () => { await result.current.handleAdd() })

    expect(vi.mocked(muAddItem)).not.toHaveBeenCalled()
    expect(vi.mocked(muUpdateItem)).toHaveBeenCalledWith('list-1', 'p', {
      quantity: 2,
      measurement: '300 g + 500 g',
      is_checked: false,
    })
  })

  it('restores input and sets error when extractAddItems returns an error', async () => {
    const { extractAddItems } = await import('./actions')
    vi.mocked(extractAddItems).mockResolvedValue({ error: 'AI failed', items: undefined })

    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('2 mjölk') })
    await act(async () => { await result.current.handleAdd() })

    expect(result.current.addError).toBe('AI failed')
    expect(result.current.input).toBe('2 mjölk')
    expect(result.current.loading).toBe(false)
  })

  it('restores input and sets error when extractAddItems throws', async () => {
    const { extractAddItems } = await import('./actions')
    vi.mocked(extractAddItems).mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('3 ägg') })
    await act(async () => { await result.current.handleAdd() })

    expect(result.current.addError).toBe('network error')
    expect(result.current.input).toBe('3 ägg')
    expect(result.current.loading).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // selectSuggestion / handleDeleteSuggestion
  // ---------------------------------------------------------------------------

  it('selectSuggestion sets input and clears filtered', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('mj') })
    act(() => { result.current.selectSuggestion('mjölk') })
    expect(result.current.input).toBe('mjölk')
    expect(result.current.filtered).toEqual([])
  })

  it('handleDeleteSuggestion removes the item from filtered', () => {
    const { result } = renderHook(() => useAddItems(defaultProps))
    act(() => { result.current.handleInputChange('m') })
    act(() => { result.current.handleDeleteSuggestion('mjölk') })
    expect(result.current.filtered).not.toContain('mjölk')
  })
})
