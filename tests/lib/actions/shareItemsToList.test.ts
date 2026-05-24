import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock revalidatePath (called by the action). It's a Next.js cache helper —
// tests don't care about its side effects, just that it doesn't throw.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock the Supabase client. The full fluent-builder chain is large; the guard
// tests below short-circuit before any DB call, so we only need a stub for
// auth.getUser. Heavier code-path testing of the action lives in manual smoke
// (per CLAUDE.md: server actions are not unit-tested against a real DB).
const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(),
  })),
}))

describe('shareItemsToList — guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } })
  })

  it('rejects when source and target are the same list', async () => {
    const { shareItemsToList } = await import('@/app/lists/[id]/actions/cross-list')
    const res = await shareItemsToList('list-1', 'list-1', ['a'])
    expect(res).toEqual({ error: expect.stringMatching(/source and target/i) })
  })

  it('rejects when itemIds is empty', async () => {
    const { shareItemsToList } = await import('@/app/lists/[id]/actions/cross-list')
    const res = await shareItemsToList('list-1', 'list-2', [])
    expect(res).toEqual({ error: expect.stringMatching(/no items/i) })
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })
    const { shareItemsToList } = await import('@/app/lists/[id]/actions/cross-list')
    const res = await shareItemsToList('list-1', 'list-2', ['a'])
    expect(res).toEqual({ error: expect.stringMatching(/not authenticated/i) })
  })
})
