import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { List } from '@/lib/types'
import type { LocalItem, LocalList } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Mock surfaces. The cached set is derived from two useLiveQuery results
// (lists, items); useSyncState drives the isOffline branch.
// ---------------------------------------------------------------------------

const live = vi.hoisted(() => ({
  lists: undefined as LocalList[] | undefined,
  items: undefined as LocalItem[] | undefined,
}))

const sync = vi.hoisted(() => ({ isOffline: false }))

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => Promise<unknown>) => {
    // The component calls toArray() once for lists and once for items; we
    // distinguish by inspecting what the closure touches via a counter trick.
    // Simpler: read the function body to route.
    const src = fn.toString()
    if (src.includes('items')) return live.items
    if (src.includes('lists')) return live.lists
    return undefined
  },
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    lists: { count: async () => 0, bulkPut: vi.fn() },
  },
}))

vi.mock('@/lib/sync/reconcile', () => ({
  reconcileLists: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: sync.isOffline, pendingCount: 0, recentConflicts: [] }),
}))

// DeleteListButton imports server actions; stub it so this test stays focused.
vi.mock('@/app/lists/DeleteListButton', () => ({
  default: ({ listId }: { listId: string }) => <button aria-label={`delete-${listId}`}>×</button>,
}))

import ListsView from '@/app/lists/ListsView'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkList(id: string, ownerId = 'me', name = `List ${id}`, isShared = false): List {
  return { id, name, owner_id: ownerId, is_shared: isShared, created_at: '2024-01-01T00:00:00.000Z' }
}

function mkItem(id: string, listId: string): LocalItem {
  return {
    id, list_id: listId, name: 'x', is_checked: false,
    created_at: '', updated_at: '', picture_url: null, sort_order: null,
    quantity: 1, category: null, measurement: null, added_by: 'me',
  }
}

beforeEach(() => {
  live.lists = undefined
  live.items = undefined
  sync.isOffline = false
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ListsView', () => {
  it('renders all lists from initialItems while Dexie is hydrating', () => {
    const initial = [mkList('a'), mkList('b')]
    render(<ListsView initialLists={initial} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /List b/ })).toBeInTheDocument()
  })

  it('online: every list is a clickable Link regardless of cache status', () => {
    live.lists = [mkList('a'), mkList('b')]
    live.items = [] // a and b have no items cached
    render(<ListsView initialLists={[]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toHaveAttribute('href', '/lists/a')
    expect(screen.getByRole('link', { name: /List b/ })).toHaveAttribute('href', '/lists/b')
  })

  it('offline + cached list: renders as a normal link', () => {
    sync.isOffline = true
    live.lists = [mkList('a')]
    live.items = [mkItem('i1', 'a')]
    render(<ListsView initialLists={[]} currentUserId="me" />)
    const link = screen.getByRole('link', { name: /List a/ })
    expect(link).toHaveAttribute('href', '/lists/a')
    expect(link).not.toHaveAttribute('aria-disabled')
  })

  it('offline + non-cached list: link is replaced with an aria-disabled span', () => {
    sync.isOffline = true
    // Dexie still hydrating → component falls back to the SSR seed for rendering,
    // and cachedIds is empty because neither live query has resolved.
    live.lists = undefined
    live.items = undefined
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    expect(screen.queryByRole('link', { name: /List a/ })).not.toBeInTheDocument()
    const disabled = screen.getByText('List a')
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
  })

  it('offline + non-cached list: shows the "Inte tillgänglig offline" affordance', () => {
    sync.isOffline = true
    live.lists = undefined
    live.items = undefined
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    expect(screen.getByText('List a')).toHaveAttribute('title', 'Inte tillgänglig offline')
  })

  it('offline + non-cached: click does not navigate (no href, treated as a span)', () => {
    sync.isOffline = true
    live.lists = undefined
    live.items = undefined
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    const el = screen.getByText('List a')
    expect(el.tagName).not.toBe('A')
    fireEvent.click(el)
  })

  it('cached set: a list known only via the items table counts as cached', () => {
    sync.isOffline = true
    // Rendered set comes from SSR seed; cached set from items query.
    live.lists = undefined
    live.items = [mkItem('i1', 'orphan')]
    render(<ListsView initialLists={[mkList('orphan')]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List orphan/ })).toHaveAttribute('href', '/lists/orphan')
  })

  it('cached set: a list known only via the lists table counts as cached (zero items)', () => {
    sync.isOffline = true
    live.lists = [mkList('empty')]
    live.items = []
    render(<ListsView initialLists={[]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List empty/ })).toHaveAttribute('href', '/lists/empty')
  })

  it('splits "My lists" vs "Shared with me" using owner_id', () => {
    live.lists = [
      mkList('mine', 'me'),
      mkList('theirs', 'someone-else', 'Other List', true),
    ]
    live.items = []
    render(<ListsView initialLists={[]} currentUserId="me" />)
    const mineHeader = screen.getByText('My lists')
    const sharedHeader = screen.getByText('Shared with me')
    expect(mineHeader).toBeInTheDocument()
    expect(sharedHeader).toBeInTheDocument()
    // The owned list shows its delete button; the shared one does not.
    expect(screen.getByLabelText('delete-mine')).toBeInTheDocument()
    expect(screen.queryByLabelText('delete-theirs')).not.toBeInTheDocument()
  })
})
