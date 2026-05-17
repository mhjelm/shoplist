import { useRef, useState } from 'react'
import { localDB } from '@/lib/db/local'
import { addItems, deleteHistoryItem, extractAddItems } from './actions'
import { splitPlainItems } from '@/lib/parseAddInput'
import { dedupeAddBatch } from '@/lib/itemListHelpers'
import { muAddItem, muUpdateItem } from '@/lib/sync/mutations'
import { findExistingItem, buildLocalItem, itemToLocalItem } from './itemHelpers'
import type { Item } from '@/lib/types'

export function useAddItems({
  listId,
  items,
  suggestions,
  isOffline,
}: {
  listId: string
  items: Item[]
  suggestions: string[]
  isOffline: boolean
}) {
  const [input, setInput] = useState('')
  const [filtered, setFiltered] = useState<string[]>([])
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function handleInputChange(value: string) {
    setInput(value)
    setHighlightIdx(-1)
    if (value.trim().length < 1 || /[,\n\d]/.test(value)) { setFiltered([]); return }
    const lower = value.toLowerCase()
    setFiltered(suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 6))
  }

  function selectSuggestion(name: string) {
    setInput(name)
    setFiltered([])
    inputRef.current?.focus()
  }

  function handleDeleteSuggestion(name: string) {
    setFiltered(f => f.filter(s => s !== name))
    if (!isOffline) deleteHistoryItem(name)
    inputRef.current?.focus()
  }

  async function handleAdd() {
    const raw = input.trim()
    if (!raw) return
    setAddError(null)

    const hasSplit = /[,\n]/.test(raw)
    const hasDigit = /\d/.test(raw)

    if (!hasSplit && !hasDigit) {
      // Fast path: plain single name, works offline via local outbox.
      setLoading(true)
      setInput('')
      setFiltered([])
      if (inputRef.current) inputRef.current.style.height = 'auto'
      const pictureUrl = urlInput.trim() || undefined
      setUrlInput('')

      const match = findExistingItem(items, raw)
      if (match) {
        await muUpdateItem(listId, match.id, { quantity: match.quantity + 1, is_checked: false })
      } else {
        await muAddItem(buildLocalItem(listId, raw, { pictureUrl }))
      }
      setLoading(false)
      inputRef.current?.focus()
      return
    }

    // Multi-item or digit-bearing.
    const previousInput = raw
    setLoading(true)
    setInput('')
    setFiltered([])
    if (inputRef.current) inputRef.current.style.height = 'auto'

    try {
      if (hasSplit && !hasDigit) {
        // Plain names — dedupe within the batch then route through the outbox.
        for (const { name, quantity } of dedupeAddBatch(splitPlainItems(raw))) {
          const match = findExistingItem(items, name)
          if (match) {
            await muUpdateItem(listId, match.id, { quantity: match.quantity + quantity, is_checked: false })
          } else {
            await muAddItem(buildLocalItem(listId, name, { quantity }))
          }
        }
      } else {
        // Digit-bearing — requires AI extraction on the server.
        const extracted = await extractAddItems(raw)
        if (extracted.error || !extracted.items) {
          setAddError(extracted.error ?? 'Kunde inte tolka listan')
          setInput(previousInput)
          return
        }
        const itemsToAdd = extracted.items
        if (itemsToAdd.length > 0) {
          const result = await addItems(listId, itemsToAdd)
          if (result.error) {
            setAddError(result.error)
            return
          }
          if (result.items) {
            localDB.items.bulkPut((result.items as Item[]).map(itemToLocalItem))
              .catch(err => console.error('Failed to put items in local db:', err))
          }
        }
      }
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Kunde inte lägga till')
      setInput(previousInput)
    } finally {
      setLoading(false)
    }
    inputRef.current?.focus()
  }

  return {
    input, setInput,
    filtered, setFiltered,
    highlightIdx, setHighlightIdx,
    loading,
    addError, setAddError,
    showUrlInput, setShowUrlInput,
    urlInput, setUrlInput,
    inputRef,
    handleInputChange,
    selectSuggestion,
    handleDeleteSuggestion,
    handleAdd,
  }
}
