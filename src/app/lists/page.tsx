import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { logout } from '../auth/actions'
import CreateListForm from './CreateListForm'
import DeleteListButton from './DeleteListButton'

export default async function ListsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: lists } = await supabase
    .from('lists')
    .select('*')
    .order('created_at', { ascending: false })

  const myLists = lists?.filter(l => l.owner_id === user.id) ?? []
  const sharedLists = lists?.filter(l => l.owner_id !== user.id) ?? []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Shopping Lists</h1>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Settings</Link>
          <form action={logout}>
            <button className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Sign out</button>
          </form>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        <CreateListForm />

        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">My lists</h2>
          {myLists.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No lists yet.</p>
          ) : (
            <ul className="space-y-2">
              {myLists.map(list => (
                <li key={list.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
                  <Link href={`/lists/${list.id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 flex-1 min-w-0 truncate">
                    {list.name}
                    {list.is_shared && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">shared</span>}
                  </Link>
                  <DeleteListButton listId={list.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {sharedLists.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Shared with me</h2>
            <ul className="space-y-2">
              {sharedLists.map(list => (
                <li key={list.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                  <Link href={`/lists/${list.id}`} className="block px-4 py-3 font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
                    {list.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
