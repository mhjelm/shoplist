import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractRecipeItems, extractListItemsFromImage } from '@/app/lists/[id]/actions'
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

  let items: Array<{ name: string; category: string | null; measurement: string | null }> = []
  let source: 'image' | 'url' | 'text' = 'text'
  let extractError: string | undefined

  if (image instanceof File && image.size > 0) {
    source = 'image'
    const fd = new FormData()
    fd.append('image', image)
    const result = await extractListItemsFromImage(fd)
    if (result.error) extractError = result.error
    else items = result.items ?? []
  } else {
    const payload = url || text || title
    if (!payload) {
      return NextResponse.redirect(new URL('/lists?shareError=empty', req.url), 303)
    }
    source = url ? 'url' : 'text'
    const result = await extractRecipeItems(payload)
    if (result.error) extractError = result.error
    else items = result.items ?? []
  }

  if (extractError) {
    log.warn('share.extract_failed', { source, error: extractError })
    return NextResponse.redirect(new URL('/lists?shareError=extract', req.url), 303)
  }

  if (items.length === 0) {
    return NextResponse.redirect(new URL('/lists?shareError=empty', req.url), 303)
  }

  const { data: row, error: insertError } = await supabase
    .from('pending_imports')
    .insert({ user_id: user.id, items, source })
    .select('id')
    .single()

  if (insertError || !row) {
    log.error('share.insert_failed', { code: insertError?.code, error: insertError?.message })
    return NextResponse.redirect(new URL('/lists?shareError=db', req.url), 303)
  }

  return NextResponse.redirect(new URL(`/share/${row.id}`, req.url), 303)
}
