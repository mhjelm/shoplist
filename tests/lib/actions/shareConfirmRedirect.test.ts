import { describe, it, expect, vi, beforeEach } from 'vitest'

// REQUIREMENT (regression guard): the share picker (/share/[importId]) is a
// one-shot interstitial — its pending row is deleted on confirm/cancel. The
// confirm/cancel redirects MUST use `replace`, so pressing Back from the
// destination list goes to /lists, NOT back to the now-defunct picker page.
// Also: confirmShareLink reuses the unfurl captured at the route (stored on the
// pending row) instead of fetching the link again.

const mockGetUser = vi.fn()
const mockEq = vi.fn(async () => ({ error: null }))
const mockDelete = vi.fn(() => ({ eq: mockEq }))
const mockInsert = vi.fn(async () => ({ error: null }))
let pendingUnfurl: unknown = null
const mockSingle = vi.fn(async () => ({ data: { unfurl: pendingUnfurl } }))
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle })) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({ select: mockSelect, insert: mockInsert, delete: mockDelete })),
  })),
}))

vi.mock('@/app/lists/[id]/actions', () => ({
  addItems: vi.fn(async () => ({ items: [{ id: 'x' }] })),
  unfurlLink: vi.fn(async () => ({ title: 'Fetched', description: 'fd', image: 'fi' })),
}))
const { unfurlLink } = await import('@/app/lists/[id]/actions')
const mockUnfurl = vi.mocked(unfurlLink)

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
  RedirectType: { push: 'push', replace: 'replace' },
}))

describe('share confirm/cancel — replace redirect + reuse stored unfurl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } })
    mockEq.mockResolvedValue({ error: null })
    mockInsert.mockResolvedValue({ error: null })
    pendingUnfurl = null
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

  it('confirmShareLink reuses the stored unfurl and does NOT re-fetch the link', async () => {
    pendingUnfurl = { title: 'Stored', description: 'sd', image: 'si' }
    const { confirmShareLink } = await import('@/app/share/actions')
    await confirmShareLink('imp-1', { kind: 'existing', listId: 'notes-9' }, 'https://x.test/y')
    expect(mockUnfurl).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Stored', note: 'sd', picture_url: 'si', url: 'https://x.test/y' }),
    )
  })

  it('confirmShareLink falls back to fetching when no stored unfurl', async () => {
    pendingUnfurl = null
    const { confirmShareLink } = await import('@/app/share/actions')
    await confirmShareLink('imp-1', { kind: 'existing', listId: 'notes-9' }, 'https://x.test/y')
    expect(mockUnfurl).toHaveBeenCalledWith('https://x.test/y')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fetched', note: 'fd', picture_url: 'fi' }),
    )
  })

  it('cancelShareImport redirects to /lists with replace', async () => {
    const { cancelShareImport } = await import('@/app/share/actions')
    await cancelShareImport('imp-1')
    expect(mockRedirect).toHaveBeenCalledWith('/lists', 'replace')
  })
})
