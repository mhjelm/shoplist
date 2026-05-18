import type { List } from '@/lib/types'

/**
 * Compute which lists should show a "NEW" marker on /lists for a given user.
 *
 * A list is unread when there is item activity newer than the user's last
 * viewed timestamp (or they've never opened it). Personal lists (you own,
 * zero members) are always skipped — nobody else can produce a change you
 * haven't seen yourself, so the marker has no information value.
 */
export function computeUnread({
  lists,
  memberCounts,
  lastActivity,
  lastViewed,
  currentUserId,
}: {
  lists: Pick<List, 'id' | 'owner_id'>[]
  memberCounts: Record<string, boolean>
  lastActivity: Map<string, string>
  lastViewed: Map<string, string>
  currentUserId: string
}): Record<string, boolean> {
  const unread: Record<string, boolean> = {}
  for (const list of lists) {
    const isShared = list.owner_id !== currentUserId || memberCounts[list.id]
    if (!isShared) continue
    const act = lastActivity.get(list.id)
    if (!act) continue
    const seen = lastViewed.get(list.id)
    unread[list.id] = !seen || act > seen
  }
  return unread
}
