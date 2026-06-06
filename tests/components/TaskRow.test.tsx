import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow } from '@/app/lists/[id]/TaskRow'
import { formatDueLabel } from '@/lib/taskView'
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
    name: 'Mow the lawn',
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
    ...overrides,
  }
}

describe('TaskRow', () => {
  it('renders the task name', () => {
    render(<TaskRow item={makeTask()} people={PEOPLE} onToggle={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText('Mow the lawn')).toBeInTheDocument()
  })

  it('shows an Unassigned avatar when no assignee', () => {
    render(<TaskRow item={makeTask()} people={PEOPLE} onToggle={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByLabelText('Unassigned')).toBeInTheDocument()
  })

  it('shows the assignee initial + email when assigned', () => {
    render(<TaskRow item={makeTask({ assignee_id: 'u-anna' })} people={PEOPLE} onToggle={vi.fn()} onEdit={vi.fn()} />)
    const avatar = screen.getByLabelText('Assigned to anna@example.com')
    expect(avatar).toHaveTextContent('A')
  })

  it('renders a due-date pill when a due date is set', () => {
    const due = '2026-12-31'
    render(<TaskRow item={makeTask({ due_date: due })} people={PEOPLE} onToggle={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText(formatDueLabel(due)!)).toBeInTheDocument()
  })

  it('omits the due-date pill when there is no due date', () => {
    render(<TaskRow item={makeTask()} people={PEOPLE} onToggle={vi.fn()} onEdit={vi.fn()} />)
    // checkbox is the only role=checkbox; no pill text present beyond the name/avatar
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('checkbox reflects done state and fires onToggle', () => {
    const onToggle = vi.fn()
    render(<TaskRow item={makeTask({ is_checked: true })} people={PEOPLE} done onToggle={onToggle} onEdit={vi.fn()} />)
    const cb = screen.getByRole('checkbox')
    expect(cb).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(cb)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('done tasks render the name with a line-through and hide the due pill', () => {
    render(<TaskRow item={makeTask({ is_checked: true, due_date: '2026-12-31' })} people={PEOPLE} done onToggle={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.getByText('Mow the lawn').className).toContain('line-through')
    expect(screen.queryByText(formatDueLabel('2026-12-31')!)).not.toBeInTheDocument()
  })

  it('fires onEdit when the pencil is clicked', () => {
    const onEdit = vi.fn()
    render(<TaskRow item={makeTask()} people={PEOPLE} onToggle={vi.fn()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /edit mow the lawn/i }))
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
