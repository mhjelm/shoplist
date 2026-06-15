// Pure helper extracted from the updateItem server action so the field
// allow-list (which silently dropped is_checked in the past) can be unit-tested.
//
// IMPORTANT: every column the outbox dispatcher may forward through
// `item.update` MUST appear here. Adding a column to mutations.ts without
// adding it here means the local Dexie write happens but the server write
// is a no-op — the exact class of bug that broke offline toggle.
export interface ItemUpdatePatch {
  name?: string
  picture_url?: string | null
  quantity?: number
  measurement?: string | null
  is_checked?: boolean
  // Task-list fields (migration 0025). Explicit null clears the column.
  assignee_id?: string | null
  due_date?: string | null
  // Notes-list fields (migration 0029). Explicit null clears the column.
  url?: string | null
  note?: string | null
}

export function buildItemUpdatePayload(patch: ItemUpdatePatch): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if ('picture_url' in patch) update.picture_url = patch.picture_url?.trim() || null
  if (patch.quantity !== undefined) update.quantity = Math.max(1, patch.quantity)
  if ('measurement' in patch) update.measurement = patch.measurement?.trim() || null
  if (patch.is_checked !== undefined) update.is_checked = patch.is_checked
  // Empty string → null so "Unassigned" / "no due date" clears the column.
  if ('assignee_id' in patch) update.assignee_id = patch.assignee_id || null
  if ('due_date' in patch) update.due_date = patch.due_date || null
  // Notes fields: trim, empty → null (clears the link / body).
  if ('url' in patch) update.url = patch.url?.trim() || null
  if ('note' in patch) update.note = patch.note?.trim() || null
  return update
}
