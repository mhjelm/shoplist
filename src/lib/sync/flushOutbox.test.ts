import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OutboxEntry } from '@/lib/db/types'

// ---------------------------------------------------------------------------
// In-memory fake for localDB.outbox — supports exactly the calls flushOutbox
// makes. A fresh store is created each time the module factory runs; we call
// vi.resetModules() in beforeEach so every test gets pristine engine module
// state (the private `draining` / `resyncRequested` singletons) AND a clean
// outbox store, re-imported together.
// ---------------------------------------------------------------------------

function makeOutboxFake() {
  const store: OutboxEntry[] = []
  let seq = 1

  const byStatus = (statuses: string[]) => store.filter(e => statuses.includes(e.status))
  // Reads return detached copies, like Dexie — mutating the store later (via
  // update/delete) must NOT retroactively change a snapshot already handed out.
  const clone = (e: OutboxEntry) => ({ ...e })
  const collection = (statuses: string[]) => ({
    sortBy: async (key: keyof OutboxEntry) =>
      byStatus(statuses).map(clone).sort((a, b) => Number(a[key]) - Number(b[key])),
    count: async () => byStatus(statuses).length,
    toArray: async () => byStatus(statuses).map(clone),
    modify: async (patch: Partial<OutboxEntry>) => {
      for (const e of byStatus(statuses)) Object.assign(e, patch)
    },
  })

  return {
    __store: store,
    __seed(entry: Partial<OutboxEntry>): number {
      const s = seq++
      store.push({
        seq: s,
        list_id: 'list-1',
        type: 'item.update',
        status: 'pending',
        attempts: 0,
        created_at: Date.now(),
        idempotency_key: `key-${s}`,
        payload: {},
        ...entry,
      } as OutboxEntry)
      return s
    },
    async add(entry: Omit<OutboxEntry, 'seq'>): Promise<number> {
      const s = seq++
      store.push({ ...entry, seq: s } as OutboxEntry)
      return s
    },
    async update(s: number, patch: Partial<OutboxEntry>) {
      const e = store.find(x => x.seq === s)
      if (e) Object.assign(e, patch)
    },
    async delete(s: number) {
      const i = store.findIndex(x => x.seq === s)
      if (i >= 0) store.splice(i, 1)
    },
    where(_field: string) {
      return {
        equals: (val: string) => collection([val]),
        anyOf: (vals: string[]) => collection(vals),
      }
    },
  }
}

let outboxFake: ReturnType<typeof makeOutboxFake>

vi.mock('@/lib/db/local', () => ({
  get localDB() {
    return {
      outbox: outboxFake,
      items: { update: vi.fn().mockResolvedValue(undefined) },
    }
  },
}))

const updateItem = vi.fn().mockResolvedValue(undefined)
const touchListView = vi.fn().mockResolvedValue({})

vi.mock('@/app/lists/[id]/actions', () => ({
  addItem: vi.fn().mockResolvedValue({ item: { id: 'x', category: 'mejeri' }, merged: false }),
  updateItem: (...args: unknown[]) => updateItem(...args),
  setItemCategory: vi.fn().mockResolvedValue(undefined),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  reorderItem: vi.fn().mockResolvedValue(undefined),
  mergeItems: vi.fn().mockResolvedValue(undefined),
  categorizeItem: vi.fn().mockResolvedValue({}),
  touchListView: (...args: unknown[]) => touchListView(...args),
}))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Let queued microtasks/awaits settle so the drain loop advances to its next
// network await. Uses a real macrotask turn (no fake timers in these tests).
const settle = () => new Promise(r => setTimeout(r, 0))

function updatePayload(id: string) {
  return { id, list_id: 'list-1', patch: { is_checked: true } }
}

