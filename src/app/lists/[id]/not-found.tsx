import Link from 'next/link'

// Rendered when page.tsx calls notFound() — the list row is gone (deleted on
// another device) or RLS no longer returns it (you were removed / left). Without
// this boundary Next falls back to the bare global 404 ("This page could not be
// found"), which is confusing when a list you had open simply got deleted.
export default function ListGone() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Listan finns inte</h1>
      </header>
      <main className="max-w-lg mx-auto px-4 py-12 flex flex-col items-center text-center gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Den här listan har tagits bort eller delas inte längre med dig.
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
