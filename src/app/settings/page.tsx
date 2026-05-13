import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserPreferences } from '@/lib/preferences'
import SettingsForm from './SettingsForm'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { theme, list_text_size } = await getUserPreferences()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link href="/lists" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">←</Link>
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <SettingsForm initialTheme={theme} initialListTextSize={list_text_size} />
      </main>
    </div>
  )
}
