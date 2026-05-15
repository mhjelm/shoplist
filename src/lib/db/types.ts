import type { CategorySlug } from '@/lib/categories'

export interface LocalList {
  id: string
  name: string
  owner_id: string
  is_shared: boolean
  created_at: string
}

export interface LocalItem {
  id: string
  list_id: string
  added_by: string
  name: string
  is_checked: boolean
  created_at: string
  updated_at: string
  picture_url: string | null
  sort_order: number | null
  quantity: number
  category: CategorySlug | null
  measurement: string | null
  _pending_local_updated_at?: number
}

export interface LocalListMember {
  list_id: string
  user_id: string
  added_at: string
}

export interface LocalHistory {
  user_id: string
  name_lower: string
  name: string
  last_used_at: string
  use_count: number
  category: CategorySlug | null
}

export interface LocalPrefs {
  user_id: string
  theme: 'light' | 'dark'
  list_text_size: 'normal' | 'large'
  category_order: string[]
  updated_at: string
}

export interface OutboxEntry {
  seq?: number
  list_id: string
  type:
    | 'item.insert'
    | 'item.update'
    | 'item.delete'
    | 'list.insert'
    | 'list.delete'
    | 'item.reorder'
    | 'item.merge'
  payload: unknown
  status: 'pending' | 'in_flight' | 'failed'
  attempts: number
  last_error?: string
  created_at: number
  idempotency_key: string
}

export interface SyncMeta {
  list_id: string
  last_sync_at: string
}
