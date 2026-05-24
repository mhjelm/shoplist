import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Mutable state — vi.hoisted so it's available inside vi.mock factory.
const state = vi.hoisted(() => ({
  // Rows returned by the SELECT query for shared shopped items
  shoppedSharedRows: [] as Array<{ shared_group_id: string | null }>,
  // Recorded calls to .delete() chains — each entry is a list of {method, args}
  deleteInvocations: [] as Array<Array<{ method: string; args: unknown[] }>>,
  // Recorded calls to supabase.rpc(name, params)
  rpcCalls: [] as Array<{ name: string; params: unknown }>,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    function makeDeleteProxy() {
      const calls: Array<{ method: string; args: unknown[] }> = []
      state.deleteInvocations.push(calls)

      const proxy: Record<string, unknown> = {}
      const addFilter = (method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args })
          return proxy
        }
      proxy.eq = addFilter('eq')
      proxy.in = addFilter('in')
      proxy.or = addFilter('or')
      proxy.not = addFilter('not')
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
              not: () =>
                Promise.resolve({ data: state.shoppedSharedRows, error: null }),
            }),
          }),
        }),
        delete: () => makeDeleteProxy(),
      }),
      rpc: (name: string, params: unknown) => {
        state.rpcCalls.push({ name, params })
        return Promise.resolve({ data: null, error: null })
      },
    }
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  state.shoppedSharedRows = []
  state.deleteInvocations = []
  state.rpcCalls = []
})

// ---------------------------------------------------------------------------
// clearShoppedItems — must call the Postgres RPC (not build a .or() chain)
// ---------------------------------------------------------------------------

describe('clearShoppedItems — RPC strategy', () => {
  it('calls rpc("clear_shopped_items") with the list id', async () => {
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    await clearShoppedItems('list-1')

    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0]).toEqual({
      name: 'clear_shopped_items',
      params: { p_list_id: 'list-1' },
    })
  })

  it('does NOT build a client-side .delete() chain', async () => {
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    await clearShoppedItems('list-1')

    expect(state.deleteInvocations).toHaveLength(0)
  })

  it('returns no error on success', async () => {
    const { clearShoppedItems } = await import('@/app/lists/[id]/actions/items')

    const result = await clearShoppedItems('list-1')

    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// deleteItem — edit-mode delete must NOT cascade to shared siblings
// ---------------------------------------------------------------------------

describe('deleteItem — edit-mode only removes by id', () => {
  it('issues a single DELETE filtered by item id only', async () => {
    const { deleteItem } = await import('@/app/lists/[id]/actions/items')

    await deleteItem('item-abc', 'list-1')

    expect(state.deleteInvocations).toHaveLength(1)
    const chain = state.deleteInvocations[0]
    expect(chain).toEqual([{ method: 'eq', args: ['id', 'item-abc'] }])
  })

  it('does not reference shared_group_id — siblings on other lists are untouched', async () => {
    const { deleteItem } = await import('@/app/lists/[id]/actions/items')

    await deleteItem('item-abc', 'list-1')

    const chain = state.deleteInvocations[0]
    const touchesGroupId = chain.some(c =>
      c.args.some(a => a === 'shared_group_id'),
    )
    expect(touchesGroupId).toBe(false)
  })

  it('does not call rpc — no cross-list operation', async () => {
    const { deleteItem } = await import('@/app/lists/[id]/actions/items')

    await deleteItem('item-abc', 'list-1')

    expect(state.rpcCalls).toHaveLength(0)
  })
})
