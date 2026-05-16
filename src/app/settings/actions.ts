'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Theme, ListTextSize } from '@/lib/types'
import { DEFAULT_CATEGORY_ORDER, isValidCategorySlug, type CategorySlug } from '@/lib/categories'

const THEMES: readonly Theme[] = ['light', 'dark', 'shoplist']
const SIZES: readonly ListTextSize[] = ['normal', 'large']

export async function updateSettings(theme: Theme, listTextSize: ListTextSize, highContrast: boolean) {
  if (!THEMES.includes(theme) || !SIZES.includes(listTextSize) || typeof highContrast !== 'boolean') {
    return { error: 'Invalid value' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('user_preferences').upsert({
    user_id: user.id,
    theme,
    list_text_size: listTextSize,
    high_contrast: highContrast,
    updated_at: new Date().toISOString(),
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}

export async function updateCategoryOrder(categoryOrder: CategorySlug[]) {
  if (
    categoryOrder.length !== DEFAULT_CATEGORY_ORDER.length ||
    !categoryOrder.every(isValidCategorySlug) ||
    new Set(categoryOrder).size !== categoryOrder.length
  ) {
    return { error: 'Invalid category order' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('user_preferences').upsert({
    user_id: user.id,
    category_order: categoryOrder,
    updated_at: new Date().toISOString(),
  })

  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
}
