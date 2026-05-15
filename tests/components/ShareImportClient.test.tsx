import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareImportClient from '@/app/share/[importId]/ShareImportClient'

vi.mock('@/app/share/actions', () => ({
  confirmShareImport: vi.fn(),
  cancelShareImport: vi.fn(),
}))

const { confirmShareImport, cancelShareImport } = await import('@/app/share/actions')
const mockConfirm = vi.mocked(confirmShareImport)
const mockCancel = vi.mocked(cancelShareImport)

const baseItems = [
  { name: 'Smör', category: 'mejeri', measurement: '2 msk' },
  { name: 'Mjölk', category: 'mejeri', measurement: '3 dl' },
]

const baseLists = [
  { id: 'list-a', name: 'Veckohandling', owner_id: 'me', is_shared: false },
  { id: 'list-b', name: 'Fest', owner_id: 'someone-else', is_shared: true },
]

function renderClient(overrides: Partial<React.ComponentProps<typeof ShareImportClient>> = {}) {
  return render(
    <ShareImportClient
      importId="imp-1"
      items={baseItems}
      source="url"
      lists={baseLists}
      currentUserId="me"
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShareImportClient', () => {
  it('renders both lists', () => {
    renderClient()
    expect(screen.getByText('Veckohandling')).toBeInTheDocument()
    expect(screen.getByText('Fest')).toBeInTheDocument()
  })

  it('marks shared lists from other users', () => {
    renderClient()
    expect(screen.getByText('delad')).toBeInTheDocument()
  })

  it('starts with all items selected', () => {
    renderClient()
    expect(screen.getByText(/varor att lägga till \(2\/2\)/i)).toBeInTheDocument()
  })

  it('confirm is disabled until a list is picked', () => {
    renderClient()
    expect(screen.getByRole('button', { name: /lägg till 2/i })).toBeDisabled()
  })

  it('confirm enabled once a list is picked', () => {
    renderClient()
    fireEvent.click(screen.getByText('Veckohandling'))
    expect(screen.getByRole('button', { name: /lägg till 2/i })).not.toBeDisabled()
  })

  it('auto-selects when only one list exists', () => {
    renderClient({ lists: [baseLists[0]] })
    expect(screen.getByRole('button', { name: /lägg till 2/i })).not.toBeDisabled()
  })

  it('toggling an item reduces the count', () => {
    renderClient()
    fireEvent.click(screen.getByText('Smör').closest('li')!)
    expect(screen.getByText(/varor att lägga till \(1\/2\)/i)).toBeInTheDocument()
  })

  it('confirm disabled when 0 items selected', () => {
    renderClient()
    fireEvent.click(screen.getByText('Veckohandling'))
    fireEvent.click(screen.getByText('Smör').closest('li')!)
    fireEvent.click(screen.getByText('Mjölk').closest('li')!)
    expect(screen.getByRole('button', { name: /lägg till 0/i })).toBeDisabled()
  })

  it('confirm calls confirmShareImport with the picked list and selected items', async () => {
    mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
    renderClient()
    fireEvent.click(screen.getByText('Fest'))
    fireEvent.click(screen.getByText('Smör').closest('li')!) // deselect Smör
    fireEvent.click(screen.getByRole('button', { name: /lägg till 1/i }))
    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith('imp-1', 'list-b', [
        { name: 'Mjölk', category: 'mejeri', measurement: '3 dl' },
      ]),
    )
  })

  it('surfaces an error returned by confirmShareImport', async () => {
    mockConfirm.mockResolvedValue({ error: 'Database is on fire' } as unknown as void)
    renderClient()
    fireEvent.click(screen.getByText('Veckohandling'))
    fireEvent.click(screen.getByRole('button', { name: /lägg till 2/i }))
    await waitFor(() => expect(screen.getByText(/database is on fire/i)).toBeInTheDocument())
  })

  it('cancel calls cancelShareImport with just the import id', async () => {
    mockCancel.mockResolvedValue(undefined as unknown as { error?: string })
    renderClient()
    fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('imp-1'))
  })

  it('shows a message when the user has no lists', () => {
    renderClient({ lists: [] })
    expect(screen.getByText(/du har inga listor än/i)).toBeInTheDocument()
  })

  it('renders the source label', () => {
    renderClient({ source: 'image' })
    expect(screen.getByText(/från bild/i)).toBeInTheDocument()
  })
})
