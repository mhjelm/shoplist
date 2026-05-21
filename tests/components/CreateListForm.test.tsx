import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const sync = vi.hoisted(() => ({ isOffline: false }))

vi.mock('@/app/lists/actions', () => ({
  createListAndOpen: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: sync.isOffline, pendingCount: 0, recentConflicts: [] }),
}))

import CreateListForm from '@/app/lists/CreateListForm'
const { createListAndOpen } = await import('@/app/lists/actions')
const mockCreateListAndOpen = vi.mocked(createListAndOpen)

beforeEach(() => {
  vi.clearAllMocks()
  sync.isOffline = false
  mockCreateListAndOpen.mockResolvedValue(undefined)
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

  it('online: successful create invokes createListAndOpen (server handles navigation)', async () => {
    render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    fireEvent.change(screen.getByPlaceholderText(/list name/i), { target: { value: 'Ny' } })

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(mockCreateListAndOpen).toHaveBeenCalled()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('online: create errors are shown without navigating', async () => {
    mockCreateListAndOpen.mockResolvedValueOnce({ error: 'Nope' })
    render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    fireEvent.change(screen.getByPlaceholderText(/list name/i), { target: { value: 'Ny' } })

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText('Nope')).toBeInTheDocument()
  })

  it('offline: createListAndOpen action is never invoked even if the form is somehow submitted', async () => {
    const { rerender } = render(<CreateListForm />)
    fireEvent.click(screen.getByRole('button', { name: /\+ new list/i }))
    fireEvent.change(screen.getByPlaceholderText(/list name/i), { target: { value: 'Ny' } })

    sync.isOffline = true
    rerender(<CreateListForm />)

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
    expect(mockCreateListAndOpen).not.toHaveBeenCalled()
  })
})
