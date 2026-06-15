import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareImportClient from '@/app/share/[importId]/ShareImportClient'

vi.mock('@/app/share/actions', () => ({
  confirmShareImport: vi.fn(),
  confirmShareLink: vi.fn(),
  confirmShareLinkAsRecipe: vi.fn(),
  cancelShareImport: vi.fn(),
}))

const { confirmShareImport, confirmShareLink, confirmShareLinkAsRecipe, cancelShareImport } = await import('@/app/share/actions')
const mockConfirm = vi.mocked(confirmShareImport)
const mockConfirmLink = vi.mocked(confirmShareLink)
const mockConfirmLinkRecipe = vi.mocked(confirmShareLinkAsRecipe)
const mockCancel = vi.mocked(cancelShareImport)

const baseItems = [
  { name: 'Smör', category: 'mejeri', measurement: '2 msk' },
  { name: 'Mjölk', category: 'mejeri', measurement: '3 dl' },
]

const baseLists = [
  { id: 'list-a', name: 'Veckohandling', owner_id: 'me', kind: 'shopping' },
  { id: 'list-b', name: 'Fest', owner_id: 'someone-else', kind: 'shopping' },
]

const notesLists = [
  { id: 'notes-1', name: 'Min scrapbook', owner_id: 'me', kind: 'notes' },
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

describe('ShareImportClient — items mode', () => {
  it('renders both lists', () => {
    renderClient()
    expect(screen.getByText('Veckohandling')).toBeInTheDocument()
    expect(screen.getByText('Fest')).toBeInTheDocument()
  })

  it('renders the "+ Skapa ny lista" option', () => {
    renderClient()
    expect(screen.getByText(/skapa ny lista/i)).toBeInTheDocument()
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

  it('confirm enabled once an existing list is picked', () => {
    renderClient()
    fireEvent.click(screen.getByText('Veckohandling'))
    expect(screen.getByRole('button', { name: /lägg till 2/i })).not.toBeDisabled()
  })

  it('auto-selects when only one list exists', () => {
    renderClient({ lists: [baseLists[0]] })
    expect(screen.getByRole('button', { name: /lägg till 2/i })).not.toBeDisabled()
  })

  it('auto-selects "new list" when user has no lists', () => {
    renderClient({ lists: [] })
    expect(screen.getByPlaceholderText(/listnamn/i)).toBeInTheDocument()
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

  it('confirm calls confirmShareImport with the existing list destination', async () => {
    mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
    renderClient()
    fireEvent.click(screen.getByText('Fest'))
    fireEvent.click(screen.getByText('Smör').closest('li')!) // deselect Smör
    fireEvent.click(screen.getByRole('button', { name: /lägg till 1/i }))
    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        'imp-1',
        { kind: 'existing', listId: 'list-b' },
        [{ name: 'Mjölk', category: 'mejeri', measurement: '3 dl' }],
      ),
    )
  })

  describe('new-list flow', () => {
    it('shows a name input when "+ Skapa ny lista" is picked', () => {
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      expect(screen.getByPlaceholderText(/listnamn/i)).toBeInTheDocument()
    })

    it('confirm stays disabled until a name is typed', () => {
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      expect(screen.getByRole('button', { name: /skapa & lägg till 2/i })).toBeDisabled()
    })

    it('confirm enables once a name is typed', () => {
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Picnic' } })
      expect(screen.getByRole('button', { name: /skapa & lägg till 2/i })).not.toBeDisabled()
    })

    it('whitespace-only name does not enable confirm', () => {
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: '   ' } })
      expect(screen.getByRole('button', { name: /skapa & lägg till 2/i })).toBeDisabled()
    })

    it('confirm calls confirmShareImport with the new-list destination (defaults to shopping)', async () => {
      mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: '  Picnic  ' } })
      fireEvent.click(screen.getByRole('button', { name: /skapa & lägg till 2/i }))
      await waitFor(() =>
        expect(mockConfirm).toHaveBeenCalledWith(
          'imp-1',
          { kind: 'new', name: 'Picnic', listKind: 'shopping' },
          baseItems,
        ),
      )
    })

    it('confirm passes listKind: task when the task toggle is chosen', async () => {
      mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Helgsysslor' } })
      fireEvent.click(screen.getByRole('radio', { name: /uppgifter/i }))
      fireEvent.click(screen.getByRole('button', { name: /skapa & lägg till 2/i }))
      await waitFor(() =>
        expect(mockConfirm).toHaveBeenCalledWith(
          'imp-1',
          { kind: 'new', name: 'Helgsysslor', listKind: 'task' },
          baseItems,
        ),
      )
    })
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

  it('renders the source label', () => {
    renderClient({ source: 'image' })
    expect(screen.getByText(/från bild/i)).toBeInTheDocument()
  })
})

