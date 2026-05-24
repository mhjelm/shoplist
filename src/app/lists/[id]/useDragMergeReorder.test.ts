import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragMergeReorder } from './useDragMergeReorder'
import type { Item } from '@/lib/types'
import type { DragEndEvent } from '@dnd-kit/core'

vi.mock('@/lib/sync/mutations', () => ({
  muReorderItem: vi.fn().mockResolvedValue(undefined),
  muMergeItems: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...args: unknown[]) => args),
  }
})

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

function makeDragEvent(activeId: string, overId: string): DragEndEvent {
  return {
    active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    over: { id: overId, data: { current: undefined }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } },
    collisions: [],
    delta: { x: 0, y: 0 },
    activatorEvent: new Event('pointerdown'),
  } as unknown as DragEndEvent
}

const items = [
  makeItem('a', { sort_order: 1, category: 'mejeri' }),
  makeItem('b', { sort_order: 2, category: 'mejeri' }),
  makeItem('c', { sort_order: 3, category: 'mejeri' }),
]

describe('useDragMergeReorder', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ---------------------------------------------------------------------------
  // Reorder mode (editMode = false)
  // ---------------------------------------------------------------------------

  it('calls muReorderItem when dragging in reorder mode', async () => {
    const { muReorderItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: false })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('c', 'a')) })
    expect(vi.mocked(muReorderItem)).toHaveBeenCalledOnce()
    expect(vi.mocked(muReorderItem).mock.calls[0][0]).toBe('list-1')
  })

  it('does nothing when active === over', async () => {
    const { muReorderItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: false })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('a', 'a')) })
    expect(vi.mocked(muReorderItem)).not.toHaveBeenCalled()
  })

  it('does nothing when dragging across categories', async () => {
    const { muReorderItem } = await import('@/lib/sync/mutations')
    const crossItems = [
      makeItem('a', { category: 'mejeri', sort_order: 1 }),
      makeItem('b', { category: 'brod', sort_order: 2 }),
    ]
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items: crossItems, editMode: false })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('a', 'b')) })
    expect(vi.mocked(muReorderItem)).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Merge mode (editMode = true)
  // ---------------------------------------------------------------------------

  it('sets pendingMerge instead of reordering when editMode is true', async () => {
    const { muReorderItem } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: true })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('a', 'b')) })
    expect(vi.mocked(muReorderItem)).not.toHaveBeenCalled()
    expect(result.current.pendingMerge).not.toBeNull()
    expect(result.current.pendingMerge?.source.id).toBe('a')
    expect(result.current.pendingMerge?.target.id).toBe('b')
  })

  // ---------------------------------------------------------------------------
  // handleMergeConfirm
  // ---------------------------------------------------------------------------

  it('calls muMergeItems and clears pendingMerge on confirm', async () => {
    const { muMergeItems } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: true })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('a', 'b')) })
    await act(async () => { await result.current.handleMergeConfirm() })
    expect(vi.mocked(muMergeItems)).toHaveBeenCalledOnce()
    expect(result.current.pendingMerge).toBeNull()
  })

  it('handleMergeConfirm is a no-op when there is no pendingMerge', async () => {
    const { muMergeItems } = await import('@/lib/sync/mutations')
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: false })
    )
    await act(async () => { await result.current.handleMergeConfirm() })
    expect(vi.mocked(muMergeItems)).not.toHaveBeenCalled()
  })

  it('setPendingMerge(null) cancels the pending merge', () => {
    const { result } = renderHook(() =>
      useDragMergeReorder({ listId: 'list-1', items, editMode: true })
    )
    act(() => { result.current.handleDragEnd(makeDragEvent('a', 'b')) })
    expect(result.current.pendingMerge).not.toBeNull()
    act(() => { result.current.setPendingMerge(null) })
    expect(result.current.pendingMerge).toBeNull()
  })
})
