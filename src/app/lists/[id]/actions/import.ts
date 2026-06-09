'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { type CategorySlug, isValidCategorySlug } from '@/lib/categories'
import { callGemini, callGeminiWithAudio } from '@/lib/gemini'
import { normalizeTaskNames } from '@/lib/taskExtract'
import { log } from '@/lib/log'

// addItems: batch import entry point for RecipeImportModal and the Web Share Target route.
// Do not call from add-item flows — those route through muAddItem (outbox) instead.
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

const CATEGORY_LIST = `frukt-gront, mejeri, kott-fisk, brod, frys, skafferi, drycker, snacks, hushall, hygien, ovrigt`

// Shared extraction instructions for both the typed (extractAddItems) and the
// spoken (extractItemsFromAudio) flows. The `source` clause names where the
// items come from; the rest is identical so both paths return the same shape.
function buildExtractionPrompt(source: string) {
  const exampleInput = `2 mjölk\nbanan\npasta 500g\n3 burkar krossade tomater`
  const exampleOutput = `{"items":[{"name":"Mjölk","quantity":2,"measurement":null,"category":"mejeri"},{"name":"Banan","quantity":1,"measurement":null,"category":"frukt-gront"},{"name":"Pasta","quantity":1,"measurement":"500 g","category":"skafferi"},{"name":"Krossade tomater","quantity":3,"measurement":"3 burkar","category":"skafferi"}]}`

  return `Parse ${source} into structured items. Each line, comma-separated segment, or spoken item is one item. For each, extract:
- "name": the grocery item in Swedish (1-4 words, capitalize first word only)
- "quantity": positive integer (default 1). Use when a clear count is stated, e.g. "2 mjölk" → 2, "3 burkar tonfisk" → 3.
- "measurement": copy the unit/amount phrase VERBATIM (e.g. "500 g", "3 burkar", "1,5 dl"). Set to null if none.
- "category": one of these slugs: ${CATEGORY_LIST}

CRITICAL: Never invent or modify measurements. Copy exactly as stated, including fractions (½), approximations (ca), and Swedish decimal commas (1,5). When a number is a count of a named unit ("3 burkar tonfisk" → quantity 3, measurement "3 burkar"), include it in both. When a number is purely an amount ("500 g pasta" → quantity 1, measurement "500 g"). When uncertain, prefer quantity 1.

CRITICAL: Only return items that are actually present in the input. If the input contains no clear items — e.g. silence, background noise, or unintelligible audio — return {"items": []}. Never guess, fill in, or invent a plausible shopping list when nothing was clearly stated. The example below is only a format guide; never copy its items into your answer.

Example input:
${exampleInput}

Example output:
${exampleOutput}

Return JSON only: {"items": [{"name": "...", "quantity": 1, "measurement": "..." or null, "category": "slug"}, ...]}`
}

// Validate and normalise the raw Gemini `items` array into the strict shape the
// add-item flows expect: trimmed name, quantity ≥ 1, valid category slug or null,
// trimmed measurement or null. Drops anything without a usable name.
function normalizeExtractedItems(parsed: { items?: unknown }) {
  if (!Array.isArray(parsed.items)) return []
  return (parsed.items as unknown[])
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
}

export async function extractAddItems(text: string) {
  if (!text.trim()) return { error: 'No input' }
  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  try {
    const parsed = (await callGemini(
      `${buildExtractionPrompt('this user-typed shopping list')}

Input:
${text}`,
      { temperature: 0 }
    )) as { items?: unknown }

    return { items: normalizeExtractedItems(parsed) }
  } catch (e) {
    log.error('extract.add_items_failed', { error: e instanceof Error ? e.message : String(e) })
    return { error: e instanceof Error ? e.message : 'Could not parse Gemini response' }
  }
}

export async function extractItemsFromAudio(audioBase64: string, mimeType: string) {
  if (!audioBase64) return { error: 'No audio' }
  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  try {
    const parsed = (await callGeminiWithAudio(
      buildExtractionPrompt('the spoken shopping list in the attached audio'),
      audioBase64,
      mimeType,
      { temperature: 0 }
    )) as { items?: unknown }

    return { items: normalizeExtractedItems(parsed) }
  } catch (e) {
    log.error('extract.audio_failed', { error: e instanceof Error ? e.message : String(e) })
    return { error: e instanceof Error ? e.message : 'Could not parse Gemini response' }
  }
}

