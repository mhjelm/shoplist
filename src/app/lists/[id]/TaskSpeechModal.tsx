'use client'

import { useCallback, useEffect, useState } from 'react'
import { extractTasksFromAudio } from './actions'
import { muAddItem } from '@/lib/sync/mutations'
import { buildLocalItem } from './itemHelpers'
import { useAudioRecorder } from './useAudioRecorder'

interface Props {
  listId: string
  onClose: () => void
}

type Stage = 'recording' | 'processing' | 'results' | 'error'

type Parsed = { name: string; selected: boolean }

const MAX_SECONDS = 30

// Voice add for task lists: record spoken Swedish, let Gemini segment it into
// discrete tasks, then add the selected ones. Simplified sibling of SpeechModal
// (no quantity/measurement/category, no name-merge — tasks don't dedupe).
export default function TaskSpeechModal({ listId, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('recording')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed[]>([])
  const [adding, setAdding] = useState(false)

  const handleResult = useCallback(async (base64: string, mimeType: string) => {
    setStage('processing')
    try {
      const result = await extractTasksFromAudio(base64, mimeType)
      if (result.error) {
        setError(result.error)
        setStage('error')
        return
      }
      const got = result.tasks ?? []
      if (got.length === 0) {
        setError('Inga uppgifter hittades. Försök igen och tala tydligt.')
        setStage('error')
        return
      }
      setParsed(got.map(name => ({ name, selected: true })))
      setStage('results')
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

  function toggleAt(idx: number) {
    setParsed(prev => prev.map((p, n) => n === idx ? { ...p, selected: !p.selected } : p))
  }

  async function handleAdd() {
    const selected = parsed.filter(p => p.selected)
    if (selected.length === 0) return
    setAdding(true)
    for (const p of selected) {
      await muAddItem(buildLocalItem(listId, p.name), { skipCategorize: true })
    }
    onClose()
  }

  function handleRetry() {
    setError(null)
    setStage('recording')
    restart()
  }

  const selectedCount = parsed.filter(p => p.selected).length

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 sm:rounded-xl border-t sm:border border-gray-200 dark:border-gray-800 p-5 w-full sm:max-w-md shadow-xl flex flex-col gap-3 max-h-[90vh] sm:max-h-[80vh]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {stage === 'results' ? `Add ${selectedCount} tasks` : 'Speak to add tasks'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {stage === 'recording' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
              <span className="relative flex items-center justify-center w-20 h-20 rounded-full bg-red-500 text-white">
                <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
              </span>
            </div>
            <p className="text-base text-gray-700 dark:text-gray-300 text-center">Recording… speak to add tasks</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {elapsed}s / {MAX_SECONDS}s
            </p>
            <button
              onClick={stop}
              className="text-sm px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {stage === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <span className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-indigo-600 animate-spin" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Interpreting…</p>
          </div>
        )}

        {stage === 'results' && (
          <>
            <ul className="overflow-y-auto -mx-1 px-1 space-y-1 flex-1">
              {parsed.map((item, idx) => (
                <li
                  key={idx}
                  onClick={() => toggleAt(idx)}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className={`w-6 h-6 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${item.selected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {item.selected && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-lg flex-1 ${item.selected ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                    <span className="font-medium">{item.name}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || selectedCount === 0}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {adding ? 'Adding…' : `Add ${selectedCount}`}
              </button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-red-500 text-center">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRetry}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors"
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
