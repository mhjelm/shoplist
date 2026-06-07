'use client'

import { useEffect } from 'react'
import { log } from '@/lib/log'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return
    navigator.serviceWorker.register('/sw.js').catch(err => {
      log.warn('sw.register_failed', { error: String(err?.message ?? err) })
    })
  }, [])
  return null
}