// Prompt for the spoken task-list flow (extractTasksFromAudio). Unlike the
// grocery audio path, tasks have no quantity/measurement/category — just a
// name. The input is rambling spoken Swedish; the model's job is to segment it
// into discrete actionable tasks and drop the filler between them.
const TASK_AUDIO_PROMPT = `The attached audio is a person speaking Swedish out loud, listing things they need to do — chores and to-do tasks. The speech is casual and may ramble: filler words, connectors, pauses, and self-corrections.

Extract the distinct, actionable tasks. Rules:
- One short phrase per task; phrase it as an actionable to-do.
- Ignore filler and connectors ("öh", "och sen", "jag måste också", "vänta", "alltså").
- Fold a clarification into the task it belongs to (don't split it into a separate task).
- If the speaker corrects themselves, keep only the corrected version.
- Never invent tasks that weren't spoken. If the audio is silence, background noise, or unintelligible, return {"tasks": []} — never guess a plausible task list. The example below is only a format guide; never copy its tasks into your answer.
- Transcribe and return each task in SWEDISH. Do not translate to English.
- Keep each task concise (max ~8 words).

Example (spoken): "öh jag måste ringa rörmokaren, och sen vattna blommorna, ja och hämta tvätten på fredag"
Example output: {"tasks":["Ring rörmokaren","Vattna blommorna","Hämta tvätten"]}

Return JSON only: {"tasks": ["...", "..."]}`

export async function extractTasksFromAudio(audioBase64: string, mimeType: string) {
  if (!audioBase64) return { error: 'No audio' }
  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  try {
    const parsed = (await callGeminiWithAudio(
      TASK_AUDIO_PROMPT,
      audioBase64,
      mimeType,
      { temperature: 0 }
    )) as { tasks?: unknown }

    return { tasks: normalizeTaskNames(parsed) }
  } catch (e) {
    log.error('extract.tasks_audio_failed', { error: e instanceof Error ? e.message : String(e) })
    return { error: e instanceof Error ? e.message : 'Could not parse Gemini response' }
  }
}

// Prompt for the task-list picture import (extractTasksFromImage). Image sibling
// of TASK_AUDIO_PROMPT: a photo of a handwritten/printed to-do or chore list, not
// groceries — so no quantity/measurement/category, just task names.
const TASK_IMAGE_PROMPT = `The attached image is a photo of a handwritten or printed to-do / chore list. Extract the distinct, actionable tasks. Rules:
- One short phrase per task; phrase it as an actionable to-do.
- Skip crossed-out / struck-through items, checked-off lines, header text, dates, and any decoration.
- Fold a clarification into the task it belongs to (don't split it into a separate task).
- Never invent tasks that aren't written in the image. If the image shows no clear list — e.g. it's blank, illegible, or not a list at all — return {"tasks": []}. The example below is only a format guide; never copy its tasks into your answer.
- Transcribe and return each task in SWEDISH. Do not translate to English.
- Keep each task concise (max ~8 words).

Example output: {"tasks":["Ring rörmokaren","Vattna blommorna","Hämta tvätten"]}

Return JSON only: {"tasks": ["...", "..."]}`

export async function extractTasksFromImage(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Image too large (max 5 MB)' }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' }

  const mimeType = file.type || 'image/jpeg'
  const buf = await file.arrayBuffer()
  const base64 = Buffer.from(buf).toString('base64')

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
              { text: TASK_IMAGE_PROMPT },
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
    log.error('extract.tasks_image_http_error', { status: res.status, error: body.slice(0, 200) })
    if (res.status === 429) return { error: 'Gemini API rate limit reached — wait a moment and try again' }
    return { error: `Gemini failed (${res.status})` }
  }

  type GemResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const data = (await res.json()) as GemResp
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  if (!text) return { error: 'Gemini returned no text' }

  try {
    const parsed = JSON.parse(text) as { tasks?: unknown }
    return { tasks: normalizeTaskNames(parsed) }
  } catch {
    // Don't dump `text` — it's user-derived extracted content. Length only.
    log.error('extract.tasks_image_parse_failed', { len: text.length })
    return { error: 'Could not parse Gemini response' }
  }
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
    log.error('extract.recipe_failed', { error: e instanceof Error ? e.message : String(e) })
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
    log.error('extract.image_http_error', { status: res.status, error: body.slice(0, 200) })
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
  } catch {
    // Don't dump `text` — it's user-derived extracted content. Length only.
    log.error('extract.image_parse_failed', { len: text.length })
    return { error: 'Could not parse Gemini response' }
  }
}
