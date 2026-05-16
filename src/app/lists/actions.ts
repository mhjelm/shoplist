'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createList(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const name = (formData.get('name') as string)?.trim()
  if (!name) return { error: 'Name is required' }

  const { data: list, error } = await supabase.from('lists').insert({
    name,
    owner_id: user.id,
  }).select().single()

  if (error) return { error: error.message }
  revalidatePath('/lists')
  return { list }
}

export async function deleteList(listId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('lists').delete().eq('id', listId)
  if (error) return { error: error.message }
  revalidatePath('/lists')
}

export async function inviteMember(listId: string, email: string) {
  const supabase = await createClient()

  const { data: userId, error: lookupError } = await supabase
    .rpc('find_user_by_email', { p_email: email })

  if (lookupError || !userId) return { error: 'User not found' }

  const { error } = await supabase.from('list_members').insert({ list_id: listId, user_id: userId })
  if (error) return { error: error.message }

  revalidatePath(`/lists/${listId}`)
}

export async function removeMember(listId: string, userId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('list_members')
    .delete()
    .eq('list_id', listId)
    .eq('user_id', userId)
  if (error) return { error: error.message }
  revalidatePath(`/lists/${listId}`)
  return { error: null }
}

export async function leaveList(listId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('list_members')
    .delete()
    .eq('list_id', listId)
    .eq('user_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/lists')
}

export async function fetchListMembers(listId: string): Promise<Array<{ user_id: string; email: string; added_at: string }>> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_list_members', { p_list_id: listId })
  return (data ?? []) as Array<{ user_id: string; email: string; added_at: string }>
}

export async function fetchMyInvitees(): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('get_my_invitee_emails')
  return (data ?? []).map((r: { email: string }) => r.email)
}
