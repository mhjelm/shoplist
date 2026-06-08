import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Item } from '@/lib/types'

// Capture the callbacks the modal passes to the recorder so the test can drive
// it past the (browser-only) capture stage that jsdom can't run.
const rec = vi.hoisted(() => ({
  onResult: undefined as undefined | ((b64: string, mime: string) => void),
  onError: undefined as undefined | ((msg: string) => void),
  stop: vi.fn(),
  restart: vi.fn(),
}))

vi.mock('@/app/lists/[id]/useAudioRecorder', () => ({
  useAudioRecorder: (opts: {
    onResult: (b64: string, mime: string) => void
    onError: (msg: string) => void
  }) => {
    rec.onResult = opts.onResult
    rec.onError = opts.onError
    return { elapsed: 0, stop: rec.stop, restart: rec.restart }
  },
}))

vi.mock('@/app/lists/[id]/actions', () => ({
  extractItemsFromAudio: vi.fn(),
}))
vi.mock('@/lib/sync/mutations', () => ({
  muAddItem: vi.fn().mockResolvedValue(undefined),
  muUpdateItem: vi.fn().mockResolvedValue(undefined),
}))

import SpeechModal from '@/app/lists/[id]/SpeechModal'
const { extractItemsFromAudio } = await import('@/app/lists/[id]/actions')
const { muAddItem, muUpdateItem } = await import('@/lib/sync/mutations')
const mockExtract = vi.mocked(extractItemsFromAudio)
const mockAdd = vi.mocked(muAddItem)
const mockUpdate = vi.mocked(muUpdateItem)

type ParsedItem = { name: string; quantity: number; measurement: string | null; category: null }

beforeEach(() => {
  vi.clearAllMocks()
  rec.onResult = undefined
  rec.onError = undefined
})

async function driveToResults(items: ParsedItem[]) {
  mockExtract.mockResolvedValue({ items })
  await act(async () => {
    rec.onResult!('base64audio', 'audio/webm')
  })
}

function item(partial: Partial<Item>): Item {
  return {
    id: 'i1', list_id: 'l1', added_by: 'u1', name: 'X', is_checked: false,
    created_at: '', picture_url: null, sort_order: 0, quantity: 1,
    category: null, measurement: null, shared_group_id: null,
    assignee_id: null, due_date: null,
    ...partial,
  } as Item
}

describe('SpeechModal', () => {
  it('starts in the recording stage', () => {
    render(<SpeechModal listId="l1" items={[]} onClose={vi.fn()} />)
    expect(screen.getByText(/spelar in/i)).toBeInTheDocument()
  })

  it('shows parsed items after extraction and adds the selected ones via muAddItem', async () => {
    render(<SpeechModal listId="l1" items={[]} onClose={vi.fn()} />)
    await driveToResults([
      { name: 'Mjölk', quantity: 1, measurement: null, category: null },
      { name: 'Bröd', quantity: 2, measurement: null, category: null },
      { name: 'Ägg', quantity: 1, measurement: null, category: null },
    ])

    expect(await screen.findByText('Mjölk')).toBeInTheDocument()
    expect(mockExtract).toHaveBeenCalledWith('base64audio', 'audio/webm')

    // Deselect the middle item, then add the rest.
    fireEvent.click(screen.getByText('Bröd'))
    fireEvent.click(screen.getByRole('button', { name: /lägg till 2/i }))

    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2))
    const addedNames = mockAdd.mock.calls.map(c => (c[0] as { name: string }).name)
    expect(addedNames).toEqual(['Mjölk', 'Ägg'])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('merges into an existing unchecked item instead of adding a duplicate', async () => {
    const existing = item({ id: 'e1', name: 'Mjölk', quantity: 1, measurement: '1 l' })
    render(<SpeechModal listId="l1" items={[existing]} onClose={vi.fn()} />)
    await driveToResults([{ name: 'mjölk', quantity: 2, measurement: '2 l', category: null }])

    fireEvent.click(await screen.findByRole('button', { name: /lägg till 1/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith('l1', 'e1', {
      quantity: 3,
      measurement: '1 l + 2 l',
      is_checked: false,
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('surfaces an extraction error', async () => {
    mockExtract.mockResolvedValue({ error: 'Gemini failed' })
    render(<SpeechModal listId="l1" items={[]} onClose={vi.fn()} />)
    await act(async () => {
      rec.onResult!('b64', 'audio/webm')
    })
    expect(await screen.findByText('Gemini failed')).toBeInTheDocument()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('shows an empty-result message when no items are found', async () => {
    render(<SpeechModal listId="l1" items={[]} onClose={vi.fn()} />)
    await driveToResults([])
    expect(await screen.findByText(/inga varor hittades/i)).toBeInTheDocument()
  })

  it('surfaces a recorder error (mic denied)', async () => {
    render(<SpeechModal listId="l1" items={[]} onClose={vi.fn()} />)
    await act(async () => {
      rec.onError!('Mikrofonåtkomst nekades. Tillåt mikrofonen och försök igen.')
    })
    expect(await screen.findByText(/mikrofonåtkomst nekades/i)).toBeInTheDocument()
  })
})
