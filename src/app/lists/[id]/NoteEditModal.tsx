'use client'

import { useEffect, useState } from 'react'
import type { Item } from '@/lib/types'

export interface NotePatch {
  name: string
  note: string | null
  url: string | null
  picture_url: string | null
}

interface Props {
  item: Item
  onSave: (patch: NotePatch) => void
  onDelete: () => void
  onClose: () => void
}

export function NoteEditModal({ item, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(item.name)
  const [note, setNote] = useState(item.note ?? '')
  const [url, setUrl] = useState(item.url ?? '')
  const [keepImage, setKeepImage] = useState(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasImage = !!item.picture_url

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Edit note</h2>

        {hasImage && keepImage && (
          <div className="flex items-center gap-3">
            <img src={item.picture_url!} alt="" className="h-16 w-16 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setKeepImage(false)}
              className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
            >
              Remove image
            </button>
          </div>
        )}

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Title"
          autoFocus
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Note (optional)"
          rows={4}
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://… (optional)"
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <div className="flex justify-between gap-2 pt-1">
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave({
                name: name.trim(),
                note: note.trim() || null,
                url: url.trim() || null,
                picture_url: hasImage && keepImage ? item.picture_url : null,
              })}
              disabled={!name.trim() && !url.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
