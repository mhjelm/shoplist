'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Item, ListTextSize } from '@/lib/types'
import { addItem, deleteCheckedItems, deleteItem, toggleItem, updateItem } from './actions'

interface Props {
  initialItems: Item[]
  listId: string
  isShared: boolean
  suggestions: string[]
  textSize: ListTextSize
}

export default function ItemList({ initialItems, listId, isShared, suggestions, textSize }: Props) {
  const itemTextClass = textSize === 'large' ? 'text-base' : 'text-sm'
  const checkboxSizeClass = textSize === 'large' ? 'w-6 h-6' : 'w-5 h-5'
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
    const channel = supabase
      .channel(`list-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setItems(prev => [...prev, payload.new as Item])
          } else if (payload.eventType === 'UPDATE') {
            setItems(prev => prev.map(i => i.id === (payload.new as Item).id ? payload.new as Item : i))
          } else if (payload.eventType === 'DELETE') {
            setItems(prev => prev.filter(i => i.id !== (payload.old as Item).id))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [listId, isShared])

  useEffect(() => {
    if (!lightboxUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

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
    const optimistic: Item = {
      id: crypto.randomUUID(),
      list_id: listId,
      added_by: '',
      name,
      is_checked: false,
      created_at: new Date().toISOString(),
      picture_url: pictureUrl ?? null,
    }
    setItems(prev => [...prev, optimistic])
    const result = await addItem(listId, name, pictureUrl)
    if (result?.error) setItems(prev => prev.filter(i => i.id !== optimistic.id))
    setLoading(false)
  }

  async function handleToggle(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: !i.is_checked } : i))
    await toggleItem(item.id, listId, !item.is_checked)
  }

  async function handleDeleteItem(item: Item) {
    setItems(prev => prev.filter(i => i.id !== item.id))
    await deleteItem(item.id, listId)
  }

  async function handleDeleteChecked() {
    setItems(prev => prev.filter(i => !i.is_checked))
    await deleteCheckedItems(listId)
  }

  async function handleUpdate(item: Item, name: string, pictureUrl: string) {
    const patch = {
      name: name.trim() || item.name,
      picture_url: pictureUrl.trim() || null,
    }
    setEditingItem(null)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...patch } : i))
    const result = await updateItem(item.id, listId, patch)
    if (result?.error) setItems(prev => prev.map(i => i.id === item.id ? item : i))
  }

  const hasChecked = items.some(i => i.is_checked)

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
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="Picture URL (optional)…"
            className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No items yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(item => (
            <li
              key={item.id}
              className="flex items-center gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none"
            >
              <span
                onClick={() => handleToggle(item)}
                className={`${checkboxSizeClass} rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors cursor-pointer ${item.is_checked ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'}`}
              >
                {item.is_checked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              {item.picture_url && (
                <img
                  src={item.picture_url}
                  alt=""
                  onClick={() => setLightboxUrl(item.picture_url!)}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                  className={`${thumbSizeClass} rounded object-cover cursor-pointer flex-shrink-0`}
                />
              )}
              <span
                onClick={() => handleToggle(item)}
                className={`${itemTextClass} flex-1 cursor-pointer ${item.is_checked ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}
              >
                {item.name}
              </span>
              <button
                onClick={() => setEditingItem(item)}
                className="text-gray-300 dark:text-gray-600 hover:text-blue-400 dark:hover:text-blue-400 transition-colors"
                aria-label="Edit item"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
              <button
                onClick={() => handleDeleteItem(item)}
                className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-lg leading-none"
                aria-label="Delete item"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasChecked && (
        <button
          onClick={handleDeleteChecked}
          className="w-full text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 py-2 border border-dashed border-red-200 dark:border-red-900 rounded-xl hover:border-red-400 dark:hover:border-red-700 transition-colors"
        >
          Delete checked items
        </button>
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
            onClick={e => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
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
        <input
          value={pictureUrl}
          onChange={e => setPictureUrl(e.target.value)}
          placeholder="Picture URL (optional)…"
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
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
