import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/app/lists/[id]/actions', () => ({
  extractTasksFromImage: vi.fn(),
}))
vi.mock('@/lib/resize-image', () => ({
  resizeImage: vi.fn(async (blob: Blob) => blob),
}))
vi.mock('@/lib/sync/mutations', () => ({
  muAddItem: vi.fn().mockResolvedValue(undefined),
}))

import TaskImageImportModal from '@/app/lists/[id]/TaskImageImportModal'
const { extractTasksFromImage } = await import('@/app/lists/[id]/actions')
const { muAddItem } = await import('@/lib/sync/mutations')
const mockExtract = vi.mocked(extractTasksFromImage)
const mockAdd = vi.mocked(muAddItem)

const onClose = vi.fn()

function renderModal() {
  return render(<TaskImageImportModal listId="list-1" onClose={onClose} />)
}

function pickImage() {
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['fake'], 'todo.jpg', { type: 'image/jpeg' })
  fireEvent.change(fileInput, { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TaskImageImportModal', () => {
  it('shows the picture-import button initially', () => {
    renderModal()
    expect(screen.getByText(/hämta uppgifter från bild/i)).toBeInTheDocument()
  })

  it('extracts tasks from a picked image and adds the selected ones via muAddItem', async () => {
    mockExtract.mockResolvedValue({ tasks: ['Ring rörmokaren', 'Vattna blommorna', 'Hämta tvätten'] })
    renderModal()
    pickImage()

    expect(await screen.findByText('Ring rörmokaren')).toBeInTheDocument()
    await waitFor(() => expect(mockExtract).toHaveBeenCalled())

    // Deselect the middle task, then add the rest.
    fireEvent.click(screen.getByText('Vattna blommorna'))
    fireEvent.click(screen.getByRole('button', { name: /add 2/i }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2))
    const addedNames = mockAdd.mock.calls.map(c => (c[0] as { name: string }).name)
    expect(addedNames).toEqual(['Ring rörmokaren', 'Hämta tvätten'])
    // Tasks opt out of the Gemini category fallback.
    expect(mockAdd.mock.calls[0][1]).toEqual({ skipCategorize: true })
  })

  it('surfaces an extraction error', async () => {
    mockExtract.mockResolvedValue({ error: 'Gemini failed' })
    renderModal()
    pickImage()
    expect(await screen.findByText('Gemini failed')).toBeInTheDocument()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('shows an empty-result message when no tasks are found', async () => {
    mockExtract.mockResolvedValue({ tasks: [] })
    renderModal()
    pickImage()
    expect(await screen.findByText(/inga uppgifter hittades i bilden/i)).toBeInTheDocument()
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
