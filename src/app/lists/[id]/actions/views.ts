'use server'

import { revalidatePath } from 'next/cache'
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
  revalidatePath('/lists')
  return {}
}
