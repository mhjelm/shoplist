'use client'

import { useRef, useState } from 'react'
import { suggestItemName, uploadImage } from './actions'
import { resizeImage } from '@/lib/resize-image'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onSuggestName?: (name: string) => void
}

export default function PictureInput({ value, onChange, placeholder, onSuggestName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    console.log('[picture] handleFile start, file:', file.name, file.size, 'bytes, onSuggestName:', !!onSuggestName)
    setError(null)
    setUploading(true)
    try {
      const blob = await resizeImage(file)
      const buildFd = () => {
        const fd = new FormData()
        fd.append('image', new File([blob], 'image.jpg', { type: 'image/jpeg' }))
        return fd
      }
      const [uploadResult, suggestResult] = await Promise.all([
        uploadImage(buildFd()),
        onSuggestName
          ? suggestItemName(buildFd())
          : Promise.resolve({} as { name?: string; error?: string }),
      ])
      console.log('[picture] upload:', uploadResult)
      console.log('[picture] suggest:', suggestResult)
      if (uploadResult.error) setError(uploadResult.error)
      else if (uploadResult.url) onChange(uploadResult.url)
      if (onSuggestName && 'name' in suggestResult && suggestResult.name) {
        onSuggestName(suggestResult.name)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const imgItem = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!imgItem) return
    const file = imgItem.getAsFile()
    if (!file) return
    e.preventDefault()
    handleFile(file)
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            onPaste={handlePaste}
            placeholder={uploading ? 'Uploading…' : placeholder ?? 'Paste image, paste URL, or pick a file…'}
            disabled={uploading}
            className="w-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 pr-8"
          />
          {value && !uploading && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="Clear picture"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload image"
          className="border border-gray-300 dark:border-gray-700 rounded-lg px-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
      </div>
      <input
        type="file"
        accept="image/*"
        ref={fileRef}
        hidden
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
