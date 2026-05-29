'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { extractItemsFromAudio } from './actions'
import { muAddItem, muUpdateItem } from '@/lib/sync/mutations'
import { findExistingItem, buildLocalItem } from './itemHelpers'
import type { CategorySlug } from '@/lib/categories'
import type { Item } from '@/lib/types'

interface Props {
  listId: string
  items: Item[]
  onClose: () => void
}

type Stage = 'recording' | 'processing' | 'results' | 'error'

type Parsed = {
  name: string
  quantity: number
  measurement: string | null
  category: CategorySlug | null
  selected: boolean
}

const MAX_SECONDS = 30

// Strip the "data:<mime>;base64," prefix that FileReader produces.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read audio'))
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export default function SpeechModal({ listId, items, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('recording')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [adding, setAdding] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Guards the onstop handler: only process audio for an intentional stop, not
  // an abort triggered by closing the modal.
  const abortedRef = useRef(false)

  const releaseMic = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const handleClose = useCallback(() => {
    abortedRef.current = true
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    releaseMic()
    onClose()
  }, [releaseMic, onClose])

  // Begins the async mic capture. Deliberately performs no synchronous setState
  // before the first await: on mount the initial state already matches the
  // recording stage, and the retry path resets state in its click handler.
  const startRecording = useCallback(async () => {
    abortedRef.current = false
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Mikrofonåtkomst nekades. Tillåt mikrofonen och försök igen.')
      setStage('error')
      return
    }
    streamRef.current = stream

    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      releaseMic()
      if (abortedRef.current) return
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      if (blob.size === 0) {
        setError('Hörde inget. Försök igen.')
        setStage('error')
        return
      }
      setStage('processing')
      try {
        const base64 = await blobToBase64(blob)
        const result = await extractItemsFromAudio(base64, blob.type)
        if (result.error) {
          setError(result.error)
          setStage('error')
          return
        }
        const got = result.items ?? []
        if (got.length === 0) {
          setError('Inga varor hittades. Försök igen och tala tydligt.')
          setStage('error')
          return
        }
        setParsed(got.map(i => ({ ...i, selected: true })))
        setStage('results')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Kunde inte tolka ljudet')
        setStage('error')
      }
    }

    recorder.start()
    timerRef.current = setInterval(() => {
      setElapsed(s => {
        const next = s + 1
        if (next >= MAX_SECONDS && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
        }
        return next
      })
    }, 1000)
  }, [releaseMic])

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  // Start recording on mount; release the mic on unmount. startRecording is an
  // async side-effect (getUserMedia) whose state updates all happen after the
  // first await — the set-state-in-effect rule can't see past it, so it's a
  // false positive here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startRecording()
    return () => {
      abortedRef.current = true
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      releaseMic()
    }
    // Run once on mount — startRecording/releaseMic are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  function toggleAt(idx: number) {
    setParsed(prev => prev.map((p, n) => n === idx ? { ...p, selected: !p.selected } : p))
  }

  async function handleAdd() {
    const selected = parsed.filter(p => p.selected)
    if (selected.length === 0) return
    setAdding(true)
    for (const p of selected) {
      const match = findExistingItem(items, p.name)
      if (match) {
        const incoming = p.measurement?.trim() || null
        const mergedMeasurement = incoming
          ? (match.measurement ? `${match.measurement} + ${incoming}` : incoming)
          : match.measurement
        await muUpdateItem(listId, match.id, {
          quantity: match.quantity + p.quantity,
          measurement: mergedMeasurement,
          is_checked: false,
        })
      } else {
        await muAddItem(buildLocalItem(listId, p.name, {
          quantity: p.quantity,
          measurement: p.measurement,
          category: p.category,
        }))
      }
    }
    onClose()
  }

  const selectedCount = parsed.filter(p => p.selected).length

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 sm:rounded-xl border-t sm:border border-gray-200 dark:border-gray-800 p-5 w-full sm:max-w-md shadow-xl flex flex-col gap-3 max-h-[90vh] sm:max-h-[80vh]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {stage === 'results' ? `Lägg till ${selectedCount} varor` : 'Tala för att lägga till'}
          </h2>
          <button
            onClick={handleClose}
            aria-label="Stäng"
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
            <p className="text-base text-gray-700 dark:text-gray-300 text-center">Spelar in… tala för att lägga till varor</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {elapsed}s / {MAX_SECONDS}s
            </p>
            <button
              onClick={stopRecording}
              className="text-sm px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
            >
              Klar
            </button>
          </div>
        )}

        {stage === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <span className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Tolkar…</p>
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
                  <span className={`w-6 h-6 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${item.selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {item.selected && (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-lg flex-1 ${item.selected ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                    <span className="font-medium">{item.name}</span>
                    {item.quantity > 1 && (
                      <span className="ml-1.5 text-base text-gray-400 dark:text-gray-500">× {item.quantity}</span>
                    )}
                    {item.measurement && (
                      <span className="ml-1.5 text-base text-gray-400 dark:text-gray-500">· {item.measurement}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || selectedCount === 0}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {adding ? 'Lägger till…' : `Lägg till ${selectedCount}`}
              </button>
            </div>
          </>
        )}

        {stage === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-red-500 text-center">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={() => { setError(null); setElapsed(0); setStage('recording'); startRecording() }}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
              >
                Försök igen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
