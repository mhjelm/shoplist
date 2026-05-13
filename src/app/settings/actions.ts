'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Theme, ListTextSize } from '@/lib/types'

const THEMES: readonly Theme[] = ['light', 'dark']
const SIZES: readonly ListTextSize[] = ['normal', 'large']

export async function updateSettings(theme: Theme, listTextSize: ListTextSize) {
  if (!THEMES.includes(theme) || !SIZES.includes(listTextSize)) {
    return { error: 'Invalid value' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('user_preferences').upsert({
    user_id: user.id,
    theme,
    list_text_size: listTextSize,
    updated_at: new Date().toISOString(),
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
