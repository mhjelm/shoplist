import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ShareImportClient from '@/app/share/[importId]/ShareImportClient'

vi.mock('@/app/share/actions', () => ({
  confirmShareImport: vi.fn(),
  confirmShareLink: vi.fn(),
  cancelShareImport: vi.fn(),
}))

const { confirmShareImport, confirmShareLink, cancelShareImport } = await import('@/app/share/actions')
const mockConfirm = vi.mocked(confirmShareImport)
const mockConfirmLink = vi.mocked(confirmShareLink)
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

const taskList = { id: 'task-1', name: 'Sysslor', owner_id: 'me', kind: 'task' }

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

    it('confirm calls confirmShareImport with the new-list destination (always shopping)', async () => {
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

    it('offers no task-list option when creating a new list', () => {
      renderClient()
      fireEvent.click(screen.getByText(/skapa ny lista/i))
      expect(screen.queryByRole('radio', { name: /uppgifter|uppg/i })).toBeNull()
    })
  })

  // REQUIREMENT: task lists are never selectable as a share target.
  it('does not show task lists as destinations', () => {
    renderClient({ lists: [...baseLists, taskList, ...notesLists] })
    expect(screen.getByText('Veckohandling')).toBeInTheDocument()
    expect(screen.queryByText('Sysslor')).toBeNull()
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
  // A shared RECIPE link carries the items extracted at the route. This fixture
  // is the heart of the regression these tests guard: sharing a recipe must let
  // the user review/accept the extracted items before they're imported.
  const recipeItems = [
    { name: 'Smör', category: 'mejeri', measurement: '2 msk' },
    { name: 'Köttfärs', category: 'kott-fisk', measurement: '500 g' },
  ]

  function renderLink(overrides: Partial<React.ComponentProps<typeof ShareImportClient>> = {}) {
    return render(
      <ShareImportClient
        importId="imp-2"
        items={recipeItems}
        source="link"
        url="https://recept.se/kottbullar"
        title="Köttbullar"
        lists={[...baseLists, ...notesLists]}
        currentUserId="me"
        {...overrides}
      />,
    )
  }

  it('displays the link title and host', () => {
    renderLink()
    expect(screen.getByText('Köttbullar')).toBeInTheDocument()
    expect(screen.getByText('recept.se')).toBeInTheDocument()
  })

  it('shows the unfurled image + description in the preview when provided', () => {
    renderLink({
      unfurl: { title: 'Köttbullar', description: 'Klassiska svenska köttbullar', image: 'https://img.test/k.jpg' },
    })
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img.test/k.jpg')
    expect(screen.getByText('Klassiska svenska köttbullar')).toBeInTheDocument()
  })

  it('offers shopping and notes lists as destinations', () => {
    renderLink()
    expect(screen.getByText('Veckohandling')).toBeInTheDocument()
    expect(screen.getByText('Fest')).toBeInTheDocument()
    expect(screen.getByText('Min scrapbook')).toBeInTheDocument()
  })

  // REQUIREMENT: task lists are never selectable as a share target.
  it('does not show task lists as destinations, and offers no task create option', () => {
    renderLink({ lists: [...baseLists, taskList, ...notesLists] })
    expect(screen.queryByText('Sysslor')).toBeNull()
    fireEvent.click(screen.getByText(/skapa ny lista/i))
    expect(screen.queryByRole('radio', { name: /uppg/i })).toBeNull()
  })

  // ── The core requirement: recipe share is reviewable, not auto-imported ──
  // This is the test that must FAIL if anyone removes the accept/reject checklist
  // again. Do not relax it to match a future implementation — fix the code.
  describe('REQUIREMENT: a shared recipe is reviewed before import', () => {
    it('shows the extracted items as an accept/reject checklist', () => {
      renderLink()
      expect(screen.getByText('Smör')).toBeInTheDocument()
      expect(screen.getByText('Köttfärs')).toBeInTheDocument()
      expect(screen.getByText(/varor att lägga till \(2\/2\)/i)).toBeInTheDocument()
    })

    it('imports the reviewed items (minus any deselected) into the chosen list', async () => {
      mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
      renderLink()
      fireEvent.click(screen.getByText('Veckohandling'))        // pick a shopping list
      fireEvent.click(screen.getByText('Smör'))                 // deselect one item
      fireEvent.click(screen.getByRole('button', { name: /lägg till 1/i }))
      await waitFor(() =>
        expect(mockConfirm).toHaveBeenCalledWith(
          'imp-2',
          { kind: 'existing', listId: 'list-a' },
          [{ name: 'Köttfärs', category: 'kott-fisk', measurement: '500 g' }],
        ),
      )
      // It must be a real item import, never a silent link-save.
      expect(mockConfirmLink).not.toHaveBeenCalled()
    })

    it('blocks import when every item is deselected', () => {
      renderLink()
      fireEvent.click(screen.getByText('Veckohandling'))
      fireEvent.click(screen.getByText('Smör'))
      fireEvent.click(screen.getByText('Köttfärs'))
      expect(screen.getByRole('button', { name: /lägg till 0/i })).toBeDisabled()
    })
  })

  it('create-new shopping list imports the reviewed items', async () => {
    mockConfirm.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink({ lists: [] })
    fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Recept' } })
    fireEvent.click(screen.getByRole('button', { name: /lägg till 2/i }))
    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'new', name: 'Recept', listKind: 'shopping' },
        recipeItems,
      ),
    )
  })

  it('choosing a scrapbook hides the checklist and saves the link as a scrap', async () => {
    mockConfirmLink.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink()
    fireEvent.click(screen.getByText('Min scrapbook'))
    // Checklist is irrelevant for a scrap, so it's hidden.
    expect(screen.queryByText(/varor att lägga till/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /spara klipp/i }))
    await waitFor(() =>
      expect(mockConfirmLink).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'existing', listId: 'notes-1' },
        'https://recept.se/kottbullar',
      ),
    )
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('create-new with the Scrap toggle saves a scrap', async () => {
    mockConfirmLink.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink({ lists: [] })
    fireEvent.change(screen.getByPlaceholderText(/listnamn/i), { target: { value: 'Klipp' } })
    fireEvent.click(screen.getByRole('radio', { name: /scrap/i }))
    fireEvent.click(screen.getByRole('button', { name: /spara klipp/i }))
    await waitFor(() =>
      expect(mockConfirmLink).toHaveBeenCalledWith(
        'imp-2',
        { kind: 'new', name: 'Klipp' },
        'https://recept.se/kottbullar',
      ),
    )
  })

  it('a non-recipe link (no items) cannot import to a shopping list, only scrap', () => {
    renderLink({ items: [] })
    expect(screen.queryByText(/varor att lägga till/i)).toBeNull()
    // Shopping target with nothing to add → confirm disabled.
    fireEvent.click(screen.getByText('Veckohandling'))
    expect(screen.getByRole('button', { name: /lägg till 0/i })).toBeDisabled()
    // Scrap target still works.
    fireEvent.click(screen.getByText('Min scrapbook'))
    expect(screen.getByRole('button', { name: /spara klipp/i })).not.toBeDisabled()
  })

  it('surfaces an error from the confirm action', async () => {
    mockConfirm.mockResolvedValue({ error: 'Database is on fire' } as unknown as void)
    renderLink()
    fireEvent.click(screen.getByText('Veckohandling'))
    fireEvent.click(screen.getByRole('button', { name: /lägg till 2/i }))
    await waitFor(() => expect(screen.getByText(/database is on fire/i)).toBeInTheDocument())
  })

  it('cancel calls cancelShareImport', async () => {
    mockCancel.mockResolvedValue(undefined as unknown as { error?: string })
    renderLink()
    fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('imp-2'))
  })
})
