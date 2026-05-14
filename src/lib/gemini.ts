import { type CategorySlug, CATEGORIES, isValidCategorySlug } from './categories'

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

type GemResp = { candidates?: { content?: { parts?: { text?: string }[] } }[] }

export async function callGemini(prompt: string): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[gemini] error', res.status, body)
    throw new Error(`Gemini failed (${res.status})`)
  }

  const data = (await res.json()) as GemResp
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''
  return JSON.parse(text)
}

const CATEGORY_LINES = CATEGORIES.map(c => `- ${c.slug} (${c.label})`).join('\n')

export async function categorizeNames(names: string[]): Promise<Record<string, CategorySlug>> {
  if (names.length === 0) return {}

  const prompt = `Klassificera följande matvaror i exakt en av dessa kategorier (returnera slug):
${CATEGORY_LINES}

Varor: ${JSON.stringify(names)}

Svara med JSON: {"results": [{"name": "<vara>", "category": "<slug>"}]}`

  try {
    const parsed = (await callGemini(prompt)) as { results?: { name?: string; category?: string }[] }
    const out: Record<string, CategorySlug> = {}
    for (const r of parsed.results ?? []) {
      if (r.name && r.category && isValidCategorySlug(r.category)) {
        out[r.name.toLowerCase()] = r.category
      }
    }
    return out
  } catch {
    return {}
  }
}
