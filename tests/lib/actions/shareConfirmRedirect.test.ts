import { describe, it, expect, vi, beforeEach } from 'vitest'

// REQUIREMENT (regression guard): the share picker (/share/[importId]) is a
// one-shot interstitial — its pending row is deleted on confirm/cancel. The
// confirm/cancel redirects MUST use `replace`, so pressing Back from the
// destination list goes to /lists, NOT back to the now-defunct picker page.
// If this fails, fix the action (keep RedirectType.replace) — do not relax it.

const mockGetUser = vi.fn()
const mockEq = vi.fn(async () => ({ error: null }))
const mockDelete = vi.fn(() => ({ eq: mockEq }))
const mockInsert = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({ insert: mockInsert, delete: mockDelete })),
  })),
}))

vi.mock('@/app/lists/[id]/actions', () => ({
  addItems: vi.fn(async () => ({ items: [{ id: 'x' }] })),
  unfurlLink: vi.fn(async () => ({ title: 'T', description: 'D', image: 'I' })),
}))

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
  RedirectType: { push: 'push', replace: 'replace' },
}))

describe('share confirm/cancel — leave the picker out of history (replace redirect)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } })
    mockEq.mockResolvedValue({ error: null })
    mockInsert.mockResolvedValue({ error: null })
  })

  it('confirmShareImport redirects to the destination list with replace', async () => {
    const { confirmShareImport } = await import('@/app/share/actions')
    await confirmShareImport('imp-1', { kind: 'existing', listId: 'list-9' }, [
      { name: 'Smör', category: 'mejeri', measurement: null },
    ])
    expect(mockRedirect).toHaveBeenCalledWith('/lists/list-9', 'replace')
  })

  it('confirmShareLink redirects to the destination list with replace', async () => {
    const { confirmShareLink } = await import('@/app/share/actions')
    await confirmShareLink('imp-1', { kind: 'existing', listId: 'notes-9' }, 'https://x.test/y')
    expect(mockRedirect).toHaveBeenCalledWith('/lists/notes-9', 'replace')
  })

  it('cancelShareImport redirects to /lists with replace', async () => {
    const { cancelShareImport } = await import('@/app/share/actions')
    await cancelShareImport('imp-1')
    expect(mockRedirect).toHaveBeenCalledWith('/lists', 'replace')
  })
})
