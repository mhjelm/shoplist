'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import { reconcileLists } from '@/lib/sync/reconcile'
import { useSyncState } from '@/lib/sync/engine'
import type { List } from '@/lib/types'
import DeleteListButton from './DeleteListButton'

interface Props {
  initialLists: List[]
  currentUserId: string
}

export default function ListsView({ initialLists, currentUserId }: Props) {
  const { isOffline } = useSyncState()

  // Reconcile on mount so existing Dexie `lists` rows get refreshed against
  // the server. We do NOT seed Dexie from initialLists here — Dexie's `lists`
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
  // cached /lists HTML, whose SSR data is from the last online visit — fine
  // as a shell, and offline gating below hides anything the user can't open.
  const myLists = initialLists.filter(l => l.owner_id === currentUserId)
  const sharedLists = initialLists.filter(l => l.owner_id !== currentUserId)

  return (
    <div className="space-y-8">
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
                cached={cachedIds.has(list.id)}
                isOffline={isOffline}
                showDelete
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
                cached={cachedIds.has(list.id)}
                isOffline={isOffline}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ListRow({ list, cached, isOffline, showDelete }: {
  list: List
  cached: boolean
  isOffline: boolean
  showDelete?: boolean
}) {
  const disabled = isOffline && !cached
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
      {list.is_shared && <span className="text-xs text-gray-400 dark:text-gray-500">shared</span>}
    </>
  )

  return (
    <li className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between ${disabled ? 'opacity-50' : ''}`}>
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
        >
          {inner}
        </a>
      ) : (
        <Link
          href={`/lists/${list.id}`}
          className={`${labelClasses} ${hoverClasses}`}
        >
          {inner}
        </Link>
      )}
      {showDelete && <DeleteListButton listId={list.id} />}
    </li>
  )
}
