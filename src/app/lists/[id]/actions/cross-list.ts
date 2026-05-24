'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { CategorySlug } from '@/lib/categories'

type CopyItem = {
  name: string
  picture_url: string | null
  quantity: number
  category: CategorySlug | null
  measurement: string | null
}

export async function copyItemsToList(targetListId: string, incoming: CopyItem[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (incoming.length === 0) return { error: 'No items to copy' }

  // Collapse duplicates within the input by lowercased name. Sum quantities,
  // join measurements with ` + `, keep the first non-null picture/category.
  type Bucket = {
    display: string
    quantity: number
    measurements: string[]
    category: CategorySlug | null
    picture_url: string | null
  }
  const byLower = new Map<string, Bucket>()
  for (const it of incoming) {
    const t = it.name.trim()
    if (!t) continue
    const key = t.toLowerCase()
    const m = it.measurement?.trim() || null
    const existing = byLower.get(key)
    if (existing) {
      existing.quantity += Math.max(1, it.quantity)
      if (m) existing.measurements.push(m)
      if (!existing.category && it.category) existing.category = it.category
      if (!existing.picture_url && it.picture_url) existing.picture_url = it.picture_url
    } else {
      byLower.set(key, {
        display: t,
        quantity: Math.max(1, it.quantity),
        measurements: m ? [m] : [],
        category: it.category ?? null,
        picture_url: it.picture_url ?? null,
      })
    }
  }
  if (byLower.size === 0) return { error: 'No items to copy' }

  const { data: allItems } = await supabase
    .from('items')
    .select('id, name, is_checked, quantity, measurement, picture_url')
    .eq('list_id', targetListId)

  const activeMap = new Map<string, { id: string; quantity: number; measurement: string | null; picture_url: string | null }>()
  const shoppedMap = new Map<string, { id: string; quantity: number; measurement: string | null; picture_url: string | null }>()
  for (const it of allItems ?? []) {
    const key = it.name.toLowerCase()
    const row = { id: it.id, quantity: it.quantity, measurement: it.measurement ?? null, picture_url: it.picture_url ?? null }
    if (!it.is_checked) activeMap.set(key, row)
    else shoppedMap.set(key, row)
  }

  const resultItems: unknown[] = []

  for (const [key, bucket] of byLower) {
    const active = activeMap.get(key)
    const shopped = shoppedMap.get(key)
    const batchMeasurement = bucket.measurements.length > 0 ? bucket.measurements.join(' + ') : null

    if (active) {
      // Append measurements; don't clobber existing picture.
      const newMeasurement = batchMeasurement
        ? (active.measurement ? `${active.measurement} + ${batchMeasurement}` : batchMeasurement)
        : active.measurement
      const patch: Record<string, unknown> = {
        quantity: active.quantity + bucket.quantity,
        measurement: newMeasurement,
      }
      if (!active.picture_url && bucket.picture_url) patch.picture_url = bucket.picture_url
      const { data } = await supabase
        .from('items')
        .update(patch)
        .eq('id', active.id)
        .select()
        .single()
      if (data) resultItems.push(data)
    } else if (shopped) {
      // Revive: replace measurement, fill picture only if target had none.
      const patch: Record<string, unknown> = {
        quantity: shopped.quantity + bucket.quantity,
        is_checked: false,
        measurement: batchMeasurement,
      }
      if (!shopped.picture_url && bucket.picture_url) patch.picture_url = bucket.picture_url
      const { data } = await supabase
        .from('items')
        .update(patch)
        .eq('id', shopped.id)
        .select()
        .single()
      if (data) resultItems.push(data)
    } else {
      const { data } = await supabase
        .from('items')
        .insert({
          list_id: targetListId,
          added_by: user.id,
          name: bucket.display,
          quantity: bucket.quantity,
          category: bucket.category,
          measurement: batchMeasurement,
          picture_url: bucket.picture_url,
        })
        .select()
        .single()
      if (data) resultItems.push(data)
    }
  }

  revalidatePath(`/lists/${targetListId}`)
  return { items: resultItems }
}

export async function moveItemsToList(
  sourceListId: string,
  targetListId: string,
  itemIds: string[],
  incoming: CopyItem[],
) {
  if (sourceListId === targetListId) return { error: 'Source and target must differ' }
  if (itemIds.length === 0) return { error: 'No items to move' }

  const copyResult = await copyItemsToList(targetListId, incoming)
  if (copyResult.error) return { error: copyResult.error }

  const supabase = await createClient()
  const { error: delErr } = await supabase
    .from('items')
    .delete()
    .in('id', itemIds)
    .eq('list_id', sourceListId)
  if (delErr) return { error: delErr.message }

  revalidatePath(`/lists/${sourceListId}`)
  return { items: copyResult.items }
}

// Share selected items from sourceListId into targetListId. Each shared item
// gets a `shared_group_id` (lazy-assigned on first share). Sibling rows in the
// target list carry the same group id; the AFTER UPDATE trigger keeps every
// editable field in sync across the group going forward.
export async function shareItemsToList(
  sourceListId: string,
  targetListId: string,
  itemIds: string[],
) {
  if (sourceListId === targetListId) return { error: 'Source and target must differ' }
  if (itemIds.length === 0) return { error: 'No items to share' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Load source rows (fresh — don't trust caller-provided field values for
  // is_checked etc., we want exactly what's currently in the DB so the new
  // sibling is born in a state consistent with the group).
  const { data: sourceRows, error: sourceErr } = await supabase
    .from('items')
    .select('id, name, shared_group_id, is_checked, quantity, measurement, picture_url, category')
    .eq('list_id', sourceListId)
    .in('id', itemIds)
  if (sourceErr) return { error: sourceErr.message }
  if (!sourceRows || sourceRows.length === 0) return { error: 'No source items found' }

  // Lazy-assign a fresh shared_group_id to each source row that doesn't have
  // one yet. One group per item, not one group for the whole batch.
  for (const row of sourceRows) {
    if (!row.shared_group_id) {
      const newGroupId = crypto.randomUUID()
      const { error } = await supabase
        .from('items')
        .update({ shared_group_id: newGroupId })
        .eq('id', row.id)
        .is('shared_group_id', null)
      if (error) return { error: error.message }
      row.shared_group_id = newGroupId
    }
  }

  // Load target list's existing items for dedup-merge.
  const { data: targetRows } = await supabase
    .from('items')
    .select('id, name, is_checked, shared_group_id, quantity, measurement, picture_url')
    .eq('list_id', targetListId)

  type TargetRow = {
    id: string
    name: string
    is_checked: boolean
    shared_group_id: string | null
    quantity: number
    measurement: string | null
    picture_url: string | null
  }
  const activeMap = new Map<string, TargetRow>()
  const shoppedMap = new Map<string, TargetRow>()
  for (const row of (targetRows ?? []) as TargetRow[]) {
    const key = row.name.toLowerCase()
    if (!row.is_checked) activeMap.set(key, row)
    else shoppedMap.set(key, row)
  }

  const resultItems: unknown[] = []

  for (const src of sourceRows) {
    const key = src.name.toLowerCase()
    const incomingMeasurement = src.measurement?.trim() || null
    const groupId = src.shared_group_id!
    const active = activeMap.get(key)
    const shopped = shoppedMap.get(key)

    if (active) {
      // Active match: copy-style merge, plus adopt group id if target was
      // unshared. If target was already shared with a *different* group, leave
      // its group id alone (v1: accept one row staying out of the group).
      const mergedMeasurement = incomingMeasurement
        ? (active.measurement ? `${active.measurement} + ${incomingMeasurement}` : incomingMeasurement)
        : active.measurement
      const patch: Record<string, unknown> = {
        quantity: active.quantity + src.quantity,
        measurement: mergedMeasurement,
      }
      if (!active.picture_url && src.picture_url) patch.picture_url = src.picture_url
      if (active.shared_group_id == null) patch.shared_group_id = groupId
      const { data, error } = await supabase
        .from('items')
        .update(patch)
        .eq('id', active.id)
        .select()
        .single()
      if (error) return { error: error.message }
      if (data) resultItems.push(data)
    } else if (shopped) {
      // Shopped match: revive + merge + adopt.
      const patch: Record<string, unknown> = {
        quantity: shopped.quantity + src.quantity,
        is_checked: false,
        measurement: incomingMeasurement,
      }
      if (!shopped.picture_url && src.picture_url) patch.picture_url = src.picture_url
      if (shopped.shared_group_id == null) patch.shared_group_id = groupId
      const { data, error } = await supabase
        .from('items')
        .update(patch)
        .eq('id', shopped.id)
        .select()
        .single()
      if (error) return { error: error.message }
      if (data) resultItems.push(data)
    } else {
      // No match: insert fresh sibling carrying the group id.
      const { data, error } = await supabase
        .from('items')
        .insert({
          list_id: targetListId,
          added_by: user.id,
          name: src.name,
          quantity: src.quantity,
          category: src.category,
          measurement: incomingMeasurement,
          picture_url: src.picture_url,
          is_checked: src.is_checked,
          shared_group_id: groupId,
        })
        .select()
        .single()
      if (error) return { error: error.message }
      if (data) resultItems.push(data)
    }
  }

  revalidatePath(`/lists/${sourceListId}`)
  revalidatePath(`/lists/${targetListId}`)
  return { items: resultItems }
}
