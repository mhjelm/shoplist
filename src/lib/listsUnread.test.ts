import { describe, it, expect } from 'vitest'
import { computeUnread, isNewSinceVisit } from './listsUnread'
import type { Item, List } from '@/lib/types'

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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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
      lastActivityBy: new Map(),
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

  // ---------------------------------------------------------------------------
  // same-user suppression (bugs 1, 3, 4)
  // ---------------------------------------------------------------------------

  it('suppresses NEW when lastActivityBy matches currentUserId (bug #1 — shared to own list)', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map([['a', ME]]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('still surfaces NEW when lastActivityBy is a different user', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map([['a', THEM]]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: true })
  })

  it('does not auto-suppress when lastActivityBy is null (pre-migration row)', () => {
    const result = computeUnread({
      lists: [mkList('a', THEM)],
      memberCounts: {},
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map<string, string | null>([['a', null]]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({ a: true })
  })

  it('personal-list suppression wins regardless of lastActivityBy', () => {
    const result = computeUnread({
      lists: [mkList('a', ME)],
      memberCounts: { a: false },
      lastActivity: new Map([['a', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map([['a', THEM]]),
      lastViewed: new Map([['a', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('does not mark NEW when my own action propagated via shared-item trigger (bug #3)', () => {
    // Sibling list I have viewed; trigger bumped last_activity in my session
    const result = computeUnread({
      lists: [mkList('source', ME)],
      memberCounts: { source: true },
      lastActivity: new Map([['source', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map([['source', ME]]),
      lastViewed: new Map([['source', '2026-05-18T10:00:00Z']]),
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })

  it('does not mark NEW for previously-unviewed list whose activity was caused by me (bug #4)', () => {
    // I shared an item; the source list last_activity was bumped by my session,
    // but I have never explicitly navigated to this list
    const result = computeUnread({
      lists: [mkList('source', ME)],
      memberCounts: { source: true },
      lastActivity: new Map([['source', '2026-05-18T12:00:00Z']]),
      lastActivityBy: new Map([['source', ME]]),
      lastViewed: new Map(), // no last_viewed_at entry
      currentUserId: ME,
    })
    expect(result).toEqual({})
  })
})

describe('isNewSinceVisit', () => {
  const mkItem = (over: Partial<Pick<Item, 'added_by' | 'created_at'>>): Pick<Item, 'added_by' | 'created_at'> => ({
    added_by: THEM,
    created_at: '2026-05-18T12:00:00Z',
    ...over,
  })

  it('marks an item another user added after the baseline', () => {
    expect(isNewSinceVisit(mkItem({}), ME, '2026-05-18T10:00:00Z')).toBe(true)
  })

  it('does not mark an item the viewer added themselves', () => {
    expect(isNewSinceVisit(mkItem({ added_by: ME }), ME, '2026-05-18T10:00:00Z')).toBe(false)
  })

  it('does not mark optimistic local inserts (added_by empty)', () => {
    expect(isNewSinceVisit(mkItem({ added_by: '' }), ME, '2026-05-18T10:00:00Z')).toBe(false)
  })

  it('does not mark an item created at/before the baseline', () => {
    expect(isNewSinceVisit(mkItem({ created_at: '2026-05-18T10:00:00Z' }), ME, '2026-05-18T10:00:00Z')).toBe(false)
    expect(isNewSinceVisit(mkItem({ created_at: '2026-05-18T09:00:00Z' }), ME, '2026-05-18T10:00:00Z')).toBe(false)
  })

  it('marks any other-user item when never visited (null baseline)', () => {
    expect(isNewSinceVisit(mkItem({}), ME, null)).toBe(true)
  })

  it('still suppresses self-adds even when never visited', () => {
    expect(isNewSinceVisit(mkItem({ added_by: ME }), ME, null)).toBe(false)
  })
})
