'use client'

import { useEffect, useState } from 'react'
import { addItems, extractRecipeItems } from './actions'
import type { Item } from '@/lib/types'

interface Props {
  listId: string
  onClose: () => void
  onItemsAdded: (items: Item[]) => void
}

type Extracted = { name: string; category: string | null; selected: boolean }

export default function RecipeImportModal({ listId, onClose, onItemsAdded }: Props) {
  const [text, setText] = useState('')
  const [extracted, setExtracted] = useState<Extracted[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleExtract() {
    if (!text.trim()) return
    setError(null)
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
    setExtracted(items.map(i => ({ name: i.name, category: i.category ?? null, selected: true })))
  }

  async function handleAdd() {
    if (!extracted) return
    const selected = extracted.filter(i => i.selected).map(i => ({ name: i.name, category: i.category }))
    if (selected.length === 0) return
    setError(null)
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
            {extracted ? `Lägg till ${selectedCount} varor` : 'Importera från recept'}
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
                {loading ? 'Bearbetar…' : 'Hämta varor'}
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
