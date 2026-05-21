'use client'

export function BackLink() {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let browser handle modifier-key clicks (open in new tab etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    if (typeof window !== 'undefined' && window.history.length > 1) {
      // Native history.back() — no Next router involvement, no RSC fetch,
      // no React reconciliation on the leaving page. Item page does nothing.
      window.history.back()
    } else {
      // Deep-link with no in-app history: fall back to full navigation.
      window.location.assign('/lists')
    }
  }
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/lists"
      onClick={onClick}
      aria-label="Tillbaka"
      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 -ml-1 px-1"
    >
      ←
    </a>
  )
}
