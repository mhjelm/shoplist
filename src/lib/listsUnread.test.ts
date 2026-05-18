import { describe, it, expect } from 'vitest'
import { computeUnread } from './listsUnread'
import type { List } from '@/lib/types'

const ME = 'user-me'
const THEM = 'user-them'

function mkList(id: string, ownerId = ME): Pick<List, 'id' | 'owner_id'> {
  return { id, owner_id: ownerId }
}

describe('computeUnread', () => {
  it('marks a list shared-with-me as unread when activity is newer than last view', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: true })
  })

  it('marks an owned + shared list as unread when activity is newer than last view', () => {
    const result = computeUnread({
      lists: [mkList('a', ME)],
      memberCounts: { a: true },
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: true })
  })

  it('does NOT mark a personal (owned, no members) list as unread even when activity exists', () => {
    const result = computeUnread({
      lists: [mkList('a', ME)],
      memberCounts: { a: false },
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('does NOT mark a personal list when memberCounts is missing the key', () => {
    const result = computeUnread({
      lists: [mkList('a', ME)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastViewed: new Map(),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('treats a never-viewed shared list with activity as unread', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastViewed: new Map(),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: true })
  })

  it('treats a shared list with no activity as not-unread', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map(),
      lastViewed: new Map(),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('marks a shared list as not-unread when last_viewed is later than activity', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T10:00:00Z']]),
      lastViewed: new Map([['a', '2026-05-18T12:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: false })
  })

  it('handles a mixed batch — only flags the shared lists with newer activity', () => {
    const result = computeUnread({
      lists: [
        mkList('personal', ME),               // own, no members → suppressed
        mkList('owned-shared', ME),           // own, has members → eligible
        mkList('joined', THEM),               // someone else's → eligible
        mkList('quiet-shared', THEM),         // shared but no activity
      ],
      memberCounts: { 'owned-shared': true, personal: false },
      lastActivity: new Map([
        ['personal', '2026-05-18T12:00:00Z'],
        ['owned-shared', '2026-05-18T12:00:00Z'],
        ['joined', '2026-05-18T12:00:00Z'],
      ]),
      lastViewed: new Map([
        ['owned-shared', '2026-05-18T10:00:00Z'],
        ['joined', '2026-05-18T13:00:00Z'],
      ]),
      currentUserId: ME,
    })
    expect(result).toEqual({
      'owned-shared': true, // activity > last_viewed
      'joined': false,      // already seen later
    })
  })
})
