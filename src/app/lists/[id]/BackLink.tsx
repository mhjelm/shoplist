'use client'

import { useRouter } from 'next/navigation'

export function BackLink() {
  const router = useRouter()
  const onClick = () => {
    // Prefer history pop so we land on the previous /lists render instantly
    // with its scroll position restored. Fall back to a push for deep-links
    // that have no in-app history.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/lists')
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Tillbaka"
      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 -ml-1 px-1"
    >
      ←
    </button>
  )
}
