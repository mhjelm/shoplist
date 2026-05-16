import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import ItemList from './ItemList'
import LeaveListButton from './LeaveListButton'
import { getUserPreferences } from '@/lib/preferences'
import { EditModeProvider, EditModeToggle } from './EditModeContext'
import OfflineBadge from '@/components/OfflineBadge'

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
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  const { data: history } = await supabase
    .from('user_item_history')
    .select('name')
    .eq('user_id', user.id)
    .order('use_count', { ascending: false })
    .limit(200)

  // RLS filters to lists the user owns or is a member of.
  const { data: otherLists } = await supabase
    .from('lists')
    .select('id, name, owner_id, created_at')
    .neq('id', id)
    .order('created_at', { ascending: false })

  const suggestions = history?.map(h => h.name) ?? []
  const isOwner = list.owner_id === user.id
  const { list_text_size, category_order } = await getUserPreferences()

  return (
    <EditModeProvider>
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link href="/lists" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">←</Link>
        <h1 className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{list.name}</h1>
        <OfflineBadge />
        <EditModeToggle />
        {!isOwner && <LeaveListButton listId={id} />}
      </header>

      <main className="w-full max-w-lg mx-auto px-4 py-6 space-y-6">
        <ItemList
          list={list}
          initialItems={items ?? []}
          listId={id}
          suggestions={suggestions}
          textSize={list_text_size}
          categoryOrder={category_order}
          availableLists={otherLists ?? []}
          currentUserId={user.id}
        />

      </main>
    </div>
    </EditModeProvider>
  )
}