describe('ShareImportClient — link mode', () => {
  // url=null so no auto-select; tests pick a destination explicitly.
  function renderLink(overrides: Partial<React.ComponentProps<typeof ShareImportClient>> = {}) {
    return render(
      <ShareImportClient
        importId="imp-2"
        items={[]}
        source="link"
        url="https://www.biltema.se/x"
        title="Kortläsare med USB C-kontakt"
        lists={[...baseLists, ...notesLists]}
        currentUserId="me"
        {...overrides}
      />,
    )
  }

  it('shows the "Importera länk" header', () => {
    renderLink()
    expect(screen.getByText('Importera länk')).toBeInTheDocument()
  })

  it('displays the link title and host pill', () => {
    renderLink()
    expect(screen.getByText('Kortläsare med USB C-kontakt')).toBeInTheDocument()
    expect(screen.getByText('biltema.se')).toBeInTheDocument()
  })

  it('shows the raw url when no title given', () => {
    renderLink({ title: null })
    expect(screen.getByText('https://www.biltema.se/x')).toBeInTheDocument()
  })

  it('does not render the item checklist', () => {
    renderLink()
    expect(screen.queryByText(/varor att lägga till/i)).toBeNull()
  })

  it('shows ALL lists as destinations (shopping, task, notes)', () => {
    renderLink()
    expect(screen.getByText('Veckohandling')).toBeInTheDocument()
    expect(screen.getByText('Fest')).toBeInTheDocument()
    expect(screen.getByText('Min scrapbook')).toBeInTheDocument()
  })

  it('confirm is disabled until a list is picked (multiple lists)', () => {
    renderLink()
    expect(screen.getByRole('button', { name: /importera|spara klipp/i })).toBeDisabled()
  })

  it('picking a shopping list → label "Importera" and confirmShareLinkAsRecipe', async () => {
    mockConfirmLinkRecipe.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink()
    fireEvent.click(screen.getByText('Veckohandling'))
    fireEvent.click(screen.getByRole('button', { name: /^importera$/i }))
    await waitFor(() =>
      expect(mockConfirmLinkRecipe).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'existing', listId: 'list-a' },
        'https://www.biltema.se/x',
      ),
    )
    expect(mockConfirmLink).not.toHaveBeenCalled()
  })

  it('picking a notes list → label "Spara klipp" and confirmShareLink', async () => {
    mockConfirmLink.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink()
    fireEvent.click(screen.getByText('Min scrapbook'))
    fireEvent.click(screen.getByRole('button', { name: /spara klipp/i }))
    await waitFor(() =>
      expect(mockConfirmLink).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'existing', listId: 'notes-1' },
        'https://www.biltema.se/x',
      ),
    )
    expect(mockConfirmLinkRecipe).not.toHaveBeenCalled()
  })

  it('create-new shopping list → confirmShareLinkAsRecipe with listKind shopping', async () => {
    mockConfirmLinkRecipe.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink({ lists: [] })
    fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Recept' } })
    fireEvent.click(screen.getByRole('button', { name: /^importera$/i }))
    await waitFor(() =>
      expect(mockConfirmLinkRecipe).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'new', name: 'Recept', listKind: 'shopping' },
        'https://www.biltema.se/x',
      ),
    )
  })

  it('create-new with the Scrap toggle → confirmShareLink', async () => {
    mockConfirmLink.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink({ lists: [] })
    fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Klipp' } })
    fireEvent.click(screen.getByRole('radio', { name: /scrap/i }))
    fireEvent.click(screen.getByRole('button', { name: /spara klipp/i }))
    await waitFor(() =>
      expect(mockConfirmLink).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'new', name: 'Klipp' },
        'https://www.biltema.se/x',
      ),
    )
  })

  it('auto-selects when only one list exists', () => {
    renderLink({ lists: [notesLists[0]] })
    expect(screen.getByRole('button', { name: /spara klipp/i })).not.toBeDisabled()
  })

  it('surfaces an error from the confirm action', async () => {
    mockConfirmLinkRecipe.mockResolvedValue({ error: 'Inga varor kunde hittas i länken.' } as unknown as void)
    renderLink()
    fireEvent.click(screen.getByText('Veckohandling'))
    fireEvent.click(screen.getByRole('button', { name: /^importera$/i }))
    await waitFor(() => expect(screen.getByText(/inga varor kunde hittas/i)).toBeInTheDocument())
  })

  it('cancel calls cancelShareImport', async () => {
    mockCancel.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink()
    fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('imp-2'))
  })
})
