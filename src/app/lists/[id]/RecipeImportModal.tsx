'use client'

import { useEffect, useId, useState } from 'react'
import { addItems, extractRecipeItems, extractListItemsFromImage } from './actions'
import { resizeImage } from '@/lib/resize-image'
import type { Item } from '@/lib/types'

interface Props {
  listId: string
  onClose: () => void
  onItemsAdded: (items: Item[]) => void
}

type Extracted = { name: string; category: string | null; measurement: string | null; selected: boolean }

export default function RecipeImportModal({ listId, onClose, onItemsAdded }: Props) {
  const fileInputId = useId()
  const [text, setText] = useState('')
  const [extracted, setExtracted] = useState<Extracted[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingLabel, setLoadingLabel] = useState('Bearbetar…')
  const [error, setError] = useState<string | null>(null)
  // Force a fresh <input type="file"> DOM node after each pick. On Android,
  // the content:// permission Chrome grants to the input is one-shot — reusing
  // the same element makes subsequent reads fail with NotReadableError.
  const [pickerNonce, setPickerNonce] = useState(0)

  async function handleImageFile(file: File, resizePromise?: Promise<Blob>) {
    setError(null)
    setLoadingLabel('Bearbetar bild…')
    setLoading(true)
    try {
      const blob = await (resizePromise ?? resizeImage(file))
      const fd = new FormData()
      fd.append('image', new File([blob], 'image.jpg', { type: 'image/jpeg' }))
      const result = await extractListItemsFromImage(fd)
      if (result.error) {
        setError(result.error)
        return
      }
      const items = result.items ?? []
      if (items.length === 0) {
        setError('Inga varor hittades i bilden. Försök med en tydligare bild.')
        return
      }
      setExtracted(items.map(i => ({ name: i.name, category: i.category ?? null, measurement: i.measurement ?? null, selected: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte bearbeta bilden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    (async () => {
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            const imgType = item.types.find(t => t.startsWith('image/'))
            if (imgType) {
              const blob = await item.getType(imgType)
              const file = new File([blob], 'clipboard.png', { type: imgType })
              setLoadingLabel('Bearbetar bild från klippbord…')
              await handleImageFile(file)
              return
            }
          }
        } catch { /* permission denied or no image — fall through */ }
      }
      try {
        const clip = await navigator.clipboard.readText()
        const t = clip.trim()
        if (/^https?:\/\/\S+$/i.test(t)) setText(t)
      } catch {}
    })()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleExtract() {
    if (!text.trim()) return
    setError(null)
    setLoadingLabel('Bearbetar…')
    setLoading(true)
    const result = await extractRecipeItems(text)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const items = result.items ?? []
    if (items.length === 0) {
      setError('Inga varor hittades. Försök med mer text.')
      return
    }
    setExtracted(items.map(i => ({ name: i.name, category: i.category ?? null, measurement: i.measurement ?? null, selected: true })))
  }

  async function handleAdd() {
    if (!extracted) return
    const selected = extracted.filter(i => i.selected).map(i => ({ name: i.name, category: i.category, measurement: i.measurement }))
    if (selected.length === 0) return
    setError(null)
    setLoadingLabel('Lägger till…')
    setLoading(true)
    const result = await addItems(listId, selected)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    if (result.items) onItemsAdded(result.items as Item[])
    onClose()
  }

  function toggleAt(idx: number) {
    setExtracted(prev => prev?.map((i, n) => n === idx ? { ...i, selected: !i.selected } : i) ?? null)
  }

  const selectedCount = extracted?.filter(i => i.selected).length ?? 0

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
            {extracted ? `Lägg till ${selectedCount} varor` : 'Importera från recept eller lista'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Stäng"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {!extracted && (
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
              <span>Hämta lista från bild</span>
            </label>
            <input
              key={pickerNonce}
              id={fileInputId}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) {
                  // Android 13's photo picker grants a short-lived read URI;
                  // start the read synchronously here to win the race before
                  // any state update or React render delays it.
                  const p = resizeImage(f)
                  p.catch(() => {})
                  handleImageFile(f, p)
                }
                setPickerNonce(n => n + 1)
              }}
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-1">
              Tips: om bilden inte läses, dela från Galleri istället.
            </p>
            <div className="relative my-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-gray-800" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white dark:bg-gray-900 px-2 text-xs text-gray-400 dark:text-gray-500">eller</span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Klistra in en länk eller hela receptet…"
              autoFocus
              rows={8}
              className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={handleExtract}
                disabled={loading || !text.trim()}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {loading ? loadingLabel : 'Hämta varor'}
              </button>
            </div>
          </>
        )}

        {extracted && (
          <>
            <ul className="overflow-y-auto -mx-1 px-1 space-y-1 flex-1">
              {extracted.map((item, idx) => (
                <li
                  key={idx}
                  onClick={() => toggleAt(idx)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${item.selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {item.selected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-sm flex-1 ${item.selected ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                    {item.name}
                    {item.measurement && (
                      <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">· {item.measurement}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setExtracted(null)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Tillbaka
              </button>
              <button
                onClick={handleAdd}
                disabled={loading || selectedCount === 0}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {loading ? 'Lägger till…' : `Lägg till ${selectedCount}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
