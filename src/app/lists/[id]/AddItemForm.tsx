'use client'

import type React from 'react'
import { useSyncExternalStore } from 'react'
import PictureInput from './PictureInput'

// Client-only capability read: false during SSR/first paint (avoids a hydration
// mismatch), then the real value once mounted. useSyncExternalStore is the
// idiomatic way to surface this without a setState-in-effect.
const noopSubscribe = () => () => {}
function useSpeechSupported() {
  return useSyncExternalStore(
    noopSubscribe,
    () => !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined',
    () => false,
  )
}

interface Props {
  input: string
  filtered: string[]
  highlightIdx: number
  loading: boolean
  addError: string | null
  showUrlInput: boolean
  urlInput: string
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  handleInputChange: (v: string) => void
  selectSuggestion: (s: string) => void
  handleDeleteSuggestion: (s: string) => void
  handleAdd: () => Promise<void>
  setInput: React.Dispatch<React.SetStateAction<string>>
  setFiltered: (v: string[]) => void
  setHighlightIdx: React.Dispatch<React.SetStateAction<number>>
  setShowUrlInput: React.Dispatch<React.SetStateAction<boolean>>
  setUrlInput: (v: string) => void
  isOffline: boolean
  onOpenRecipe: () => void
  onOpenSpeech?: () => void
}

export function AddItemForm({
  input, filtered, highlightIdx, loading, addError,
  showUrlInput, urlInput, inputRef,
  handleInputChange, selectSuggestion, handleDeleteSuggestion, handleAdd,
  setInput, setFiltered, setHighlightIdx, setShowUrlInput, setUrlInput,
  isOffline, onOpenRecipe, onOpenSpeech,
}: Props) {
  const speechSupported = useSpeechSupported()

  return (
    <div className="flex flex-col gap-2" data-add-item>
      <div className="relative">
        <div className="flex gap-2 items-stretch">
          <div className="relative flex-1 min-w-0">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={e => {
                handleInputChange(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' && !e.shiftKey) { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp' && !e.shiftKey) { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, -1)) }
                else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (highlightIdx >= 0 && filtered[highlightIdx]) selectSuggestion(filtered[highlightIdx])
                  else handleAdd()
                }
                else if (e.key === 'Escape') setFiltered([])
              }}
              placeholder="Add items…"
              autoComplete="off"
              className="block w-full h-9 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden leading-normal pr-7"
            />
            {input && (
              <button
                onMouseDown={e => {
                  e.preventDefault()
                  setInput('')
                  setFiltered([])
                  if (inputRef.current) inputRef.current.style.height = 'auto'
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
                tabIndex={-1}
                aria-label="Rensa"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={handleAdd}
            disabled={loading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-1.5 h-9 self-start transition-colors"
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
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${idx === highlightIdx ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <span className="flex-1">{s}</span>
                <button
                  onMouseDown={e => { e.stopPropagation(); handleDeleteSuggestion(s) }}
                  className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors flex-shrink-0"
                  tabIndex={-1}
                  aria-label={`Ta bort ${s} från historik`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setShowUrlInput(v => !v)}
          disabled={isOffline}
          title={isOffline ? 'Kräver anslutning' : 'Lägg till bild'}
          className={`border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-30 ${showUrlInput ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shoplist:border-pink-300 shoplist:text-pink-500 shoplist:hover:text-pink-600'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        </button>
        <button
          onClick={onOpenRecipe}
          disabled={isOffline}
          title={isOffline ? 'Kräver anslutning' : 'Importera från recept eller lista'}
          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-30 shoplist:border-teal-300 shoplist:text-teal-500 shoplist:hover:text-teal-600"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4" />
          </svg>
        </button>
        {speechSupported && onOpenSpeech && (
          <button
            onClick={onOpenSpeech}
            disabled={isOffline}
            title={isOffline ? 'Kräver anslutning' : 'Tala för att lägga till varor'}
            aria-label="Tala för att lägga till varor"
            className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-30 shoplist:border-purple-300 shoplist:text-purple-500 shoplist:hover:text-purple-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </button>
        )}
      </div>

      {showUrlInput && (
        <PictureInput
          value={urlInput}
          onChange={setUrlInput}
          onSuggestName={name => setInput(prev => prev.trim() ? prev : name)}
        />
      )}

      {addError && (
        <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>
      )}
    </div>
  )
}
