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
    // v3: items gain `shared_group_id` (no index needed — cascades are
    // server-side; Dexie just stores the field).
    this.version(3).stores({})
    // v4: list_catalog gains `last_activity_by` (no new index needed).
    this.version(4).stores({})
    // v5: list_catalog swaps `last_activity`/`last_activity_by` for the add-only
    // `last_add_at`/`last_add_by` signal (migration 0024). Non-indexed fields, so
    // no schema change — old rows are harmlessly overwritten on the next seed.
    this.version(5).stores({})
    // v6: task lists (migration 0025) — list_catalog gains `kind`, items gain
    // `assignee_id`/`due_date`. All non-indexed, so no index change; rows are
    // overwritten on the next seed/reconcile.
    this.version(6).stores({})
    // v7: notes/scrapbook lists (migration 0029) — items gain `url`/`note`.
    // Non-indexed, so no index change; rows are overwritten on the next
    // seed/reconcile.
    this.version(7).stores({})
  }
}

export const localDB = new LocalDB()
