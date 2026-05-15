import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useSyncState,
  addConflicts,
  dismissConflicts,
  markOffline,
  markOnlineIfBrowserAgrees,
  setActiveList,
  getActiveList,
} from '@/lib/sync/engine'

beforeEach(() => {
  dismissConflicts()
  // Clear isOffline left by the connectivity tests below.
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  markOnlineIfBrowserAgrees()
})

afterEach(() => {
  vi.useRealTimers()
  setActiveList(null)
})

describe('useSyncState', () => {
  it('returns initial state', () => {
    const { result } = renderHook(() => useSyncState())
    expect(result.current.isOffline).toBe(false)
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.recentConflicts).toHaveLength(0)
  })

  it('reflects addConflicts immediately', () => {
    const { result } = renderHook(() => useSyncState())
    act(() => { addConflicts([{ id: 'a', name: 'Mjölk' }]) })
    expect(result.current.recentConflicts).toHaveLength(1)
    expect(result.current.recentConflicts[0].name).toBe('Mjölk')
  })

  it('reflects dismissConflicts immediately', () => {
    const { result } = renderHook(() => useSyncState())
    act(() => {
      addConflicts([{ id: 'a', name: 'Mjölk' }])
      dismissConflicts()
    })
    expect(result.current.recentConflicts).toHaveLength(0)
  })

  it('two concurrent hooks both receive updates', () => {
    const { result: r1 } = renderHook(() => useSyncState())
    const { result: r2 } = renderHook(() => useSyncState())
    act(() => { addConflicts([{ id: 'x', name: 'Bröd' }]) })
    expect(r1.current.recentConflicts).toHaveLength(1)
    expect(r2.current.recentConflicts).toHaveLength(1)
  })
})

describe('addConflicts', () => {
  it('accumulates across multiple calls', () => {
    const { result } = renderHook(() => useSyncState())
    act(() => {
      addConflicts([{ id: 'a', name: 'Ägg' }])
      addConflicts([{ id: 'b', name: 'Smör' }])
    })
    expect(result.current.recentConflicts).toHaveLength(2)
    expect(result.current.recentConflicts.map(c => c.name)).toEqual(['Ägg', 'Smör'])
  })

  it('auto-dismisses after 30 seconds', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSyncState())
    act(() => { addConflicts([{ id: 'x', name: 'Bröd' }]) })
    expect(result.current.recentConflicts).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current.recentConflicts).toHaveLength(0)
  })

  it('only auto-dismisses its own batch, not a later one', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useSyncState())
    act(() => { addConflicts([{ id: 'a', name: 'Bröd' }]) })
    act(() => {
      vi.advanceTimersByTime(15_000)
      addConflicts([{ id: 'b', name: 'Kaffe' }])
    })
    act(() => { vi.advanceTimersByTime(15_000) }) // first batch timer expires
    // 'Bröd' dismissed, 'Kaffe' still has ~15 s left
    expect(result.current.recentConflicts).toHaveLength(1)
    expect(result.current.recentConflicts[0].name).toBe('Kaffe')
  })
})

describe('connectivity flags', () => {
  it('markOffline flips isOffline to true', () => {
    const { result } = renderHook(() => useSyncState())
    expect(result.current.isOffline).toBe(false)
    act(() => { markOffline() })
    expect(result.current.isOffline).toBe(true)
  })

  it('markOnlineIfBrowserAgrees clears isOffline only when navigator says online', () => {
    const { result } = renderHook(() => useSyncState())
    act(() => { markOffline() })
    expect(result.current.isOffline).toBe(true)

    // Browser still claims offline → don't lie to the UI.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    act(() => { markOnlineIfBrowserAgrees() })
    expect(result.current.isOffline).toBe(true)

    // Browser agrees we're online → clear the flag.
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    act(() => { markOnlineIfBrowserAgrees() })
    expect(result.current.isOffline).toBe(false)
  })
})

describe('activeList registration', () => {
  it('setActiveList round-trips through getActiveList', () => {
    expect(getActiveList()).toBeNull()
    setActiveList('list-42')
    expect(getActiveList()).toBe('list-42')
    setActiveList(null)
    expect(getActiveList()).toBeNull()
  })
})

describe('dismissConflicts', () => {
  it('clears all pending conflicts at once', () => {
    const { result } = renderHook(() => useSyncState())
    act(() => {
      addConflicts([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
      dismissConflicts()
    })
    expect(result.current.recentConflicts).toHaveLength(0)
  })
})
