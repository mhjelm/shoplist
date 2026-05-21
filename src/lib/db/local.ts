import Dexie, { type Table } from 'dexie'
import type { LocalList, LocalItem, LocalListMember, LocalHistory, LocalPrefs, OutboxEntry, SyncMeta, LocalListCatalog, LocalListView } from './types'

class LocalDB extends Dexie {
  lists!: Table<LocalList>
  items!: Table<LocalItem>
  list_members!: Table<LocalListMember>
  user_item_history!: Table<LocalHistory>
  user_preferences!: Table<LocalPrefs>
  outbox!: Table<OutboxEntry>
  sync_meta!: Table<SyncMeta>
  list_catalog!: Table<LocalListCatalog>
  list_views!: Table<LocalListView>

  constructor() {
    super('shoplist')
    this.version(1).stores({
      lists: 'id, owner_id',
      items: 'id, list_id, [list_id+is_checked], updated_at',
      list_members: '[list_id+user_id], list_id',
      user_item_history: '[user_id+name_lower], user_id',
      user_preferences: 'user_id',
      outbox: '++seq, status, list_id, created_at',
      sync_meta: 'list_id',
    })
    this.version(2).stores({
      list_catalog: 'id, owner_id',
      list_views: 'list_id',
    })
  }
}

export const localDB = new LocalDB()
