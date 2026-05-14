import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MeasurementBadge } from '@/app/lists/[id]/MeasurementBadge'
import type { Item } from '@/lib/types'

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'test-id',
    list_id: 'list-1',
    added_by: 'user-1',
    name: 'Test item',
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

describe('MeasurementBadge', () => {
  it('renders nothing when no measurement and quantity is 1', () => {
    const { container } = render(<MeasurementBadge item={makeItem()} onCombine={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders quantity when no measurement and quantity > 1', () => {
    render(<MeasurementBadge item={makeItem({ quantity: 3 })} onCombine={vi.fn()} />)
    expect(screen.getByText('× 3')).toBeInTheDocument()
  })

  it('renders plain text when measurement has no combinable segments', () => {
    render(<MeasurementBadge item={makeItem({ measurement: '500 g' })} onCombine={vi.fn()} />)
    expect(screen.getByText('500 g')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a clickable button when segments can be combined', () => {
    render(<MeasurementBadge item={makeItem({ measurement: '500 g + 200 g' })} onCombine={vi.fn()} />)
    // Accessible name comes from button text content
    expect(screen.getByRole('button', { name: '500 g + 200 g' })).toBeInTheDocument()
  })

  it('clicking the badge opens the combine popover showing the combined value', () => {
    render(<MeasurementBadge item={makeItem({ measurement: '500 g + 200 g' })} onCombine={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '500 g + 200 g' }))
    expect(screen.getByText('700 g')).toBeInTheDocument()
  })

  it('"Slå ihop" calls onCombine with the combined value and closes the popover', () => {
    const onCombine = vi.fn()
    render(<MeasurementBadge item={makeItem({ measurement: '500 g + 200 g' })} onCombine={onCombine} />)
    fireEvent.click(screen.getByRole('button', { name: '500 g + 200 g' }))
    fireEvent.click(screen.getByRole('button', { name: /^slå ihop$/i }))
    expect(onCombine).toHaveBeenCalledOnce()
    expect(onCombine).toHaveBeenCalledWith('700 g')
    expect(screen.queryByText('700 g')).toBeNull()
  })

  it('"Avbryt" closes the popover without calling onCombine', () => {
    const onCombine = vi.fn()
    render(<MeasurementBadge item={makeItem({ measurement: '500 g + 200 g' })} onCombine={onCombine} />)
    fireEvent.click(screen.getByRole('button', { name: '500 g + 200 g' }))
    fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
    expect(onCombine).not.toHaveBeenCalled()
    expect(screen.queryByText('700 g')).toBeNull()
  })

  it('Escape closes the popover', () => {
    render(<MeasurementBadge item={makeItem({ measurement: '1 dl + 2 dl' })} onCombine={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '1 dl + 2 dl' }))
    expect(screen.getByText('3 dl')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('3 dl')).toBeNull()
  })
})
