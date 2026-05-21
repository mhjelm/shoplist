import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { logout } from '../auth/actions'
import CreateListForm from './CreateListForm'
import ListsView from './ListsView'
import OfflineBadge from '@/components/OfflineBadge'
import { getUserPreferences } from '@/lib/preferences'
import type { List } from '@/lib/types'

export default async function ListsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Join list_members count so we can show the "shared" badge without the
  // dropped is_shared column. head:true returns just the count, not rows.
  const { data: rawLists } = await supabase
    .from('lists')
    .select('id, name, owner_id, created_at, list_members(count)')
    .order('created_at', { ascending: false })

  // Flatten into List shape + a hasMembers boolean for the badge.
  const lists: List[] = []
  const memberCounts: Record<string, boolean> = {}
  for (const row of rawLists ?? []) {
    const { list_members, ...rest } = row as typeof row & { list_members: Array<{ count: number }> }
    lists.push(rest as List)
    memberCounts[rest.id] = (list_members?.[0]?.count ?? 0) > 0
  }

  // "Unread" indicator: a list shows a dot when its most recent item activity
  // is newer than the user's last_viewed_at (or they've never opened it).
  const [{ data: activityRows }, { data: viewRows }] = await Promise.all([
    supabase.from('list_activity').select('list_id, last_activity'),
    supabase.from('list_views').select('list_id, last_viewed_at').eq('user_id', user.id),
  ])
  // Convert to plain Records for RSC serialization (Map can't cross the boundary)
  const lastActivity: Record<string, string> = {}
  for (const r of activityRows ?? []) lastActivity[r.list_id as string] = r.last_activity as string
  const lastViewed: Record<string, string> = {}
  for (const r of viewRows ?? []) lastViewed[r.list_id as string] = r.last_viewed_at as string

  const { theme } = await getUserPreferences()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Shopping Lists</h1>
        <div className="flex items-center gap-4">
          <OfflineBadge />
          <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Settings</Link>
          <form action={logout}>
            <button className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Sign out</button>
          </form>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        <CreateListForm />
        <ListsView initialLists={lists} memberCounts={memberCounts} lastActivity={lastActivity} lastViewed={lastViewed} theme={theme} currentUserId={user.id} />
      </main>
    </div>
  )
}
