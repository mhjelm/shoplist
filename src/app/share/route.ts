import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractRecipeItems, extractListItemsFromImage, unfurlLink } from '@/app/lists/[id]/actions'
import { firstUrlIn } from '@/lib/notesView'
import { log } from '@/lib/log'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', req.url), 303)
  }

  const form = await req.formData()
  const text = (form.get('text') ?? '').toString().trim()
  const url = (form.get('url') ?? '').toString().trim()
  const title = (form.get('title') ?? '').toString().trim()
  const image = form.get('image')

  const hasImage = image instanceof File && image.size > 0
  // A link share: the `url` field, or the first URL found anywhere in `text`
  // (many apps share "some text https://…" with the url field empty).
  const linkUrl = url || firstUrlIn(text)

  log.info('share.received', {
    hasImage,
    hasUrl: !!url,
    hasText: !!text,
    hasTitle: !!title,
    textHasUrl: !!firstUrlIn(text),
  })

  // --- Image path: grocery extraction (unchanged) ---
  if (hasImage) {
    const fd = new FormData()
    fd.append('image', image as File)
    const result = await extractListItemsFromImage(fd)
    if (result.error) {
      log.warn('share.extract_failed', { source: 'image', error: result.error })
      return NextResponse.redirect(new URL('/lists?shareError=extract', req.url), 303)
    }
    const items = result.items ?? []
    if (items.length === 0) {
      return NextResponse.redirect(new URL('/lists?shareError=empty', req.url), 303)
    }
    const { data: row, error: insertError } = await supabase
      .from('pending_imports')
      .insert({ user_id: user.id, items, source: 'image' })
      .select('id')
      .single()
    if (insertError || !row) {
      log.error('share.insert_failed', { code: insertError?.code, error: insertError?.message })
      return NextResponse.redirect(new URL('/lists?shareError=db', req.url), 303)
    }
    return NextResponse.redirect(new URL(`/share/${row.id}`, req.url), 303)
  }

  // --- Link path ---
  // Recipe extraction (for shopping/task targets — the reviewable checklist) and
  // unfurl (for the picker's rich preview + the scrap) run in PARALLEL: both parse
  // the same page, so this bounds latency to the slower of the two. A non-recipe
  // link yields [] items (no bail) and just becomes a scrap; the unfurl is stored
  // so the picker shows a preview immediately and confirm needn't re-fetch.
  if (linkUrl) {
    const [recipe, meta] = await Promise.all([
      extractRecipeItems(linkUrl),
      unfurlLink(linkUrl),
    ])
    if (recipe.error) log.warn('share.extract_failed', { source: 'link', error: recipe.error })
    const items = recipe.items ?? []
    const unfurl = (!meta.error && (meta.title || meta.description || meta.image))
      ? { title: meta.title ?? null, description: meta.description ?? null, image: meta.image ?? null }
      : null
    const { data: row, error: insertError } = await supabase
      .from('pending_imports')
      .insert({ user_id: user.id, items, source: 'link', url: linkUrl, title: unfurl?.title || title || null, unfurl })
      .select('id')
      .single()
    if (insertError || !row) {
      log.error('share.insert_failed', { code: insertError?.code, error: insertError?.message })
      return NextResponse.redirect(new URL('/lists?shareError=db', req.url), 303)
    }
    return NextResponse.redirect(new URL(`/share/${row.id}`, req.url), 303)
  }

  // --- Plain text path: grocery extraction ---
  const payload = text || title
  if (!payload) {
    return NextResponse.redirect(new URL('/lists?shareError=empty', req.url), 303)
  }
  const result = await extractRecipeItems(payload)
  if (result.error) {
    log.warn('share.extract_failed', { source: 'text', error: result.error })
    return NextResponse.redirect(new URL('/lists?shareError=extract', req.url), 303)
  }
  const items = result.items ?? []
  if (items.length === 0) {
    return NextResponse.redirect(new URL('/lists?shareError=empty', req.url), 303)
  }
  const { data: row, error: insertError } = await supabase
    .from('pending_imports')
    .insert({ user_id: user.id, items, source: 'text' })
    .select('id')
    .single()
  if (insertError || !row) {
    log.error('share.insert_failed', { code: insertError?.code, error: insertError?.message })
    return NextResponse.redirect(new URL('/lists?shareError=db', req.url), 303)
  }
  return NextResponse.redirect(new URL(`/share/${row.id}`, req.url), 303)
}
