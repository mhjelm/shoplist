'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Item, List, Theme } from '@/lib/types'
import type { LocalItem } from '@/lib/db/types'
import { localDB } from '@/lib/db/local'
import { isNewSinceVisit } from '@/lib/listsUnread'
import { isUrl, splitNoteText } from '@/lib/notesView'
import { useRevealFx } from '@/lib/useRevealFx'
import { useSyncState } from '@/lib/sync/engine'
import { log } from '@/lib/log'
import { useListItemsSync } from './useListItemsSync'
import { buildLocalItem } from './itemHelpers'
import { muAddItem, muUpdateItem, muDeleteItem } from '@/lib/sync/mutations'
import { touchListView, unfurlLink, copyItemsToList, categorizeItem } from './actions'
import { touchListViewLocal } from '@/lib/sync/overviewLocal'
import { useNotesSelect } from './NotesSelectContext'
import { NoteCard } from './NoteCard'
import { NoteEditModal, type NotePatch } from './NoteEditModal'
import NoteSpeechModal from './NoteSpeechModal'
import TargetListModal from './TargetListModal'

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
  availableLists: Pick<List, 'id' | 'name' | 'owner_id'>[]
}

export default function NoteList({ list, listId, currentUserId, lastViewedAt, availableLists }: Props) {
  const [draft, setDraft] = useState('')
  // The last clipboard URL we auto-pasted, cleared, or added. Used so refocusing
  // re-pastes only when the clipboard holds a *different* link — never the same
  // one twice.
  const lastClipRef = useRef<string | null>(null)
  const [editing, setEditing] = useState<Item | null>(null)
  const [showSpeech, setShowSpeech] = useState(false)
  const [adding, setAdding] = useState(false)
  const { items, hasLoaded } = useListItemsSync(list, listId)
  const revealFx = useRevealFx(hasLoaded)
  const { isOffline } = useSyncState()
  const speechSupported = useSpeechSupported()

  // Select & copy: select mode is driven from the header ⋯ menu via context.
  const { selecting, setSelecting } = useNotesSelect()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Clear selection when leaving select mode (render-time derived state —
  // idempotent setters, mirrors useItemSelection).
  const [prevSelecting, setPrevSelecting] = useState(selecting)
  if (prevSelecting !== selecting) {
    setPrevSelecting(selecting)
    if (!selecting) { setSelectedIds(new Set()); setPickerOpen(false) }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select-all toggle: when every scrap is already marked, clear; otherwise
  // mark them all.
  const allSelected = items.length > 0 && selectedIds.size === items.length
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.id)))
  }

  // Copy selected scraps into the chosen shopping list. Representation A:
  // the scrap's title becomes the item name and its unfurled og:image
  // (picture_url) rides along as the item photo. The source url/note ride
  // along too so the link stays reachable from the shopping row.
  async function handleCopy(targetListId: string) {
    const chosen = items.filter(i => selectedIds.has(i.id))
    if (chosen.length === 0) return
    const payload = chosen.map(i => ({
      name: i.name,
      picture_url: i.picture_url,
      quantity: 1,
      category: null,
      measurement: null,
      url: i.url,
      note: i.note,
    }))
    const res = await copyItemsToList(targetListId, payload)
    if (res?.error) {
      log.warn('notes.copy_failed', { error: res.error, count: chosen.length })
      throw new Error(res.error)
    }
    // Seed the target list's Dexie cache so the receiving view shows the rows
    // immediately (same rationale as the shopping copy path in useItemSelection).
    if ('items' in res && res.items) {
      const rows = res.items as LocalItem[]
      try { await localDB.items.bulkPut(rows) } catch { /* best-effort */ }
      // Scraps carry no category, so freshly-inserted rows would all land in
      // "övrigt". Categorize them in the background (mirrors the add-item flow:
      // optimistic insert → categorizeItem → Gemini → items.category + history),
      // patching the local row as each result lands.
      for (const row of rows) {
        if (row.category) continue
        categorizeItem(row.id)
          .then(r => { if (r.category) return localDB.items.update(row.id, { category: r.category }) })
          .catch(() => { /* best-effort: stays 'övrigt' */ })
      }
    }
    setToast(`Kopierade ${chosen.length} ${chosen.length === 1 ? 'scrap' : 'scraps'} ✓`)
    setSelecting(false) // also clears selection + picker via the derived effect
  }

  // Auto-dismiss the success toast.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

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
      // Remember it so an unchanged clipboard won't re-paste the just-added link.
      lastClipRef.current = text
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

  // On focus, if the clipboard holds a bare link and the input is empty, drop it
  // in so the user doesn't have to paste manually. Best-effort: silently ignores
  // an unavailable/denied clipboard.
  async function handleFocus() {
    if (draft || !navigator.clipboard?.readText) return
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      // Paste only a fresh link — not the one we already handled last time.
      if (clip && isUrl(clip) && clip !== lastClipRef.current) {
        lastClipRef.current = clip
        setDraft(clip)
      }
    } catch {
      /* clipboard unavailable or permission denied — ignore */
    }
  }

  function clearDraft() {
    // Remember the cleared link so refocusing doesn't immediately re-paste it.
    if (isUrl(draft.trim())) lastClipRef.current = draft.trim()
    setDraft('')
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
    <div className={`space-y-6${revealFx ? ' ' + revealFx : ''}${selecting ? ' pb-24' : ''}`}>
      {!selecting && (
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="relative">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={e => {
              // Enter submits; Shift+Enter inserts a newline (multi-line notes).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAdd(e as unknown as FormEvent)
              }
            }}
            rows={2}
            placeholder="Add a note or paste a link…"
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {draft && (
            <button
              type="button"
              onClick={clearDraft}
              aria-label="Clear"
              title="Clear"
              className="absolute right-2 top-2 rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
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
      )}

      {selecting && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
            Välj scraps att kopiera till en handlingslista.
          </p>
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={items.length === 0}
            className="shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            {allSelected ? 'Avmarkera alla' : 'Markera alla'}
          </button>
        </div>
      )}

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
              onDelete={() => muDeleteItem(listId, item.id)}
              selectable={selecting}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => toggleSelect(item.id)}
            />
          ))}
        </ul>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <span className="flex-1 text-sm text-gray-600 dark:text-gray-400">
              {selectedIds.size} {selectedIds.size === 1 ? 'markerad' : 'markerade'}
            </span>
            <button
              type="button"
              onClick={() => setSelecting(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Avbryt
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setPickerOpen(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
            >
              Kopiera till lista →
            </button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <TargetListModal
          mode="copy"
          availableLists={availableLists}
          currentUserId={currentUserId}
          onPick={handleCopy}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-lg dark:bg-gray-100 dark:text-gray-900">
          {toast}
        </div>
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
