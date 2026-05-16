'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type CategorySlug, isValidCategorySlug } from '@/lib/categories'
import { callGemini, categorizeNames } from '@/lib/gemini'
import { buildItemUpdatePayload, type ItemUpdatePatch } from '@/lib/itemUpdate'

export async function addItem(listId: string, name: string, pictureUrl?: string, clientId?: string) {
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
    const patch: Record<string, unknown> = { quantity: existing.quantity + 1 }
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
      category: cachedCategory,
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
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .eq('is_checked', true)

  if (error) return { error: error.message }
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

export async function addItems(listId: string, incoming: Array<{ name: string; category?: string | null; measurement?: string | null; quantity?: number }>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Collapse duplicates within the input by lowercased name.
  // qSum tracks total desired quantity. When `quantity` is explicitly provided it
  // counts unconditionally; when absent (e.g. recipe import) it only counts for
  // measurement-free entries, preserving the original behaviour for those callers.
  const byLower = new Map<string, { display: string; qSum: number; measurements: string[]; category: CategorySlug | null }>()
  for (const it of incoming) {
    const t = it.name.trim()
    if (!t) continue
    const key = t.toLowerCase()
    const cat = (it.category && isValidCategorySlug(it.category)) ? it.category : null
    const m = it.measurement?.trim() || null
    const explicitQ = it.quantity !== undefined ? Math.max(1, Math.floor(it.quantity)) : null
    const qIncrement = explicitQ !== null ? explicitQ : (m ? 0 : 1)
    const existing = byLower.get(key)
    if (existing) {
      existing.qSum += qIncrement
      if (m) existing.measurements.push(m)
    } else {
      byLower.set(key, { display: t, qSum: qIncrement, measurements: m ? [m] : [], category: cat })
    }
  }
  if (byLower.size === 0) return { error: 'No items to add' }

  // Fetch all existing items for this list once.
  const { data: allItems } = await supabase
    .from('items')
    .select('id, name, is_checked, quantity, measurement')
    .eq('list_id', listId)

  const activeMap = new Map<string, { id: string; quantity: number; measurement: string | null }>()
  const shoppedMap = new Map<string, { id: string; quantity: number; measurement: string | null }>()
  for (const it of allItems ?? []) {
    const key = it.name.toLowerCase()
    if (!it.is_checked) activeMap.set(key, { id: it.id, quantity: it.quantity, measurement: it.measurement ?? null })
    else shoppedMap.set(key, { id: it.id, quantity: it.quantity, measurement: it.measurement ?? null })
  }

  const resultItems: unknown[] = []

  for (const [key, { display, qSum, measurements, category }] of byLower) {
    const active = activeMap.get(key)
    const shopped = shoppedMap.get(key)
    const batchMeasurement = measurements.length > 0 ? measurements.join(' + ') : null

    if (active) {
      // Append new measurements to existing (always, no dedup).
      let newMeasurement: string | null = active.measurement
      if (batchMeasurement) {
        newMeasurement = active.measurement ? `${active.measurement} + ${batchMeasurement}` : batchMeasurement
      }
      const patch: Record<string, unknown> = {
        quantity: active.quantity + qSum,
        measurement: newMeasurement,
      }
      const { data } = await supabase
        .from('items')
        .update(patch)
        .eq('id', active.id)
        .select()
        .single()
      if (data) resultItems.push(data)
    } else if (shopped) {
      // Revive: replace old measurement (treat shopped as reset boundary).
      const { data } = await supabase
        .from('items')
        .update({ quantity: shopped.quantity + qSum, is_checked: false, measurement: batchMeasurement })
        .eq('id', shopped.id)
        .select()
        .single()
      if (data) resultItems.push(data)
    } else {
      const { data } = await supabase
        .from('items')
        .insert({ list_id: listId, added_by: user.id, name: display, quantity: Math.max(1, qSum), category, measurement: batchMeasurement })
        .select()
        .single()
      if (data) resultItems.push(data)
    }
  }

  revalidatePath(`/lists/${listId}`)
  return { items: resultItems }
}

export async function extractAddItems(text: string) {
  if (!text.trim()) return { error: 'No input' }
  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  const categoryList = `frukt-gront, mejeri, kott-fisk, brod, frys, skafferi, drycker, snacks, hushall, hygien, ovrigt`

  const exampleInput = `2 mjölk\nbanan\npasta 500g\n3 burkar krossade tomater`
  const exampleOutput = `{"items":[{"name":"Mjölk","quantity":2,"measurement":null,"category":"mejeri"},{"name":"Banan","quantity":1,"measurement":null,"category":"frukt-gront"},{"name":"Pasta","quantity":1,"measurement":"500 g","category":"skafferi"},{"name":"Krossade tomater","quantity":3,"measurement":"3 burkar","category":"skafferi"}]}`

  try {
    const parsed = (await callGemini(
      `Parse this user-typed shopping list into structured items. Each line or comma-separated segment is one item. For each, extract:
- "name": the grocery item in Swedish (1-4 words, capitalize first word only)
- "quantity": positive integer (default 1). Use when a clear count is stated, e.g. "2 mjölk" → 2, "3 burkar tonfisk" → 3.
- "measurement": copy the unit/amount phrase VERBATIM from the input (e.g. "500 g", "3 burkar", "1,5 dl"). Set to null if none.
- "category": one of these slugs: ${categoryList}

CRITICAL: Never invent or modify measurements. Copy exactly as written, including fractions (½), approximations (ca), and Swedish decimal commas (1,5). When a number is a count of a named unit ("3 burkar tonfisk" → quantity 3, measurement "3 burkar"), include it in both. When a number is purely an amount ("500 g pasta" → quantity 1, measurement "500 g"). When uncertain, prefer quantity 1.

Example input:
${exampleInput}

Example output:
${exampleOutput}

Return JSON only: {"items": [{"name": "...", "quantity": 1, "measurement": "..." or null, "category": "slug"}, ...]}

Input:
${text}`,
      { temperature: 0 }
    )) as { items?: unknown }

    if (!Array.isArray(parsed.items)) return { items: [] }

    const items = (parsed.items as unknown[])
      .filter((i): i is { name: string; quantity?: unknown; measurement?: unknown; category?: string } =>
        typeof i === 'object' && i !== null && typeof (i as Record<string, unknown>).name === 'string'
      )
      .map(i => ({
        name: i.name.trim(),
        quantity: (typeof i.quantity === 'number' && i.quantity > 0) ? Math.max(1, Math.floor(i.quantity)) : 1,
        category: (i.category && isValidCategorySlug(i.category)) ? i.category : null,
        measurement: (typeof i.measurement === 'string' && i.measurement.trim()) ? i.measurement.trim() : null,
      }))
      .filter(i => i.name.length > 0)

    return { items }
  } catch (e) {
    console.error('[extractAddItems] failed', e)
    return { error: e instanceof Error ? e.message : 'Could not parse Gemini response' }
  }
}

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

// Walk a JSON-LD value and collect every node typed as Recipe (handles bare
// objects, arrays, and `@graph` wrappers).
function findRecipeNodes(node: unknown): Array<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(findRecipeNodes)
  const obj = node as Record<string, unknown>
  const out: Array<Record<string, unknown>> = []
  const t = obj['@type']
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) out.push(obj)
  if (obj['@graph']) out.push(...findRecipeNodes(obj['@graph']))
  return out
}

