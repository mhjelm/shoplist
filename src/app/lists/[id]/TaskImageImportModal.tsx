'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { extractTasksFromImage } from './actions'
import { resizeImage } from '@/lib/resize-image'
import { muAddItem } from '@/lib/sync/mutations'
import { buildLocalItem } from './itemHelpers'
import { log } from '@/lib/log'

interface Props {
  listId: string
  onClose: () => void
}

type Parsed = { name: string; selected: boolean }

// Picture import for task lists: snap/upload a photo of a to-do or chore list,
// let Gemini segment it into discrete tasks, then add the selected ones. Image
// sibling of TaskSpeechModal; shares its results checklist + add path. The file
// picker mirrors RecipeImportModal's Android content:// fix.
export default function TaskImageImportModal({ listId, onClose }: Props) {
  const fileInputId = useId()
  const [parsed, setParsed] = useState<Parsed[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // Force a fresh <input type="file"> DOM node after each pick. On Android, the
  // content:// permission Chrome grants the input is one-shot — reusing the same
  // element makes subsequent reads fail with NotReadableError.
  const [pickerNonce, setPickerNonce] = useState(0)
  // Android 13's system Photo Picker hands Chrome unreadable content:// URIs. The
  // SAF "Files" picker returns readable URIs, and Chrome routes accept="image/*"
  // to the Photo Picker — so on Android we strip `accept` to land on the Files
  // picker instead. Renders WITH accept for desktop/iOS + SSR/hydration parity;
  // removed imperatively post-mount only on Android. Mirrors RecipeImportModal /
  // PictureInput — keep the three in sync.
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (/Android/i.test(navigator.userAgent)) fileInputRef.current?.removeAttribute('accept')
  }, [pickerNonce])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleImageFile(file: File, resizePromise?: Promise<Blob>) {
    setError(null)
    setLoading(true)
    try {
      const blob = await (resizePromise ?? resizeImage(file))
      const fd = new FormData()
      fd.append('image', new File([blob], 'image.jpg', { type: 'image/jpeg' }))
      const result = await extractTasksFromImage(fd)
      if (result.error) {
        // Client-side breadcrumb: the server log.error doesn't reliably reach the
        // durable app_logs sink at end-of-request (see BUG-002), so log here too.
        log.warn('taskimport.image_failed', { error: result.error })
        setError(result.error)
        return
      }
      const tasks = result.tasks ?? []
      if (tasks.length === 0) {
        setError('Inga uppgifter hittades i bilden. Försök med en tydligare bild.')
        return
      }
      setParsed(tasks.map(name => ({ name, selected: true })))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Kunde inte bearbeta bilden'
      log.warn('taskimport.image_failed', { error: message })
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  function toggleAt(idx: number) {
    setParsed(prev => prev?.map((p, n) => n === idx ? { ...p, selected: !p.selected } : p) ?? null)
  }

  async function handleAdd() {
    if (!parsed) return
    const selected = parsed.filter(p => p.selected)
    if (selected.length === 0) return
    setAdding(true)
    for (const p of selected) {
      await muAddItem(buildLocalItem(listId, p.name), { skipCategorize: true })
    }
    onClose()
  }

  const selectedCount = parsed?.filter(p => p.selected).length ?? 0

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
            {parsed ? `Add ${selectedCount} tasks` : 'Import tasks from a picture'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {!parsed && (
          <>
            <label
              htmlFor={fileInputId}
              aria-disabled={loading}
              className={`flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors ${loading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
              </svg>
              <span>{loading ? 'Bearbetar bild…' : 'Hämta uppgifter från bild'}</span>
            </label>
            <input
              key={pickerNonce}
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              // accept stripped post-mount on Android (see fileInputRef effect above).
              accept="image/*"
              className="sr-only"
              onChange={e => {
                const f = e.target.files?.[0]
                if (!f) {
                  setPickerNonce(n => n + 1)
                  return
                }
                // Without accept on Android the Files picker can return non-images;
                // reject them cleanly instead of failing later in decode.
                if (f.type && !f.type.startsWith('image/')) {
                  setError('Välj en bildfil')
                  setPickerNonce(n => n + 1)
                  return
                }
                // Android 13's photo picker grants a short-lived read URI; start
                // the read synchronously to win the race before any React render
                // delays it. Defer the input remount until the read finishes so
                // changing the key doesn't revoke the file mid-read.
                const p = resizeImage(f)
                p.catch(() => {})
                handleImageFile(f, p).finally(() => setPickerNonce(n => n + 1))
              }}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </>
        )}

        {parsed && (
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
            {error && <p className="text-xs text-red-500">{error}</p>}
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
      </div>
    </div>
  )
}
