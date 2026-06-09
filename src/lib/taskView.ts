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

/** The two task-list sort views. Persisted per-user-per-list on `list_views`. */
export type TaskSort = 'manual' | 'date'

/**
 * Manual / added order: by `sort_order` ascending (null sorts last), then
 * `created_at` as a stable tiebreak. This is what the drag-reorderable Manual
 * view shows — deliberately ignoring due dates (those drive the By-date view).
 */
export function sortTasksManual(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const ao = a.sort_order ?? Infinity
    const bo = b.sort_order ?? Infinity
    if (ao !== bo) return ao - bo
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  })
}

export type TaskSectionTone = 'over' | 'today' | 'soon' | 'future' | 'none'

export interface TaskSection {
  key: string
  label: string
  tone: TaskSectionTone
  items: Item[]
}

/**
 * Groups undone tasks into date buckets for the By-date view, in display order:
 * Overdue → Today → Tomorrow → one section per weekday within the next week
 * (diff 2–6, labelled e.g. "Wednesday") → Later (≥1 week) → No date. Only
 * non-empty sections are returned; items within a section keep the due/created
 * sort. Pass `done` tasks separately — this is for the to-do stream only.
 */
export function taskDateSections(items: Item[], now: Date = new Date()): TaskSection[] {
  const today = startOfDay(now)
  const overdue: Item[] = []
  const todayItems: Item[] = []
  const tomorrow: Item[] = []
  const weekdays = new Map<number, Item[]>() // diffDays 2..6 → items
  const later: Item[] = []
  const noDate: Item[] = []

  for (const it of items) {
    const due = it.due_date ? parseYMD(it.due_date) : null
    if (!due) { noDate.push(it); continue }
    const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000)
    if (diff < 0) overdue.push(it)
    else if (diff === 0) todayItems.push(it)
    else if (diff === 1) tomorrow.push(it)
    else if (diff <= 6) {
      const arr = weekdays.get(diff) ?? []
      arr.push(it)
      weekdays.set(diff, arr)
    } else later.push(it)
  }

  const sections: TaskSection[] = []
  if (overdue.length) sections.push({ key: 'overdue', label: 'Overdue', tone: 'over', items: sortTasks(overdue) })
  if (todayItems.length) sections.push({ key: 'today', label: 'Today', tone: 'today', items: sortTasks(todayItems) })
  if (tomorrow.length) sections.push({ key: 'tomorrow', label: 'Tomorrow', tone: 'soon', items: sortTasks(tomorrow) })
  for (let diff = 2; diff <= 6; diff++) {
    const arr = weekdays.get(diff)
    if (!arr?.length) continue
    const date = new Date(today.getTime() + diff * 86_400_000)
    sections.push({
      key: `wd-${diff}`,
      label: date.toLocaleDateString('en-US', { weekday: 'long' }),
      tone: 'future',
      items: sortTasks(arr),
    })
  }
  if (later.length) sections.push({ key: 'later', label: 'Later', tone: 'future', items: sortTasks(later) })
  if (noDate.length) sections.push({ key: 'none', label: 'No date', tone: 'none', items: sortTasks(noDate) })
  return sections
}
