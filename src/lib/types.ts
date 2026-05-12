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

export interface Item {
  id: string
  list_id: string
  added_by: string
  name: string
  is_checked: boolean
  created_at: string
}
