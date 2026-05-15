'use client'

import { useEffect } from 'react'
import { localDB } from '@/lib/db/local'

export default function SyncProvider() {
  useEffect(() => {
    // Open the Dexie database on first client render. Dexie.open() is idempotent.
    localDB.open().catch(err => console.error('LocalDB open failed:', err))
  }, [])

  return null
}