// Most Swedish recipe sites (koket.se, ica.se, arla.se, mathem.se) embed
// schema.org Recipe markup with a clean recipeIngredient array — way more
// reliable than scraping HTML.
function extractRecipeIngredients(html: string): string[] | null {
  const matches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of matches) {
    try {
      const json = JSON.parse(m[1].trim())
      for (const recipe of findRecipeNodes(json)) {
        const raw = recipe.recipeIngredient
        if (!Array.isArray(raw)) continue
        const ings = raw
          .filter((s): s is string => typeof s === 'string')
          .map(s => s.trim())
          .filter(Boolean)
        if (ings.length > 0) return ings
      }
    } catch {
      continue
    }
  }
  return null
}

async function fetchRecipeText(input: string): Promise<{ text?: string; error?: string }> {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed) && !trimmed.includes('\n')) {
    try {
      const res = await fetch(trimmed, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 ShoplistBot' },
      })
      if (!res.ok) return { error: `Failed to fetch URL (${res.status})` }
      const html = await res.text()
      const ingredients = extractRecipeIngredients(html)
      if (ingredients) return { text: ingredients.join('\n') }
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .slice(0, 30000)
      return { text: stripped }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Fetch failed' }
    }
  }
  return { text: trimmed }
}

export async function extractRecipeItems(input: string) {
  if (!input.trim()) return { error: 'No input' }
  if (input.length > 50000) return { error: 'Input too long' }

  const fetched = await fetchRecipeText(input)
  if (fetched.error) return { error: fetched.error }

  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  const categoryList = `frukt-gront, mejeri, kott-fisk, brod, frys, skafferi, drycker, snacks, hushall, hygien, ovrigt`

  const exampleInput = `2 msk smör\nca 500 g köttfärs\nVitlöksklyfta\n1`
  const exampleOutput = `{"items":[{"name":"Smör","category":"mejeri","measurement":"2 msk"},{"name":"Köttfärs","category":"kott-fisk","measurement":"ca 500 g"},{"name":"Vitlöksklyfta","category":"frukt-gront","measurement":"1 klyfta"}]}`

  try {
    const parsed = (await callGemini(
      `Extract grocery shopping list items from this recipe or shopping list. Return only items someone needs to buy at a store. Skip common pantry staples like water, salt, pepper, basic cooking oil. Reply in Swedish. Keep names short (1-4 words each). Also classify each item into one of these category slugs: ${categoryList}.\n\nFor each item, include a "measurement" field with the quantity/unit phrase from the input. CRITICAL: copy the measurement VERBATIM from the input. Never modify, round, paraphrase, or invent numbers. If the input says "5 dl" the output must be "5 dl" — not "2 dl", not "3 dl". Preserve fractions (½, ¼), ranges (350-400), approximations (ca), parentheticals (à 500 g), and Swedish decimal commas (1,5) exactly as written. If the input lists the ingredient and its amount on separate lines, associate them. Set "measurement" to null when no amount is given in the input.\n\nExample input:\n${exampleInput}\n\nExample output:\n${exampleOutput}\n\nReturn JSON only in this exact shape: {"items": [{"name": "...", "category": "slug", "measurement": "..." or null}, ...]}\n\nInput:\n${fetched.text}`,
      { temperature: 0 }
    )) as { items?: unknown }

    if (!Array.isArray(parsed.items)) return { items: [] }

    const items = (parsed.items as unknown[])
      .filter((i): i is { name: string; category?: string; measurement?: unknown } =>
        typeof i === 'object' && i !== null && typeof (i as Record<string, unknown>).name === 'string'
      )
      .map(i => ({
        name: i.name.trim(),
        category: (i.category && isValidCategorySlug(i.category)) ? i.category : null,
        measurement: (typeof i.measurement === 'string' && i.measurement.trim()) ? i.measurement.trim() : null,
      }))
      .filter(i => i.name.length > 0)

    return { items }
  } catch (e) {
    console.error('[extractRecipeItems] failed', e)
    return { error: e instanceof Error ? e.message : 'Could not parse Gemini response' }
  }
}

