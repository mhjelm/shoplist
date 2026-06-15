import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NoteCard } from '@/app/lists/[id]/NoteCard'
import type { Item } from '@/lib/types'

function makeNote(overrides: Partial<Item> = {}): Item {
  return {
    id: 'note-1',
    list_id: 'list-1',
    added_by: 'u-anna',
    name: 'A saved thought',
    is_checked: false,
    created_at: '2026-06-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    assignee_id: null,
    due_date: null,
    url: null,
    note: null,
    ...overrides,
  }
}

describe('NoteCard', () => {
  it('renders a plain note as text (not a link)', () => {
    render(<NoteCard item={makeNote({ note: 'the body' })} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('A saved thought')).toBeInTheDocument()
    expect(screen.getByText('the body')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders a link with its title, href, and host pill', () => {
    render(<NoteCard item={makeNote({ name: 'Cool gadget', url: 'https://www.shop.test/item' })} onEdit={vi.fn()} onDelete={vi.fn()} />)
    const link = screen.getByRole('link', { name: 'Cool gadget' })
    expect(link).toHaveAttribute('href', 'https://www.shop.test/item')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('shop.test')).toBeInTheDocument()
  })

  it('renders a rich preview (image + title + description + host) for a link with an image', () => {
    render(
      <NoteCard
        item={makeNote({
          name: 'Kortläsare med USB C-kontakt',
          url: 'https://www.biltema.se/x',
          picture_url: 'https://img.test/p.jpg',
          note: 'Saknar din dator kortläsare?',
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: /Kortläsare med USB C-kontakt/ })
    expect(link).toHaveAttribute('href', 'https://www.biltema.se/x')
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://img.test/p.jpg')
    expect(screen.getByText('Saknar din dator kortläsare?')).toBeInTheDocument()
    expect(screen.getByText('biltema.se')).toBeInTheDocument()
  })

  it('falls back to the URL as the link label when there is no title', () => {
    render(<NoteCard item={makeNote({ name: '', url: 'https://x.test/y' })} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'https://x.test/y' })).toBeInTheDocument()
  })

  it('deletes only after a two-step confirm', () => {
    const onDelete = vi.fn()
    render(<NoteCard item={makeNote()} onEdit={vi.fn()} onDelete={onDelete} />)

    // First tap reveals confirm; nothing deleted yet.
    fireEvent.click(screen.getByLabelText('Delete A saved thought'))
    expect(onDelete).not.toHaveBeenCalled()

    // Cancel backs out without deleting.
    fireEvent.click(screen.getByLabelText('Cancel delete'))
    expect(onDelete).not.toHaveBeenCalled()

    // Tap again, then confirm.
    fireEvent.click(screen.getByLabelText('Delete A saved thought'))
    fireEvent.click(screen.getByLabelText('Confirm delete A saved thought'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('shows the NEW dot when isNew and calls onEdit', () => {
    const onEdit = vi.fn()
    render(<NoteCard item={makeNote()} isNew onEdit={onEdit} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('Tillagd sedan ditt senaste besök')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Edit A saved thought'))
    expect(onEdit).toHaveBeenCalled()
  })
})
