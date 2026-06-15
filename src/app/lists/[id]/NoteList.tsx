'use client'

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Item, List, Theme } from '@/lib/types'
import { isNewSinceVisit } from '@/lib/listsUnread'
import { isUrl, splitNoteText } from '@/lib/notesView'
import { useRevealFx } from '@/lib/useRevealFx'
import { useSyncState } from '@/lib/sync/engine'
import { useListItemsSync } from './useListItemsSync'
import { buildLocalItem } from './itemHelpers'
import { muAddItem, muUpdateItem, muDeleteItem } from '@/lib/sync/mutations'
import { touchListView, unfurlLink } from './actions'
import { touchListViewLocal } from '@/lib/sync/overviewLocal'
import { NoteCard } from './NoteCard'
import { NoteEditModal, type NotePatch } from './NoteEditModal'
import NoteSpeechModal from './NoteSpeechModal'

// Client-only capability read (mirrors TaskList): false during SSR, real value
// once mounted — avoids a hydration mismatch on the voice button.
const noopSubscribe = () => () => {}
function useSpeechSupported() {
  return useSyncExternalStore(
    noopSubscribe,
    () => !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined',
    () => false,
  )
}

interface Props {
  list: List
  listId: string
  currentUserId: string
  lastViewedAt: string | null
  theme: Theme
}

export default function NoteList({ list, listId, currentUserId, lastViewedAt }: Props) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [showSpeech, setShowSpeech] = useState(false)
  const [adding, setAdding] = useState(false)
  const { items, hasLoaded } = useListItemsSync(list, listId)
  const revealFx = useRevealFx(hasLoaded)
  const { isOffline } = useSyncState()
  const speechSupported = useSpeechSupported()

  // Touch last_viewed on mount/unmount so the /lists NEW marker clears for this
  // user (local write = instant; server write = cross-device). Mirrors TaskList.
  useEffect(() => {
    touchListView(listId).catch(() => {})
    touchListViewLocal(listId)
    return () => {
      touchListView(listId).catch(() => {})
      touchListViewLocal(listId)
    }
  }, [listId])

  // Newest scrap first — scrapbooks read like a feed, not a reorderable list.
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [items],
  )

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || adding) return
    setDraft('')

    if (isUrl(text)) {
      // Best-effort unfurl into a rich card; offline (or on failure) we just
      // save the raw link so nothing is lost.
      if (isOffline) {
        await muAddItem(buildLocalItem(listId, text, { url: text }), { skipCategorize: true })
        return
      }
      setAdding(true)
      try {
        const meta = await unfurlLink(text)
        await muAddItem(
          buildLocalItem(listId, meta.title || text, {
            url: text,
            note: meta.description ?? null,
            pictureUrl: meta.image ?? null,
          }),
          { skipCategorize: true },
        )
      } finally {
        setAdding(false)
      }
      return
    }

    const { name, note } = splitNoteText(text)
    if (!name) return
    await muAddItem(buildLocalItem(listId, name, { note }), { skipCategorize: true })
  }

  function handleSave(patch: NotePatch) {
    if (editing) muUpdateItem(listId, editing.id, patch)
    setEditing(null)
  }

  function handleDelete() {
    if (editing) muDeleteItem(listId, editing.id)
    setEditing(null)
  }

  return (
    <div className={`space-y-6${revealFx ? ' ' + revealFx : ''}`}>
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Enter submits; Shift+Enter inserts a newline (multi-line notes).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleAdd(e as unknown as FormEvent)
            }
          }}
          rows={2}
          placeholder="Add a note or paste a link…"
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!draft.trim() || adding}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {adding ? 'Saving…' : 'Add'}
          </button>
          {speechSupported && (
            <button
              type="button"
              onClick={() => setShowSpeech(true)}
              disabled={isOffline}
              title={isOffline ? 'Requires a connection' : 'Speak to add a note'}
              aria-label="Speak to add a note"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-400 transition-colors hover:text-indigo-600 disabled:opacity-30 dark:border-gray-700 dark:text-gray-500 dark:hover:text-indigo-400"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            </button>
          )}
        </div>
      </form>

      {hasLoaded && sorted.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing saved yet. Add a note or paste a link above.
        </p>
      )}

      {sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.map(item => (
            <NoteCard
              key={item.id}
              item={item}
              isNew={isNewSinceVisit(item, currentUserId, lastViewedAt)}
              onEdit={() => setEditing(item)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <NoteEditModal
          item={editing}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {showSpeech && (
        <NoteSpeechModal listId={listId} onClose={() => setShowSpeech(false)} />
      )}
    </div>
  )
}
