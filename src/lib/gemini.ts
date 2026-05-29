import { type CategorySlug, CATEGORIES, isValidCategorySlug } from './categories'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Tried in order. When the primary is overloaded (503) the wrapper fails over
// to the next. flash-lite is the same 2.5 generation — identical request shape
// (audio input, thinkingConfig, JSON response) — and usually has spare capacity
// when flash is saturated.
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

type GemResp = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

// A single Gemini request part: text, or inline binary (e.g. audio) as base64.
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

async function callGeminiOnce(model: string, parts: GeminiPart[], options: { temperature?: number }): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[gemini] http error', model, res.status, body)
    const message = res.status === 429
      ? 'Gemini API rate limit reached — wait a moment and try again'
      : res.status === 503
        ? 'Gemini är tillfälligt överbelastad — försök igen om en stund'
        : `Gemini HTTP ${res.status}: ${body.slice(0, 200)}`
    // Attach status so the retry wrapper can decide whether it's transient.
    throw Object.assign(new Error(message), { status: res.status })
  }

  const data = (await res.json()) as GemResp
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map(p => p.text ?? '').join('').trim() ?? ''

  if (!text) {
    console.error('[gemini] empty response', JSON.stringify(data).slice(0, 1000))
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'
    throw new Error(`Gemini returned no text (finishReason: ${reason})`)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    console.error('[gemini] JSON parse failed. text:', text.slice(0, 500))
    throw new Error(`Gemini returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Transient statuses worth retrying: 429 (rate limit) and 503 (model overloaded
// / "high demand" — common on gemini-2.5-flash and not reflected on the status
// page). Backoff per same-model retry, in ms; the array length sets the retry
// count per model. Kept short because we also fail over to the next model.
const RETRYABLE_STATUSES = new Set([429, 503])
const RETRY_BACKOFFS_MS = [1200]

async function callGeminiParts(parts: GeminiPart[], options: { temperature?: number }): Promise<unknown> {
  let lastErr: unknown
  for (let m = 0; m < GEMINI_MODELS.length; m++) {
    const model = GEMINI_MODELS[m]
    const hasFallback = m < GEMINI_MODELS.length - 1
    for (let attempt = 0; ; attempt++) {
      try {
        return await callGeminiOnce(model, parts, options)
      } catch (e) {
        lastErr = e
        const status = (e as { status?: number }).status
        const retryable = !!status && RETRYABLE_STATUSES.has(status)
        if (retryable && attempt < RETRY_BACKOFFS_MS.length) {
          await new Promise(r => setTimeout(r, RETRY_BACKOFFS_MS[attempt]))
          continue
        }
        // Same-model retries exhausted. If it's a transient/overload status and
        // another model is available, fail over to it; otherwise give up.
        if (retryable && hasFallback) {
          console.warn(`[gemini] ${model} unavailable (${status}); falling back to ${GEMINI_MODELS[m + 1]}`)
          break
        }
        throw e
      }
    }
  }
  throw lastErr
}

export async function callGemini(prompt: string, options: { temperature?: number } = {}): Promise<unknown> {
  return callGeminiParts([{ text: prompt }], options)
}

export async function callGeminiWithAudio(
  prompt: string,
  audioBase64: string,
  mimeType: string,
  options: { temperature?: number } = {},
): Promise<unknown> {
  return callGeminiParts(
    [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }],
    options,
  )
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
