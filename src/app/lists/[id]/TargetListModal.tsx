'use client'

import { useEffect, useRef, useState } from 'react'
import type { List } from '@/lib/types'
import { createList } from '@/app/lists/actions'

type Props = {
  mode: 'copy' | 'move'
  availableLists: Pick<List, 'id' | 'name' | 'owner_id'>[]
  currentUserId: string
  onPick: (targetListId: string) => Promise<void>
  onClose: () => void
}

export default function TargetListModal({ mode, availableLists, currentUserId, onPick, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (creating) newNameRef.current?.focus()
  }, [creating])

  async function pick(targetListId: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onPick(targetListId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel')
      setBusy(false)
    }
  }

  async function handleCreate() {
    const trimmed = newName.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.set('name', trimmed)

    const result = await createList(fd)
    if (result?.error || !result?.list) {
      setError(result?.error ?? 'Kunde inte skapa listan')
      setBusy(false)
      return
    }
    try {
      await onPick(result.list.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Något gick fel')
      setBusy(false)
    }
  }

  const title = mode === 'copy' ? 'Kopiera till lista' : 'Flytta till lista'

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-sm space-y-3 shadow-xl max-h-[80vh] flex flex-col"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h2>

        {creating ? (
          <div className="space-y-2">
            <input
              ref={newNameRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              placeholder="Listans namn"
              disabled={busy}
              className="w-full min-w-0 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setCreating(false); setNewName('') }}
                disabled={busy}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Tillbaka
              </button>
              <button
                onClick={handleCreate}
                disabled={busy || !newName.trim()}
                className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
              >
                {mode === 'copy' ? 'Skapa & kopiera' : 'Skapa & flytta'}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto -mx-2 px-2 space-y-1">
            <button
              onClick={() => setCreating(true)}
              disabled={busy}
              className="w-full text-left px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors text-sm"
            >
              + Skapa ny lista
            </button>
            {availableLists.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">Inga andra listor</p>
            ) : (
              availableLists.map(l => (
                <button
                  key={l.id}
                  onClick={() => pick(l.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors text-sm text-gray-800 dark:text-gray-200"
                >
                  <span className="flex-1 min-w-0 truncate">{l.name}</span>
                  {l.owner_id !== currentUserId && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Delad</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}

        {!creating && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Avbryt
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
