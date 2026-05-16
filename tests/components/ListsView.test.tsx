import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { List } from '@/lib/types'
import type { LocalItem, LocalList } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Mock surfaces. The cached set is derived from two useLiveQuery results
// (lists, items); useSyncState drives the isOffline branch. Rendering of the
// list set itself comes from `initialLists` (SSR seed), not Dexie — see
// ListsView for why.
// ---------------------------------------------------------------------------

const live = vi.hoisted(() => ({
  lists: undefined as LocalList[] | undefined,
  items: undefined as LocalItem[] | undefined,
}))

const sync = vi.hoisted(() => ({ isOffline: false }))

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => Promise<unknown>) => {
    const src = fn.toString()
    if (src.includes('items')) return live.items
    if (src.includes('lists')) return live.lists
    return undefined
  },
}))

vi.mock('@/lib/db/local', () => ({
  localDB: {
    lists: {},
    items: {},
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
  it('renders all lists from initialLists', () => {
    const initial = [mkList('a'), mkList('b')]
    render(<ListsView initialLists={initial} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /List b/ })).toBeInTheDocument()
  })

  it('online: every list is a clickable Link regardless of cache status', () => {
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a'), mkList('b')]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List a/ })).toHaveAttribute('href', '/lists/a')
    expect(screen.getByRole('link', { name: /List b/ })).toHaveAttribute('href', '/lists/b')
  })

  it('offline + cached list: renders a hard-nav <a> (not next/link) with the right href', () => {
    sync.isOffline = true
    live.lists = [mkList('a')]
    live.items = [mkItem('i1', 'a')]
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    const link = screen.getByRole('link', { name: /List a/ })
    expect(link).toHaveAttribute('href', '/lists/a')
    expect(link).not.toHaveAttribute('aria-disabled')
    // Hard navigation is required so the SW navigate handler runs and serves
    // the cached HTML shell — Link-driven RSC fetches bypass the SW cache.
    expect(link.tagName).toBe('A')
  })

  it('cached list shows the offline-cached dot indicator (even online)', () => {
    live.lists = [mkList('a')]
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    expect(screen.getByLabelText('Sparad offline')).toBeInTheDocument()
  })

  it('uncached list does NOT show the cached dot', () => {
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    expect(screen.queryByLabelText('Sparad offline')).not.toBeInTheDocument()
  })

  it('offline + non-cached list: link is replaced with an aria-disabled span', () => {
    sync.isOffline = true
    // Both live queries resolved-empty → cachedIds is empty.
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    expect(screen.queryByRole('link', { name: /List a/ })).not.toBeInTheDocument()
    const disabled = screen.getByText('List a').closest('[aria-disabled]')
    expect(disabled).not.toBeNull()
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
  })

  it('offline + non-cached list: shows the "Inte tillgänglig offline" affordance', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    const disabled = screen.getByText('List a').closest('[aria-disabled]')
    expect(disabled).toHaveAttribute('title', 'Inte tillgänglig offline')
  })

  it('offline + non-cached: click does not navigate (rendered as a span, not <a>)', () => {
    sync.isOffline = true
    live.lists = []
    live.items = []
    render(<ListsView initialLists={[mkList('a')]} currentUserId="me" />)
    const el = screen.getByText('List a').closest('[aria-disabled]')
    expect(el?.tagName).not.toBe('A')
    if (el) fireEvent.click(el)
  })

  it('cached set: a list known only via the items table counts as cached', () => {
    sync.isOffline = true
    live.lists = []
    live.items = [mkItem('i1', 'orphan')]
    render(<ListsView initialLists={[mkList('orphan')]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List orphan/ })).toHaveAttribute('href', '/lists/orphan')
  })

  it('cached set: a list known only via the lists table counts as cached (zero items)', () => {
    sync.isOffline = true
    live.lists = [mkList('empty')]
    live.items = []
    render(<ListsView initialLists={[mkList('empty')]} currentUserId="me" />)
    expect(screen.getByRole('link', { name: /List empty/ })).toHaveAttribute('href', '/lists/empty')
  })

  it('splits "My lists" vs "Shared with me" using owner_id', () => {
    live.lists = []
    live.items = []
    render(
      <ListsView
        initialLists={[mkList('mine', 'me'), mkList('theirs', 'someone-else', 'Other List', true)]}
        currentUserId="me"
      />,
    )
    expect(screen.getByText('My lists')).toBeInTheDocument()
    expect(screen.getByText('Shared with me')).toBeInTheDocument()
    expect(screen.getByLabelText('delete-mine')).toBeInTheDocument()
    expect(screen.queryByLabelText('delete-theirs')).not.toBeInTheDocument()
  })
})
