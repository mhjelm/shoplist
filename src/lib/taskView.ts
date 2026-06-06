// Pure helpers for the task-list view (see PLAN.md). Kept out of components so
// the date-bucket logic (which drives pill colors) and the due-date sort are
// unit-testable without rendering.
import type { Item } from './types'

export type DueStatus = 'overdue' | 'today' | 'soon' | 'future'

function parseYMD(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Buckets a due date relative to `now` for pill styling:
 * overdue (past), today (0 days), soon (1–2 days), future (>2 days).
 * Returns null when there is no due date (or it's unparseable).
 */
export function dueStatus(dueDate: string | null, now: Date = new Date()): DueStatus | null {
  if (!dueDate) return null
  const due = parseYMD(dueDate)
  if (!due) return null
  const diffDays = Math.round((due.getTime() - startOfDay(now).getTime()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 2) return 'soon'
  return 'future'
}

/** Short human label for a due date: Today / Tomorrow / weekday (within a week) / "MMM D". */
export function formatDueLabel(dueDate: string | null, now: Date = new Date()): string | null {
  if (!dueDate) return null
  const due = parseYMD(dueDate)
  if (!due) return null
  const diffDays = Math.round((due.getTime() - startOfDay(now).getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 1 && diffDays < 7) {
    return due.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * To-do sort: by due date ascending (ISO `YYYY-MM-DD` sorts lexically), undated
 * tasks last, then by created_at ascending as a stable tiebreak.
 */
export function sortTasks(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const ad = a.due_date
    const bd = b.due_date
    if (ad && bd) {
      if (ad !== bd) return ad < bd ? -1 : 1
    } else if (ad) {
      return -1
    } else if (bd) {
      return 1
    }
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
}
