'use client'

import type { ListPerson } from '@/lib/types'

// Deterministic avatar color per user, so the same person reads the same across
// rows. Indigo-leaning palette to match the task theme.
const COLORS = ['#0ea5e9', '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6']

function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export function emailToInitial(email: string): string {
  const trimmed = email.trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}

export function TaskAvatar({
  assigneeId,
  people,
  size = 24,
}: {
  assigneeId: string | null
  people: ListPerson[]
  size?: number
}) {
  const dim = { width: size, height: size, fontSize: Math.round(size * 0.45) }

  if (!assigneeId) {
    return (
      <span
        aria-label="Unassigned"
        title="Unassigned"
        style={dim}
        className="shrink-0 grid place-items-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-semibold"
      >
        ?
      </span>
    )
  }

  const person = people.find(p => p.user_id === assigneeId)
  const label = person?.email ?? 'Unknown'
  return (
    <span
      aria-label={`Assigned to ${label}`}
      title={label}
      style={{ ...dim, background: colorFor(assigneeId) }}
      className="shrink-0 grid place-items-center rounded-full text-white font-bold"
    >
      {person ? emailToInitial(person.email) : '·'}
    </span>
  )
}
