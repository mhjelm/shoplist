export default function ListsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
        <h1 className="font-semibold text-gray-900 dark:text-gray-100">Shopping Lists</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Settings</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">Sign out</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-8">
        {/* Match CreateListForm row height so layout doesn't jump when data arrives. */}
        <div className="h-10 rounded-lg bg-gray-100 dark:bg-gray-900 animate-pulse" aria-hidden />
        <section>
          <div className="h-4 w-20 mb-3 rounded bg-gray-200 dark:bg-gray-800 animate-pulse" aria-hidden />
          <ul className="space-y-2">
            <li className="h-14 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 animate-pulse" aria-hidden />
            <li className="h-14 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 animate-pulse" aria-hidden />
            <li className="h-14 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 animate-pulse" aria-hidden />
          </ul>
        </section>
      </main>
    </div>
  )
}
