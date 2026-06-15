'use client'

import { useCallback, useEffect, useState } from 'react'
import { transcribeNote } from './actions'
import { muAddItem } from '@/lib/sync/mutations'
import { buildLocalItem } from './itemHelpers'
import { splitNoteText } from '@/lib/notesView'
import { useAudioRecorder } from './useAudioRecorder'

interface Props {
  listId: string
  onClose: () => void
}

type Stage = 'recording' | 'processing' | 'review' | 'error'

const MAX_SECONDS = 120

// Voice memo for scrapbook lists: record speech, let Gemini transcribe it into
// one freeform note, then let the user review/edit the transcript before saving.
// Sibling of TaskSpeechModal, but there's nothing to segment — it's a single memo.
export default function NoteSpeechModal({ listId, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('recording')
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)

  const handleResult = useCallback(async (base64: string, mimeType: string) => {
    setStage('processing')
    try {
      const result = await transcribeNote(base64, mimeType)
      if (result.error) {
        setError(result.error)
        setStage('error')
        return
      }
      const got = (result.text ?? '').trim()
      if (!got) {
        setError('Hörde inget. Försök igen och tala tydligt.')
        setStage('error')
        return
      }
      setText(got)
      setStage('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte tolka ljudet')
      setStage('error')
    }
  }, [])

  const handleRecordError = useCallback((message: string) => {
    setError(message)
    setStage('error')
  }, [])

  const { elapsed, stop, restart } = useAudioRecorder({
    maxSeconds: MAX_SECONDS,
    onResult: handleResult,
    onError: handleRecordError,
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleAdd() {
    const { name, note } = splitNoteText(text)
    if (!name) return
    setAdding(true)
    await muAddItem(buildLocalItem(listId, name, { note }), { skipCategorize: true })
    onClose()
  }

  function handleRetry() {
    setError(null)
    setStage('recording')
    restart()
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col gap-3 border-t border-gray-200 bg-white p-5 shadow-xl sm:max-h-[80vh] sm:max-w-md sm:rounded-xl sm:border dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {stage === 'review' ? 'Review note' : 'Speak to add a note'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ×
          </button>
        </div>

        {stage === 'recording' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="relative">
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-red-500 text-white">
                <svg className="h-9 w-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
              </span>
            </div>
            <p className="text-center text-base text-gray-700 dark:text-gray-300">Recording… speak your note</p>
            <p className="text-xs tabular-nums text-gray-400 dark:text-gray-500">{elapsed}s / {MAX_SECONDS}s</p>
            <button
              onClick={stop}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        )}

        {stage === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Transcribing…</p>
          </div>
        )}

        {stage === 'review' && (
          <>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={6}
              autoFocus
              className="w-full flex-1 resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !text.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
              >
                {adding ? 'Adding…' : 'Add note'}
              </button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-center text-sm text-red-500">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleRetry}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
