import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SortableRow } from '@/app/lists/[id]/SortableRow'
import type { Item } from '@/lib/types'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
    isOver: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    list_id: 'list-1',
    added_by: 'user-1',
    name: 'Mjölk',
    is_checked: false,
    created_at: '2024-01-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    ...overrides,
  }
}

const defaultProps = {
  item: makeItem(),
  itemTextClass: 'text-sm',
  thumbSizeClass: 'w-12 h-12',
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onPicture: vi.fn(),
  onCombine: vi.fn(),
  onDelete: vi.fn(),
  onToggleSelect: vi.fn(),
}

describe('SortableRow — normal mode', () => {
  it('renders the item name', () => {
    render(<ul><SortableRow {...defaultProps} /></ul>)
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
  })

  it('shows the drag handle', () => {
    render(<ul><SortableRow {...defaultProps} /></ul>)
    expect(screen.getByRole('button', { name: /reorder item/i })).toBeInTheDocument()
  })

  it('shows the edit button', () => {
    render(<ul><SortableRow {...defaultProps} /></ul>)
    expect(screen.getByRole('button', { name: /edit item/i })).toBeInTheDocument()
  })

  it('clicking the row calls onToggle', () => {
    const onToggle = vi.fn()
    render(<ul><SortableRow {...defaultProps} onToggle={onToggle} /></ul>)
    fireEvent.click(screen.getByRole('listitem'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('clicking the edit button calls onEdit and not onToggle', () => {
    const onToggle = vi.fn()
    const onEdit = vi.fn()
    render(<ul><SortableRow {...defaultProps} onToggle={onToggle} onEdit={onEdit} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: /edit item/i }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('applies the itemTextClass to the item name', () => {
    render(<ul><SortableRow {...defaultProps} itemTextClass="text-base" /></ul>)
    expect(screen.getByText('Mjölk')).toHaveClass('text-base')
  })
})

describe('SortableRow — edit mode', () => {
  it('shows the delete button instead of edit button', () => {
    render(<ul><SortableRow {...defaultProps} editMode /></ul>)
    expect(screen.getByRole('button', { name: /delete item/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit item/i })).toBeNull()
  })

  it('clicking the row calls onToggleSelect in edit mode', () => {
    const onToggle = vi.fn()
    const onToggleSelect = vi.fn()
    render(<ul><SortableRow {...defaultProps} editMode onToggle={onToggle} onToggleSelect={onToggleSelect} /></ul>)
    fireEvent.click(screen.getByRole('listitem'))
    expect(onToggleSelect).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('SortableRow — store mode', () => {
  it('hides the drag handle', () => {
    render(<ul><SortableRow {...defaultProps} storeMode /></ul>)
    expect(screen.queryByRole('button', { name: /reorder item/i })).toBeNull()
  })

  it('hides the edit button', () => {
    render(<ul><SortableRow {...defaultProps} storeMode /></ul>)
    expect(screen.queryByRole('button', { name: /edit item/i })).toBeNull()
  })

  it('bumps item name to text-lg regardless of itemTextClass prop', () => {
    render(<ul><SortableRow {...defaultProps} storeMode itemTextClass="text-sm" /></ul>)
    expect(screen.getByText('Mjölk')).toHaveClass('text-lg')
    expect(screen.getByText('Mjölk')).not.toHaveClass('text-sm')
  })

  it('does not call onToggle on plain click (swipe-to-check replaces tap)', () => {
    const onToggle = vi.fn()
    render(<ul><SortableRow {...defaultProps} storeMode onToggle={onToggle} /></ul>)
    fireEvent.click(screen.getByRole('listitem'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders the item name', () => {
    render(<ul><SortableRow {...defaultProps} storeMode /></ul>)
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
  })
})

describe('SortableRow — shopped (muted)', () => {
  it('applies muted styling', () => {
    render(<ul><SortableRow {...defaultProps} muted /></ul>)
    expect(screen.getByRole('listitem')).toHaveAttribute('data-muted', 'true')
  })

  it('still renders the item name when muted', () => {
    render(<ul><SortableRow {...defaultProps} muted /></ul>)
    expect(screen.getByText('Mjölk')).toBeInTheDocument()
  })
})
