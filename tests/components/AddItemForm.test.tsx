import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddItemForm } from '@/app/lists/[id]/AddItemForm'
import type React from 'react'

vi.mock('@/app/lists/[id]/PictureInput', () => ({
  default: ({ onSuggestName }: { onSuggestName?: (n: string) => void }) => (
    <div data-testid="picture-input" onClick={() => onSuggestName?.('suggested name')} />
  ),
}))

function makeRef<T>(value: T | null = null): React.RefObject<T | null> {
  return { current: value }
}

const defaultProps = {
  input: '',
  filtered: [],
  highlightIdx: -1,
  loading: false,
  addError: null,
  showUrlInput: false,
  urlInput: '',
  inputRef: makeRef<HTMLTextAreaElement>(),
  handleInputChange: vi.fn(),
  selectSuggestion: vi.fn(),
  handleDeleteSuggestion: vi.fn(),
  handleAdd: vi.fn().mockResolvedValue(undefined),
  setInput: vi.fn(),
  setFiltered: vi.fn(),
  setHighlightIdx: vi.fn(),
  setShowUrlInput: vi.fn(),
  setUrlInput: vi.fn(),
  isOffline: false,
  onOpenRecipe: vi.fn(),
}

describe('AddItemForm', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the add textarea', () => {
    render(<AddItemForm {...defaultProps} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders current input value in the textarea', () => {
    render(<AddItemForm {...defaultProps} input="mjölk" />)
    expect(screen.getByDisplayValue('mjölk')).toBeInTheDocument()
  })

  it('calls handleInputChange when text is typed', () => {
    const handleInputChange = vi.fn()
    render(<AddItemForm {...defaultProps} handleInputChange={handleInputChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mjölk' } })
    expect(handleInputChange).toHaveBeenCalledWith('mjölk')
  })

  it('shows the clear (×) button when input has text', () => {
    render(<AddItemForm {...defaultProps} input="mjölk" />)
    expect(screen.getByRole('button', { name: /rensa/i })).toBeInTheDocument()
  })

  it('hides the clear button when input is empty', () => {
    render(<AddItemForm {...defaultProps} input="" />)
    expect(screen.queryByRole('button', { name: /rensa/i })).toBeNull()
  })

  it('renders suggestions when filtered is non-empty', () => {
    render(<AddItemForm {...defaultProps} filtered={['mjölk', 'smör']} />)
    expect(screen.getByText('mjölk')).toBeInTheDocument()
    expect(screen.getByText('smör')).toBeInTheDocument()
  })

  it('hides suggestions when filtered is empty', () => {
    render(<AddItemForm {...defaultProps} filtered={[]} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('calls selectSuggestion when a suggestion is clicked', () => {
    const selectSuggestion = vi.fn()
    render(<AddItemForm {...defaultProps} filtered={['mjölk']} selectSuggestion={selectSuggestion} />)
    fireEvent.mouseDown(screen.getByText('mjölk').closest('li')!)
    expect(selectSuggestion).toHaveBeenCalledWith('mjölk')
  })

  it('calls handleDeleteSuggestion when the × on a suggestion is clicked', () => {
    const handleDeleteSuggestion = vi.fn()
    render(<AddItemForm {...defaultProps} filtered={['mjölk']} handleDeleteSuggestion={handleDeleteSuggestion} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: /ta bort mjölk/i }))
    expect(handleDeleteSuggestion).toHaveBeenCalledWith('mjölk')
  })

  it('calls handleAdd when the Add button is clicked', () => {
    const handleAdd = vi.fn().mockResolvedValue(undefined)
    render(<AddItemForm {...defaultProps} input="mjölk" handleAdd={handleAdd} />)
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(handleAdd).toHaveBeenCalledOnce()
  })

  it('disables Add button when input is empty', () => {
    render(<AddItemForm {...defaultProps} input="" />)
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
  })

  it('disables Add button when loading', () => {
    render(<AddItemForm {...defaultProps} input="mjölk" loading />)
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
  })

  it('calls onOpenRecipe when the recipe button is clicked', () => {
    const onOpenRecipe = vi.fn()
    render(<AddItemForm {...defaultProps} onOpenRecipe={onOpenRecipe} />)
    // The recipe button has a title about importing
    fireEvent.click(screen.getByTitle(/importera/i))
    expect(onOpenRecipe).toHaveBeenCalledOnce()
  })

  it('calls setShowUrlInput when the image button is clicked', () => {
    const setShowUrlInput = vi.fn()
    render(<AddItemForm {...defaultProps} setShowUrlInput={setShowUrlInput} />)
    fireEvent.click(screen.getByTitle(/lägg till bild/i))
    expect(setShowUrlInput).toHaveBeenCalledOnce()
  })

  it('renders PictureInput when showUrlInput is true', () => {
    render(<AddItemForm {...defaultProps} showUrlInput />)
    expect(screen.getByTestId('picture-input')).toBeInTheDocument()
  })

  it('does not render PictureInput when showUrlInput is false', () => {
    render(<AddItemForm {...defaultProps} showUrlInput={false} />)
    expect(screen.queryByTestId('picture-input')).toBeNull()
  })

  it('shows addError text', () => {
    render(<AddItemForm {...defaultProps} addError="Något gick fel" />)
    expect(screen.getByText('Något gick fel')).toBeInTheDocument()
  })

  it('disables image and recipe buttons when offline', () => {
    render(<AddItemForm {...defaultProps} isOffline />)
    const offlineButtons = screen.getAllByTitle(/kräver anslutning/i)
    expect(offlineButtons).toHaveLength(2)
    offlineButtons.forEach(btn => expect(btn).toBeDisabled())
  })
})
