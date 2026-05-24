// Barrel re-export so external imports of `@/app/lists/[id]/actions` keep
// working. Each underlying file carries its own 'use server' directive, which
// is what marks the re-exported functions as server actions. This barrel must
// NOT itself be `'use server'` — Next.js only allows `export async function`
// declarations in `'use server'` files, never `export { ... } from ...`.
export {
  addItem,
  categorizeItem,
  deleteHistoryItem,
  setItemCategory,
  updateItem,
  toggleItem,
  reorderItem,
  clearShoppedItems,
  deleteItem,
  mergeItems,
  clearAllItems,
} from './items'

export {
  addItems,
  extractAddItems,
  extractRecipeItems,
  extractListItemsFromImage,
} from './import'

export {
  copyItemsToList,
  moveItemsToList,
  shareItemsToList,
} from './cross-list'

export { touchListView } from './views'

export {
  suggestItemName,
  uploadImage,
} from './upload'
