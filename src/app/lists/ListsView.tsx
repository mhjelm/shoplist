'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLiveQuery } from 'dexie-react-hooks'
import { localDB } from '@/lib/db/local'
import { reconcileLists } from '@/lib/sync/reconcile'
import { useSyncState } from '@/lib/sync/engine'
import type { List, Theme } from '@/lib/types'
import { slColorFor, slFlareDelay } from '@/lib/sl-theme'
import DeleteListButton from './DeleteListButton'
import ListEditPanel from './ListEditPanel'

interface Props {
  initialLists: List[]
  memberCounts: Record<string, boolean>
  unread: Record<string, boolean>
  theme: Theme
  currentUserId: string
}

export default function ListsView({ initialLists, memberCounts, unread, theme, currentUserId }: Props) {
  const { isOffline } = useSyncState()
  const router = useRouter()
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

  // Refresh the server-rendered unread/membership data whenever the tab
  // becomes visible again (e.g. phone screen wakes with the app sitting
  // on /lists). Without this, stale unread markers linger until the user
  // manually pulls-to-refresh.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])

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
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white dark:bg-black"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512.png"
            alt=""
            aria-hidden
            className="w-64 h-64 sm:w-80 sm:h-80 loading-cart select-none dark:hidden"
            draggable={false}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512-dark.png"
            alt=""
            aria-hidden
            className="w-64 h-64 sm:w-80 sm:h-80 loading-cart select-none hidden dark:block"
            draggable={false}
          />
          <span className="mt-2 text-[#EC4899] text-lg font-semibold tracking-wide">Laddar...</span>
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
                unread={unread[list.id] ?? false}
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
                unread={unread[list.id] ?? false}
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
      {unread && (theme === 'shoplist' ? <UnreadSticker /> : <UnreadBadge />)}
      <span className="truncate">{list.name}</span>
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
