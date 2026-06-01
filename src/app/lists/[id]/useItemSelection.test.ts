import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useItemSelection } from './useItemSelection'
import type { Item } from '@/lib/types'

vi.mock('./actions', () => ({
  moveItemsToList: vi.fn(),
  copyItemsToList: vi.fn(),
  shareItemsToList: vi.fn(),
}))
vi.mock('@/lib/db/local', () => ({
  localDB: {
    items: {
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      bulkPut: vi.fn().mockResolvedValue(undefined),
    },
  },
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
  editMode: true,
  items: [makeItem('a'), makeItem('b'), makeItem('c')],
  listId: 'list-1',
}

describe('useItemSelection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ---------------------------------------------------------------------------
  // toggleSelect
  // ---------------------------------------------------------------------------

  it('starts with no selection', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('adds an id on first toggle', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.toggleSelect('a') })
    expect(result.current.selectedIds.has('a')).toBe(true)
  })

  it('removes an id on second toggle (deselect)', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.toggleSelect('a') })
    act(() => { result.current.toggleSelect('a') })
    expect(result.current.selectedIds.has('a')).toBe(false)
  })

  it('can select multiple ids independently', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.toggleSelect('a') })
    act(() => { result.current.toggleSelect('b') })
    expect(result.current.selectedIds.size).toBe(2)
    expect(result.current.selectedIds.has('a')).toBe(true)
    expect(result.current.selectedIds.has('b')).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // edit-mode-leave reset
  // ---------------------------------------------------------------------------

  it('clears selection when editMode transitions from true to false', () => {
    let editMode = true
    const { result, rerender } = renderHook(
      ({ editMode }) => useItemSelection({ ...defaultProps, editMode }),
      { initialProps: { editMode } },
    )
    act(() => { result.current.toggleSelect('a') })
    expect(result.current.selectedIds.size).toBe(1)

    editMode = false
    rerender({ editMode })
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.pickerMode).toBeNull()
    expect(result.current.pickerError).toBeNull()
  })

  it('does NOT clear selection when editMode remains true', () => {
    const { result, rerender } = renderHook(
      ({ editMode }) => useItemSelection({ ...defaultProps, editMode }),
      { initialProps: { editMode: true } },
    )
    act(() => { result.current.toggleSelect('a') })
    rerender({ editMode: true })
    expect(result.current.selectedIds.size).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // pickerMode / pickerError setters
  // ---------------------------------------------------------------------------

  it('setPickerMode updates pickerMode', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.setPickerMode('copy') })
    expect(result.current.pickerMode).toBe('copy')
  })

  it('setPickerError updates pickerError', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.setPickerError('något gick fel') })
    expect(result.current.pickerError).toBe('något gick fel')
  })

  // ---------------------------------------------------------------------------
  // handlePickTarget — copy
  // ---------------------------------------------------------------------------

  it('handlePickTarget copy calls copyItemsToList and clears state', async () => {
    const { copyItemsToList } = await import('./actions')
    vi.mocked(copyItemsToList).mockResolvedValue({ items: [] })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('copy')
    })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(copyItemsToList)).toHaveBeenCalledWith('list-2', expect.any(Array))
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.pickerMode).toBeNull()
  })

  it('handlePickTarget copy sets pickerError and throws on server error', async () => {
    const { copyItemsToList } = await import('./actions')
    vi.mocked(copyItemsToList).mockResolvedValue({ error: 'server error' })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('copy')
    })

    let threw = false
    await act(async () => {
      try { await result.current.handlePickTarget('list-2') }
      catch { threw = true }
    })

    expect(threw).toBe(true)
    expect(result.current.pickerError).toBe('server error')
  })

  // ---------------------------------------------------------------------------
  // handlePickTarget — move
  // ---------------------------------------------------------------------------

  it('handlePickTarget move calls moveItemsToList then bulkDelete on success', async () => {
    const { moveItemsToList } = await import('./actions')
    const { localDB } = await import('@/lib/db/local')
    vi.mocked(moveItemsToList).mockResolvedValue({ items: [] })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('move')
    })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(moveItemsToList)).toHaveBeenCalledWith('list-1', 'list-2', ['a'], expect.any(Array))
    expect(vi.mocked(localDB.items.bulkDelete)).toHaveBeenCalledWith(['a'])
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('handlePickTarget move seeds the destination Dexie cache with the returned rows', async () => {
    const { moveItemsToList } = await import('./actions')
    const { localDB } = await import('@/lib/db/local')
    // Server rows for the *target* list. Without seeding these, the receiving
    // user opens the target list and sees nothing (the precheck may skip the
    // refetch), assumes the move failed, and re-adds by hand → duplicates.
    const movedRows = [{ id: 'srv-a', list_id: 'list-2', name: 'Item a' }]
    vi.mocked(moveItemsToList).mockResolvedValue({ items: movedRows })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('move')
    })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(localDB.items.bulkPut)).toHaveBeenCalledWith(movedRows)
  })

  it('handlePickTarget copy seeds the destination Dexie cache with the returned rows', async () => {
    const { copyItemsToList } = await import('./actions')
    const { localDB } = await import('@/lib/db/local')
    const copiedRows = [{ id: 'srv-a', list_id: 'list-2', name: 'Item a' }]
    vi.mocked(copyItemsToList).mockResolvedValue({ items: copiedRows })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('copy')
    })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(localDB.items.bulkPut)).toHaveBeenCalledWith(copiedRows)
  })

  it('handlePickTarget is a no-op when nothing is selected', async () => {
    const { copyItemsToList } = await import('./actions')
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.setPickerMode('copy') })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(copyItemsToList)).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // handlePickTarget — share
  // ---------------------------------------------------------------------------

  it('setPickerMode accepts the share mode', () => {
    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => { result.current.setPickerMode('share') })
    expect(result.current.pickerMode).toBe('share')
  })

  it('handlePickTarget share calls shareItemsToList and clears state (no Dexie mutation)', async () => {
    const { shareItemsToList } = await import('./actions')
    const { localDB } = await import('@/lib/db/local')
    vi.mocked(shareItemsToList).mockResolvedValue({ items: [] })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.toggleSelect('b')
      result.current.setPickerMode('share')
    })

    await act(async () => { await result.current.handlePickTarget('list-2') })

    expect(vi.mocked(shareItemsToList)).toHaveBeenCalledWith('list-1', 'list-2', expect.arrayContaining(['a', 'b']))
    // Sharing must NOT touch local items — siblings live on another list; the
    // source row's shared_group_id arrives via the realtime UPDATE.
    expect(vi.mocked(localDB.items.bulkDelete)).not.toHaveBeenCalled()
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.pickerMode).toBeNull()
  })

  it('handlePickTarget share sets pickerError and throws on server error', async () => {
    const { shareItemsToList } = await import('./actions')
    vi.mocked(shareItemsToList).mockResolvedValue({ error: 'no permission' })

    const { result } = renderHook(() => useItemSelection(defaultProps))
    act(() => {
      result.current.toggleSelect('a')
      result.current.setPickerMode('share')
    })

    let threw = false
    await act(async () => {
      try { await result.current.handlePickTarget('list-2') }
      catch { threw = true }
    })

    expect(threw).toBe(true)
    expect(result.current.pickerError).toBe('no permission')
  })
})
