'use client'

import type { Item } from '@/lib/types'
import { noteHostname } from '@/lib/notesView'

// Small pencil button, shared by both card layouts.
function EditButton({ name, onEdit, floating = false }: { name: string; onEdit: () => void; floating?: boolean }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${name || 'note'}`}
      className={
        floating
          ? 'absolute right-2 top-2 rounded-full bg-white/80 p-1.5 text-gray-500 backdrop-blur transition-colors hover:text-indigo-500 dark:bg-gray-900/70 dark:text-gray-400'
          : 'shrink-0 text-gray-300 transition-colors hover:text-indigo-400 dark:text-gray-600 dark:hover:text-indigo-400'
      }
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
      </svg>
    </button>
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
}: {
  item: Item
  isNew?: boolean
  onEdit: () => void
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
        <EditButton name={item.name} onEdit={onEdit} floating />
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

          <EditButton name={item.name} onEdit={onEdit} />
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
