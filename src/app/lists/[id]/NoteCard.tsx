'use client'

import { useState } from 'react'
import type { Item } from '@/lib/types'
import { noteHostname } from '@/lib/notesView'

// Edit pencil + trash with an inline two-step confirm. Shared by both card
// layouts; `floating` positions it over the preview image (rich layout).
function CardActions({
  name,
  onEdit,
  onDelete,
  floating = false,
}: {
  name: string
  onEdit: () => void
  onDelete: () => void
  floating?: boolean
}) {
  const [confirming, setConfirming] = useState(false)

  const wrap = floating
    ? 'absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/85 px-1 py-0.5 backdrop-blur dark:bg-gray-900/75'
    : 'flex shrink-0 items-center gap-1'

  if (confirming) {
    return (
      <div className={wrap}>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Confirm delete ${name || 'note'}`}
          className="rounded-md px-2 py-0.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          aria-label="Cancel delete"
          className="rounded-md px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={wrap}>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name || 'note'}`}
        className="text-gray-300 transition-colors hover:text-indigo-400 dark:text-gray-600 dark:hover:text-indigo-400"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${name || 'note'}`}
        className="text-gray-300 transition-colors hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
      </button>
    </div>
  )
}

// Host pill (link glyph + hostname), shared by both layouts.
function HostPill({ host }: { host: string }) {
  return (
    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
      </svg>
      {host}
    </span>
  )
}

const NewDot = () => (
  <span
    aria-label="Tillagd sedan ditt senaste besök"
    title="Tillagd sedan ditt senaste besök"
    className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-[#EC4899]"
  />
)

// A single scrap card. A link with a preview image renders as a rich
// link-preview card (full-width image on top, then title / description / host —
// the WhatsApp style). Everything else (plain notes, links without an image)
// uses the compact layout: optional thumbnail on the left, title, body, host.
export function NoteCard({
  item,
  isNew = false,
  onEdit,
  onDelete,
}: {
  item: Item
  isNew?: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const host = noteHostname(item.url)

  // Rich link-preview layout.
  if (item.url && item.picture_url) {
    return (
      <li className="relative overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={item.picture_url}
            alt=""
            className="max-h-72 w-full bg-gray-50 object-contain dark:bg-gray-800"
            loading="lazy"
          />
          <div className="p-3">
            <div className="flex items-start gap-2">
              {isNew && <NewDot />}
              <span className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
                {item.name || item.url}
              </span>
            </div>
            {item.note && (
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-400">
                {item.note}
              </p>
            )}
            {host && <HostPill host={host} />}
          </div>
        </a>
        <CardActions name={item.name} onEdit={onEdit} onDelete={onDelete} floating />
      </li>
    )
  }

  // Compact layout.
  return (
    <li className="relative flex gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      {item.picture_url && (
        <img
          src={item.picture_url}
          alt=""
          className="h-16 w-16 shrink-0 rounded-lg object-cover bg-gray-100 dark:bg-gray-800"
          loading="lazy"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {isNew && <NewDot />}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 break-words text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {item.name || item.url}
            </a>
          ) : (
            <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900 dark:text-gray-100">
              {item.name}
            </span>
          )}

          <CardActions name={item.name} onEdit={onEdit} onDelete={onDelete} />
        </div>

        {item.note && (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-400">
            {item.note}
          </p>
        )}

        {host && <HostPill host={host} />}
      </div>
    </li>
  )
}
