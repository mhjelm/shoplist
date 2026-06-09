import Link from 'next/link'

// Shown when a share-import has no live pending_imports row: already
// confirmed/cancelled, refreshed after the fact, double-submitted, or a
// stale/invalid link. Replaces the old notFound() (BUG-001) so navigating Back
// onto /share/[importId] lands here instead of a 404.
export default function ShareGone() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Importera delning</h1>
      </header>
      <main className="max-w-lg mx-auto px-4 py-12 flex flex-col items-center text-center gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Den här delningen är redan hanterad eller hittades inte.
        </p>
        <Link
          href="/lists"
          className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
        >
          Till mina listor
        </Link>
      </main>
    </div>
  )
}
