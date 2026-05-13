'use client'

import { useState, useTransition } from 'react'
import type { Theme, ListTextSize } from '@/lib/types'
import { updateSettings } from './actions'

interface Props {
  initialTheme: Theme
  initialListTextSize: ListTextSize
}

export default function SettingsForm({ initialTheme, initialListTextSize }: Props) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [size, setSize] = useState<ListTextSize>(initialListTextSize)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(nextTheme: Theme, nextSize: ListTextSize) {
    setError(null)
    startTransition(async () => {
      const result = await updateSettings(nextTheme, nextSize)
      if (result?.error) setError(result.error)
    })
  }

  function pickTheme(next: Theme) {
    setTheme(next)
    save(next, size)
  }

  function pickSize(next: ListTextSize) {
    setSize(next)
    save(theme, next)
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Theme</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <OptionRow
            label="Light"
            sublabel="Default"
            selected={theme === 'light'}
            onSelect={() => pickTheme('light')}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Dark"
            selected={theme === 'dark'}
            onSelect={() => pickTheme('dark')}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">List text size</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <OptionRow
            label="Normal"
            sublabel="Default"
            selected={size === 'normal'}
            onSelect={() => pickSize('normal')}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Large"
            selected={size === 'large'}
            onSelect={() => pickSize('large')}
          />
        </div>
      </section>

      <p className="text-xs text-gray-400 dark:text-gray-500 h-4">
        {pending ? 'Saving…' : error ? <span className="text-red-500 dark:text-red-400">{error}</span> : ''}
      </p>
    </div>
  )
}

interface OptionRowProps {
  label: string
  sublabel?: string
  selected: boolean
  onSelect: () => void
}

function OptionRow({ label, sublabel, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      <span className="flex items-center gap-2">
        <span className="text-sm text-gray-900 dark:text-gray-100">{label}</span>
        {sublabel && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{sublabel}</span>
        )}
      </span>
      <span
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${selected ? 'border-blue-600 dark:border-blue-400' : 'border-gray-300 dark:border-gray-600'}`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />}
      </span>
    </button>
  )
}
