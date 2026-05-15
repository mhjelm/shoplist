export interface List {
  id: string
  name: string
  owner_id: string
  is_shared: boolean
  created_at: string
}

export interface ListMember {
  list_id: string
  user_id: string
  added_at: string
}

import type { CategorySlug } from './categories'

export interface Item {
  id: string
  list_id: string
  added_by: string
  name: string
  is_checked: boolean
  created_at: string
  updated_at?: string
  picture_url: string | null
  sort_order: number | null
  quantity: number
  category: CategorySlug | null
  measurement: string | null
}

export type Theme = 'light' | 'dark'
export type ListTextSize = 'normal' | 'large'

export interface UserPreferences {
  user_id: string
  theme: Theme
  list_text_size: ListTextSize
  updated_at: string
}
