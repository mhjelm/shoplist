import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskEditModal } from '@/app/lists/[id]/TaskEditModal'
import type { Item, ListPerson } from '@/lib/types'

const PEOPLE: ListPerson[] = [
  { user_id: 'u-anna', email: 'anna@example.com' },
  { user_id: 'u-erik', email: 'erik@example.com' },
]

function makeTask(overrides: Partial<Item> = {}): Item {
  return {
    id: 'task-1',
    list_id: 'list-1',
    added_by: 'u-anna',
    name: 'Call plumber',
    is_checked: false,
    created_at: '2026-06-01T00:00:00Z',
    picture_url: null,
    sort_order: null,
    quantity: 1,
    category: null,
    measurement: null,
    shared_group_id: null,
    assignee_id: 'u-anna',
    due_date: '2026-06-09',
    ...overrides,
  }
}

describe('TaskEditModal', () => {
  it('prefills name, assignee, and due date', () => {
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('Call plumber')).toBeInTheDocument()
    expect(screen.getByDisplayValue('anna@example.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-06-09')).toBeInTheDocument()
  })

  it('lists Unassigned + each person as assignee options', () => {
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'erik@example.com' })).toBeInTheDocument()
  })

  it('saves the edited patch (name, assignee_id, due_date)', () => {
    const onSave = vi.fn()
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Call plumber'), { target: { value: 'Call the plumber' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith({
      name: 'Call the plumber',
      assignee_id: 'u-anna',
      due_date: '2026-06-09',
    })
  })

  it('clears assignee to null when Unassigned is chosen', () => {
    const onSave = vi.fn()
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignee_id: null }))
  })

  it('clears the due date to null via Clear', () => {
    const onSave = vi.fn()
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ due_date: null }))
  })

  it('fires onDelete and onClose', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<TaskEditModal item={makeTask()} people={PEOPLE} onSave={vi.fn()} onDelete={onDelete} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Save when the name is empty', () => {
    render(<TaskEditModal item={makeTask({ name: '' })} people={PEOPLE} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})
