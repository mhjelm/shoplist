import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import ShareImportClient from './ShareImportClient'

interface Props {
  params: Promise<{ importId: string }>
}

type StoredItem = { name: string; category: string | null; measurement: string | null }

export default async function SharePage({ params }: Props) {
  const { importId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: pending } = await supabase
    .from('pending_imports')
    .select('id, items, source')
    .eq('id', importId)
    .single()
  if (!pending) notFound()

  const { data: lists } = await supabase
    .from('lists')
    .select('id, name, owner_id')
    .order('created_at', { ascending: false })

  return (
    <ShareImportClient
      importId={pending.id}
      items={(pending.items as StoredItem[]) ?? []}
      source={pending.source as 'image' | 'url' | 'text'}
      lists={lists ?? []}
      currentUserId={user.id}
    />
  )
}
