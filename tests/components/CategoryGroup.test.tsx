import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CategoryGroup } from '@/app/lists/[id]/CategoryGroup'
import type { Item } from '@/lib/types'

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

function makeItem(id: string, name: string): Item {
  return {
    id,
    list_id: 'list-1',
    added_by: 'user-1',
    name,
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: 'mejeri',
    measurement: null,
  }
}

const items = [makeItem('a', 'Mjölk'), makeItem('b', 'Smör')]

const defaultProps = {
  category: 'mejeri' as const,
  items,
  itemTextClass: 'text-sm',
  thumbSizeClass: 'w-12 h-12',
  editMode: false,
  storeMode: false,
  theme: 'light' as const,
  selectedIds: new Set<string>(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleSelect: vi.fn(),
  onPicture: vi.fn(),
  onCombine: vi.fn(),
}

describe('CategoryGroup', () => {
  it('renders the category label', () => {
    render(<ul><CategoryGroup {...defaultProps} /></ul>)
    expect(screen.getByText(/mejeri/i)).toBeInTheDocument()
  })

  it('renders all items in the group', () => {
    render(<ul><CategoryGroup {...defaultProps} /></ul>)
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
    expect(screen.getByText('Smör')).toBeInTheDocument()
  })

  it('calls onToggle when an item row is clicked', () => {
    const onToggle = vi.fn()
    render(<ul><CategoryGroup {...defaultProps} onToggle={onToggle} /></ul>)
    const rows = screen.getAllByRole('listitem')
    fireEvent.click(rows[0])
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle.mock.calls[0][0]).toMatchObject({ id: 'a' })
  })

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn()
    render(<ul><CategoryGroup {...defaultProps} onEdit={onEdit} /></ul>)
    const editButtons = screen.getAllByRole('button', { name: /edit item/i })
    fireEvent.click(editButtons[0])
    expect(onEdit).toHaveBeenCalledWith(items[0])
  })
})