export async function extractListItemsFromImage(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Image too large (max 5 MB)' }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' }

  const mimeType = file.type || 'image/jpeg'
  const buf = await file.arrayBuffer()
  const base64 = Buffer.from(buf).toString('base64')

  const categoryList = `frukt-gront, mejeri, kott-fisk, brod, frys, skafferi, drycker, snacks, hushall, hygien, ovrigt`
  const prompt = `Extract grocery shopping list items from this image of a shopping list or recipe. Reply in Swedish. Keep names short (1-4 words each). Classify each item into one of these category slugs: ${categoryList}.\n\nFor each item, include a "measurement" field with the quantity/unit phrase if visible in the image. CRITICAL: copy the measurement VERBATIM from the image. Never modify, round, paraphrase, or invent numbers. Preserve fractions (½, ¼), ranges (350-400), approximations (ca), parentheticals (à 500 g), and Swedish decimal commas (1,5) exactly as shown. Set "measurement" to null when no amount is shown.\n\nSkip handwritten strikethroughs or crossed-out items. Skip header text, dates, or store names.\n\nReturn JSON only in this exact shape: {"items": [{"name": "...", "category": "slug", "measurement": "..." or null}, ...]}`

  async function callOnce(): Promise<Response> {
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64 } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4000,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
          },
        }),
      }
    )
  }

  let res = await callOnce()
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 5000))
    res = await callOnce()
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[extractListItemsFromImage] gemini error', res.status, body)
    if (res.status === 429) return { error: 'Gemini API rate limit reached — wait a moment and try again' }
    return { error: `Gemini failed (${res.status})` }
  }

  type GemResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const data = (await res.json()) as GemResp
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  if (!text) return { error: 'Gemini returned no text' }

  try {
    const parsed = JSON.parse(text) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return { items: [] }

    const items = (parsed.items as unknown[])
      .filter((i): i is { name: string; category?: string; measurement?: unknown } =>
        typeof i === 'object' && i !== null && typeof (i as Record<string, unknown>).name === 'string'
      )
      .map(i => ({
        name: i.name.trim(),
        category: (i.category && isValidCategorySlug(i.category)) ? i.category : null,
        measurement: (typeof i.measurement === 'string' && i.measurement.trim()) ? i.measurement.trim() : null,
      }))
      .filter(i => i.name.length > 0)

    return { items }
  } catch (e) {
    console.error('[extractListItemsFromImage] parse failed', e, 'text:', text.slice(0, 500))
    return { error: 'Could not parse Gemini response' }
  }
}

