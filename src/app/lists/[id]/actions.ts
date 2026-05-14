'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type CategorySlug, isValidCategorySlug } from '@/lib/categories'
import { callGemini, categorizeNames } from '@/lib/gemini'

export async function addItem(listId: string, name: string, pictureUrl?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const trimmed = name.trim()

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
  patch: { name?: string; picture_url?: string | null; quantity?: number; measurement?: string | null }
) {
  const supabase = await createClient()
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if ('picture_url' in patch) update.picture_url = patch.picture_url?.trim() || null
  if (patch.quantity !== undefined) update.quantity = Math.max(1, patch.quantity)
  if ('measurement' in patch) update.measurement = patch.measurement?.trim() || null

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

export async function clearAllItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function addItems(listId: string, incoming: Array<{ name: string; category?: string | null; measurement?: string | null }>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Collapse duplicates within the input by lowercased name.
  const byLower = new Map<string, { display: string; nakedCount: number; measurements: string[]; category: CategorySlug | null }>()
  for (const { name, category, measurement } of incoming) {
    const t = name.trim()
    if (!t) continue
    const key = t.toLowerCase()
    const cat = (category && isValidCategorySlug(category)) ? category : null
    const m = measurement?.trim() || null
    const existing = byLower.get(key)
    if (existing) {
      if (m) existing.measurements.push(m)
      else existing.nakedCount++
    } else {
      byLower.set(key, { display: t, nakedCount: m ? 0 : 1, measurements: m ? [m] : [], category: cat })
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

  for (const [key, { display, nakedCount, measurements, category }] of byLower) {
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
        quantity: active.quantity + nakedCount,
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
        .update({ quantity: shopped.quantity + nakedCount, is_checked: false, measurement: batchMeasurement })
        .eq('id', shopped.id)
        .select()
        .single()
      if (data) resultItems.push(data)
    } else {
      const { data } = await supabase
        .from('items')
        .insert({ list_id: listId, added_by: user.id, name: display, quantity: Math.max(1, nakedCount), category, measurement: batchMeasurement })
        .select()
        .single()
      if (data) resultItems.push(data)
    }
  }

  revalidatePath(`/lists/${listId}`)
  return { items: resultItems }
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
      `Extract grocery shopping list items from this recipe. Return only items someone needs to buy at a store. Skip common pantry staples like water, salt, pepper, basic cooking oil. Reply in Swedish. Keep names short (1-4 words each). Also classify each item into one of these category slugs: ${categoryList}.\n\nFor each item, include a "measurement" field with the quantity/unit phrase from the recipe, preserved verbatim in Swedish (e.g. "500 g", "2 msk", "½ dl", "350-400 g", "ca 500 g", "2 förp à 500 g", "1 vitlöksklyfta"). Fractions (½, ¼), ranges (350-400), approximations (ca), and parentheticals (à 500 g) must be kept exactly as written. If the recipe lists the ingredient and its amount on separate lines, associate them. Set "measurement" to null when no amount is given.\n\nExample input:\n${exampleInput}\n\nExample output:\n${exampleOutput}\n\nReturn JSON only in this exact shape: {"items": [{"name": "...", "category": "slug", "measurement": "..." or null}, ...]}\n\nRecipe:\n${fetched.text}`
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
  } catch {
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
    console.error('[gemini] error', res.status, body)
    return { error: `Gemini failed (${res.status}): ${body.slice(0, 200)}` }
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
