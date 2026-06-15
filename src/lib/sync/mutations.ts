import { localDB } from '@/lib/db/local'
import type { LocalItem, OutboxEntry } from '@/lib/db/types'
import type { CategorySlug } from '@/lib/categories'
import { flushOutbox } from './engine'

function baseEntry(
  listId: string,
  type: OutboxEntry['type'],
  payload: unknown,
): Omit<OutboxEntry, 'seq'> {
  return {
    list_id: listId,
    type,
    payload,
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
    idempotency_key: crypto.randomUUID(),
  }
}

export async function muAddItem(
  item: LocalItem,
  opts: { skipCategorize?: boolean } = {},
): Promise<void> {
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.put(item)
    await localDB.outbox.add(baseEntry(item.list_id, 'item.insert', {
      id: item.id,
      list_id: item.list_id,
      name: item.name,
      picture_url: item.picture_url,
      quantity: item.quantity,
      measurement: item.measurement,
      category: item.category,
      // Notes-list fields — forwarded only when present so shopping/task
      // payloads stay byte-for-byte unchanged. The server insert (addItem)
      // and engine dispatch read these only when set.
      ...(item.url ? { url: item.url } : {}),
      ...(item.note ? { note: item.note } : {}),
      // Task adds opt out of the background Gemini categorize fallback — tasks
      // aren't groceries. Omitted (not false) for shopping so payloads are
      // byte-for-byte unchanged there.
      ...(opts.skipCategorize ? { skip_categorize: true } : {}),
    }))
  })
  flushOutbox()
}

export async function muUpdateItem(
  listId: string,
  itemId: string,
  patch: Partial<LocalItem>,
): Promise<void> {
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.update(itemId, patch)
    await localDB.outbox.add(baseEntry(listId, 'item.update', {
      id: itemId,
      list_id: listId,
      patch,
    }))
  })
  flushOutbox()
}

export async function muSetCategory(
  listId: string,
  itemId: string,
  category: CategorySlug,
): Promise<void> {
  await muUpdateItem(listId, itemId, { category })
}

export async function muDeleteItem(listId: string, itemId: string): Promise<void> {
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.delete(itemId)
    await localDB.outbox.add(baseEntry(listId, 'item.delete', {
      id: itemId,
      list_id: listId,
    }))
  })
  flushOutbox()
}

export async function muBulkDelete(listId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.bulkDelete(itemIds)
    for (const id of itemIds) {
      await localDB.outbox.add(baseEntry(listId, 'item.delete', { id, list_id: listId }))
    }
  })
  flushOutbox()
}

export async function muReorderItem(
  listId: string,
  itemId: string,
  sortOrder: number,
): Promise<void> {
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.update(itemId, { sort_order: sortOrder })
    await localDB.outbox.add(baseEntry(listId, 'item.reorder', {
      id: itemId,
      list_id: listId,
      sort_order: sortOrder,
    }))
  })
  flushOutbox()
}

export async function muMergeItems(
  listId: string,
  sourceId: string,
  targetId: string,
  mergedMeasurement: string | null,
  mergedQuantity: number,
): Promise<void> {
  await localDB.transaction('rw', [localDB.items, localDB.outbox], async () => {
    await localDB.items.delete(sourceId)
    await localDB.items.update(targetId, { measurement: mergedMeasurement, quantity: mergedQuantity })
    await localDB.outbox.add(baseEntry(listId, 'item.merge', {
      source_id: sourceId,
      target_id: targetId,
      list_id: listId,
    }))
  })
  flushOutbox()
}
