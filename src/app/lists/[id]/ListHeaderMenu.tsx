'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { changeListKind } from '@/app/lists/actions'
import { categorizeItem } from './actions'
import { localDB } from '@/lib/db/local'
import { log } from '@/lib/log'
import { useNotesSelect } from './NotesSelectContext'

// After converting a Scrapbook to a shopping list, its existing items were
// never judged as groceries, so they'd all show as "övrigt". Categorize the
// uncategorized ones in the background (mirrors the add-item / copy flow:
// categorizeItem → Gemini → items.category + history), patching each local row
// as its verdict lands. Detached promises — they keep running and updating
// Dexie after router.refresh() swaps this component out. Best-effort.
async function categorizeConvertedItems(listId: string) {
  try {
    const rows = await localDB.items.where('list_id').equals(listId).toArray()
    for (const row of rows) {
      if (row.category) continue
      categorizeItem(row.id)
        .then(r => { if (r.category) return localDB.items.update(row.id, { category: r.category }) })
        .catch(() => { /* stays 'övrigt' */ })
    }
  } catch { /* best-effort */ }
}

// The ⋯ overflow menu in a Scrapbook list's header — the single entry point for
// promoting scraps to shopping. Owner sees "Convert to shopping list"; everyone
// (owner ∪ members) sees "Select & copy", which flips NoteList into select mode
// via NotesSelectContext. Convert is a one-tap-then-confirm flip of lists.kind
// that keeps the same name and is reversible.
export default function ListHeaderMenu({
  listId,
  listName,
  isOwner,
}: {
  listId: string
  listName: string
  isOwner: boolean
}) {
  const router = useRouter()
  const { setSelecting } = useNotesSelect()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setConfirming(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleConvert() {
    if (busy) return
    setBusy(true)
    const res = await changeListKind(listId, 'shopping')
    if (res?.error) {
      setBusy(false)
      setConfirming(false)
      log.warn('list.convert_failed', { error: res.error })
      return
    }
    // Optimistic local update so the /lists markers flip instantly; the
    // revalidate inside changeListKind keeps it correct on next /lists render.
    try { await localDB.list_catalog.update(listId, { kind: 'shopping' }) } catch { /* best-effort */ }
    // Judge the now-shopping items so they don't all land in "övrigt" (detached).
    void categorizeConvertedItems(listId)
    log.info('list.converted', { to: 'shopping' })
    // Re-render the server component → page.tsx re-reads the list row and swaps
    // the notes branch for the shopping (ItemList) branch.
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Listval"
        className="shrink-0 rounded-lg px-2 py-1 text-xl leading-none text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      >
        ⋯
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="fixed right-3 top-14 z-40 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
          >
            {isOwner && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); setConfirming(true) }}
                className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className="text-base leading-none">🛒</span>
                <span>
                  Konvertera till handlingslista
                  <small className="block text-xs font-normal text-gray-400 dark:text-gray-500">Hela listan blir en shoplist</small>
                </span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); setSelecting(true) }}
              className="flex w-full items-start gap-3 border-t border-gray-100 px-4 py-3 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <span className="text-base leading-none">☑️</span>
              <span>
                Välj &amp; kopiera scraps
                <small className="block text-xs font-normal text-gray-400 dark:text-gray-500">Kopiera valda till en annan lista</small>
              </span>
            </button>
          </div>
        </>,
        document.body,
      )}

      {confirming && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 text-center shadow-xl dark:bg-gray-900"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-2xl dark:bg-indigo-950/50">🛒</div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Konvertera till handlingslista?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              ”{listName}” blir en shoplist med samma namn. Anteckningar och länkar sparas kvar. Ändringen gäller alla som listan delas med.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={busy}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Konverterar…' : 'Konvertera'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
