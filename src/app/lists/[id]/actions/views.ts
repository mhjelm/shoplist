'use server'

import { createClient } from '@/lib/supabase/server'

export async function touchListView(listId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase
    .from('list_views')
    .upsert(
      { user_id: user.id, list_id: listId, last_viewed_at: new Date().toISOString() },
      { onConflict: 'user_id,list_id' },
    )
  if (error) return { error: error.message }
  // No revalidatePath — /lists paints instantly from the local Dexie cache
  // (seedListsOverview + touchListViewLocal keep it fresh). Purging the router
  // cache here would make every back-nav block on a server refetch.
  return {}
}

// Persist the per-user, per-list task-sort view ('manual' | 'date') on the
// list_views row. Upserts only task_sort, leaving last_viewed_at intact. RLS
// already scopes list_views to the caller's own row.
export async function setTaskSort(listId: string, mode: 'manual' | 'date'): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const task_sort = mode === 'date' ? 'date' : 'manual'
  const { error } = await supabase
    .from('list_views')
    .upsert(
      { user_id: user.id, list_id: listId, task_sort },
      { onConflict: 'user_id,list_id' },
    )
  if (error) return { error: error.message }
  return {}
}
