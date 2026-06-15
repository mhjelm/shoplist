import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ShareImportClient from './ShareImportClient'
import ShareGone from './ShareGone'

interface Props {
  params: Promise<{ importId: string }>
}

type StoredItem = { name: string; category: string | null; measurement: string | null }
type UnfurlMeta = { title: string | null; description: string | null; image: string | null }

export default async function SharePage({ params }: Props) {
  const { importId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: pending } = await supabase
    .from('pending_imports')
    .select('id, items, source, url, title, unfurl')
    .eq('id', importId)
    .single()
  if (!pending) return <ShareGone />

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name, owner_id, kind')
    .order('created_at', { ascending: false })

  return (
    <ShareImportClient
      importId={pending.id}
      items={(pending.items as StoredItem[]) ?? []}
      source={pending.source as 'image' | 'url' | 'text' | 'link'}
      url={(pending.url as string | null) ?? null}
      title={(pending.title as string | null) ?? null}
      unfurl={(pending.unfurl as UnfurlMeta | null) ?? null}
      lists={lists ?? []}
      currentUserId={user.id}
    />
  )
}
