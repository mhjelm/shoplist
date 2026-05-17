'use client'

interface Props {
  count: number
  isOffline: boolean
  onCopy: () => void
  onMove: () => void
  onClear: () => void
}

export function SelectionBar({ count, isOffline, onCopy, onMove, onClear }: Props) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 pt-3 flex items-center gap-2 shadow-lg"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 min-w-0">{count} valda</span>
      <button
        onClick={onCopy}
        disabled={isOffline}
        title={isOffline ? 'Kräver anslutning' : undefined}
        className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
      >
        Kopiera till…
      </button>
      <button
        onClick={onMove}
        disabled={isOffline}
        title={isOffline ? 'Kräver anslutning' : undefined}
        className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40"
      >
        Flytta till…
      </button>
      <button
        onClick={onClear}
        aria-label="Avmarkera alla"
        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none px-1"
      >
        ×
      </button>
    </div>
  )
}
