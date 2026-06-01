import type { Item, List } from '@/lib/types'

/**
 * Compute which lists should show a "NEW" marker on /lists for a given user.
 *
 * A list is unread when an item was ADDED to it (the add-only `last_add_*`
 * signal from migration 0024) more recently than the user last opened it — or
 * they've never opened it. Deletes, clear-shopped, move-from, and edits do NOT
 * raise the marker; only genuine adds (including a move/copy INTO the list) do.
 * Two cases are always skipped:
 * - Personal lists (you own, zero members) — no other actor can add to them.
 * - Any shared list whose last add was caused by the viewing user themselves —
 *   including trigger-propagated writes from sibling shared items.
 */
export function computeUnread({
  lists,
  memberCounts,
  lastAdd,
  lastAddBy,
  lastViewed,
  currentUserId,
}: {
  lists: Pick<List, 'id' | 'owner_id'>[]
  memberCounts: Record<string, boolean>
  lastAdd: Map<string, string>
  lastAddBy: Map<string, string | null>
  lastViewed: Map<string, string>
  currentUserId: string
}): Record<string, boolean> {
  const unread: Record<string, boolean> = {}
  for (const list of lists) {
    const isShared = list.owner_id !== currentUserId || memberCounts[list.id]
    if (!isShared) continue
    const add = lastAdd.get(list.id)
    if (!add) continue
    // Suppress NEW when the last add was caused by the viewing user,
    // including actions that propagated via shared-item triggers.
    if (lastAddBy.get(list.id) === currentUserId) continue
    const seen = lastViewed.get(list.id)
    unread[list.id] = !seen || add > seen
  }
  return unread
}

/**
 * Per-item analogue of {@link computeUnread}: is this item one that another user
 * ADDED since the viewer last opened the list? Used for the in-list "NEW" dot.
 *
 * `baselineViewedAt` is the viewer's last_viewed_at frozen at page entry (before
 * the mount effect bumps it). `null` means never visited → any item by another
 * user counts as new. Optimistic local inserts (added_by === '') and the
 * viewer's own adds are never marked.
 */
export function isNewSinceVisit(
  item: Pick<Item, 'added_by' | 'created_at'>,
  currentUserId: string,
  baselineViewedAt: string | null,
): boolean {
  if (!item.added_by || item.added_by === currentUserId) return false
  if (!baselineViewedAt) return true
  return item.created_at > baselineViewedAt
}
