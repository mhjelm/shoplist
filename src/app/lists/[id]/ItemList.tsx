'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Item, ListTextSize } from '@/lib/types'
import { addItem, clearDeletedItems, clearShoppedItems, deleteItem, restoreItem, toggleItem, updateItem } from './actions'
import PictureInput from './PictureInput'

interface Props {
  initialItems: Item[]
  listId: string
  isShared: boolean
  suggestions: string[]
  textSize: ListTextSize
}

export default function ItemList({ initialItems, listId, isShared, suggestions, textSize }: Props) {
  const itemTextClass = textSize === 'large' ? 'text-base' : 'text-sm'
  const thumbSizeClass = textSize === 'large' ? 'w-16 h-16' : 'w-12 h-12'
  const [items, setItems] = useState<Item[]>(initialItems)
  const [input, setInput] = useState('')
  const [filtered, setFiltered] = useState<string[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isShared) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      console.log('[realtime] session user:', session?.user?.id ?? '(none)')
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token)
      }

      channel = supabase
        .channel(`list-${listId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
          (payload) => {
            console.log('[realtime] event:', payload.eventType, payload)
            if (payload.eventType === 'INSERT') {
              const incoming = payload.new as Item
              setItems(prev => {
                if (prev.some(i => i.id === incoming.id)) return prev
                const optIdx = prev.findIndex(i => i.added_by === '' && i.name === incoming.name)
                if (optIdx >= 0) {
                  const next = [...prev]
                  next[optIdx] = incoming
                  return next
                }
                return [...prev, incoming]
              })
            } else if (payload.eventType === 'UPDATE') {
              setItems(prev => prev.map(i => i.id === (payload.new as Item).id ? payload.new as Item : i))
            } else if (payload.eventType === 'DELETE') {
              setItems(prev => prev.filter(i => i.id !== (payload.old as Item).id))
            }
          })
        .subscribe((status, err) => {
          if (err) console.error('[realtime] subscribe error', err)
          else console.log('[realtime] status:', status)
        })
    })()

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [listId, isShared])

  useEffect(() => {
    if (!lightboxUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  const toShop = useMemo(() => items.filter(i => !i.deleted_at && !i.is_checked), [items])
  const shopped = useMemo(() => items.filter(i => !i.deleted_at && i.is_checked), [items])
  const deleted = useMemo(() => items.filter(i => !!i.deleted_at), [items])

  function handleInputChange(value: string) {
    setInput(value)
    setHighlightIdx(-1)
    if (value.trim().length < 1) { setFiltered([]); return }
    const lower = value.toLowerCase()
    setFiltered(suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 6))
  }

  function selectSuggestion(name: string) {
    setInput(name)
    setFiltered([])
    inputRef.current?.focus()
  }

  async function handleAdd() {
    const name = input.trim()
    if (!name) return
    setLoading(true)
    setInput('')
    setFiltered([])
    const pictureUrl = urlInput.trim() || undefined
    setUrlInput('')
    const tempId = crypto.randomUUID()
    const optimistic: Item = {
      id: tempId,
      list_id: listId,
      added_by: '',
      name,
      is_checked: false,
      created_at: new Date().toISOString(),
      picture_url: pictureUrl ?? null,
      deleted_at: null,
    }
    setItems(prev => [...prev, optimistic])
    const result = await addItem(listId, name, pictureUrl)
    if (result?.error) {
      setItems(prev => prev.filter(i => i.id !== tempId))
    } else if (result?.item) {
      const real = result.item as Item
      setItems(prev => {
        if (prev.some(i => i.id === real.id)) {
          return prev.filter(i => i.id !== tempId)
        }
        return prev.map(i => i.id === tempId ? real : i)
      })
    }
    setLoading(false)
  }

  async function handleToggle(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: !i.is_checked } : i))
    await toggleItem(item.id, listId, !item.is_checked)
  }

  async function handleDeleteItem(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, deleted_at: new Date().toISOString() } : i))
    await deleteItem(item.id, listId)
  }

  async function handleRestore(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: false, deleted_at: null } : i))
    await restoreItem(item.id, listId)
  }

  async function handleClearShopped() {
    setItems(prev => prev.filter(i => i.deleted_at || !i.is_checked))
    await clearShoppedItems(listId)
  }

  async function handleClearDeleted() {
    setItems(prev => prev.filter(i => !i.deleted_at))
    await clearDeletedItems(listId)
  }

  async function handleUpdate(item: Item, name: string, pictureUrl: string) {
    const patch = {
      name: name.trim() || item.name,
      picture_url: pictureUrl.trim() || null,
    }
    setEditingItem(null)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i))
    const result = await updateItem(item.id, listId, patch)
    if (result?.error) {
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
    } else {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i))
    }
  }

  const isEmpty = toShop.length === 0 && shopped.length === 0 && deleted.length === 0

  return (
    <div className="space-y-4">
      {/* Add item */}
      <div className="space-y-2">
        <div className="relative">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, -1)) }
                else if (e.key === 'Enter') {
                  if (highlightIdx >= 0 && filtered[highlightIdx]) selectSuggestion(filtered[highlightIdx])
                  else handleAdd()
                }
                else if (e.key === 'Escape') setFiltered([])
              }}
              placeholder="Add an item…"
              className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => setShowUrlInput(v => !v)}
              title="Add picture URL"
              className={`border rounded-lg px-3 transition-colors ${showUrlInput ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </button>
            <button
              onClick={handleAdd}
              disabled={loading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 transition-colors"
            >
              Add
            </button>
          </div>

          {filtered.length > 0 && (
            <ul className="absolute z-10 top-full mt-1 left-0 right-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md overflow-hidden">
              {filtered.map((s, idx) => (
                <li
                  key={s}
                  onMouseDown={() => selectSuggestion(s)}
                  className={`px-3 py-2 text-sm cursor-pointer ${idx === highlightIdx ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {showUrlInput && (
          <PictureInput value={urlInput} onChange={setUrlInput} />
        )}
      </div>

      {/* Items to shop (no header) */}
      {toShop.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
          {isEmpty ? 'No items yet.' : 'Everything shopped'}
        </p>
      ) : (
        <ul className="space-y-1">
          {toShop.map(item => (
            <li
              key={item.id}
              onClick={() => handleToggle(item)}
              className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none cursor-pointer"
            >
              {item.picture_url && (
                <img
                  src={item.picture_url}
                  alt=""
                  onClick={e => { e.stopPropagation(); setLightboxUrl(item.picture_url!) }}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                  className={`${thumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0`}
                />
              )}
              <span className={`${itemTextClass} flex-1 text-gray-800 dark:text-gray-200`}>
                {item.name}
              </span>
              <button
                onClick={e => { e.stopPropagation(); setEditingItem(item) }}
                className="text-gray-300 dark:text-gray-600 hover:text-blue-400 dark:hover:text-blue-400 transition-colors"
                aria-label="Edit item"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteItem(item) }}
                className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
                aria-label="Delete item"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Shopped */}
      {shopped.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Shopped</span>
            <button
              onClick={handleClearShopped}
              className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
              aria-label="Clear shopped items"
            >
              ×
            </button>
          </div>
          <ul className="space-y-1">
            {shopped.map(item => (
              <li
                key={item.id}
                onClick={() => handleToggle(item)}
                className="flex items-center gap-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800/50 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors select-none cursor-pointer"
              >
                {item.picture_url && (
                  <img
                    src={item.picture_url}
                    alt=""
                    onError={e => { e.currentTarget.style.display = 'none' }}
                    className={`${thumbSizeClass} rounded object-cover flex-shrink-0 opacity-60`}
                  />
                )}
                <span className={`${itemTextClass} flex-1 text-gray-400 dark:text-gray-500`}>
                  {item.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deleted */}
      {deleted.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-300 dark:text-gray-600">Deleted</span>
            <button
              onClick={handleClearDeleted}
              className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
              aria-label="Clear deleted items"
            >
              ×
            </button>
          </div>
          <ul className="space-y-1">
            {deleted.map(item => (
              <li
                key={item.id}
                onClick={() => handleRestore(item)}
                className="flex items-center gap-3 bg-gray-50/50 dark:bg-gray-900/30 rounded-xl border border-gray-100/50 dark:border-gray-800/30 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors select-none cursor-pointer opacity-50 hover:opacity-75"
              >
                {item.picture_url && (
                  <img
                    src={item.picture_url}
                    alt=""
                    onError={e => { e.currentTarget.style.display = 'none' }}
                    className={`${thumbSizeClass} rounded object-cover flex-shrink-0`}
                  />
                )}
                <span className={`${itemTextClass} flex-1 text-gray-400 dark:text-gray-500 line-through`}>
                  {item.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editingItem && (
        <EditModal
          item={editingItem}
          onSave={(name, pictureUrl) => handleUpdate(editingItem, name, pictureUrl)}
          onClose={() => setEditingItem(null)}
        />
      )}

      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <img
            src={lightboxUrl}
            alt=""
            onClick={() => setLightboxUrl(null)}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}

function EditModal({ item, onSave, onClose }: {
  item: Item
  onSave: (name: string, pictureUrl: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item.name)
  const [pictureUrl, setPictureUrl] = useState(item.picture_url ?? '')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 w-full max-w-md space-y-3 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Edit item</h2>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Item name"
          autoFocus
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <PictureInput value={pictureUrl} onChange={setPictureUrl} />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(name, pictureUrl)}
            disabled={!name.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
