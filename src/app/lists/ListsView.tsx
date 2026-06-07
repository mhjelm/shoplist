'use client'

import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import type { LocalListCatalog, LocalListView } from '@/lib/db/types'
import { subscribeToListsOverview } from '@/lib/sync/realtime'
import { reconcileListsOverview } from '@/lib/sync/reconcile'
import { computeUnread } from '@/lib/listsUnread'
import { useSyncState } from '@/lib/sync/engine'
import type { List, Theme } from '@/lib/types'
import { slColorFor, slFlareDelay } from '@/lib/sl-theme'
import { useRevealFx } from '@/lib/useRevealFx'
import { log } from '@/lib/log'
import DeleteListButton from './DeleteListButton'
import ListEditPanel from './ListEditPanel'

interface Props {
  initialLists: List[]
  memberCounts: Record<string, boolean>
  lastAdd: Record<string, string>
  lastAddBy: Record<string, string | null>
  lastViewed: Record<string, string>
  theme: Theme
  currentUserId: string
}

export default function ListsView({ initialLists, memberCounts, lastAdd, lastAddBy, lastViewed, theme, currentUserId }: Props) {
  const { isOffline } = useSyncState()
  // Random one-of-six reveal animation on mount (incl. after back-nav overlay).
  const revealFx = useRevealFx(true)
  const [navigatingToListId, setNavigatingToListId] = useState<string | null>(null)
  const [openEditListId, setOpenEditListId] = useState<string | null>(null)
  const [renamedLists, setRenamedLists] = useState<Record<string, string>>({})

  // Seed list_catalog and list_views from SSR data before the first paint so
  // useLiveQuery has data on the very first frame after hydration.
  useLayoutEffect(() => {
    // Remove the back-nav loading overlay (if any) the moment /lists is ready
    // to paint — BackLink.tsx leaves a detached #backnav-loading node on <body>
    // when navigating here from a list. Doing it here (pre-paint) reveals
    // /lists without a flash of the leaving page's scroll-jump.
    document.getElementById('backnav-loading')?.remove()
    const catalogRows: LocalListCatalog[] = initialLists.map(list => ({
      id: list.id,
      name: list.name,
      owner_id: list.owner_id,
      created_at: list.created_at,
      kind: list.kind,
      has_members: memberCounts[list.id] ?? false,
      last_add_at: lastAdd[list.id] ?? null,
      last_add_by: lastAddBy[list.id] ?? null,
    }))
    const viewRows: LocalListView[] = Object.entries(lastViewed).map(([list_id, last_viewed_at]) => ({
      list_id,
      last_viewed_at,
    }))
    localDB.list_catalog.bulkPut(catalogRows).catch(err => {
      log.error('idb.write_failed', { table: 'list_catalog', op: 'bulkPut', error: String(err?.message ?? err) })
    })
    if (viewRows.length > 0) localDB.list_views.bulkPut(viewRows).catch(err => {
      log.error('idb.write_failed', { table: 'list_views', op: 'bulkPut', error: String(err?.message ?? err) })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally only seeds from first-mount SSR values; realtime keeps Dexie fresh after

  // Subscribe to realtime changes on lists/list_members/items.
  // Reconcile on subscribe (heals SSR drift) and on reconnect (heals missed events).
  // Item INSERTs are handled optimistically inside the subscription (bump last_add_*).
  useEffect(() => {
    return subscribeToListsOverview(currentUserId, () => {
      reconcileListsOverview().catch(err => {
        log.warn('reconcile.overview_failed', { error: String(err?.message ?? err) })
      })
    })
  }, [currentUserId])

  // Cached set for offline gating (unchanged):
  // a list counts as cached if Dexie has its row OR any of its items.
  const liveLists = useLiveQuery(() => localDB.lists.toArray(), [])
  const liveItems = useLiveQuery(() => localDB.items.toArray(), [])
  const cachedIds = useMemo(() => {
    const ids = new Set<string>()
    if (liveLists) for (const l of liveLists) ids.add(l.id)
    if (liveItems) for (const i of liveItems) ids.add(i.list_id)
    return ids
  }, [liveLists, liveItems])

  // Primary render source: Dexie list_catalog + list_views.
  // Falls back to the SSR seed when undefined (first frame before IndexedDB hydrates).
  const liveCatalog = useLiveQuery(() => localDB.list_catalog.toArray(), [])
  const liveViews = useLiveQuery(() => localDB.list_views.toArray(), [])

  const { myLists, sharedLists, computedMemberCounts, computedUnread } = useMemo(() => {
    const catalog: LocalListCatalog[] = liveCatalog ?? initialLists.map(l => ({
      id: l.id,
      name: l.name,
      owner_id: l.owner_id,
      created_at: l.created_at,
      kind: l.kind,
      has_members: memberCounts[l.id] ?? false,
      last_add_at: lastAdd[l.id] ?? null,
      last_add_by: lastAddBy[l.id] ?? null,
    }))
    const views: LocalListView[] = liveViews ?? Object.entries(lastViewed).map(([list_id, last_viewed_at]) => ({ list_id, last_viewed_at }))

    const addMap = new Map<string, string>()
    const addByMap = new Map<string, string | null>()
    for (const c of catalog) {
      if (c.last_add_at) addMap.set(c.id, c.last_add_at)
      addByMap.set(c.id, c.last_add_by)
    }
    const viewMap = new Map<string, string>()
    for (const v of views) viewMap.set(v.list_id, v.last_viewed_at)

    const mc: Record<string, boolean> = {}
    for (const c of catalog) mc[c.id] = c.has_members

    const sorted = [...catalog].sort((a, b) => b.created_at.localeCompare(a.created_at))

    const lists: List[] = sorted.map(c => ({
      id: c.id,
      name: renamedLists[c.id] ?? c.name,
      owner_id: c.owner_id,
      created_at: c.created_at,
      kind: c.kind ?? 'shopping',
    }))

    const unread = computeUnread({
      lists: sorted,
      memberCounts: mc,
      lastAdd: addMap,
      lastAddBy: addByMap,
      lastViewed: viewMap,
      currentUserId,
    })

    return {
      myLists: lists.filter(l => l.owner_id === currentUserId),
      sharedLists: lists.filter(l => l.owner_id !== currentUserId),
      computedMemberCounts: mc,
      computedUnread: unread,
    }
  }, [liveCatalog, liveViews, initialLists, memberCounts, lastAdd, lastAddBy, lastViewed, renamedLists, currentUserId])

  const toggleEdit = (listId: string) => {
    setOpenEditListId(current => current === listId ? null : listId)
  }
  const handleRename = (listId: string, name: string) => {
    setRenamedLists(prev => ({ ...prev, [listId]: name }))
  }

  // Which kind is being opened — so the nav loading overlay shows a task glyph
  // instead of the shopping cart when entering a task list.
  const navIsTask = navigatingToListId
    ? (myLists.find(l => l.id === navigatingToListId) ?? sharedLists.find(l => l.id === navigatingToListId))?.kind === 'task'
    : false

  return (
    // revealFx is one of six subtle entrance animations, chosen at random on
    // mount (including after the back-nav overlay is removed); '' otherwise.
    <div className={`space-y-8${revealFx ? ' ' + revealFx : ''}`}>
      {navigatingToListId && (
        <div
          role="status"
          aria-live="polite"
          className={`loading-overlay fixed inset-0 z-50 flex flex-col items-center justify-center ${theme === 'polar' ? 'loading-bg-polar' : theme === 'dusk' ? 'loading-bg-dusk' : 'bg-white dark:bg-black'}`}
        >
          {theme === 'polar' || theme === 'dusk' ? (
            <div className={`loading-plate ${theme === 'polar' ? 'loading-plate-polar' : 'loading-plate-dusk'} w-64 h-64 sm:w-80 sm:h-80 loading-cart`} aria-hidden>
              <span className="text-[7rem] sm:text-[9rem] leading-none select-none">{navIsTask ? '📋' : '🛒'}</span>
            </div>
          ) : navIsTask ? (
            <span
              aria-hidden
              className="w-64 h-64 sm:w-80 sm:h-80 loading-cart select-none flex items-center justify-center text-[7rem] sm:text-[9rem] leading-none"
            >
              📋
            </span>
          ) : (
            <>
              <img
                src="/icon-512.png"
                alt=""
                aria-hidden
                className="w-64 h-64 sm:w-80 sm:h-80 loading-cart select-none dark:hidden"
                draggable={false}
              />
              <img
                src="/icon-512-dark.png"
                alt=""
                aria-hidden
                className="w-64 h-64 sm:w-80 sm:h-80 loading-cart select-none hidden dark:block"
                draggable={false}
              />
            </>
          )}
          <span className="loading-label mt-2 text-[#EC4899] text-lg font-semibold tracking-wide">Laddar...</span>
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
                hasMembers={computedMemberCounts[list.id] ?? false}
                unread={computedUnread[list.id] ?? false}
                theme={theme}
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
                unread={computedUnread[list.id] ?? false}
                theme={theme}
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

function ListRow({ list, hasMembers, unread, theme, cached, isOffline, onNavigate, openEditListId, onToggleEdit, onRename, showEdit }: {
  list: List
  hasMembers: boolean
  unread: boolean
  theme: Theme
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
      {unread && (
        theme === 'shoplist' ? <UnreadSticker /> :
        theme === 'polar'    ? <UnreadPolarChip /> :
        theme === 'dusk'     ? <UnreadDuskChip />  :
                               <UnreadBadge />
      )}
      <span className="truncate">{list.name}</span>
      {list.kind === 'task' && <TaskMarker />}
      {hasMembers && <span className="text-xs text-gray-400 dark:text-gray-500">shared</span>}
    </>
  )

  return (
    <li
      data-sl-color={slColorFor(list.id)}
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <div
        className="sl-tile relative overflow-hidden rounded-[inherit] -mx-4 -my-3 px-4 py-3"
        style={{ '--sl-flare-delay': slFlareDelay(list.id) } as CSSProperties}
      >
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

// Mixed-stream kind marker: shopping lists (the common case) stay unmarked; a
// task list carries a single ✓ TASK chip so the exception stands out without
// adding noise to every shopping row.
function TaskMarker() {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide rounded-full px-2 py-0.5 border text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800">
      <span aria-hidden>✓</span>TASK
    </span>
  )
}

const BURST_POINTS =
  '50,2 59,15 74,8 75,25 92,26 85,41 98,50 85,59 92,74 75,75 74,92 59,85 50,98 41,85 26,92 25,75 8,74 15,59 2,50 15,41 8,26 25,25 26,8 41,15'

function UnreadBadge() {
  return (
    <span
      aria-label="Uppdaterad sedan senaste besöket"
      title="Uppdaterad sedan senaste besöket"
      className="unread-burst inline-flex shrink-0 -rotate-12"
    >
      <svg viewBox="0 0 100 100" className="w-7 h-7" aria-hidden="true">
        <polygon points={BURST_POINTS} fill="#EC4899" />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight="900"
          fontSize="28"
          letterSpacing="0.5"
          fill="white"
        >NEW</text>
      </svg>
    </span>
  )
}

function UnreadPolarChip() {
  return (
    <span
      aria-label="Uppdaterad sedan senaste besöket"
      title="Uppdaterad sedan senaste besöket"
      className="unread-polar inline-flex shrink-0"
    >
      <svg viewBox="0 0 100 50" className="h-6 w-auto overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="up-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#9BC1D7" />
            <stop offset="100%" stopColor="#2D5B7D" />
          </linearGradient>
          <filter id="up-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
            <feOffset dx="0.4" dy="1.2" />
            <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g filter="url(#up-shadow)">
          <rect x="2" y="6" width="96" height="38" rx="19" fill="url(#up-fill)" stroke="#F3F9FC" strokeWidth="1.5" />
          <text
            x="50" y="25"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="900"
            fontSize="20"
            letterSpacing="3"
            fill="#F3F9FC"
          >NEW</text>
        </g>
      </svg>
    </span>
  )
}

function UnreadDuskChip() {
  return (
    <span
      aria-label="Uppdaterad sedan senaste besöket"
      title="Uppdaterad sedan senaste besöket"
      className="unread-dusk inline-flex shrink-0 -rotate-3"
    >
      <svg viewBox="0 0 110 50" className="h-7 w-auto overflow-visible" aria-hidden="true">
        <defs>
          <filter id="ud-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" />
            <feOffset dx="0.5" dy="1.6" />
            <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g filter="url(#ud-shadow)">
          <path
            d="M 8 28 Q 8 8 30 8 L 88 8 Q 102 8 102 22 Q 102 38 86 40 L 28 42 Q 8 42 8 28 Z"
            fill="#C47B5E"
            stroke="#FDF6EE"
            strokeWidth="1.5"
          />
          <text
            x="55" y="24"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="ui-serif, Georgia, 'Times New Roman', serif"
            fontStyle="italic"
            fontWeight="700"
            fontSize="20"
            fill="#FDF6EE"
          >nytt</text>
        </g>
      </svg>
    </span>
  )
}

function UnreadSticker() {
  return (
    <span
      aria-label="Uppdaterad sedan senaste besöket"
      title="Uppdaterad sedan senaste besöket"
      className="unread-sticker inline-flex shrink-0"
    >
      <svg viewBox="0 0 100 100" className="w-8 h-8 overflow-visible" aria-hidden="true">
        <defs>
          <filter id="us-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" />
            <feOffset dx="0.6" dy="1.6" />
            <feComponentTransfer><feFuncA type="linear" slope="0.35" /></feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="us-clip">
            <circle cx="50" cy="50" r="42" />
          </clipPath>
          <linearGradient id="us-shine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="50%" stopColor="white" stopOpacity="0.6" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="us-highlight" cx="35%" cy="32%" r="55%">
            <stop offset="0%" stopColor="white" stopOpacity="0.45" />
            <stop offset="60%" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g filter="url(#us-shadow)">
          <circle cx="50" cy="50" r="42" fill="#F97316" />
          <circle cx="50" cy="50" r="42" fill="url(#us-highlight)" />
          <g clipPath="url(#us-clip)">
            <rect className="us-shine-bar" x="-28" y="0" width="18" height="100" fill="url(#us-shine)" />
          </g>
          <path d="M 70 10 Q 80 12 88 24 L 72 22 Z" fill="#FFF3DC" stroke="#C76A10" strokeWidth="0.4" />
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="900"
            fontSize="22"
            letterSpacing="0.4"
            fill="white"
          >NEW</text>
        </g>
      </svg>
    </span>
  )
}
