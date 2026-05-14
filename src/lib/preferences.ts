import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Theme, ListTextSize } from '@/lib/types'
import { type CategorySlug, DEFAULT_CATEGORY_ORDER, isValidCategorySlug } from './categories'

export interface ResolvedPreferences {
  theme: Theme
  list_text_size: ListTextSize
  category_order: CategorySlug[]
}

export const DEFAULT_PREFERENCES: ResolvedPreferences = {
  theme: 'light',
  list_text_size: 'normal',
  category_order: DEFAULT_CATEGORY_ORDER,
}

export const getUserPreferences = cache(async (): Promise<ResolvedPreferences> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return DEFAULT_PREFERENCES

  const { data } = await supabase
    .from('user_preferences')
    .select('theme, list_text_size, category_order')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return DEFAULT_PREFERENCES

  const rawOrder = data.category_order as string[] | null
  const category_order: CategorySlug[] = Array.isArray(rawOrder) && rawOrder.every(isValidCategorySlug)
    ? rawOrder
    : DEFAULT_CATEGORY_ORDER

  return { theme: data.theme as Theme, list_text_size: data.list_text_size as ListTextSize, category_order }
})
