import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

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
  extractTasksFromAudio: vi.fn(),
}))
vi.mock('@/lib/sync/mutations', () => ({
  muAddItem: vi.fn().mockResolvedValue(undefined),
}))

import TaskSpeechModal from '@/app/lists/[id]/TaskSpeechModal'
const { extractTasksFromAudio } = await import('@/app/lists/[id]/actions')
const { muAddItem } = await import('@/lib/sync/mutations')
const mockExtract = vi.mocked(extractTasksFromAudio)
const mockAdd = vi.mocked(muAddItem)

beforeEach(() => {
  vi.clearAllMocks()
  rec.onResult = undefined
  rec.onError = undefined
})

async function driveToResults(tasks: string[]) {
  mockExtract.mockResolvedValue({ tasks })
  await act(async () => {
    rec.onResult!('base64audio', 'audio/webm')
  })
}

describe('TaskSpeechModal', () => {
  it('starts in the recording stage', () => {
    render(<TaskSpeechModal listId="l1" onClose={vi.fn()} />)
    expect(screen.getByText(/recording/i)).toBeInTheDocument()
  })

  it('shows parsed tasks after extraction and adds the selected ones via muAddItem', async () => {
    render(<TaskSpeechModal listId="l1" onClose={vi.fn()} />)
    await driveToResults(['Ring rörmokaren', 'Vattna blommorna', 'Hämta tvätten'])

    expect(await screen.findByText('Ring rörmokaren')).toBeInTheDocument()
    expect(mockExtract).toHaveBeenCalledWith('base64audio', 'audio/webm')

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
    render(<TaskSpeechModal listId="l1" onClose={vi.fn()} />)
    await act(async () => {
      rec.onResult!('b64', 'audio/webm')
    })
    expect(await screen.findByText('Gemini failed')).toBeInTheDocument()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('shows an empty-result message when no tasks are found', async () => {
    render(<TaskSpeechModal listId="l1" onClose={vi.fn()} />)
    await driveToResults([])
    expect(await screen.findByText(/inga uppgifter hittades/i)).toBeInTheDocument()
  })
})
