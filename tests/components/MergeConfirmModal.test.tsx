import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergeConfirmModal } from '@/app/lists/[id]/MergeConfirmModal'
import type { Item } from '@/lib/types'

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
    category: null,
    measurement: null,
  }
}

const source = makeItem('a', 'Mjölk')
const target = makeItem('b', 'Filmjölk')

describe('MergeConfirmModal', () => {
  it('renders both item names', () => {
    render(<MergeConfirmModal source={source} target={target} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/Mjölk/)).toBeInTheDocument()
    expect(screen.getByText(/Filmjölk/)).toBeInTheDocument()
  })

  it('calls onConfirm when "Slå ihop" is clicked', () => {
    const onConfirm = vi.fn()
    render(<MergeConfirmModal source={source} target={target} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /slå ihop/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when "Avbryt" is clicked', () => {
    const onCancel = vi.fn()
    render(<MergeConfirmModal source={source} target={target} onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <MergeConfirmModal source={source} target={target} onConfirm={vi.fn()} onCancel={onCancel} />
    )
    // The backdrop is the outermost div
    fireEvent.click(container.firstElementChild!)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not call onCancel when the dialog body is clicked', () => {
    const onCancel = vi.fn()
    render(<MergeConfirmModal source={source} target={target} onConfirm={vi.fn()} onCancel={onCancel} />)
    // Click on the text inside the modal body
    fireEvent.click(screen.getByText(/Mjölk/))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
