import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Item, List, ListPerson } from '@/lib/types'

const state = vi.hoisted(() => ({
  items: [] as Item[],
  hasLoaded: true,
}))

vi.mock('@/app/lists/[id]/useListItemsSync', () => ({
  useListItemsSync: () => ({ items: state.items, hasLoaded: state.hasLoaded }),
}))
vi.mock('@/lib/sync/mutations', () => ({
  muAddItem: vi.fn().mockResolvedValue(undefined),
  muUpdateItem: vi.fn().mockResolvedValue(undefined),
  muDeleteItem: vi.fn().mockResolvedValue(undefined),
  muBulkDelete: vi.fn().mockResolvedValue(undefined),
  muReorderItem: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/app/lists/[id]/actions', () => ({
  touchListView: vi.fn().mockResolvedValue(undefined),
  setTaskSort: vi.fn().mockResolvedValue(undefined),
}))
const overviewLocal = vi.hoisted(() => ({
  seedListsOverview: vi.fn().mockResolvedValue(undefined),
  touchListViewLocal: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/sync/overviewLocal', () => overviewLocal)
vi.mock('@/lib/useRevealFx', () => ({ useRevealFx: () => '' }))
// Shared router mock so tests can assert refresh is NOT called (the unmount
// router.refresh() was removed for instant back-nav).
const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => routerMock }))

import TaskList from '@/app/lists/[id]/TaskList'
const { muAddItem, muUpdateItem, muBulkDelete } = await import('@/lib/sync/mutations')
const mockAdd = vi.mocked(muAddItem)
const mockUpdate = vi.mocked(muUpdateItem)
const mockBulkDelete = vi.mocked(muBulkDelete)

const LIST: List = { id: 'l1', name: 'Chores', owner_id: 'u-anna', created_at: '2026-06-01T00:00:00Z', kind: 'task' }
const PEOPLE: ListPerson[] = [{ user_id: 'u-anna', email: 'anna@example.com' }]

function makeTask(o: Partial<Item> = {}): Item {
  return {
    id: o.id ?? crypto.randomUUID(),
    list_id: 'l1', added_by: 'u-anna', name: o.name ?? 'task', is_checked: o.is_checked ?? false,
    created_at: o.created_at ?? '2026-06-01T00:00:00Z', picture_url: null, sort_order: null,
    quantity: 1, category: null, measurement: null, shared_group_id: null,
    assignee_id: o.assignee_id ?? null, due_date: o.due_date ?? null,
  }
}

function renderList() {
  return render(
    <TaskList
      list={LIST} listId="l1" people={PEOPLE} currentUserId="u-anna"
      lastViewedAt={null} theme="light" initialSort="manual"
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.items = []
  state.hasLoaded = true
})

describe('TaskList', () => {
  it('shows the empty state when there are no tasks', () => {
    renderList()
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument()
  })

  it('renders to-do tasks and a Done section with a count', () => {
    state.items = [
      makeTask({ id: 't1', name: 'Mow lawn' }),
      makeTask({ id: 't2', name: 'Buy stamps', is_checked: true }),
    ]
    renderList()
    expect(screen.getByText('Mow lawn')).toBeInTheDocument()
    expect(screen.getByText('Buy stamps')).toBeInTheDocument()
    expect(screen.getByText(/done \(1\)/i)).toBeInTheDocument()
  })

  it('adds a task through muAddItem', async () => {
    renderList()
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'Call plumber' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(mockAdd).toHaveBeenCalledOnce())
    expect(mockAdd.mock.calls[0][0]).toMatchObject({ list_id: 'l1', name: 'Call plumber', is_checked: false })
    // Tasks opt out of the Gemini category fallback (not groceries).
    expect(mockAdd.mock.calls[0][1]).toEqual({ skipCategorize: true })
  })

  it('does not add a blank task', () => {
    renderList()
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('toggles a task done via muUpdateItem', () => {
    state.items = [makeTask({ id: 't1', name: 'Mow lawn' })]
    renderList()
    fireEvent.click(screen.getByRole('checkbox', { name: /mark mow lawn done/i }))
    expect(mockUpdate).toHaveBeenCalledWith('l1', 't1', { is_checked: true })
  })

  it('Clear done bulk-deletes only the checked tasks, after confirm', () => {
    state.items = [
      makeTask({ id: 't1', name: 'Mow lawn' }),
      makeTask({ id: 'd1', name: 'Buy stamps', is_checked: true }),
      makeTask({ id: 'd2', name: 'Book dentist', is_checked: true }),
    ]
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /clear done/i }))
    // First click only asks for confirmation — no delete yet.
    expect(mockBulkDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))
    expect(mockBulkDelete).toHaveBeenCalledTimes(1)
    const [listId, ids] = mockBulkDelete.mock.calls[0]
    expect(listId).toBe('l1')
    expect([...ids].sort()).toEqual(['d1', 'd2'])
  })

  it('Cancel aborts the clear without deleting', () => {
    state.items = [makeTask({ id: 'd1', name: 'Buy stamps', is_checked: true })]
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /clear done/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockBulkDelete).not.toHaveBeenCalled()
    // Back to the idle affordance.
    expect(screen.getByRole('button', { name: /clear done/i })).toBeInTheDocument()
  })

  it('shows no clear control when there are no done tasks', () => {
    state.items = [makeTask({ id: 't1', name: 'Mow lawn' })]
    renderList()
    expect(screen.queryByRole('button', { name: /clear done/i })).not.toBeInTheDocument()
  })

  it('switches to the by-date view and renders date section headers', () => {
    state.items = [
      makeTask({ id: 't1', name: 'Overdue thing', due_date: '2020-01-01' }),
      makeTask({ id: 't2', name: 'Someday thing' }), // no due date
    ]
    renderList()
    // Starts in Manual: no section headers.
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /by date/i }))
    // Overdue (past date) and No date (null) are now grouped — robust regardless of "now".
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('No date')).toBeInTheDocument()
    expect(screen.getByText('Overdue thing')).toBeInTheDocument()
    expect(screen.getByText('Someday thing')).toBeInTheDocument()
  })

  // Guards the instant-back-nav fix: unmount must touch last_viewed (server +
  // local Dexie) but must NOT call router.refresh() — that purged the /lists
  // router cache and made every back-nav block on a server refetch.
  it('touches last_viewed on mount and unmount without calling router.refresh', async () => {
    const { touchListView } = await import('@/app/lists/[id]/actions')
    const mockTouch = vi.mocked(touchListView)

    const { unmount } = renderList()
    expect(mockTouch).toHaveBeenCalledWith('l1')
    expect(overviewLocal.touchListViewLocal).toHaveBeenCalledWith('l1')
    const callsBeforeUnmount = mockTouch.mock.calls.length

    unmount()
    expect(mockTouch.mock.calls.length).toBeGreaterThan(callsBeforeUnmount)
    expect(overviewLocal.touchListViewLocal.mock.calls.length).toBeGreaterThan(1)
    expect(routerMock.refresh).not.toHaveBeenCalled()
  })
})
