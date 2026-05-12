import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import ItemList from './ItemList'
import InviteForm from './InviteForm'
import LeaveListButton from './LeaveListButton'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ListPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: list } = await supabase.from('lists').select('*').eq('id', id).single()
  if (!list) notFound()

  const { data: items } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', id)
    .order('created_at', { ascending: true })

  const { data: history } = await supabase
    .from('user_item_history')
    .select('name')
    .eq('user_id', user.id)
    .order('use_count', { ascending: false })
    .limit(200)

  const suggestions = history?.map(h => h.name) ?? []
  const isOwner = list.owner_id === user.id

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link href="/lists" className="text-gray-400 hover:text-gray-600">←</Link>
        <h1 className="font-semibold text-gray-900 flex-1 min-w-0 truncate">{list.name}</h1>
        {!isOwner && <LeaveListButton listId={id} />}
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <ItemList
          initialItems={items ?? []}
          listId={id}
          isShared={list.is_shared}
          suggestions={suggestions}
        />

        {isOwner && list.is_shared && (
          <section>
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Invite member</h2>
            <InviteForm listId={id} />
          </section>
        )}
      </main>
    </div>
  )
}
