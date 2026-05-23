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
