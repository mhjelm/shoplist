import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractRecipeItems, extractListItemsFromImage } from '@/app/lists/[id]/actions'
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
  // Extract recipe/list items best-effort so a recipe link still lands on the
  // reviewable item checklist (the picker shows it for shopping/task targets).
  // A non-recipe link just yields [] — no bail; the picker offers saving it as a
  // scrap instead. The raw url/title ride along so the scrap option can unfurl.
  if (linkUrl) {
    const result = await extractRecipeItems(linkUrl)
    if (result.error) log.warn('share.extract_failed', { source: 'link', error: result.error })
    const items = result.items ?? []
    const { data: row, error: insertError } = await supabase
      .from('pending_imports')
      .insert({ user_id: user.id, items, source: 'link', url: linkUrl, title: title || null })
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
