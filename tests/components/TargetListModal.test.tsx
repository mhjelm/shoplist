import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TargetListModal from '@/app/lists/[id]/TargetListModal'

vi.mock('@/app/lists/actions', () => ({
  createList: vi.fn(),
}))

const { createList } = await import('@/app/lists/actions')
const mockCreateList = vi.mocked(createList)

const onPick = vi.fn()
const onClose = vi.fn()

const lists = [
  { id: 'list-a', name: 'Veckohandling', owner_id: 'me' },
  { id: 'list-b', name: 'Recept', owner_id: 'someone-else' },
]

function renderModal(overrides: Partial<Parameters<typeof TargetListModal>[0]> = {}) {
  return render(
    <TargetListModal
      mode="copy"
      availableLists={lists}
      currentUserId="me"
      onPick={onPick}
      onClose={onClose}
      {...overrides}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  onPick.mockResolvedValue(undefined)
})

describe('TargetListModal', () => {
  describe('initial render', () => {
    it('shows "Kopiera till lista" heading when mode is copy', () => {
      renderModal({ mode: 'copy' })
      expect(screen.getByText('Kopiera till lista')).toBeInTheDocument()
    })

    it('shows "Flytta till lista" heading when mode is move', () => {
      renderModal({ mode: 'move' })
      expect(screen.getByText('Flytta till lista')).toBeInTheDocument()
    })

    it('shows "Dela till lista" heading when mode is share', () => {
      renderModal({ mode: 'share' })
      expect(screen.getByText('Dela till lista')).toBeInTheDocument()
    })

    it('renders one button per available list', () => {
      renderModal()
      expect(screen.getByRole('button', { name: /veckohandling/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /recept/i })).toBeInTheDocument()
    })

    it('shows "Delad" badge only on lists not owned by current user', () => {
      renderModal()
      const badges = screen.getAllByText('Delad')
      expect(badges).toHaveLength(1)
      // The badge sits inside the Recept row.
      expect(badges[0].closest('button')).toHaveTextContent('Recept')
    })

    it('shows the create-new affordance', () => {
      renderModal()
      expect(screen.getByRole('button', { name: /skapa ny lista/i })).toBeInTheDocument()
    })

    it('shows empty-state copy when there are no other lists', () => {
      renderModal({ availableLists: [] })
      expect(screen.getByText(/inga andra listor/i)).toBeInTheDocument()
    })
  })

  describe('picking an existing list', () => {
    it('calls onPick with the chosen list id', async () => {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /veckohandling/i }))
      await waitFor(() => expect(onPick).toHaveBeenCalledWith('list-a'))
    })

    it('does not call createList when picking an existing list', async () => {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /recept/i }))
      await waitFor(() => expect(onPick).toHaveBeenCalled())
      expect(mockCreateList).not.toHaveBeenCalled()
    })
  })

  describe('create-new flow', () => {
    it('reveals an input when "Skapa ny lista" is clicked', () => {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      expect(screen.getByPlaceholderText(/listans namn/i)).toBeInTheDocument()
    })

    it('submit is disabled until a name is entered', () => {
      renderModal({ mode: 'copy' })
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      const submit = screen.getByRole('button', { name: /skapa & kopiera/i })
      expect(submit).toBeDisabled()
      fireEvent.change(screen.getByPlaceholderText(/listans namn/i), { target: { value: 'Ny lista' } })
      expect(submit).not.toBeDisabled()
    })

    it('uses "Skapa & flytta" label when mode is move', () => {
      renderModal({ mode: 'move' })
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      expect(screen.getByRole('button', { name: /skapa & flytta/i })).toBeInTheDocument()
    })

    it('uses "Skapa & dela" label when mode is share', () => {
      renderModal({ mode: 'share' })
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      expect(screen.getByRole('button', { name: /skapa & dela/i })).toBeInTheDocument()
    })

    it('on submit, calls createList then onPick with the new list id', async () => {
      mockCreateList.mockResolvedValue({ list: { id: 'new-list-id', name: 'Ny', owner_id: 'me', created_at: '' } })
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      fireEvent.change(screen.getByPlaceholderText(/listans namn/i), { target: { value: 'Ny' } })
      fireEvent.click(screen.getByRole('button', { name: /skapa & kopiera/i }))
      await waitFor(() => expect(mockCreateList).toHaveBeenCalled())
      const fd = mockCreateList.mock.calls[0][0]
      expect(fd.get('name')).toBe('Ny')

      await waitFor(() => expect(onPick).toHaveBeenCalledWith('new-list-id'))
    })

    it('shows an error and does not call onPick when createList fails', async () => {
      mockCreateList.mockResolvedValue({ error: 'Duplicate name' })
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      fireEvent.change(screen.getByPlaceholderText(/listans namn/i), { target: { value: 'Ny' } })
      fireEvent.click(screen.getByRole('button', { name: /skapa & kopiera/i }))
      await waitFor(() => expect(screen.getByText(/duplicate name/i)).toBeInTheDocument())
      expect(onPick).not.toHaveBeenCalled()
    })

    it('"Tillbaka" returns to the list view', () => {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /^\+ skapa ny lista$/i }))
      fireEvent.click(screen.getByRole('button', { name: /tillbaka/i }))
      expect(screen.queryByPlaceholderText(/listans namn/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /veckohandling/i })).toBeInTheDocument()
    })
  })

  describe('closing', () => {
    it('Escape key calls onClose', () => {
      renderModal()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('"Avbryt" button calls onClose', () => {
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /avbryt/i }))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('errors from onPick', () => {
    it('surfaces an error message when onPick throws', async () => {
      onPick.mockRejectedValueOnce(new Error('Move failed'))
      renderModal()
      fireEvent.click(screen.getByRole('button', { name: /veckohandling/i }))
      await waitFor(() => expect(screen.getByText(/move failed/i)).toBeInTheDocument())
    })
  })
})
