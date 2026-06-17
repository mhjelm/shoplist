import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import ItemList from './ItemList'
import TaskList from './TaskList'
import NoteList from './NoteList'
import ListHeaderMenu from './ListHeaderMenu'
import { NotesSelectProvider } from './NotesSelectContext'
import LeaveListButton from './LeaveListButton'
import { getUserPreferences } from '@/lib/preferences'
import { EditModeProvider, EditModeToggle } from './EditModeContext'
import { StoreModeProvider } from './StoreModeContext'
import OfflineBadge from '@/components/OfflineBadge'
import { BackLink } from './BackLink'

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

  // Items are NOT fetched server-side any more — ItemList reads them from
  // Dexie via useLiveQuery for instant paint on cached lists. Reconcile in
  // the background brings in any server changes (see useListItemsSync).
  const { data: history } = await supabase
    .from('user_item_history')
    .select('name')
    .eq('user_id', user.id)
    .order('use_count', { ascending: false })
    .limit(200)

  // RLS filters to lists the user owns or is a member of. Only shopping lists
  // are valid copy/move targets, so task lists are filtered out below.
  const { data: otherLists } = await supabase
    .from('lists')
    .select('id, name, owner_id, created_at, kind')
    .neq('id', id)
    .order('created_at', { ascending: false })

  // Pre-visit last_viewed_at, read BEFORE the client mount effect bumps it via
  // touchListView — the baseline for the in-list "NEW" dot (items added by
  // others since this timestamp). null = never opened this list.
  const { data: view } = await supabase
    .from('list_views')
    .select('last_viewed_at, task_sort')
    .eq('user_id', user.id)
    .eq('list_id', id)
    .maybeSingle()

  const suggestions = history?.map(h => h.name) ?? []
  const isOwner = list.owner_id === user.id
  const { list_text_size, category_order, theme } = await getUserPreferences()

  // Task lists get a separate, simpler view (no store mode / edit-merge / AI).
  if (list.kind === 'task') {
    const { data: peopleData } = await supabase.rpc('get_list_people', { p_list_id: id })
    const people = (peopleData ?? []) as Array<{ user_id: string; email: string }>
    return (
      <div data-route-root className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
          <BackLink theme={theme} />
          <h1 className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{list.name}</h1>
          <OfflineBadge />
          {!isOwner && <LeaveListButton listId={id} />}
        </header>

        <main className="w-full max-w-lg mx-auto px-4 py-6">
          <TaskList
            list={list}
            listId={id}
            people={people}
            currentUserId={user.id}
            lastViewedAt={view?.last_viewed_at ?? null}
            theme={theme}
            initialSort={view?.task_sort === 'date' ? 'date' : 'manual'}
          />
        </main>
      </div>
    )
  }

  // Scrapbook (notes) lists get their own simple feed view — no store mode /
  // edit-merge / AI, no assignees or due dates. Typed notes, voice memos, links.
  if (list.kind === 'notes') {
    // Valid copy targets for scraps are shopping lists (scraps copy in as
    // grocery items). TargetListModal's "create new" also makes a shopping list.
    const notesCopyTargets = (otherLists ?? []).filter(l => l.kind === 'shopping')
    return (
      <NotesSelectProvider>
      <div data-route-root className="relative min-h-screen bg-gray-50 dark:bg-gray-950">
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
          <BackLink theme={theme} />
          <h1 className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{list.name}</h1>
          <OfflineBadge />
          <ListHeaderMenu listId={id} listName={list.name} isOwner={isOwner} />
          {!isOwner && <LeaveListButton listId={id} />}
        </header>

        <main className="w-full max-w-lg mx-auto px-4 py-6">
          <NoteList
            list={list}
            listId={id}
            currentUserId={user.id}
            lastViewedAt={view?.last_viewed_at ?? null}
            theme={theme}
            availableLists={notesCopyTargets}
          />
        </main>
      </div>
      </NotesSelectProvider>
    )
  }

  // Shopping lists can only copy/move into other shopping lists.
  const shoppingLists = (otherLists ?? []).filter(l => l.kind !== 'task')

  return (
    <StoreModeProvider listId={id}>
    <EditModeProvider>
    <div data-route-root className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <BackLink theme={theme} />
        <h1 className="font-semibold text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{list.name}</h1>
        <OfflineBadge />
        <EditModeToggle />
        {!isOwner && <LeaveListButton listId={id} />}
      </header>

      <main className="w-full max-w-lg mx-auto px-4 py-6 space-y-6">
        <ItemList
          list={list}
          listId={id}
          suggestions={suggestions}
          textSize={list_text_size}
          theme={theme}
          categoryOrder={category_order}
          availableLists={shoppingLists}
          currentUserId={user.id}
          lastViewedAt={view?.last_viewed_at ?? null}
        />

      </main>
    </div>
    </EditModeProvider>
    </StoreModeProvider>
  )
}
