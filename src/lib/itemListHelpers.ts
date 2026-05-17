/**
 * Compute the new sort_order for a dragged item given its neighbours after reorder.
 * Uses midpoint when both neighbours are ordered; falls back to index-based seeding
 * when either neighbour has no sort_order yet (avoids collisions from null→0 coercion).
 */
export function computeNewSortOrder(
  beforeOrder: number | null,
  afterOrder: number | null,
  newIndex: number,
): number {
  if (beforeOrder == null && afterOrder == null) return newIndex
  if (beforeOrder == null) return afterOrder! - 1
  if (afterOrder == null) return beforeOrder + 1
  return (beforeOrder + afterOrder) / 2
}

/**
 * Collapse a list of names into unique entries (case-insensitive), accumulating
 * quantities for duplicates. Preserves the casing of the first occurrence.
 */
export function dedupeAddBatch(names: string[]): Array<{ name: string; quantity: number }> {
  const counts = new Map<string, { name: string; quantity: number }>()
  for (const n of names) {
    const key = n.toLowerCase()
    const existing = counts.get(key)
    if (existing) existing.quantity += 1
    else counts.set(key, { name: n, quantity: 1 })
  }
  return [...counts.values()]
}
