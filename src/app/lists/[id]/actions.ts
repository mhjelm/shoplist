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

export async function uploadImage(formData: FormData) {
  const file = formData.get('image')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image provided' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Image too large (max 5 MB)' }

  const apiKey = process.env.IMGBB_API_KEY
  if (!apiKey) return { error: 'IMGBB_API_KEY not configured' }

  const body = new FormData()
  body.append('image', file)

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, { method: 'POST', body })
  if (!res.ok) return { error: `ImgBB upload failed (${res.status})` }
  const json = (await res.json()) as { success?: boolean; data?: { url?: string }; error?: { message?: string } }
  if (!json.success || !json.data?.url) return { error: json.error?.message ?? 'Upload failed' }
  return { url: json.data.url }
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
