import { type CategorySlug, CATEGORIES, isValidCategorySlug } from './categories'
import { log } from './log'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Text/recipe/categorize calls. flash-lite is cheap and handles these fine;
// gemini-3.5-flash is the overload backstop. Tried in order.
const TEXT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash']

// Audio (speech-to-list) calls. Verified via tools/test-gemini-audio.mjs:
// gemini-3.5-flash returns 200 on inline audio; gemini-3.1-flash-lite returns
// 500 INTERNAL (can't do inline audio); the 2.5 models work but are frequently
// 503-overloaded. So 3.5-flash is the audio primary, 2.5-flash the fallback.
const AUDIO_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash']

// 3.x uses thinkingConfig.thinkingLevel; 2.x uses thinkingConfig.thinkingBudget.
// Derive per model so a chain can mix generations.
function thinkingConfigFor(model: string): Record<string, unknown> {
  return model.startsWith('gemini-3') ? { thinkingLevel: 'low' } : { thinkingBudget: 0 }
}

type GemResp = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

// A single Gemini request part: text, or inline binary (e.g. audio) as base64.
// snake_case (inline_data/mime_type) matches the working image-import request.
type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } }

async function callGeminiOnce(
  model: string,
  parts: GeminiPart[],
  options: { temperature?: number },
): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: options.temperature ?? 0.1,
        // Headroom so any thinking can't starve the JSON output.
        maxOutputTokens: 8192,
        thinkingConfig: thinkingConfigFor(model),
        responseMimeType: 'application/json',
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.error('gemini.http_error', { model, status: res.status, error: body.slice(0, 200) })
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
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'
    // Don't dump `data` — it can carry extracted content. Reason is enough.
    log.error('gemini.empty_response', { model, reason })
    throw new Error(`Gemini returned no text (finishReason: ${reason})`)
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    // Don't dump `text` — it's the model's (user-derived) output. Length only.
    log.error('gemini.parse_failed', { model, len: text.length })
    throw new Error(`Gemini returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Statuses worth retrying / failing over: 429 (rate limit), 503 (overloaded),
// 500 (INTERNAL — Gemini returns these transiently), and 404 (observed when
// Google's backend briefly mis-routes a valid model request to a non-existent
// internal model, e.g. "gemini-v4p1s-rev24-ajax-sentinel" — retrying the same
// (correct) model name routes to a healthy backend). Backoff per same-model
// retry, in ms; the array length sets the retry count. Kept short — we fail
// over too.
const RETRYABLE_STATUSES = new Set([404, 429, 500, 503])
const RETRY_BACKOFFS_MS = [1200]

async function callGeminiChain(
  models: string[],
  parts: GeminiPart[],
  options: { temperature?: number },
): Promise<unknown> {
  let lastErr: unknown
  for (let m = 0; m < models.length; m++) {
    const model = models[m]
    const hasFallback = m < models.length - 1
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
        // Same-model retries exhausted. If it's a transient status and another
        // model is available, fail over to it; otherwise give up.
        if (retryable && hasFallback) {
          log.warn('gemini.failover', { from: model, to: models[m + 1], status })
          break
        }
        throw e
      }
    }
  }
  throw lastErr
}

export async function callGemini(prompt: string, options: { temperature?: number } = {}): Promise<unknown> {
  return callGeminiChain(TEXT_MODELS, [{ text: prompt }], options)
}

export async function callGeminiWithAudio(
  prompt: string,
  audioBase64: string,
  mimeType: string,
  options: { temperature?: number } = {},
): Promise<unknown> {
  return callGeminiChain(
    AUDIO_MODELS,
    [{ inline_data: { mime_type: mimeType, data: audioBase64 } }, { text: prompt }],
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
  } catch (e) {
    // Silent give-up — items fall back to 'ovrigt' — but count it.
    log.warn('categorize.gave_up', { count: names.length, error: String((e as Error)?.message ?? e) })
    return {}
  }
}
