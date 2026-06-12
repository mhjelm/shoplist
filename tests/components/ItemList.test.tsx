import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ItemList from '@/app/lists/[id]/ItemList'
import { EditModeProvider } from '@/app/lists/[id]/EditModeContext'
import { StoreModeProvider } from '@/app/lists/[id]/StoreModeContext'
import type { Item, List } from '@/lib/types'
import { DEFAULT_CATEGORY_ORDER } from '@/lib/categories'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Shared router mock so tests can assert refresh is NOT called (the unmount
// router.refresh() was removed for instant back-nav — see overviewLocal.ts).
const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

const overviewLocal = vi.hoisted(() => ({
  seedListsOverview: vi.fn().mockResolvedValue(undefined),
  touchListViewLocal: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/sync/overviewLocal', () => overviewLocal)

vi.mock('@/lib/sync/mutations', () => ({
  muUpdateItem: vi.fn().mockResolvedValue(undefined),
  muDeleteItem: vi.fn().mockResolvedValue(undefined),
  muBulkDelete: vi.fn().mockResolvedValue(undefined),
  muAddItem: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db/local', () => ({
  localDB: { items: {
    bulkPut: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(undefined),
  } },
}))

vi.mock('@/lib/sync/realtime', () => ({
  subscribeToList: vi.fn(() => ({ unsubscribe: vi.fn() })),
}))

vi.mock('@/lib/sync/reconcile', () => ({
  reconcileList: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/app/lists/[id]/actions', () => ({
  addItem: vi.fn().mockResolvedValue({ item: null }),
  extractAddItems: vi.fn(),
  deleteHistoryItem: vi.fn(),
  addItems: vi.fn().mockResolvedValue({ items: [] }),
  copyItemsToList: vi.fn(),
  moveItemsToList: vi.fn(),
  shareItemsToList: vi.fn(),
  clearShoppedItems: vi.fn().mockResolvedValue(undefined),
  touchListView: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: false, pendingCount: 0, recentConflicts: [], lastSyncError: null }),
  flushOutbox: vi.fn(),
  setActiveList: vi.fn(),
  _dispatchEntry: vi.fn(),
}))

// Inject items via a module-level variable that renderItemList sets.
// ItemList no longer takes items as a prop — it gets them from the hook.
let mockItems: Item[] = []
vi.mock('@/app/lists/[id]/useListItemsSync', () => ({
  useListItemsSync: () => ({ items: mockItems, hasLoaded: true }),
}))

// Stub drag/merge/reorder hook — avoids dnd-kit sensor setup in jsdom
vi.mock('@/app/lists/[id]/useDragMergeReorder', () => ({
  useDragMergeReorder: () => ({
    sensors: [],
    handleDragEnd: vi.fn(),
    pendingMerge: null,
    setPendingMerge: vi.fn(),
    handleMergeConfirm: vi.fn(),
  }),
}))

// Stub celebration hook — avoids canvas animation setup
vi.mock('@/app/lists/[id]/useItemCelebrations', () => ({
  useItemCelebrations: () => ({
    ghosts: [],
    setGhosts: vi.fn(),
    fwCanvasRef: { current: null },
    spawnGhost: vi.fn(),
  }),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
    isOver: false,
  }),
  verticalListSortingStrategy: {},
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

vi.mock('@/app/lists/[id]/PictureInput', () => ({
  default: () => <div data-testid="picture-input" />,
}))

vi.mock('@/app/lists/[id]/RecipeImportModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="recipe-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/lists/[id]/TargetListModal', () => ({
  default: () => <div data-testid="target-modal" />,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    list_id: 'list-1',
    added_by: 'user-1',
    name: `Item ${id}`,
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    ...overrides,
  }
}

function makeList(): List {
  return { id: 'list-1', name: 'Test list', owner_id: 'user-1', created_at: '2024-01-01T00:00:00Z' }
}

function renderItemList(items: Item[] = []) {
  mockItems = items
  return render(
    <EditModeProvider>
      <StoreModeProvider>
        <ItemList
          list={makeList()}
          listId="list-1"
          suggestions={[]}
          textSize="normal"
          theme="light"
          categoryOrder={DEFAULT_CATEGORY_ORDER}
          availableLists={[]}
          currentUserId="user-1"
          lastViewedAt={null}
        />
      </StoreModeProvider>
    </EditModeProvider>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemList — smoke tests', () => {
  it('renders "No items yet" when list is empty', () => {
    renderItemList([])
    expect(screen.getByText(/no items yet/i)).toBeInTheDocument()
  })

  it('renders item names for active (to-shop) items', () => {
    renderItemList([
      makeItem('a', { name: 'Mjölk', category: 'mejeri' }),
      makeItem('b', { name: 'Smör', category: 'mejeri' }),
    ])
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
    expect(screen.getByText('Smör')).toBeInTheDocument()
  })

  it('renders category label for grouped items', () => {
    renderItemList([makeItem('a', { name: 'Mjölk', category: 'mejeri' })])
    expect(screen.getByText(/mejeri/i)).toBeInTheDocument()
  })

  it('renders the shopped section when items are checked', () => {
    renderItemList([
      makeItem('a', { name: 'Mjölk', is_checked: false }),
      makeItem('b', { name: 'Smör', is_checked: true }),
    ])
    expect(screen.getByText(/shopped/i)).toBeInTheDocument()
    expect(screen.getByText('Smör')).toBeInTheDocument()
  })

  it('renders the add-item textarea', () => {
    renderItemList()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders the "Handla" store mode toggle button', () => {
    renderItemList()
    expect(screen.getByRole('button', { name: /handla/i })).toBeInTheDocument()
  })

  it('shows "Everything shopped" when all items are checked', () => {
    renderItemList([makeItem('a', { name: 'Mjölk', is_checked: true })])
    expect(screen.getByText(/everything shopped/i)).toBeInTheDocument()
  })

  it('clicking an active item calls muUpdateItem (toggle to checked)', async () => {
    const { muUpdateItem } = await import('@/lib/sync/mutations')
    renderItemList([makeItem('a', { name: 'Mjölk', category: 'mejeri' })])
    const rows = screen.getAllByRole('listitem')
    fireEvent.click(rows[0])
    expect(vi.mocked(muUpdateItem)).toHaveBeenCalledWith('list-1', 'a', { is_checked: true })
  })

  // Guards the instant-back-nav fix: the unmount cleanup must touch last_viewed
  // (server + local Dexie) but must NOT call router.refresh() — that purged the
  // /lists router cache and made every back-nav block on a server refetch.
  it('touches last_viewed on mount and unmount without calling router.refresh', async () => {
    const { touchListView } = await import('@/app/lists/[id]/actions')
    const mockTouch = vi.mocked(touchListView)
    mockTouch.mockClear()
    overviewLocal.touchListViewLocal.mockClear()
    routerMock.refresh.mockClear()

    const { unmount } = renderItemList([])
    expect(mockTouch).toHaveBeenCalledWith('list-1')
    expect(overviewLocal.touchListViewLocal).toHaveBeenCalledWith('list-1')
    const callsBeforeUnmount = mockTouch.mock.calls.length

    unmount()
    expect(mockTouch.mock.calls.length).toBeGreaterThan(callsBeforeUnmount)
    expect(overviewLocal.touchListViewLocal.mock.calls.length).toBeGreaterThan(1)
    expect(routerMock.refresh).not.toHaveBeenCalled()
  })
})
