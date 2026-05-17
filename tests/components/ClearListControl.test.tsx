import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClearListControl } from '@/app/lists/[id]/ClearListControl'

const defaultProps = {
  isEmpty: false,
  storeMode: false,
  onClearAll: vi.fn().mockResolvedValue(undefined),
  onToggleStore: vi.fn(),
}

describe('ClearListControl', () => {
  it('shows the store mode toggle', () => {
    render(<ClearListControl {...defaultProps} />)
    expect(screen.getByRole('button', { name: /handla/i })).toBeInTheDocument()
  })

  it('shows "Sluta handla" when in store mode', () => {
    render(<ClearListControl {...defaultProps} storeMode />)
    expect(screen.getByText('Sluta handla')).toBeInTheDocument()
  })

  it('calls onToggleStore when the store mode button is clicked', () => {
    const onToggleStore = vi.fn()
    render(<ClearListControl {...defaultProps} onToggleStore={onToggleStore} />)
    fireEvent.click(screen.getByRole('button', { name: /handla/i }))
    expect(onToggleStore).toHaveBeenCalledOnce()
  })

  it('hides "Clear list" when isEmpty', () => {
    render(<ClearListControl {...defaultProps} isEmpty />)
    expect(screen.queryByText(/clear list/i)).toBeNull()
  })

  it('shows "Clear list" when not empty', () => {
    render(<ClearListControl {...defaultProps} isEmpty={false} />)
    expect(screen.getByText(/clear list/i)).toBeInTheDocument()
  })

  it('shows confirm state after clicking "Clear list"', () => {
    render(<ClearListControl {...defaultProps} />)
    fireEvent.click(screen.getByText(/clear list/i))
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('calls onClearAll when "Clear" is confirmed', async () => {
    const onClearAll = vi.fn().mockResolvedValue(undefined)
    render(<ClearListControl {...defaultProps} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByText(/clear list/i))
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }))
    expect(onClearAll).toHaveBeenCalledOnce()
  })

  it('returns to initial state after "Cancel"', () => {
    render(<ClearListControl {...defaultProps} />)
    fireEvent.click(screen.getByText(/clear list/i))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByText(/clear list/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^clear$/i })).toBeNull()
  })
})
