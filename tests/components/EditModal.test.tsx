import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditModal } from '@/app/lists/[id]/EditModal'
import type { Item } from '@/lib/types'

vi.mock('@/app/lists/[id]/PictureInput', () => ({
  default: () => <div data-testid="picture-input" />,
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
    quantity: 2,
    category: 'mejeri',
    measurement: '1 l',
    shared_group_id: null,
    ...overrides,
  }
}

describe('EditModal', () => {
  it('renders the item name in the input', () => {
    render(<EditModal item={makeItem()} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Mjölk')).toBeInTheDocument()
  })

  it('renders the measurement in the input', () => {
    render(<EditModal item={makeItem()} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('1 l')).toBeInTheDocument()
  })

  it('renders the current quantity', () => {
    render(<EditModal item={makeItem({ quantity: 3 })} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<EditModal item={makeItem()} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<EditModal item={makeItem()} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.click(container.firstElementChild!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(<EditModal item={makeItem()} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Save when name is empty', () => {
    render(<EditModal item={makeItem({ name: '' })} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('calls onSave with form values when Save is clicked', () => {
    const onSave = vi.fn()
    render(<EditModal item={makeItem()} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith('Mjölk', '', 2, 'mejeri', '1 l')
  })

  it('increments quantity when + is clicked', () => {
    const onSave = vi.fn()
    render(<EditModal item={makeItem({ quantity: 1 })} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /\+/ }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith('Mjölk', '', 2, 'mejeri', '1 l')
  })

  it('does not decrement quantity below 1', () => {
    const onSave = vi.fn()
    render(<EditModal item={makeItem({ quantity: 1 })} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /−/ })).toBeDisabled()
  })
})
