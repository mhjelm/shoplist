'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addItem(listId: string, name: string, pictureUrl?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('items').insert({
    list_id: listId,
    added_by: user.id,
    name: name.trim(),
    picture_url: pictureUrl?.trim() || null,
  })

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function updateItem(
  itemId: string,
  listId: string,
  patch: { name?: string; picture_url?: string | null }
) {
  const supabase = await createClient()
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if ('picture_url' in patch) update.picture_url = patch.picture_url?.trim() || null

  const { error } = await supabase.from('items').update(update).eq('id', itemId)
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

export async function deleteItem(itemId: string, listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function restoreItem(itemId: string, listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .update({ is_checked: false, deleted_at: null })
    .eq('id', itemId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function clearShoppedItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .eq('is_checked', true)
    .is('deleted_at', null)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}

export async function clearDeletedItems(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('items')
    .delete()
    .eq('list_id', listId)
    .not('deleted_at', 'is', null)

  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
}
