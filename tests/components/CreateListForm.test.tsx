import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const sync = vi.hoisted(() => ({ isOffline: false }))

vi.mock('@/app/lists/actions', () => ({
  createList: vi.fn().mockResolvedValue({ list: { id: 'new', name: 'Ny', owner_id: 'me', is_shared: false, created_at: '' } }),
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: sync.isOffline, pendingCount: 0, recentConflicts: [] }),
}))

import CreateListForm from '@/app/lists/CreateListForm'
const { createList } = await import('@/app/lists/actions')
const mockCreateList = vi.mocked(createList)

beforeEach(() => {
  vi.clearAllMocks()
  sync.isOffline = false
})

describe('CreateListForm', () => {
  it('online: the "+ New list" trigger is enabled and clicking it opens the form', () => {
    render(<CreateListForm />)
    const trigger = screen.getByRole('button', { name: /\+ new list/i })
    expect(trigger).not.toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.getByPlaceholderText(/list name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument()
  })

  it('offline: the "+ New list" trigger is disabled with the Kräver anslutning tooltip', () => {
    sync.isOffline = true
    render(<CreateListForm />)
    const trigger = screen.getByRole('button', { name: /\+ new list/i })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('title', 'Kräver anslutning')
  })

  it('offline: clicking the disabled trigger does not open the form', () => {
    sync.isOffline = true
    render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    expect(screen.queryByPlaceholderText(/list name/i)).not.toBeInTheDocument()
  })

  it('online then go offline while the form is open: Create button becomes disabled', () => {
    const { rerender } = render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    expect(screen.getByRole('button', { name: /^create$/i })).not.toBeDisabled()

    sync.isOffline = true
    rerender(<CreateListForm />)

    const submit = screen.getByRole('button', { name: /^create$/i })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Kräver anslutning')
    expect(screen.getByText('Kräver anslutning')).toBeInTheDocument()
  })

  it('offline: createList action is never invoked even if the form is somehow submitted', async () => {
    // Render online, open the form, then go offline and submit programmatically.
    const { rerender } = render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    fireEvent.change(screen.getByPlaceholderText(/list name/i), { target: { value: 'Ny' } })

    sync.isOffline = true
    rerender(<CreateListForm />)

    // Submit by clicking — the disabled state should swallow it.
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(mockCreateList).not.toHaveBeenCalled()
  })
})
