'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { addItems, unfurlLink, extractRecipeItems } from '@/app/lists/[id]/actions'
import type { ListKind } from '@/lib/types'

type Destination =
  | { kind: 'existing'; listId: string }
  | { kind: 'new'; name: string; listKind: ListKind }

// Shared helper: resolve or create the destination list.
// Returns { listId } on success, { error } on failure.
async function resolveList(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  destination: Destination,
): Promise<{ listId: string } | { error: string }> {
  if (destination.kind === 'existing') {
    return { listId: destination.listId }
  }
  const name = destination.name.trim()
  if (!name) return { error: 'List name is required' }
  const listKind: ListKind = destination.listKind === 'task' ? 'task'
    : destination.listKind === 'notes' ? 'notes'
    : 'shopping'
  const { data: list, error } = await supabase
    .from('lists')
    .insert({ name, owner_id: userId, kind: listKind })
    .select('id')
    .single()
  if (error || !list) return { error: error?.message ?? 'Could not create list' }
  return { listId: list.id }
}

export async function confirmShareImport(
  importId: string,
  destination: Destination,
  items: Array<{ name: string; category: string | null; measurement: string | null }>,
) {
  if (!items.length) return { error: 'No items selected' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const resolved = await resolveList(supabase, user.id, destination)
  if ('error' in resolved) return resolved

  const addResult = await addItems(resolved.listId, items)
  if (addResult.error) return { error: addResult.error }

  await supabase.from('pending_imports').delete().eq('id', importId)

  redirect(`/lists/${resolved.listId}`)
}

// A shared link aimed at a shopping/task list: extract recipe/list items from
// the URL (Gemini) and add them. Extraction runs here (at confirm) so the picker
// stays instant and we don't pay for it when the user just wants a scrap.
export async function confirmShareLinkAsRecipe(
  importId: string,
  destination: Destination,
  link: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Extract first — so a failed/empty extraction doesn't leave a stray new list.
  const extracted = await extractRecipeItems(link)
  if (extracted.error) return { error: extracted.error }
  const items = extracted.items ?? []
  if (items.length === 0) {
    return { error: 'Inga varor kunde hittas i länken. Spara den som ett klipp i stället?' }
  }

  const resolved = await resolveList(supabase, user.id, destination)
  if ('error' in resolved) return resolved

  const addResult = await addItems(resolved.listId, items)
  if (addResult.error) return { error: addResult.error }

  await supabase.from('pending_imports').delete().eq('id', importId)

  redirect(`/lists/${resolved.listId}`)
}

type LinkDestination =
  | { kind: 'existing'; listId: string }
  | { kind: 'new'; name: string }

export async function confirmShareLink(
  importId: string,
  destination: LinkDestination,
  link: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Resolve or create the destination — a new list is always a notes list.
  const resolved = await resolveList(
    supabase,
    user.id,
    destination.kind === 'new'
      ? { kind: 'new', name: destination.name, listKind: 'notes' }
      : { kind: 'existing', listId: destination.listId },
  )
  if ('error' in resolved) return resolved
  const listId = resolved.listId

  // Best-effort unfurl; fall back to raw link on failure.
  const meta = await unfurlLink(link)
  const name = meta.title || link
  const note = meta.description ?? null
  const picture_url = meta.image ?? null

  const { error: insertError } = await supabase
    .from('items')
    .insert({
      list_id: listId,
      added_by: user.id,
      name,
      url: link,
      note,
      picture_url,
    })
  if (insertError) return { error: insertError.message }

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
