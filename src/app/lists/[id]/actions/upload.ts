'use server'

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
