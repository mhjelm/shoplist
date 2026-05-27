'use client'

import { useState, useTransition } from 'react'
import type { Theme, ListTextSize } from '@/lib/types'
import { type CategorySlug, CATEGORIES, categoryLabel } from '@/lib/categories'
import { updateSettings, updateCategoryOrder } from './actions'
import { useSyncState } from '@/lib/sync/engine'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  initialTheme: Theme
  initialListTextSize: ListTextSize
  initialCategoryOrder: CategorySlug[]
  initialHighContrast: boolean
  initialReduceMotion: boolean
}

export default function SettingsForm({ initialTheme, initialListTextSize, initialCategoryOrder, initialHighContrast, initialReduceMotion }: Props) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [size, setSize] = useState<ListTextSize>(initialListTextSize)
  const [categoryOrder, setCategoryOrder] = useState<CategorySlug[]>(initialCategoryOrder)
  const [highContrast, setHighContrast] = useState<boolean>(initialHighContrast)
  const [reduceMotion, setReduceMotion] = useState<boolean>(initialReduceMotion)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { isOffline } = useSyncState()

  function save(nextTheme: Theme, nextSize: ListTextSize, nextHighContrast: boolean, nextReduceMotion: boolean) {
    setError(null)
    if (isOffline) return
    startTransition(async () => {
      const result = await updateSettings(nextTheme, nextSize, nextHighContrast, nextReduceMotion)
      if (result?.error) setError(result.error)
    })
  }

  function pickTheme(next: Theme) {
    setTheme(next)
    const html = document.documentElement
    html.classList.toggle('dark',     next === 'dark')
    html.classList.toggle('shoplist', next === 'shoplist')
    html.classList.toggle('polar',    next === 'polar')
    html.classList.toggle('dusk',     next === 'dusk')
    save(next, size, highContrast, reduceMotion)
  }

  function pickSize(next: ListTextSize) {
    setSize(next)
    save(theme, next, highContrast, reduceMotion)
  }

  function pickHighContrast(next: boolean) {
    setHighContrast(next)
    document.documentElement.classList.toggle('hc', next)
    save(theme, size, next, reduceMotion)
  }

  function pickReduceMotion(next: boolean) {
    setReduceMotion(next)
    document.documentElement.classList.toggle('reduce-motion', next)
    save(theme, size, highContrast, next)
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categoryOrder.indexOf(active.id as CategorySlug)
    const newIndex = categoryOrder.indexOf(over.id as CategorySlug)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(categoryOrder, oldIndex, newIndex)
    setCategoryOrder(next)
    setError(null)
    if (isOffline) return
    startTransition(async () => {
      const result = await updateCategoryOrder(next)
      if (result?.error) setError(result.error)
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

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
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Shoplist"
            sublabel="Colorful"
            selected={theme === 'shoplist'}
            onSelect={() => pickTheme('shoplist')}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Polar"
            sublabel="Iskall"
            selected={theme === 'polar'}
            onSelect={() => pickTheme('polar')}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Dusk"
            sublabel="Mjuk &amp; varm"
            selected={theme === 'dusk'}
            onSelect={() => pickTheme('dusk')}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">High contrast</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <OptionRow
            label="Off"
            sublabel="Default"
            selected={!highContrast}
            onSelect={() => pickHighContrast(false)}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="On"
            sublabel="Stronger borders and text"
            selected={highContrast}
            onSelect={() => pickHighContrast(true)}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Animationer</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <OptionRow
            label="På"
            sublabel="Standard"
            selected={!reduceMotion}
            onSelect={() => pickReduceMotion(false)}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Av"
            sublabel="Stäng av rörelser och effekter"
            selected={reduceMotion}
            onSelect={() => pickReduceMotion(true)}
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
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Extra large"
            selected={size === 'x-large'}
            onSelect={() => pickSize('x-large')}
          />
          <div className="border-t border-gray-100 dark:border-gray-800" />
          <OptionRow
            label="Extra large in store mode"
            sublabel="Large otherwise"
            selected={size === 'large-store-xlarge'}
            onSelect={() => pickSize('large-store-xlarge')}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Kategoriordning</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Dra för att ändra ordningen på kategorier i inköpslistan.</p>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
            <SortableContext items={categoryOrder} strategy={verticalListSortingStrategy}>
              {categoryOrder.map((slug, idx) => (
                <div key={slug}>
                  {idx > 0 && <div className="border-t border-gray-100 dark:border-gray-800" />}
                  <SortableCategoryRow slug={slug} />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </section>

      <p className="text-xs text-gray-400 dark:text-gray-500 h-4">
        {pending ? 'Saving…' : error ? <span className="text-red-500 dark:text-red-400">{error}</span> : ''}
      </p>
    </div>
  )
}

function SortableCategoryRow({ slug }: { slug: CategorySlug }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slug })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 select-none"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Reorder category"
        className="touch-none cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 -ml-1 px-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
        </svg>
      </button>
      <span className="text-sm text-gray-800 dark:text-gray-200">{categoryLabel(slug)}</span>
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
