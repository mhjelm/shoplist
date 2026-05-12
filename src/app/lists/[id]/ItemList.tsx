'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Item } from '@/lib/types'
import { addItem, deleteCheckedItems, toggleItem } from './actions'

interface Props {
  initialItems: Item[]
  listId: string
  isShared: boolean
  suggestions: string[]
}

export default function ItemList({ initialItems, listId, isShared, suggestions }: Props) {
  const [items, setItems] = useState<Item[]>(initialItems)
  const [input, setInput] = useState('')
  const [filtered, setFiltered] = useState<string[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Realtime subscription for shared lists
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

  function handleInputChange(value: string) {
    setInput(value)
    setHighlightIdx(-1)
    if (value.trim().length < 1) {
      setFiltered([])
      return
    }
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
    // Optimistic update
    const optimistic: Item = { id: crypto.randomUUID(), list_id: listId, added_by: '', name, is_checked: false, created_at: new Date().toISOString() }
    setItems(prev => [...prev, optimistic])
    const result = await addItem(listId, name)
    if (result?.error) {
      setItems(prev => prev.filter(i => i.id !== optimistic.id))
    }
    setLoading(false)
  }

  async function handleToggle(item: Item) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_checked: !i.is_checked } : i))
    await toggleItem(item.id, listId, !item.is_checked)
  }

  async function handleDeleteChecked() {
    setItems(prev => prev.filter(i => !i.is_checked))
    await deleteCheckedItems(listId)
  }

  const hasChecked = items.some(i => i.is_checked)

  return (
    <div className="space-y-4">
      {/* Add item */}
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
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAdd}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 transition-colors"
          >
            Add
          </button>
        </div>

        {filtered.length > 0 && (
          <ul className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden">
            {filtered.map((s, idx) => (
              <li
                key={s}
                onMouseDown={() => selectSuggestion(s)}
                className={`px-3 py-2 text-sm cursor-pointer ${idx === highlightIdx ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No items yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(item => (
            <li
              key={item.id}
              onClick={() => handleToggle(item)}
              className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors select-none"
            >
              <span className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${item.is_checked ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                {item.is_checked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              <span className={`text-sm flex-1 ${item.is_checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                {item.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasChecked && (
        <button
          onClick={handleDeleteChecked}
          className="w-full text-sm text-red-500 hover:text-red-700 py-2 border border-dashed border-red-200 rounded-xl hover:border-red-400 transition-colors"
        >
          Delete checked items
        </button>
      )}
    </div>
  )
}
