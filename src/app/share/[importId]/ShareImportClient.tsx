'use client'

import { useState } from 'react'
import { confirmShareImport, cancelShareImport } from '../actions'

interface SharedItem {
  name: string
  category: string | null
  measurement: string | null
}

interface ShareList {
  id: string
  name: string
  owner_id: string
  is_shared: boolean
}

interface Props {
  importId: string
  items: SharedItem[]
  source: 'image' | 'url' | 'text'
  lists: ShareList[]
  currentUserId: string
}

const SOURCE_LABEL: Record<Props['source'], string> = {
  image: 'från bild',
  url: 'från länk',
  text: 'från text',
}

const NEW_LIST_ID = '__new__'

export default function ShareImportClient({ importId, items, source, lists, currentUserId }: Props) {
  const initialSelectedId =
    lists.length === 1 ? lists[0].id : lists.length === 0 ? NEW_LIST_ID : null
  const [selectedListId, setSelectedListId] = useState<string | null>(initialSelectedId)
  const [newListName, setNewListName] = useState('')
  const [selectedItems, setSelectedItems] = useState<boolean[]>(() => items.map(() => true))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedCount = selectedItems.filter(Boolean).length
  const isCreatingNew = selectedListId === NEW_LIST_ID
  const newNameTrimmed = newListName.trim()
  const destinationReady = isCreatingNew ? newNameTrimmed.length > 0 : selectedListId !== null
  const confirmEnabled = !busy && destinationReady && selectedCount > 0

  function toggleItem(idx: number) {
    setSelectedItems(prev => prev.map((v, n) => n === idx ? !v : v))
  }

  async function handleConfirm() {
    if (!confirmEnabled) return
    setError(null)
    setBusy(true)
    const chosen = items.filter((_, idx) => selectedItems[idx])
    const destination = isCreatingNew
      ? { kind: 'new' as const, name: newNameTrimmed }
      : { kind: 'existing' as const, listId: selectedListId! }
    const result = await confirmShareImport(importId, destination, chosen)
    if (result?.error) {
      setError(result.error)
      setBusy(false)
    }
    // On success the action redirects — busy stays true until navigation.
  }

  async function handleCancel() {
    if (busy) return
    setBusy(true)
    await cancelShareImport(importId)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Importera delning</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {items.length} {items.length === 1 ? 'vara' : 'varor'} {SOURCE_LABEL[source]}
        </p>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <section>
          <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Välj lista</h2>
          <ul className="space-y-2">
            {lists.map(list => {
              const checked = selectedListId === list.id
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedListId(list.id)}
                    className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                      checked
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      checked ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {checked && <span className="block w-1.5 h-1.5 bg-white rounded-full mx-auto mt-[3px]" />}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
                      {list.name}
                    </span>
                    {list.owner_id !== currentUserId && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">delad</span>
                    )}
                  </button>
                </li>
              )
            })}
            <li>
              <button
                type="button"
                onClick={() => setSelectedListId(NEW_LIST_ID)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                  isCreatingNew
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-400'
                    : 'border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                  isCreatingNew ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isCreatingNew && <span className="block w-1.5 h-1.5 bg-white rounded-full mx-auto mt-[3px]" />}
                </span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">+ Skapa ny lista</span>
              </button>
              {isCreatingNew && (
                <input
                  type="text"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="Listnamn"
                  autoFocus
                  className="mt-2 w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Varor att lägga till ({selectedCount}/{items.length})
          </h2>
          <ul className="space-y-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-2">
            {items.map((item, idx) => {
              const checked = selectedItems[idx]
              return (
                <li
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                    {checked && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-sm flex-1 ${checked ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                    {item.name}
                    {item.measurement && (
                      <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">· {item.measurement}</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={handleCancel}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
          >
            Avbryt
          </button>
          <button
            onClick={handleConfirm}
            disabled={!confirmEnabled}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
          >
            {busy ? 'Lägger till…' : isCreatingNew ? `Skapa & lägg till ${selectedCount}` : `Lägg till ${selectedCount}`}
          </button>
        </div>
      </main>
    </div>
  )
}
