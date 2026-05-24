import type { List } from '@/lib/types'

/**
 * Compute which lists should show a "NEW" marker on /lists for a given user.
 *
 * A list is unread when there is item activity newer than the user's last
 * viewed timestamp (or they've never opened it). Two cases are always skipped:
 * - Personal lists (you own, zero members) — no other actor can change them.
 * - Any shared list whose last activity was caused by the viewing user
 *   themselves — including trigger-propagated writes from sibling shared items.
 */
export function computeUnread({
  lists,
  memberCounts,
  lastActivity,
  lastActivityBy,
  lastViewed,
  currentUserId,
}: {
  lists: Pick<List, 'id' | 'owner_id'>[]
  memberCounts: Record<string, boolean>
  lastActivity: Map<string, string>
  lastActivityBy: Map<string, string | null>
  lastViewed: Map<string, string>
  currentUserId: string
}): Record<string, boolean> {
  const unread: Record<string, boolean> = {}
  for (const list of lists) {
    const isShared = list.owner_id !== currentUserId || memberCounts[list.id]
    if (!isShared) continue
    const act = lastActivity.get(list.id)
    if (!act) continue
    // Suppress NEW when the last activity was caused by the viewing user,
    // including actions that propagated via shared-item triggers.
    if (lastActivityBy.get(list.id) === currentUserId) continue
    const seen = lastViewed.get(list.id)
    unread[list.id] = !seen || act > seen
  }
  return unread
}
