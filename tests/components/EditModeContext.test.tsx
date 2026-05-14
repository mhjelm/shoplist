import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditModeProvider, EditModeToggle, useEditMode } from '@/app/lists/[id]/EditModeContext'

function ModeDisplay() {
  const [active] = useEditMode()
  return <span data-testid="mode">{active ? 'edit' : 'normal'}</span>
}

describe('EditModeContext', () => {
  it('starts in normal mode', () => {
    render(
      <EditModeProvider>
        <ModeDisplay />
        <EditModeToggle />
      </EditModeProvider>
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('normal')
    expect(screen.getByRole('button', { name: /redigera/i })).toBeInTheDocument()
  })

  it('toggles to edit mode on click', () => {
    render(
      <EditModeProvider>
        <ModeDisplay />
        <EditModeToggle />
      </EditModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /redigera/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('edit')
    expect(screen.getByRole('button', { name: /klar/i })).toBeInTheDocument()
  })

  it('toggles back to normal on second click', () => {
    render(
      <EditModeProvider>
        <ModeDisplay />
        <EditModeToggle />
      </EditModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /redigera/i }))
    fireEvent.click(screen.getByRole('button', { name: /klar/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('normal')
  })

  it('two sibling consumers both see the update', () => {
    render(
      <EditModeProvider>
        <ModeDisplay />
        <ModeDisplay />
        <EditModeToggle />
      </EditModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /redigera/i }))
    screen.getAllByTestId('mode').forEach(el => {
      expect(el).toHaveTextContent('edit')
    })
  })
})
