'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { addItems } from '@/app/lists/[id]/actions'
import type { ListKind } from '@/lib/types'

type Destination =
  | { kind: 'existing'; listId: string }
  | { kind: 'new'; name: string; listKind: ListKind }

export async function confirmShareImport(
  importId: string,
  destination: Destination,
  items: Array<{ name: string; category: string | null; measurement: string | null }>,
) {
  if (!items.length) return { error: 'No items selected' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  let listId: string
  if (destination.kind === 'new') {
    const name = destination.name.trim()
    if (!name) return { error: 'List name is required' }
    const listKind: ListKind = destination.listKind === 'task' ? 'task' : 'shopping'
    const { data: list, error } = await supabase
      .from('lists')
      .insert({ name, owner_id: user.id, kind: listKind })
      .select('id')
      .single()
    if (error || !list) return { error: error?.message ?? 'Could not create list' }
    listId = list.id
  } else {
    listId = destination.listId
  }

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
