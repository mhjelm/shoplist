import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { OutboxEntry } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(seq: number, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    seq,
    list_id: 'list-1',
    type: 'item.update',
    payload: { id: 'item-1', list_id: 'list-1', patch: { is_checked: true } },
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
    idempotency_key: `key-${seq}`,
    ...overrides,
  }
}

function createOutboxMock(entries: OutboxEntry[]) {
  const byField = (field: string, val: string) =>
    entries.filter(e => (e as Record<string, unknown>)[field] === val)

  return {
    where: (field: string) => ({
      equals: (val: string) => ({
        modify: vi.fn().mockImplementation(async (patch: Partial<OutboxEntry>) => {
          byField(field, val).forEach(e => Object.assign(e, patch))
        }),
      }),
      anyOf: (vals: string[]) => ({
        sortBy: vi.fn().mockImplementation(async (key: string) =>
          [...entries]
            .filter(e => vals.includes((e as Record<string, unknown>)[field] as string))
            .sort((a, b) =>
              ((a as Record<string, unknown>)[key] as number ?? 0) -
              ((b as Record<string, unknown>)[key] as number ?? 0)
            )
        ),
        count: vi.fn().mockImplementation(async () =>
          entries.filter(e => vals.includes((e as Record<string, unknown>)[field] as string)).length
        ),
      }),
    }),
    update: vi.fn().mockImplementation(async (seq: number, patch: Partial<OutboxEntry>) => {
      const entry = entries.find(e => e.seq === seq)
      if (entry) Object.assign(entry, patch)
      return entry ? 1 : 0
    }),
    delete: vi.fn().mockImplementation(async (seq: number) => {
      const idx = entries.findIndex(e => e.seq === seq)
      if (idx >= 0) entries.splice(idx, 1)
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// vi.resetModules() + vi.doMock() per test gives each test a fresh isFlushing=false.

describe('flushOutbox', () => {
  let entries: OutboxEntry[]
  let mockUpdateItem: ReturnType<typeof vi.fn>
  let flushOutbox: () => Promise<void>

  beforeEach(async () => {
    vi.resetModules()
    entries = []
    mockUpdateItem = vi.fn().mockResolvedValue({ error: null })

    vi.doMock('@/lib/db/local', () => ({
      localDB: { outbox: createOutboxMock(entries) },
    }))

    vi.doMock('@/app/lists/[id]/actions', () => ({
      addItem: vi.fn().mockResolvedValue({ error: null }),
      updateItem: mockUpdateItem,
      setItemCategory: vi.fn().mockResolvedValue({ error: null }),
      deleteItem: vi.fn().mockResolvedValue({ error: null }),
      reorderItem: vi.fn().mockResolvedValue({ error: null }),
      mergeItems: vi.fn().mockResolvedValue({ error: null }),
    }))

    const mod = await import('@/lib/sync/engine')
    flushOutbox = mod.flushOutbox
  })

  it('empty outbox resolves without throwing', async () => {
    await expect(flushOutbox()).resolves.toBeUndefined()
  })

  it('dispatches a pending entry and removes it on success', async () => {
    entries.push(makeEntry(1))
    await flushOutbox()
    expect(mockUpdateItem).toHaveBeenCalledOnce()
    expect(entries).toHaveLength(0)
  })

  it('marks the entry as failed when the server action throws', async () => {
    entries.push(makeEntry(1))
    mockUpdateItem.mockRejectedValueOnce(new Error('network error'))
    await flushOutbox()
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('failed')
    expect(entries[0].attempts).toBe(1)
    expect(entries[0].last_error).toMatch('network error')
  })

  it('stops processing after the first failure, leaving later entries pending', async () => {
    entries.push(makeEntry(1))
    entries.push(makeEntry(2))
    mockUpdateItem.mockRejectedValueOnce(new Error('timeout'))
    await flushOutbox()
    expect(entries.find(e => e.seq === 1)?.status).toBe('failed')
    expect(entries.find(e => e.seq === 2)?.status).toBe('pending')
    expect(mockUpdateItem).toHaveBeenCalledOnce()
  })

  it('resets stuck in_flight entries to pending at startup', async () => {
    entries.push(makeEntry(1, { status: 'in_flight' }))
    await flushOutbox()
    // The entry should have been reset to pending and then dispatched successfully
    expect(mockUpdateItem).toHaveBeenCalledOnce()
    expect(entries).toHaveLength(0)
  })

  it('also retries previously failed entries', async () => {
    entries.push(makeEntry(1, { status: 'failed', attempts: 1 }))
    await flushOutbox()
    expect(mockUpdateItem).toHaveBeenCalledOnce()
    expect(entries).toHaveLength(0)
  })

  it('processes multiple entries in ascending seq order', async () => {
    const dispatched: number[] = []
    mockUpdateItem.mockImplementation(async (id: string) => {
      dispatched.push(Number(id.replace('item-', '')))
      return { error: null }
    })

    entries.push(makeEntry(2, { payload: { id: 'item-2', list_id: 'list-1', patch: { is_checked: true } } }))
    entries.push(makeEntry(1, { payload: { id: 'item-1', list_id: 'list-1', patch: { is_checked: true } } }))

    await flushOutbox()

    expect(dispatched).toEqual([1, 2])
    expect(entries).toHaveLength(0)
  })

  it('forwards is_checked through dispatch to updateItem', async () => {
    // Regression: offline toggle used to be silently dropped because
    // updateItem ignored is_checked. The action layer now accepts it and the
    // dispatcher must forward it through verbatim.
    entries.push(makeEntry(1, {
      type: 'item.update',
      payload: { id: 'item-1', list_id: 'list-1', patch: { is_checked: true } },
    }))

    await flushOutbox()

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', 'list-1', { is_checked: true })
    expect(entries).toHaveLength(0)
  })

  it('marks the entry as failed when the server action returns { error }', async () => {
    // Regression: dispatch used to discard the action return value, so an
    // action like updateItem returning { error: "RLS denied" } looked like
    // success and the outbox entry was deleted — losing the user's edit.
    entries.push(makeEntry(1))
    mockUpdateItem.mockResolvedValueOnce({ error: 'RLS denied' })

    await flushOutbox()

    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe('failed')
    expect(entries[0].attempts).toBe(1)
    expect(entries[0].last_error).toMatch('RLS denied')
  })

  it('dispatches item.insert with the client-generated id', async () => {
    const mockAddItem = vi.fn().mockResolvedValue({ error: null })
    vi.resetModules()

    vi.doMock('@/lib/db/local', () => ({
      localDB: { outbox: createOutboxMock(entries) },
    }))
    vi.doMock('@/app/lists/[id]/actions', () => ({
      addItem: mockAddItem,
      updateItem: vi.fn().mockResolvedValue({ error: null }),
      setItemCategory: vi.fn().mockResolvedValue({ error: null }),
      deleteItem: vi.fn().mockResolvedValue({ error: null }),
      reorderItem: vi.fn().mockResolvedValue({ error: null }),
      mergeItems: vi.fn().mockResolvedValue({ error: null }),
    }))
    const mod = await import('@/lib/sync/engine')

    entries.push(makeEntry(1, {
      type: 'item.insert',
      payload: { id: 'client-uuid-123', list_id: 'list-1', name: 'Mjölk', picture_url: null },
    }))

    await mod.flushOutbox()

    expect(mockAddItem).toHaveBeenCalledWith('list-1', 'Mjölk', null, 'client-uuid-123')
    expect(entries).toHaveLength(0)
  })
})
