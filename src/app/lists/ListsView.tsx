'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import { reconcileLists } from '@/lib/sync/reconcile'
import { useSyncState } from '@/lib/sync/engine'
import type { List } from '@/lib/types'
import DeleteListButton from './DeleteListButton'
import ListEditPanel from './ListEditPanel'

interface Props {
  initialLists: List[]
  memberCounts: Record<string, boolean>
  currentUserId: string
}

export default function ListsView({ initialLists, memberCounts, currentUserId }: Props) {
  const { isOffline } = useSyncState()
  const [navigatingToListId, setNavigatingToListId] = useState<string | null>(null)
  const [openEditListId, setOpenEditListId] = useState<string | null>(null)
  const [renamedLists, setRenamedLists] = useState<Record<string, string>>({})

  // Reconcile on mount so existing Dexie `lists` rows get refreshed against
  // the server. We do NOT seed Dexie from initialLists here - Dexie's `lists`
  // table tracks "what the user has actually opened on this device" and is
  // populated only by ItemList mount. Seeding from SSR would make every
  // visible list look cached and defeat the offline gating.
  useEffect(() => {
    reconcileLists().catch(err => console.error('reconcileLists failed:', err))
  }, [])

  // Cached set: a list counts as cached if Dexie has its row OR any of its
  // items. Two queries, unioned. `useLiveQuery` returns undefined while hydrating.
  const liveLists = useLiveQuery(() => localDB.lists.toArray(), [])
  const liveItems = useLiveQuery(() => localDB.items.toArray(), [])
  const cachedIds = useMemo(() => {
    const ids = new Set<string>()
    if (liveLists) for (const l of liveLists) ids.add(l.id)
    if (liveItems) for (const i of liveItems) ids.add(i.list_id)
    return ids
  }, [liveLists, liveItems])

  // Render from SSR seed. Online: SSR is current. Offline: the SW served
  // cached /lists HTML, whose SSR data is from the last online visit - fine
  // as a shell, and offline gating below hides anything the user can't open.
  const displayLists = initialLists.map(list => ({
    ...list,
    name: renamedLists[list.id] ?? list.name,
  }))
  const myLists = displayLists.filter(l => l.owner_id === currentUserId)
  const sharedLists = displayLists.filter(l => l.owner_id !== currentUserId)

  const toggleEdit = (listId: string) => {
    setOpenEditListId(current => current === listId ? null : listId)
  }
  const handleRename = (listId: string, name: string) => {
    setRenamedLists(prev => ({ ...prev, [listId]: name }))
  }

  return (
    <div className="space-y-8">
      {navigatingToListId && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 text-gray-500 backdrop-blur-sm dark:bg-gray-950/80 dark:text-gray-400"
        >
          <div className="flex items-center justify-center gap-3">
            <span
              className="inline-block w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin"
              aria-hidden
            />
            <span className="text-sm">Laddar...</span>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">My lists</h2>
        {myLists.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No lists yet.</p>
        ) : (
          <ul className="space-y-2">
            {myLists.map(list => (
              <ListRow
                key={list.id}
                list={list}
                hasMembers={memberCounts[list.id] ?? false}
                cached={cachedIds.has(list.id)}
                isOffline={isOffline}
                onNavigate={setNavigatingToListId}
                openEditListId={openEditListId}
                onToggleEdit={toggleEdit}
                onRename={handleRename}
                showEdit
              />
            ))}
          </ul>
        )}
      </section>

      {sharedLists.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Shared with me</h2>
          <ul className="space-y-2">
            {sharedLists.map(list => (
              <ListRow
                key={list.id}
                list={list}
                hasMembers={false}
                cached={cachedIds.has(list.id)}
                isOffline={isOffline}
                onNavigate={setNavigatingToListId}
                openEditListId={openEditListId}
                onToggleEdit={toggleEdit}
                onRename={handleRename}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ListRow({ list, hasMembers, cached, isOffline, onNavigate, openEditListId, onToggleEdit, onRename, showEdit }: {
  list: List
  hasMembers: boolean
  cached: boolean
  isOffline: boolean
  onNavigate: (listId: string) => void
  openEditListId: string | null
  onToggleEdit: (listId: string) => void
  onRename: (listId: string, name: string) => void
  showEdit?: boolean
}) {
  const disabled = isOffline && !cached
  const isEditOpen = openEditListId === list.id
  const labelClasses = 'font-medium text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate flex items-center gap-2'
  const hoverClasses = disabled
    ? 'cursor-not-allowed'
    : 'hover:text-blue-600 dark:hover:text-blue-400'

  const inner = (
    <>
      {isOffline && cached && (
        <span
          aria-label="Sparad offline"
          title="Sparad offline"
          className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0"
        />
      )}
      <span className="truncate">{list.name}</span>
      {hasMembers && <span className="text-xs text-gray-400 dark:text-gray-500">shared</span>}
    </>
  )

  return (
    <li className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        {disabled ? (
          <span
            aria-disabled="true"
            title="Inte tillgänglig offline"
            className={`${labelClasses} ${hoverClasses}`}
          >
            {inner}
          </span>
        ) : isOffline ? (
          // Hard navigation (not next/link) so the SW navigate handler runs and
          // serves the cached HTML for /lists/[id]. Soft nav uses an RSC fetch
          // that bypasses the navigate cache and fails offline.
          <a
            href={`/lists/${list.id}`}
            className={`${labelClasses} ${hoverClasses}`}
            onClick={() => onNavigate(list.id)}
          >
            {inner}
          </a>
        ) : (
          <Link
            href={`/lists/${list.id}`}
            className={`${labelClasses} ${hoverClasses}`}
            onClick={() => onNavigate(list.id)}
          >
            {inner}
          </Link>
        )}

        {showEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleEdit(list.id)}
              aria-expanded={isEditOpen}
              aria-label={`Redigera ${list.name}`}
              className="text-gray-300 dark:text-gray-600 hover:text-blue-400 dark:hover:text-blue-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </button>
            <DeleteListButton listId={list.id} />
          </div>
        )}
      </div>

      {showEdit && isEditOpen && (
        <ListEditPanel
          listId={list.id}
          initialName={list.name}
          onRename={name => onRename(list.id, name)}
        />
      )}
    </li>
  )
}
