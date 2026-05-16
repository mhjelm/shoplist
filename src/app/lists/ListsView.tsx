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

  // Seed Dexie from SSR on first mount, then always reconcile. Mirrors the
  // pattern in ItemList — SSR is a hydration seed, Dexie is the source of truth.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (initialLists.length > 0) {
        const existing = await localDB.lists.count()
        if (!cancelled && existing === 0) {
          await localDB.lists.bulkPut(initialLists)
        }
      }
      if (cancelled) return
      reconcileLists().catch(err => console.error('reconcileLists failed:', err))
    })()
    return () => { cancelled = true }
  }, [initialLists])

  const liveLists = useLiveQuery(() => localDB.lists.toArray(), [])
  // Use the SSR seed until Dexie hydrates the first time; after that, Dexie wins
  // even if it's empty (e.g. user signed out elsewhere → reconcile cleared it).
  const lists: List[] = liveLists ?? initialLists

  // Cached set: a list counts as cached if Dexie has its row OR any of its
  // items. Two queries, unioned. `useLiveQuery` returns undefined while hydrating.
  const liveItems = useLiveQuery(() => localDB.items.toArray(), [])
  const cachedIds = useMemo(() => {
    const ids = new Set<string>()
    if (liveLists) for (const l of liveLists) ids.add(l.id)
    if (liveItems) for (const i of liveItems) ids.add(i.list_id)
    return ids
  }, [liveLists, liveItems])

  const myLists = lists.filter(l => l.owner_id === currentUserId)
  const sharedLists = lists.filter(l => l.owner_id !== currentUserId)

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
  const linkClasses = 'font-medium text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate'
  const hoverClasses = disabled
    ? 'cursor-not-allowed'
    : 'hover:text-blue-600 dark:hover:text-blue-400'

  return (
    <li className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between ${disabled ? 'opacity-50' : ''}`}>
      {disabled ? (
        <span
          aria-disabled="true"
          title="Inte tillgänglig offline"
          className={`${linkClasses} ${hoverClasses}`}
        >
          {list.name}
          {list.is_shared && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">shared</span>}
        </span>
      ) : (
        <Link
          href={`/lists/${list.id}`}
          className={`${linkClasses} ${hoverClasses}`}
        >
          {list.name}
          {list.is_shared && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">shared</span>}
        </Link>
      )}
      {showDelete && <DeleteListButton listId={list.id} />}
    </li>
  )
}
