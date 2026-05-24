'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type CategorySlug, isValidCategorySlug } from '@/lib/categories'
import { categorizeNames } from '@/lib/gemini'
import { buildItemUpdatePayload, type ItemUpdatePatch } from '@/lib/itemUpdate'

export async function addItem(
  listId: string,
  name: string,
  pictureUrl?: string,
  clientId?: string,
  quantity?: number,
  measurement?: string | null,
  category?: CategorySlug | null,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const trimmed = name.trim()

  // Idempotency guard: if the outbox retries and the item was already inserted, return it.
  if (clientId) {
    const { data: already } = await supabase.from('items').select('*').eq('id', clientId).maybeSingle()
    if (already) return { item: already, merged: false }
  }

  // Look up cached category from user's history (fast path — avoids Gemini).
  const { data: histEntry } = await supabase
    .from('user_item_history')
    .select('category')
    .eq('user_id', user.id)
    .ilike('name', trimmed)
    .maybeSingle()
  const cachedCategory = (histEntry?.category && isValidCategorySlug(histEntry.category))
    ? histEntry.category
    : null

  // Prefer active match, then shopped match (revive), then fresh insert.
  const { data: existing } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
    .ilike('name', trimmed)
    .order('is_checked', { ascending: true }) // false (active) comes first
    .limit(1)
    .single()

  if (existing) {
    const incomingMeasurement = measurement?.trim() || null
    const mergedMeasurement = incomingMeasurement
      ? (existing.measurement ? `${existing.measurement} + ${incomingMeasurement}` : incomingMeasurement)
      : existing.measurement
    const patch: Record<string, unknown> = {
      quantity: existing.quantity + (quantity ?? 1),
      measurement: mergedMeasurement,
    }
    if (existing.is_checked) patch.is_checked = false
    const { data, error } = await supabase
      .from('items')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return { error: error.message }
    revalidatePath(`/lists/${listId}`)
    return { item: data, merged: true }
  }

  const { data, error } = await supabase
    .from('items')
    .insert({
      ...(clientId ? { id: clientId } : {}),
      list_id: listId,
      added_by: user.id,
      name: trimmed,
      picture_url: pictureUrl?.trim() || null,
      category: category ?? cachedCategory,
      quantity: quantity ?? 1,
      measurement: measurement ?? null,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
  return { item: data, merged: false }
}

export async function categorizeItem(itemId: string): Promise<{ category?: CategorySlug; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: item } = await supabase
    .from('items')
    .select('id, name, list_id')
    .eq('id', itemId)
    .single()
  if (!item) return { error: 'Item not found' }

  try {
    const map = await categorizeNames([item.name])
    const cat: CategorySlug = map[item.name.toLowerCase()] ?? 'ovrigt'

    await Promise.all([
      supabase.from('items').update({ category: cat }).eq('id', itemId),
      supabase.from('user_item_history')
        .update({ category: cat })
        .eq('user_id', user.id)
        .ilike('name', item.name),
    ])

    revalidatePath(`/lists/${item.list_id}`)
    return { category: cat }
  } catch {
    return { category: 'ovrigt' }
  }
}

export async function deleteHistoryItem(name: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  await supabase
    .from('user_item_history')
    .delete()
    .eq('user_id', user.id)
    .ilike('name', name)

  return {}
}

export async function setItemCategory(itemId: string, listId: string, category: CategorySlug): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: item } = await supabase
    .from('items')
    .update({ category })
    .eq('id', itemId)
    .select('name')
    .single()
  if (!item) return { error: 'Item not found' }

  await supabase.from('user_item_history')
    .update({ category })
    .eq('user_id', user.id)
    .ilike('name', item.name)

  // Propagate to same-named items in every accessible list (RLS scopes this to
  // lists the user owns or is a member of). Excludes the row already updated.
  await supabase
    .from('items')
    .update({ category })
    .ilike('name', item.name)
    .neq('id', itemId)

  revalidatePath(`/lists/${listId}`)
  return {}
}

export async function updateItem(
  itemId: string,
  listId: string,
  patch: ItemUpdatePatch
) {
  const update = buildItemUpdatePayload(patch)
  if (Object.keys(update).length === 0) return

  const supabase = await createClient()
  const { error } = await supabase.from('items').update(update).eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function toggleItem(itemId: string, listId: string, checked: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ is_checked: checked })
    .eq('id', itemId)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function reorderItem(itemId: string, listId: string, sortOrder: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ sort_order: sortOrder })
    .eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function clearShoppedItems(listId: string) {
  const supabase = await createClient()

  // Collect shared_group_ids of locally-checked rows so we can cascade the
  // delete to their siblings on other lists. (Because `is_checked` syncs
  // across siblings, every member of a shared group is checked when one is —
  // so deleting the whole group is consistent.)
  const { data: shoppedShared } = await supabase
    .from('items')
    .select('shared_group_id')
    .eq('list_id', listId)
    .eq('is_checked', true)
    .not('shared_group_id', 'is', null)

  const groupIds = Array.from(new Set(
    (shoppedShared ?? [])
      .map(r => r.shared_group_id)
      .filter((g): g is string => !!g)
  ))

  // Step 1: delete this list's checked rows (shared or not).
  const { error: err1 } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .eq('is_checked', true)
  if (err1) return { error: err1.message }

  // Step 2: cascade to every sibling in the same shared groups. Two separate
  // simple DELETEs instead of one nested or(and(...)) filter — PostgREST's
  // and() sub-function inside .or() is unreliable for DELETE in Supabase JS v2.
  if (groupIds.length > 0) {
    const { error: err2 } = await supabase
      .from('items')
      .delete()
      .in('shared_group_id', groupIds)
    if (err2) return { error: err2.message }
  }

  revalidatePath(`/lists/${listId}`)
}

export async function deleteItem(itemId: string, listId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function mergeItems(sourceId: string, targetId: string, listId: string) {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('items')
    .select('id, quantity, measurement')
    .in('id', [sourceId, targetId])
  const source = rows?.find(r => r.id === sourceId)
  const target = rows?.find(r => r.id === targetId)
  if (!source || !target) return { error: 'Item not found' }

  const measurement =
    [target.measurement, source.measurement]
      .filter((m): m is string => !!m && m.trim().length > 0)
      .join(' + ') || null
  const quantity = target.quantity + source.quantity

  const { error: upErr } = await supabase.from('items').update({ measurement, quantity }).eq('id', targetId)
  if (upErr) return { error: upErr.message }
  const { error: delErr } = await supabase.from('items').delete().eq('id', sourceId)
  if (delErr) return { error: delErr.message }

  revalidatePath(`/lists/${listId}`)
  return { target: { id: targetId, measurement, quantity } }
}

export async function clearAllItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}
