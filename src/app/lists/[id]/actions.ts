'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addItem(listId: string, name: string, pictureUrl?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('items')
    .insert({
      list_id: listId,
      added_by: user.id,
      name: name.trim(),
      picture_url: pictureUrl?.trim() || null,
    })
    .select()
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
  return { item: data }
}

export async function updateItem(
  itemId: string,
  listId: string,
  patch: { name?: string; picture_url?: string | null }
) {
  const supabase = await createClient()
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if ('picture_url' in patch) update.picture_url = patch.picture_url?.trim() || null

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

export async function deleteItem(itemId: string, listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ deleted_at: new Date().toISOString() })
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

export async function restoreItem(itemId: string, listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ is_checked: false, deleted_at: null })
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
    .is('deleted_at', null)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function addItems(listId: string, names: string[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const rows = names
    .map(n => n.trim())
    .filter(n => n.length > 0)
    .map(n => ({ list_id: listId, added_by: user.id, name: n }))

  if (rows.length === 0) return { error: 'No items to add' }

  const { data, error } = await supabase.from('items').insert(rows).select()
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
  return { items: data }
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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Extract grocery shopping list items from this recipe. Return only items someone needs to buy at a store. Skip common pantry staples like water, salt, pepper, basic cooking oil. Reply in Swedish. Keep names short (1-4 words each). Do not include quantities. Return JSON only in this exact shape: {"items": ["Item 1", "Item 2"]}.\n\nRecipe:\n${fetched.text}`,
          }],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1000,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json',
        },
      }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[gemini] recipe error', res.status, body)
    return { error: `Gemini failed (${res.status}): ${body.slice(0, 200)}` }
  }
  type GemResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const data = (await res.json()) as GemResp
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  try {
    const parsed = JSON.parse(text) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return { items: [] }
    const items = parsed.items
      .filter((i): i is string => typeof i === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0)
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

export async function clearDeletedItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .not('deleted_at', 'is', null)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}
