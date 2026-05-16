import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const editMode = vi.hoisted(() => ({ active: false }))
const sync = vi.hoisted(() => ({ isOffline: false }))

vi.mock('@/app/lists/[id]/EditModeContext', () => ({
  useEditMode: () => [editMode.active, vi.fn()],
}))

vi.mock('@/lib/sync/engine', () => ({
  useSyncState: () => ({ isOffline: sync.isOffline, pendingCount: 0, recentConflicts: [] }),
}))

vi.mock('@/app/lists/actions', () => ({
  inviteMember: vi.fn().mockResolvedValue({ error: null }),
  removeMember: vi.fn().mockResolvedValue({ error: null }),
}))

import ShareSection from '@/app/lists/[id]/ShareSection'
const { inviteMember, removeMember } = await import('@/app/lists/actions')
const mockInvite = vi.mocked(inviteMember)
const mockRemove = vi.mocked(removeMember)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LIST_ID = 'list-1'

function member(email: string, userId = email) {
  return { user_id: userId, email, added_at: '2024-01-01T00:00:00.000Z' }
}

function renderSection(opts: {
  members?: ReturnType<typeof member>[]
  invitees?: string[]
} = {}) {
  return render(
    <ShareSection
      listId={LIST_ID}
      initialMembers={opts.members ?? []}
      initialInvitees={opts.invitees ?? []}
    />
  )
}

beforeEach(() => {
  editMode.active = false
  sync.isOffline = false
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShareSection', () => {
  it('renders nothing when edit mode is off', () => {
    editMode.active = false
    const { container } = renderSection()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the section when edit mode is on', () => {
    editMode.active = true
    renderSection()
    expect(screen.getByText('Dela listan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/member@example.com/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /bjud in/i })).toBeInTheDocument()
  })

  it('shows current members with remove buttons', () => {
    editMode.active = true
    renderSection({ members: [member('alice@a.com', 'u1'), member('bob@b.com', 'u2')] })
    expect(screen.getByText('alice@a.com')).toBeInTheDocument()
    expect(screen.getByText('bob@b.com')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /ta bort/i })).toHaveLength(2)
  })

  it('shows "Inga medlemmar än." when member list is empty', () => {
    editMode.active = true
    renderSection()
    expect(screen.getByText('Inga medlemmar än.')).toBeInTheDocument()
  })

  it('clicking × calls removeMember and removes the row optimistically', async () => {
    editMode.active = true
    renderSection({ members: [member('alice@a.com', 'u1')] })
    fireEvent.click(screen.getByRole('button', { name: /ta bort alice@a.com/i }))
    await waitFor(() => expect(screen.queryByText('alice@a.com')).not.toBeInTheDocument())
    expect(mockRemove).toHaveBeenCalledWith(LIST_ID, 'u1')
  })

  it('rolls back the optimistic remove when removeMember returns an error', async () => {
    editMode.active = true
    mockRemove.mockResolvedValueOnce({ error: 'Not allowed' })
    renderSection({ members: [member('alice@a.com', 'u1')] })
    fireEvent.click(screen.getByRole('button', { name: /ta bort alice@a.com/i }))
    await waitFor(() => expect(screen.getByText('alice@a.com')).toBeInTheDocument())
  })

  it('submitting the invite form calls inviteMember and appends the email', async () => {
    editMode.active = true
    renderSection()
    fireEvent.change(screen.getByPlaceholderText(/member@example.com/i), { target: { value: 'carol@c.com' } })
    fireEvent.submit(screen.getByRole('button', { name: /bjud in/i }).closest('form')!)
    await waitFor(() => expect(mockInvite).toHaveBeenCalledWith(LIST_ID, 'carol@c.com'))
    await waitFor(() => expect(screen.getByText('carol@c.com')).toBeInTheDocument())
    expect(screen.getByText('Inbjuden!')).toBeInTheDocument()
  })

  it('shows an error message when inviteMember fails', async () => {
    editMode.active = true
    mockInvite.mockResolvedValueOnce({ error: 'User not found' })
    renderSection()
    fireEvent.change(screen.getByPlaceholderText(/member@example.com/i), { target: { value: 'nobody@x.com' } })
    fireEvent.submit(screen.getByRole('button', { name: /bjud in/i }).closest('form')!)
    await waitFor(() => expect(screen.getByText('User not found')).toBeInTheDocument())
  })

  it('shows previously-invited chips filtered to non-members', () => {
    editMode.active = true
    renderSection({
      members: [member('alice@a.com', 'u1')],
      invitees: ['alice@a.com', 'bob@b.com', 'carol@c.com'],
    })
    // alice is already a member — should not appear as a chip
    expect(screen.queryByRole('button', { name: 'alice@a.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'bob@b.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'carol@c.com' })).toBeInTheDocument()
  })

  it('clicking a chip fills the email input without submitting', () => {
    editMode.active = true
    renderSection({ invitees: ['bob@b.com'] })
    fireEvent.click(screen.getByRole('button', { name: 'bob@b.com' }))
    expect(screen.getByPlaceholderText(/member@example.com/i)).toHaveValue('bob@b.com')
    expect(mockInvite).not.toHaveBeenCalled()
  })

  it('offline: invite button is disabled with the Kräver anslutning tooltip', () => {
    editMode.active = true
    sync.isOffline = true
    renderSection()
    const btn = screen.getByRole('button', { name: /bjud in/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Kräver anslutning')
  })

  it('offline: remove button is disabled', () => {
    editMode.active = true
    sync.isOffline = true
    renderSection({ members: [member('alice@a.com', 'u1')] })
    const removeBtn = screen.getByRole('button', { name: /ta bort alice@a.com/i })
    expect(removeBtn).toBeDisabled()
  })
})
