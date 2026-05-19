'use client'

import { useEffect, useState } from 'react'
import type { Item } from '@/lib/types'
import { type CategorySlug, CATEGORIES } from '@/lib/categories'
import PictureInput from './PictureInput'

interface Props {
  item: Item
  onSave: (name: string, pictureUrl: string, quantity: number, category: CategorySlug, measurement: string) => void
  onClose: () => void
}

export function EditModal({ item, onSave, onClose }: Props) {
  const [name, setName] = useState(item.name)
  const [pictureUrl, setPictureUrl] = useState(item.picture_url ?? '')
  const [quantity, setQuantity] = useState(item.quantity)
  const [category, setCategory] = useState<CategorySlug>(item.category ?? 'ovrigt')
  const [measurement, setMeasurement] = useState(item.measurement ?? '')

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
          name="sl-item-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Item name"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          name="sl-item-measurement"
          value={measurement}
          onChange={e => setMeasurement(e.target.value)}
          placeholder="Mängd (t.ex. 500 g, 2 msk)"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Quantity</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              className="w-7 h-7 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-base leading-none"
            >
              −
            </button>
            <span className="w-8 text-center text-sm text-gray-800 dark:text-gray-200">{quantity}</span>
            <button
              onClick={() => setQuantity(q => q + 1)}
              className="w-7 h-7 rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-base leading-none"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Kategori</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as CategorySlug)}
            className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {CATEGORIES.map(c => (
              <option key={c.slug} value={c.slug}>{c.label}</option>
            ))}
          </select>
        </div>
        <PictureInput value={pictureUrl} onChange={setPictureUrl} />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(name, pictureUrl, quantity, category, measurement)}
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