describe('flushOutbox — single-flight, no dropped signals', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    updateItem.mockResolvedValue(undefined)
    touchListView.mockResolvedValue({})
    outboxFake = makeOutboxFake()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drains an entry that was queued AFTER the flush snapshotted its pending set', async () => {
    const { flushOutbox } = await import('./engine')

    // eA parks the drain in-flight until we resolve it.
    const dA = deferred<undefined>()
    updateItem.mockImplementationOnce(async () => { await dA.promise })

    outboxFake.__seed({ payload: updatePayload('A') })

    const p1 = flushOutbox()
    await settle() // drain advances and parks awaiting eA's dispatch

    // While the flush is parked, a second edit is committed and fires flush
    // again — this is the call the old `if (isFlushing) return` dropped.
    outboxFake.__seed({ payload: updatePayload('B') })
    flushOutbox()

    dA.resolve(undefined)
    await p1

    const dispatchedIds = updateItem.mock.calls.map(c => c[0])
    expect(dispatchedIds).toContain('A')
    expect(dispatchedIds).toContain('B')
    expect(outboxFake.__store).toHaveLength(0)
  })

  it('a re-entrant flushOutbox() resolves only after the queue is fully drained', async () => {
    const { flushOutbox } = await import('./engine')

    const dA = deferred<undefined>()
    updateItem.mockImplementationOnce(async () => { await dA.promise })

    outboxFake.__seed({ payload: updatePayload('A') })

    const p1 = flushOutbox()
    await settle()

    outboxFake.__seed({ payload: updatePayload('B') })
    let resolved = false
    const p2 = flushOutbox().then(() => { resolved = true })

    await settle()
    expect(resolved).toBe(false) // still draining — must not resolve early

    dA.resolve(undefined)
    await Promise.all([p1, p2])
    expect(resolved).toBe(true)
    expect(outboxFake.__store).toHaveLength(0)
  })

  it('settles pendingCount to 0 once everything has drained', async () => {
    const { flushOutbox, getSyncState } = await import('./engine')

    outboxFake.__seed({ payload: updatePayload('A') })
    outboxFake.__seed({ payload: updatePayload('B') })

    await flushOutbox()

    expect(getSyncState().pendingCount).toBe(0)
    expect(outboxFake.__store).toHaveLength(0)
  })

  it('runs a single drain loop for two near-simultaneous calls (no double-dispatch)', async () => {
    const { flushOutbox } = await import('./engine')

    outboxFake.__seed({ payload: updatePayload('A') })
    outboxFake.__seed({ payload: updatePayload('B') })

    flushOutbox()
    await flushOutbox()

    // Each entry dispatched exactly once, not once per flush call.
    expect(updateItem).toHaveBeenCalledTimes(2)
    expect(outboxFake.__store).toHaveLength(0)
  })

  it('dispatches entries in seq order across the re-read boundary', async () => {
    const { flushOutbox } = await import('./engine')

    const dA = deferred<undefined>()
    updateItem.mockImplementationOnce(async () => { await dA.promise })

    outboxFake.__seed({ payload: updatePayload('A') }) // seq 1
    const p1 = flushOutbox()
    await settle()

    outboxFake.__seed({ payload: updatePayload('B') }) // seq 2, queued mid-flush
    flushOutbox()

    dA.resolve(undefined)
    await p1

    expect(updateItem.mock.calls.map(c => c[0])).toEqual(['A', 'B'])
  })

  it('does NOT dead-letter a version-skew error and does not flag the app offline', async () => {
    vi.useFakeTimers()
    try {
      const { flushOutbox, getSyncState } = await import('./engine')

      // A stale, service-worker-cached bundle keeps POSTing an action id the
      // deployed server no longer knows. The entry is VALID — only the bundle is
      // stale — so it must be retried, never dropped, and this is not an "offline"
      // condition.
      updateItem.mockRejectedValue(
        new Error('UnrecognizedActionError: Server Action "7f8ede24" was not found on the server.'),
      )

      const seqA = outboxFake.__seed({ payload: updatePayload('A') })
      await flushOutbox()

      const entry = outboxFake.__store.find(e => e.seq === seqA)!
      expect(entry.status).toBe('failed') // retried…
      expect(entry.status).not.toBe('dead') // …NOT discarded
      expect(getSyncState().isOffline).toBe(false) // version skew ≠ offline
      expect(getSyncState().lastSyncError).toContain('Server Action')
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('keeps retrying (never dead-letters) a network error past MAX_ATTEMPTS', async () => {
    vi.useFakeTimers()
    try {
      const { flushOutbox, MAX_ATTEMPTS } = await import('./engine')

      updateItem.mockRejectedValue(new Error('TypeError: Failed to fetch'))

      // Already at the cap: a non-transient error here would dead-letter, but a
      // network outage must keep waiting for the radio to return.
      const seqA = outboxFake.__seed({ payload: updatePayload('A'), attempts: MAX_ATTEMPTS })
      await flushOutbox()

      const entry = outboxFake.__store.find(e => e.seq === seqA)!
      expect(entry.status).toBe('failed')
      expect(entry.status).not.toBe('dead')
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('dead-letters a poison entry after MAX_ATTEMPTS and keeps draining the rest', async () => {
    const { flushOutbox, getSyncState } = await import('./engine')
    const { MAX_ATTEMPTS } = await import('./engine')

    // 'poison' always fails with a non-transient (server-rejection) error;
    // 'healthy' — queued strictly behind it — succeeds.
    updateItem.mockImplementation(async (id: string) => {
      if (id === 'poison') throw new Error('boom: permanent server rejection')
      return undefined
    })

    const poisonSeq = outboxFake.__seed({
      payload: updatePayload('poison'),
      attempts: MAX_ATTEMPTS - 1, // next failure hits the cap
    })
    outboxFake.__seed({ payload: updatePayload('healthy') })

    await flushOutbox()

    const poison = outboxFake.__store.find(e => e.seq === poisonSeq)!
    expect(poison.status).toBe('dead')
    expect(poison.attempts).toBe(MAX_ATTEMPTS)

    // The head-of-line block is gone: the entry queued BEHIND the poison one
    // still drained instead of being stranded forever.
    expect(updateItem.mock.calls.map(c => c[0])).toContain('healthy')
    expect(outboxFake.__store.find(e => (e.payload as { id?: string }).id === 'healthy')).toBeUndefined()
    expect(getSyncState().pendingCount).toBe(0)
  })

  it('marks failed + schedules a backoff retry, then drains on the next flush', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const { flushOutbox, getSyncState } = await import('./engine')

      // First dispatch attempt rejects; a later flush (what the backoff timer
      // fires — its callback is just () => flushOutbox()) succeeds.
      updateItem.mockRejectedValueOnce(new Error('boom'))

      const seqA = outboxFake.__seed({ payload: updatePayload('A') })

      await flushOutbox()

      const entry = outboxFake.__store.find(e => e.seq === seqA)!
      expect(entry.status).toBe('failed')
      expect(entry.attempts).toBe(1)
      expect(getSyncState().lastSyncError).toContain('boom')
      expect(getSyncState().isOffline).toBe(true)
      // Backoff scheduled at RETRY_DELAYS[0] === 1000ms.
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)

      // Drive the retry deterministically (updateItem now resolves).
      await flushOutbox()

      expect(outboxFake.__store).toHaveLength(0)
      expect(getSyncState().pendingCount).toBe(0)
      expect(getSyncState().isOffline).toBe(false)
    } finally {
      vi.clearAllTimers()
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
