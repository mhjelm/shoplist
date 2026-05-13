import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Theme, ListTextSize } from '@/lib/types'

export interface ResolvedPreferences {
  theme: Theme
  list_text_size: ListTextSize
}

export const DEFAULT_PREFERENCES: ResolvedPreferences = {
  theme: 'light',
  list_text_size: 'normal',
}

export const getUserPreferences = cache(async (): Promise<ResolvedPreferences> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return DEFAULT_PREFERENCES

  const { data } = await supabase
    .from('user_preferences')
    .select('theme, list_text_size')
    .eq('user_id', user.id)
    .maybeSingle()

  return data ?? DEFAULT_PREFERENCES
})
