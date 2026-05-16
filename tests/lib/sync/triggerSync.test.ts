import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('triggerSync', () => {
  let mockReconcileList: ReturnType<typeof vi.fn>
  let mockReconcileLists: ReturnType<typeof vi.fn>
  let setActiveList: (id: string | null) => void
  let triggerSync: () => Promise<void>

  beforeEach(async () => {
    vi.resetModules()
    mockReconcileList = vi.fn().mockResolvedValue(undefined)
    mockReconcileLists = vi.fn().mockResolvedValue(undefined)

    // Outbox empty → flushOutbox short-circuits without dispatching anything.
    vi.doMock('@/lib/db/local', () => ({
      localDB: {
        outbox: {
          where: () => ({
            equals: () => ({ modify: async () => undefined }),
            anyOf: () => ({
              sortBy: async () => [],
              count: async () => 0,
            }),
          }),
        },
      },
    }))

    vi.doMock('@/lib/sync/reconcile', () => ({
      reconcileList: mockReconcileList,
      reconcileLists: mockReconcileLists,
    }))

    vi.doMock('@/app/lists/[id]/actions', () => ({
      addItem: vi.fn(),
      updateItem: vi.fn(),
      setItemCategory: vi.fn(),
      deleteItem: vi.fn(),
      reorderItem: vi.fn(),
      mergeItems: vi.fn(),
    }))

    const mod = await import('@/lib/sync/engine')
    setActiveList = mod.setActiveList
    triggerSync = mod.triggerSync
  })

  it('calls reconcileLists() unconditionally', async () => {
    await triggerSync()
    expect(mockReconcileLists).toHaveBeenCalledOnce()
  })

  it('calls reconcileList(activeListId) when a list is registered', async () => {
    setActiveList('list-7')
    await triggerSync()
    expect(mockReconcileList).toHaveBeenCalledOnce()
    expect(mockReconcileList).toHaveBeenCalledWith('list-7')
  })

  it('skips reconcileList when no list is registered (e.g. user on /lists)', async () => {
    setActiveList(null)
    await triggerSync()
    expect(mockReconcileList).not.toHaveBeenCalled()
    expect(mockReconcileLists).toHaveBeenCalledOnce()
  })
})
