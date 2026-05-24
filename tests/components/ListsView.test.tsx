import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { List } from '@/lib/types'
import type { LocalItem, LocalList, LocalListCatalog, LocalListView } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Mock surfaces. The cached set is derived from useLiveQuery(lists/items).
// Rendering comes from list_catalog via useLiveQuery — falls back to
// initialLists (SSR seed) when liveCatalog is undefined (tests default).
// ---------------------------------------------------------------------------

const live = vi.hoisted(() => ({
  lists: undefined as LocalList[] | undefined,
  items: undefined as LocalItem[] | undefined,
  catalog: undefined as LocalListCatalog[] | undefined,
  views: undefined as LocalListView[] | undefined,
}))

const sync = vi.hoisted(() => ({ isOffline: false }))
const actions = vi.hoisted(() => ({
  fetchListMembers: vi.fn().mockResolvedValue([]),
  fetchMyInvitees: vi.fn().mockResolvedValue([]),
  renameList: vi.fn().mockResolvedValue({ error: null }),
  inviteMember: vi.fn().mockResolvedValue({ error: null }),
  removeMember: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => Promise<unknown>) => {
    const src = fn.toString()
    if (src.includes('list_catalog')) return live.catalog
    if (src.includes('list_views')) return live.views
    if (src.includes('items')) return live.items
    if (src.includes('lists')) return live.lists
    return undefined
  },
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    lists: {},
    items: {},
    list_catalog: {
      bulkPut: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({ modify: vi.fn().mockResolvedValue(0) }),
    },
    list_views: {
      bulkPut: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

vi.mock('@/lib/sync/realtime', () => ({
  subscribeToListsOverview: vi.fn().mockReturnValue(() => {}),
}))

vi.mock('@/lib/sync/reconcile', () => ({
  reconcileLists: vi.fn().mockResolvedValue(undefined),
  reconcileListsOverview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: sync.isOffline, pendingCount: 0, recentConflicts: [] }),
}))

vi.mock('@/app/lists/actions', () => actions)

// DeleteListButton imports server actions; stub it so this test stays focused.
vi.mock('@/app/lists/DeleteListButton', () => ({
  default: ({ listId }: { listId: string }) => <button aria-label={`delete-${listId}`}>×</button>,
}))

import ListsView from '@/app/lists/ListsView'
const { fetchListMembers, fetchMyInvitees, renameList } = await import('@/app/lists/actions')
const mockFetchMembers = vi.mocked(fetchListMembers)
const mockFetchInvitees = vi.mocked(fetchMyInvitees)
const mockRenameList = vi.mocked(renameList)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkList(id: string, ownerId = 'me', name = `List ${id}`): List {
  return { id, name, owner_id: ownerId, created_at: '2024-01-01T00:00:00.000Z' }
}

function mkItem(id: string, listId: string): LocalItem {
  return {
    id, list_id: listId, name: 'x', is_checked: false,
    created_at: '', updated_at: '', picture_url: null, sort_order: null,
    quantity: 1, category: null, measurement: null, added_by: 'me',
    shared_group_id: null,
  }
}

function mkLocalList(id: string): LocalList {
  return { id, name: `List ${id}`, owner_id: 'me', created_at: '' }
}

const NO_COUNTS: Record<string, boolean> = {}
const NO_ACTIVITY: Record<string, string> = {}
const NO_VIEWS: Record<string, string> = {}

beforeEach(() => {
  live.lists = undefined
  live.items = undefined
  sync.isOffline = false
  vi.clearAllMocks()
  mockFetchMembers.mockResolvedValue([])
  mockFetchInvitees.mockResolvedValue([])
  mockRenameList.mockResolvedValue({ error: null })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ListsView', () => {
  it('renders all lists from initialLists', () => {
    const initial = [mkList('a'), mkList('b')]
    render(<ListsView initialLists={initial} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /List b/ })).toBeInTheDocument()
  })

  it('online: every list is a clickable Link regardless of cache status', () => {
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a'), mkList('b')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toHaveAttribute('href', '/lists/a')
    expect(screen.getByRole('link', { name: /List b/ })).toHaveAttribute('href', '/lists/b')
  })

  it('online: clicking a list shows the navigation loading affordance', () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    const link = screen.getByRole('link', { name: /List a/ })
    link.addEventListener('click', event => event.preventDefault())
    fireEvent.click(link)
    expect(screen.getByRole('status')).toHaveTextContent('Laddar...')
  })

  it('shows "shared" badge when memberCounts says a list has members', () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={{ a: true }} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByText('shared')).toBeInTheDocument()
  })

  it('shows an edit pencil for owned lists', () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByRole('button', { name: /redigera list a/i })).toBeInTheDocument()
  })

  it('does not show an edit pencil for shared-with-me lists', () => {
    render(<ListsView initialLists={[mkList('theirs', 'someone-else', 'Other List')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.queryByRole('button', { name: /redigera other list/i })).not.toBeInTheDocument()
  })

  it('clicking the edit pencil opens the inline panel and fetches share data', async () => {
    mockFetchMembers.mockResolvedValueOnce([{ user_id: 'u1', email: 'alice@a.com', added_at: '2024-01-01T00:00:00.000Z' }])
    mockFetchInvitees.mockResolvedValueOnce(['bob@b.com'])
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /redigera list a/i }))

    expect(screen.getByLabelText('Listnamn')).toHaveValue('List a')
    expect(screen.getByRole('status')).toHaveTextContent('Hämtar delning...')
    await waitFor(() => expect(mockFetchMembers).toHaveBeenCalledWith('a'))
    expect(mockFetchInvitees).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('alice@a.com')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'bob@b.com' })).toBeInTheDocument()
  })

  it('only keeps one edit panel open at a time', async () => {
    render(<ListsView initialLists={[mkList('a'), mkList('b')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /redigera list a/i }))
    expect(screen.getByLabelText('Listnamn')).toHaveValue('List a')
    fireEvent.click(screen.getByRole('button', { name: /redigera list b/i }))
    await waitFor(() => expect(screen.getByLabelText('Listnamn')).toHaveValue('List b'))
    expect(screen.queryByDisplayValue('List a')).not.toBeInTheDocument()
  })

  it('renames the list and updates the row locally', async () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /redigera list a/i }))
    fireEvent.change(screen.getByLabelText('Listnamn'), { target: { value: 'Ny lista' } })
    fireEvent.submit(screen.getByRole('button', { name: /spara/i }).closest('form')!)

    await waitFor(() => expect(mockRenameList).toHaveBeenCalledWith('a', 'Ny lista'))
    expect(screen.getByRole('link', { name: /Ny lista/ })).toBeInTheDocument()
  })

  it('does not submit an empty rename', () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /redigera list a/i }))
    fireEvent.change(screen.getByLabelText('Listnamn'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /spara/i })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: /spara/i }).closest('form')!)
    expect(mockRenameList).not.toHaveBeenCalled()
  })

  it('offline: rename is disabled with the Kräver anslutning tooltip', () => {
    sync.isOffline = true
    live.lists = [mkLocalList('a')]
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /redigera list a/i }))
    const save = screen.getByRole('button', { name: /spara/i })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('title', 'Kräver anslutning')
  })

  it('does NOT show "shared" badge when list has no members', () => {
    render(<ListsView initialLists={[mkList('a')]} memberCounts={{ a: false }} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.queryByText('shared')).not.toBeInTheDocument()
  })

  it('offline + cached list: renders a hard-nav <a> with the right href', () => {
    sync.isOffline = true
    live.lists = [mkLocalList('a')]
    live.items = [mkItem('i1', 'a')]
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    const link = screen.getByRole('link', { name: /List a/ })
    expect(link).toHaveAttribute('href', '/lists/a')
    expect(link).not.toHaveAttribute('aria-disabled')
    expect(link.tagName).toBe('A')
  })

  it('offline + cached: shows the offline-cached dot indicator', () => {
    sync.isOffline = true
    live.lists = [mkLocalList('a')]
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByLabelText('Sparad offline')).toBeInTheDocument()
  })

  it('online: cached list does NOT show the dot (only relevant offline)', () => {
    sync.isOffline = false
    live.lists = [mkLocalList('a')]
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.queryByLabelText('Sparad offline')).not.toBeInTheDocument()
  })

  it('offline + uncached: does NOT show the dot', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.queryByLabelText('Sparad offline')).not.toBeInTheDocument()
  })

  it('offline + non-cached list: link is replaced with an aria-disabled span', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.queryByRole('link', { name: /List a/ })).not.toBeInTheDocument()
    const disabled = screen.getByText('List a').closest('[aria-disabled]')
    expect(disabled).not.toBeNull()
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
  })

  it('offline + non-cached list: shows the "Inte tillgänglig offline" affordance', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    const disabled = screen.getByText('List a').closest('[aria-disabled]')
    expect(disabled).toHaveAttribute('title', 'Inte tillgänglig offline')
  })

  it('offline + non-cached: click does not navigate (rendered as a span, not <a>)', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    const el = screen.getByText('List a').closest('[aria-disabled]')
    expect(el?.tagName).not.toBe('A')
    if (el) fireEvent.click(el)
  })

  it('cached set: a list known only via the items table counts as cached', () => {
    sync.isOffline = true
    live.lists = []
    live.items = [mkItem('i1', 'orphan')]
    render(<ListsView initialLists={[mkList('orphan')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List orphan/ })).toHaveAttribute('href', '/lists/orphan')
  })

  it('cached set: a list known only via the lists table counts as cached (zero items)', () => {
    sync.isOffline = true
    live.lists = [mkLocalList('empty')]
    live.items = []
    render(<ListsView initialLists={[mkList('empty')]} memberCounts={NO_COUNTS} lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS} theme="light" currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List empty/ })).toHaveAttribute('href', '/lists/empty')
  })

  it('splits "My lists" vs "Shared with me" using owner_id', () => {
    live.lists = []
    live.items = []
    render(
      <ListsView
        initialLists={[mkList('mine', 'me'), mkList('theirs', 'someone-else', 'Other List')]}
        memberCounts={NO_COUNTS}
        lastActivity={NO_ACTIVITY} lastViewed={NO_VIEWS}
        theme="light"
        currentUserId="me"
      />,
    )
    expect(screen.getByText('My lists')).toBeInTheDocument()
    expect(screen.getByText('Shared with me')).toBeInTheDocument()
    expect(screen.getByLabelText('delete-mine')).toBeInTheDocument()
    expect(screen.queryByLabelText('delete-theirs')).not.toBeInTheDocument()
  })
})