export async function suggestItemName(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image' }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' }

  const buf = await file.arrayBuffer()
  const base64 = Buffer.from(buf).toString('base64')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
            { text: 'Identify the product in this image as a short shopping-list item name (1-4 words, e.g. "Bananer", "Flingor", "Toalettpapper"). Reply in Swedish. Reply with just the name, nothing else. If unclear, reply "unknown".' },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 40,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[gemini] suggestItemName error', res.status, body)
    if (res.status === 429) return { error: 'Gemini API rate limit reached — wait a moment and try again' }
    return { error: `Gemini failed (${res.status})` }
  }
  type GemResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const data = (await res.json()) as GemResp
  console.log('[gemini] response:', JSON.stringify(data).slice(0, 500))
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  if (!text || text.toLowerCase() === 'unknown') return {}
  return { name: text.replace(/^["']|["']$/g, '') }
}

export async function uploadImage(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image provided' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Image too large (max 5 MB)' }

  const apiKey = process.env.IMGBB_API_KEY
  if (!apiKey) return { error: 'IMGBB_API_KEY not configured' }

  const body = new FormData()
  body.append('image', file)

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, { method: 'POST', body })
  if (!res.ok) return { error: `ImgBB upload failed (${res.status})` }
  const json = (await res.json()) as { success?: boolean; data?: { url?: string }; error?: { message?: string } }
  if (!json.success || !json.data?.url) return { error: json.error?.message ?? 'Upload failed' }
  return { url: json.data.url }
}
