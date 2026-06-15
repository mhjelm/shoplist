// Pure helpers for the scrapbook (notes) list view. No DOM / no Supabase, so
// they can be unit-tested in isolation.

// A scrap row is one of:
//   - a link  : `url` set (plus an optional unfurled title/body/image)
//   - a note  : freeform `name` (title) + optional `note` (body)
// `name` is always the bold line on the card; `note` is the longer body.

// True when the whole input is a single bare http(s) URL (no surrounding text).
// Used to decide whether an add should be unfurled into a link card.
export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

// Split typed/spoken freeform text into a title + body. The first non-empty
// line becomes the title (`name`), trimmed to a sane length; everything after
// it becomes the body (`note`), or null when there's nothing left.
export function splitNoteText(text: string): { name: string; note: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { name: '', note: null }

  const lines = trimmed.split('\n')
  let titleIdx = lines.findIndex(l => l.trim().length > 0)
  if (titleIdx < 0) titleIdx = 0

  const rawTitle = lines[titleIdx].trim()
  // Keep the title to a single readable line; overflow falls into the body.
  const MAX_TITLE = 120
  let name = rawTitle
  let bodyPrefix = ''
  if (rawTitle.length > MAX_TITLE) {
    const cut = rawTitle.lastIndexOf(' ', MAX_TITLE)
    const at = cut > 40 ? cut : MAX_TITLE
    name = rawTitle.slice(0, at).trim()
    bodyPrefix = rawTitle.slice(at).trim()
  }

  const rest = lines.slice(titleIdx + 1).join('\n').trim()
  const body = [bodyPrefix, rest].filter(Boolean).join('\n').trim()
  return { name, note: body || null }
}

// Human-friendly host for a link (drops the leading "www."). Returns null when
// the URL can't be parsed.
export function noteHostname(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
