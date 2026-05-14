import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecipeImportModal from '@/app/lists/[id]/RecipeImportModal'

vi.mock('@/app/lists/[id]/actions', () => ({
  extractRecipeItems: vi.fn(),
  addItems: vi.fn(),
}))

// Import after mock registration so we get the mocked versions.
const { extractRecipeItems, addItems } = await import('@/app/lists/[id]/actions')
const mockExtract = vi.mocked(extractRecipeItems)
const mockAddItems = vi.mocked(addItems)

const onClose = vi.fn()
const onItemsAdded = vi.fn()

function renderModal() {
  return render(
    <RecipeImportModal listId="list-1" onClose={onClose} onItemsAdded={onItemsAdded} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText: vi.fn().mockResolvedValue('') },
    configurable: true,
  })
})

describe('RecipeImportModal', () => {
  describe('initial state', () => {
    it('shows the import form', () => {
      renderModal()
      expect(screen.getByPlaceholderText(/klistra in/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /hämta varor/i })).toBeInTheDocument()
    })

    it('"Hämta varor" is disabled when the textarea is empty', () => {
      renderModal()
      expect(screen.getByRole('button', { name: /hämta varor/i })).toBeDisabled()
    })

    it('enables "Hämta varor" once text is entered', () => {
      renderModal()
      fireEvent.change(screen.getByPlaceholderText(/klistra in/i), { target: { value: 'some recipe' } })
      expect(screen.getByRole('button', { name: /hämta varor/i })).not.toBeDisabled()
    })
  })

  describe('clipboard auto-fill', () => {
    it('fills textarea when clipboard contains a URL', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn().mockResolvedValue('https://example.com/recipe') },
        configurable: true,
      })
      renderModal()
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/klistra in/i)).toHaveValue('https://example.com/recipe')
      })
    })

    it('does not fill when clipboard has plain text', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText: vi.fn().mockResolvedValue('just some text') },
        configurable: true,
      })
      renderModal()
      // Give the effect time to run
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/klistra in/i)).toHaveValue('')
      })
    })
  })

  describe('after extraction', () => {
    async function renderWithItems() {
      mockExtract.mockResolvedValue({
        items: [
          { name: 'Smör', category: 'mejeri', measurement: '2 msk' },
          { name: 'Mjölk', category: 'mejeri', measurement: '3 dl' },
        ],
      })
      renderModal()
      fireEvent.change(screen.getByPlaceholderText(/klistra in/i), { target: { value: 'recipe' } })
      fireEvent.click(screen.getByRole('button', { name: /hämta varor/i }))
      await waitFor(() => screen.getByText('Smör'))
    }

    it('shows extracted items', async () => {
      await renderWithItems()
      expect(screen.getByText('Smör')).toBeInTheDocument()
      expect(screen.getByText('Mjölk')).toBeInTheDocument()
    })

    it('shows measurement for each item', async () => {
      await renderWithItems()
      expect(screen.getByText('· 2 msk')).toBeInTheDocument()
      expect(screen.getByText('· 3 dl')).toBeInTheDocument()
    })

    it('all items start selected — count in heading reflects this', async () => {
      await renderWithItems()
      expect(screen.getByText(/lägg till 2 varor/i)).toBeInTheDocument()
    })

    it('toggling an item reduces the selected count', async () => {
      await renderWithItems()
      fireEvent.click(screen.getByText('Smör').closest('li')!)
      expect(screen.getByText(/lägg till 1 varor/i)).toBeInTheDocument()
    })

    it('"Lägg till" button is disabled when 0 items selected', async () => {
      await renderWithItems()
      fireEvent.click(screen.getByText('Smör').closest('li')!)
      fireEvent.click(screen.getByText('Mjölk').closest('li')!)
      expect(screen.getByRole('button', { name: /lägg till 0/i })).toBeDisabled()
    })

    it('"Tillbaka" navigates back to the input form', async () => {
      await renderWithItems()
      fireEvent.click(screen.getByRole('button', { name: /tillbaka/i }))
      expect(screen.getByPlaceholderText(/klistra in/i)).toBeInTheDocument()
    })
  })

  describe('adding items', () => {
    it('calls addItems with selected items and closes on success', async () => {
      mockExtract.mockResolvedValue({
        items: [{ name: 'Smör', category: 'mejeri', measurement: '2 msk' }],
      })
      mockAddItems.mockResolvedValue({ items: [] })
      renderModal()
      fireEvent.change(screen.getByPlaceholderText(/klistra in/i), { target: { value: 'x' } })
      fireEvent.click(screen.getByRole('button', { name: /hämta varor/i }))
      await waitFor(() => screen.getByText('Smör'))
      fireEvent.click(screen.getByRole('button', { name: /lägg till 1/i }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
      expect(mockAddItems).toHaveBeenCalledWith('list-1', [
        { name: 'Smör', category: 'mejeri', measurement: '2 msk' },
      ])
    })
  })
})
