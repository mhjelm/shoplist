import type { Item } from '@/lib/types'
import type { LocalItem } from '@/lib/db/types'
import type { CategorySlug } from '@/lib/categories'

// ---------------------------------------------------------------------------
// Item ↔ LocalItem adapters
// ---------------------------------------------------------------------------

export function itemToLocalItem(item: Item): LocalItem {
  return {
    id: item.id,
    list_id: item.list_id,
    added_by: item.added_by,
    name: item.name,
    is_checked: item.is_checked,
    created_at: item.created_at,
    updated_at: item.updated_at ?? '',
    picture_url: item.picture_url,
    sort_order: item.sort_order,
    quantity: item.quantity,
    category: item.category,
    measurement: item.measurement,
    shared_group_id: item.shared_group_id,
    assignee_id: item.assignee_id,
    due_date: item.due_date,
    url: item.url,
    note: item.note,
  }
}

export function localItemToItem(li: LocalItem): Item {
  return {
    id: li.id,
    list_id: li.list_id,
    added_by: li.added_by,
    name: li.name,
    is_checked: li.is_checked,
    created_at: li.created_at,
    picture_url: li.picture_url,
    sort_order: li.sort_order,
    quantity: li.quantity,
    category: li.category,
    measurement: li.measurement,
    shared_group_id: li.shared_group_id,
    assignee_id: li.assignee_id,
    due_date: li.due_date,
    url: li.url,
    note: li.note,
  }
}

// ---------------------------------------------------------------------------
// Sorting and grouping
// ---------------------------------------------------------------------------

export function sortItemsByOrder(
  a: { sort_order: number | null },
  b: { sort_order: number | null },
): number {
  return (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
}

export function groupByCategory(
  items: Item[],
  categoryOrder: CategorySlug[],
): [CategorySlug, Item[]][] {
  const groups = new Map<CategorySlug, Item[]>(categoryOrder.map(c => [c, []]))
  if (!groups.has('ovrigt')) groups.set('ovrigt', [])
  for (const item of items) {
    const cat = (item.category as CategorySlug | null) ?? 'ovrigt'
    const target = groups.get(cat) ?? groups.get('ovrigt')!
    target.push(item)
  }
  return [...groups.entries()].filter(([, its]) => its.length > 0)
}

// ---------------------------------------------------------------------------
// Item lookups and factories
// ---------------------------------------------------------------------------

/**
 * Case-insensitive name search that prefers an active (unchecked) match over
 * a shopped one. Returns the first match found, or undefined if none.
 */
export function findExistingItem(items: Item[], name: string): Item | undefined {
  const lower = name.toLowerCase()
  return (
    items.find(i => !i.is_checked && i.name.toLowerCase() === lower) ??
    items.find(i => i.is_checked && i.name.toLowerCase() === lower)
  )
}

export interface BuildLocalItemOpts {
  quantity?: number
  pictureUrl?: string | null
  category?: CategorySlug | null
  measurement?: string | null
  assigneeId?: string | null
  dueDate?: string | null
  url?: string | null
  note?: string | null
}

export function buildLocalItem(
  listId: string,
  name: string,
  opts: BuildLocalItemOpts = {},
): LocalItem {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    list_id: listId,
    added_by: '',
    name,
    is_checked: false,
    created_at: now,
    updated_at: now,
    picture_url: opts.pictureUrl ?? null,
    sort_order: null,
    quantity: opts.quantity ?? 1,
    category: opts.category ?? null,
    measurement: opts.measurement ?? null,
    shared_group_id: null,
    assignee_id: opts.assigneeId ?? null,
    due_date: opts.dueDate ?? null,
    url: opts.url ?? null,
    note: opts.note ?? null,
  }
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export function buildMergePatch(
  source: Pick<Item, 'measurement' | 'quantity'>,
  target: Pick<Item, 'measurement' | 'quantity'>,
): { measurement: string | null; quantity: number } {
  const measurement =
    [target.measurement, source.measurement]
      .filter((m): m is string => !!m && m.trim().length > 0)
      .join(' + ') || null
  return { measurement, quantity: target.quantity + source.quantity }
}
