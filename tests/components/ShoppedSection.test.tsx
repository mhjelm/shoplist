import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ShoppedSection } from '@/app/lists/[id]/ShoppedSection'
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
    is_checked: true,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
  }
}

const shopped = [makeItem('a', 'Mjölk'), makeItem('b', 'Smör')]

const defaultProps = {
  shopped,
  editMode: false,
  storeMode: false,
  theme: 'light' as const,
  itemTextClass: 'text-sm',
  thumbSizeClass: 'w-12 h-12',
  selectedIds: new Set<string>(),
  onClearShopped: vi.fn(),
  onToggle: vi.fn(),
  onDelete: vi.fn(),
  onToggleSelect: vi.fn(),
  onCombine: vi.fn(),
}

describe('ShoppedSection', () => {
  it('renders the "Shopped" header', () => {
    render(<ul><ShoppedSection {...defaultProps} /></ul>)
    expect(screen.getByText(/shopped/i)).toBeInTheDocument()
  })

  it('renders all shopped items', () => {
    render(<ul><ShoppedSection {...defaultProps} /></ul>)
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
    expect(screen.getByText('Smör')).toBeInTheDocument()
  })

  it('calls onClearShopped when the × button is clicked', () => {
    const onClearShopped = vi.fn()
    render(<ul><ShoppedSection {...defaultProps} onClearShopped={onClearShopped} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: /clear shopped/i }))
    expect(onClearShopped).toHaveBeenCalledOnce()
  })

  it('renders SortableRow items in edit mode', () => {
    render(<ul><ShoppedSection {...defaultProps} editMode /></ul>)
    // In edit mode: SortableRows have drag-handle buttons
    expect(screen.getAllByRole('button', { name: /drag to merge/i })).toHaveLength(2)
  })

  it('renders plain ShoppedRow items when not in edit mode', () => {
    render(<ul><ShoppedSection {...defaultProps} editMode={false} /></ul>)
    // Non-edit ShoppedRows don't have drag handle buttons
    expect(screen.queryByRole('button', { name: /drag/i })).toBeNull()
  })

  it('calls onToggle when a shopped item is clicked (non-edit mode)', () => {
    const onToggle = vi.fn()
    render(<ul><ShoppedSection {...defaultProps} editMode={false} onToggle={onToggle} /></ul>)
    const rows = screen.getAllByRole('listitem')
    // Click a shopped row (first one that is a listitem for items, skip the section container)
    fireEvent.click(rows[0])
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
