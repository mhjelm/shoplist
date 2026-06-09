'use server'

import { log } from '@/lib/log'
import { callGeminiWithImage } from '@/lib/gemini'

export async function suggestItemName(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image' }
  if (!process.env.GEMINI_API_KEY) return { error: 'GEMINI_API_KEY not configured' }

  const mimeType = file.type || 'image/jpeg'
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const prompt = 'Identify the product in this image as a short shopping-list item name (1-4 words, e.g. "Bananer", "Flingor", "Toalettpapper"). Reply in Swedish. If unclear, use "unknown". Return JSON only: {"name": "..."}'

  try {
    const parsed = (await callGeminiWithImage(prompt, base64, mimeType, { temperature: 0.1 })) as { name?: unknown }
    const name = typeof parsed.name === 'string' ? parsed.name.trim().replace(/^["']|["']$/g, '') : ''
    if (!name || name.toLowerCase() === 'unknown') return {}
    return { name }
  } catch (e) {
    log.error('gemini.suggest_name_error', { error: e instanceof Error ? e.message : String(e) })
    return { error: e instanceof Error ? e.message : 'Gemini failed' }
  }
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
