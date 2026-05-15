'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { addItems } from '@/app/lists/[id]/actions'

export async function confirmShareImport(
  importId: string,
  listId: string,
  items: Array<{ name: string; category: string | null; measurement: string | null }>,
) {
  if (!items.length) return { error: 'No items selected' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const addResult = await addItems(listId, items)
  if (addResult.error) return { error: addResult.error }

  await supabase.from('pending_imports').delete().eq('id', importId)

  redirect(`/lists/${listId}`)
}

export async function cancelShareImport(importId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  await supabase.from('pending_imports').delete().eq('id', importId)

  redirect('/lists')
}
