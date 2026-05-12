'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addItem(listId: string, name: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('items').insert({
    list_id: listId,
    added_by: user.id,
    name: name.trim(),
  })

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function toggleItem(itemId: string, listId: string, checked: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ is_checked: checked })
    .eq('id', itemId)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function deleteCheckedItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .eq('is_checked', true)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}
