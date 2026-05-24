import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Mutable state — declared with vi.hoisted so it's available inside the vi.mock factory
// (vi.mock callbacks are hoisted before variable declarations at the call site).
const state = vi.hoisted(() => ({
  shoppedSharedRows: [] as Array<{ shared_group_id: string | null }>,
  // Each entry represents one .delete() call's accumulated filter chain
  deleteInvocations: [] as Array<Array<{ method: string; args: unknown[] }>>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    function makeDeleteProxy() {
      const calls: Array<{ method: string; args: unknown[] }> = []
      state.deleteInvocations.push(calls)

      const proxy: Record<string, unknown> = {}
      const addFilter = (method: string) =>
        (...args: unknown[]) => { calls.push({ method, args }); return proxy }

      proxy.eq  = addFilter('eq')
      proxy.in  = addFilter('in')
      proxy.or  = addFilter('or')
      proxy.not = addFilter('not')
      // Make the chain awaitable (Supabase builder resolves as a promise)
      proxy.then = (
        resolve: (v: { data: null; error: null }) => void,
        reject?: (e: unknown) => void,
      ) => Promise.resolve({ data: null, error: null }).then(resolve, reject)

      return proxy
    }

    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              not: () => Promise.resolve({ data: state.shoppedSharedRows, error: null }),
            }),
          }),
        }),
        delete: () => makeDeleteProxy(),
      }),
    }
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.shoppedSharedRows = []
  state.deleteInvocations = []
})

// ---------------------------------------------------------------------------
// clearShoppedItems
// ---------------------------------------------------------------------------

describe('clearShoppedItems — two-query delete strategy', () => {
  it('deletes checked items from the source list via .eq filters', async () => {
    state.shoppedSharedRows = [{ shared_group_id: 'grp-1' }]
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    await clearShoppedItems('list-1')

    // At least one delete chain must have the simple list + is_checked filters
    const firstChain = state.deleteInvocations[0]
    expect(firstChain).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['list_id', 'list-1'] },
        { method: 'eq', args: ['is_checked', true] },
      ]),
    )
  })

  it('cascades delete to siblings via .in("shared_group_id", ...)', async () => {
    state.shoppedSharedRows = [{ shared_group_id: 'grp-1' }]
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    await clearShoppedItems('list-1')

    // Must issue two separate DELETE statements when shared items are present
    expect(state.deleteInvocations).toHaveLength(2)

    const secondChain = state.deleteInvocations[1]
    expect(secondChain).toEqual(
      expect.arrayContaining([
        { method: 'in', args: ['shared_group_id', ['grp-1']] },
      ]),
    )
  })

  it('does NOT cascade when no shared items are checked', async () => {
    state.shoppedSharedRows = [] // no shared items in this list
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    await clearShoppedItems('list-1')

    expect(state.deleteInvocations).toHaveLength(1)
    // The single delete still targets list_id + is_checked
    const chain = state.deleteInvocations[0]
    expect(chain).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['list_id', 'list-1'] },
        { method: 'eq', args: ['is_checked', true] },
      ]),
    )
    // No .in() call on shared_group_id
    expect(chain.some(c => c.method === 'in')).toBe(false)
  })

  it('returns no error on success', async () => {
    state.shoppedSharedRows = []
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    const result = await clearShoppedItems('list-1')

    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// deleteItem — edit-mode delete must NOT cascade to shared siblings
// ---------------------------------------------------------------------------

describe('deleteItem — edit-mode delete only removes by id', () => {
  it('issues a single DELETE filtered by item id only', async () => {
    const { deleteItem } = await import('@/app/lists/[id]/actions/items')

    await deleteItem('item-abc', 'list-1')

    expect(state.deleteInvocations).toHaveLength(1)
    const chain = state.deleteInvocations[0]
    expect(chain).toEqual([{ method: 'eq', args: ['id', 'item-abc'] }])
  })

  it('does not touch shared_group_id — sibling rows on other lists are untouched', async () => {
    const { deleteItem } = await import('@/app/lists/[id]/actions/items')

    await deleteItem('item-abc', 'list-1')

    const chain = state.deleteInvocations[0]
    const touchesGroupId = chain.some(c =>
      c.args.some(a => a === 'shared_group_id'),
    )
    expect(touchesGroupId).toBe(false)
  })
})
