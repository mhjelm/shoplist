export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-center gap-3 py-20 text-gray-500 dark:text-gray-400">
        <span
          className="inline-block w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin"
          aria-hidden
        />
        <span className="text-sm">Laddar…</span>
      </div>
    </div>
  )
}
