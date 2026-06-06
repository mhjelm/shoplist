export type ListKind = 'shopping' | 'task'

export interface List {
  id: string
  name: string
  owner_id: string
  created_at: string
  kind: ListKind
}

export interface ListMember {
  list_id: string
  user_id: string
  added_at: string
}

// A person who can be assigned a task on a list (owner ∪ members). Resolved
// server-side via the get_list_people RPC (migration 0025).
export interface ListPerson {
  user_id: string
  email: string
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
  shared_group_id: string | null
  // Task-list fields (null/ignored for shopping items). See migration 0025.
  assignee_id: string | null
  due_date: string | null
}

export type Theme = 'light' | 'dark' | 'shoplist' | 'polar' | 'dusk'
export type ListTextSize = 'normal' | 'large' | 'x-large' | 'large-store-xlarge'

export interface UserPreferences {
  user_id: string
  theme: Theme
  list_text_size: ListTextSize
  high_contrast: boolean
  reduce_motion: boolean
  updated_at: string
}
