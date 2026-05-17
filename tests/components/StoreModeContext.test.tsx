import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StoreModeProvider, useStoreMode } from '@/app/lists/[id]/StoreModeContext'

function ModeDisplay() {
  const [active] = useStoreMode()
  return <span data-testid="mode">{active ? 'store' : 'normal'}</span>
}

function ModeToggle() {
  const [active, setActive] = useStoreMode()
  return <button onClick={() => setActive(!active)}>{active ? 'Sluta handla' : 'Handla'}</button>
}

describe('StoreModeContext', () => {
  it('starts in normal mode', () => {
    render(
      <StoreModeProvider>
        <ModeDisplay />
        <ModeToggle />
      </StoreModeProvider>
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('normal')
    expect(screen.getByRole('button', { name: /handla/i })).toBeInTheDocument()
  })

  it('toggles to store mode on click', () => {
    render(
      <StoreModeProvider>
        <ModeDisplay />
        <ModeToggle />
      </StoreModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /^handla$/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('store')
    expect(screen.getByRole('button', { name: /sluta handla/i })).toBeInTheDocument()
  })

  it('toggles back to normal on second click', () => {
    render(
      <StoreModeProvider>
        <ModeDisplay />
        <ModeToggle />
      </StoreModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /^handla$/i }))
    fireEvent.click(screen.getByRole('button', { name: /sluta handla/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('normal')
  })

  it('two sibling consumers both see the update', () => {
    render(
      <StoreModeProvider>
        <ModeDisplay />
        <ModeDisplay />
        <ModeToggle />
      </StoreModeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /^handla$/i }))
    screen.getAllByTestId('mode').forEach(el => {
      expect(el).toHaveTextContent('store')
    })
  })
})
