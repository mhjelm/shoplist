'use client'

import { useState } from 'react'
import type { ListKind } from '@/lib/types'
import { noteHostname } from '@/lib/notesView'
import { confirmShareImport, confirmShareLink, cancelShareImport } from '../actions'

interface SharedItem {
  name: string
  category: string | null
  measurement: string | null
}

interface ShareList {
  id: string
  name: string
  owner_id: string
  kind: string
}

interface Props {
  importId: string
  items: SharedItem[]
  source: 'image' | 'url' | 'text' | 'link'
  url?: string | null
  title?: string | null
  lists: ShareList[]
  currentUserId: string
}

const SOURCE_LABEL: Record<string, string> = {
  image: 'från bild',
  url: 'från länk',
  text: 'från text',
  link: 'länk',
}

const NEW_LIST_ID = '__new__'

// ── Link mode ─────────────────────────────────────────────────────────────────
// A shared URL is stored as-is and unfurled into a scrap on confirm.
// Only notes lists are valid destinations.

function LinkImportMode({
  importId,
  url,
  title,
  notesLists,
  currentUserId,
}: {
  importId: string
  url: string
  title: string | null
  notesLists: ShareList[]
  currentUserId: string
}) {
  const initialId = notesLists.length === 1 ? notesLists[0].id : NEW_LIST_ID
  const [selectedListId, setSelectedListId] = useState<string>(initialId)
  const [newListName, setNewListName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCreatingNew = selectedListId === NEW_LIST_ID
  const confirmEnabled = !busy && (isCreatingNew ? newListName.trim().length > 0 : true)
  const host = noteHostname(url)

  async function handleConfirm() {
    if (!confirmEnabled) return
    setError(null)
    setBusy(true)
    const destination = isCreatingNew
      ? { kind: 'new' as const, name: newListName.trim() }
      : { kind: 'existing' as const, listId: selectedListId }
    const result = await confirmShareLink(importId, destination, url)
    if (result?.error) {
      setError(result.error)
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (busy) return
    setBusy(true)
    await cancelShareImport(importId)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Spara länk</h1>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Sparas som ett klipp i din scrapbook</p>
      </header>

      <main className="mx-auto max-w-lg space-y-5 px-4 py-6">
        {/* Link preview */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">
            {title || url}
          </p>
          {title && (
            <p className="mt-1 break-all text-xs text-gray-400 dark:text-gray-500">{url}</p>
          )}
          {host && (
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
              {host}
            </span>
          )}
        </div>

        {/* Notes-only destination picker */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Välj scrapbook
          </h2>
          <ul className="space-y-2">
            {notesLists.map(list => {
              const checked = selectedListId === list.id
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedListId(list.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      checked
                        ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
                        : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                      checked ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {checked && <span className="mx-auto mt-[3px] block h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
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
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  isCreatingNew
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
                    : 'border-dashed border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}
              >
                <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                  isCreatingNew ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isCreatingNew && <span className="mx-auto mt-[3px] block h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">+ Skapa ny scrapbook</span>
              </button>
              {isCreatingNew && (
                <input
                  type="text"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="Namn på scrapbook"
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              )}
            </li>
          </ul>
        </section>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={handleCancel}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Avbryt
          </button>
          <button
            onClick={handleConfirm}
            disabled={!confirmEnabled}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      </main>
    </div>
  )
}

// ── Items mode ────────────────────────────────────────────────────────────────
// Grocery / task import: a checklist of extracted items, destination any list.

function ItemsImportMode({
  importId,
  items,
  source,
  lists,
  currentUserId,
}: {
  importId: string
  items: SharedItem[]
  source: string
  lists: ShareList[]
  currentUserId: string
}) {
  const initialSelectedId =
    lists.length === 1 ? lists[0].id : lists.length === 0 ? NEW_LIST_ID : null
  const [selectedListId, setSelectedListId] = useState<string | null>(initialSelectedId)
  const [newListName, setNewListName] = useState('')
  const [newListKind, setNewListKind] = useState<ListKind>('shopping')
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
      ? { kind: 'new' as const, name: newNameTrimmed, listKind: newListKind }
      : { kind: 'existing' as const, listId: selectedListId! }
    const result = await confirmShareImport(importId, destination, chosen)
    if (result?.error) {
      setError(result.error)
      setBusy(false)
    }
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
          {items.length} {items.length === 1 ? 'vara' : 'varor'} {SOURCE_LABEL[source] ?? source}
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
                <>
                  <input
                    type="text"
                    value={newListName}
                    onChange={e => setNewListName(e.target.value)}
                    placeholder="Listnamn"
                    autoFocus
                    className="mt-2 w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Listtyp">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={newListKind === 'shopping'}
                      onClick={() => setNewListKind('shopping')}
                      className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors ${
                        newListKind === 'shopping'
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                      }`}
                    >
                      🛒 Inköp
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={newListKind === 'task'}
                      onClick={() => setNewListKind('task')}
                      className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition-colors ${
                        newListKind === 'task'
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                          : 'border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400'
                      }`}
                    >
                      ✓ Uppgifter
                    </button>
                  </div>
                </>
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

// ── Router ────────────────────────────────────────────────────────────────────

export default function ShareImportClient({ importId, items, source, url, title, lists, currentUserId }: Props) {
  if (source === 'link' && url) {
    return (
      <LinkImportMode
        importId={importId}
        url={url}
        title={title ?? null}
        notesLists={lists.filter(l => l.kind === 'notes')}
        currentUserId={currentUserId}
      />
    )
  }
  return (
    <ItemsImportMode
      importId={importId}
      items={items}
      source={source}
      lists={lists}
      currentUserId={currentUserId}
    />
  )
}
