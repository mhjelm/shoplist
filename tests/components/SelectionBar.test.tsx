import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionBar } from '@/app/lists/[id]/SelectionBar'

const defaultProps = {
  count: 3,
  isOffline: false,
  onCopy: vi.fn(),
  onMove: vi.fn(),
  onShare: vi.fn(),
  onClear: vi.fn(),
}

describe('SelectionBar', () => {
  it('shows the selected count', () => {
    render(<SelectionBar {...defaultProps} count={5} />)
    expect(screen.getByText('5 valda')).toBeInTheDocument()
  })

  it('calls onCopy when copy button is clicked', () => {
    const onCopy = vi.fn()
    render(<SelectionBar {...defaultProps} onCopy={onCopy} />)
    fireEvent.click(screen.getByRole('button', { name: /kopiera/i }))
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('calls onMove when move button is clicked', () => {
    const onMove = vi.fn()
    render(<SelectionBar {...defaultProps} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: /flytta/i }))
    expect(onMove).toHaveBeenCalledOnce()
  })

  it('calls onShare when share button is clicked', () => {
    const onShare = vi.fn()
    render(<SelectionBar {...defaultProps} onShare={onShare} />)
    fireEvent.click(screen.getByRole('button', { name: /dela/i }))
    expect(onShare).toHaveBeenCalledOnce()
  })

  it('calls onClear when clear button is clicked', () => {
    const onClear = vi.fn()
    render(<SelectionBar {...defaultProps} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: /avmarkera/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('disables copy, share, and move buttons when offline', () => {
    render(<SelectionBar {...defaultProps} isOffline />)
    expect(screen.getByRole('button', { name: /kopiera/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /dela/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /flytta/i })).toBeDisabled()
  })

  it('enables buttons when online', () => {
    render(<SelectionBar {...defaultProps} isOffline={false} />)
    expect(screen.getByRole('button', { name: /kopiera/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /dela/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /flytta/i })).not.toBeDisabled()
  })
})
