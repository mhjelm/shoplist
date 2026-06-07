// Pure normalisation for the spoken-task extraction flow (extractTasksFromAudio
// in src/app/lists/[id]/actions/import.ts). Lives here (not in the 'use server'
// actions file, where every export must be an async function) so it stays a
// plain, directly unit-testable helper. Parallels normalizeExtractedItems for
// the grocery flow.

const MAX_TASK_LEN = 200
const MAX_TASKS = 50

/**
 * Validate/normalise the raw Gemini `tasks` array into clean task names:
 * strings only, trimmed, length-clamped, deduped case-insensitively (first
 * wins), and capped at MAX_TASKS.
 */
export function normalizeTaskNames(parsed: { tasks?: unknown }): string[] {
  if (!Array.isArray(parsed.tasks)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of parsed.tasks) {
    if (typeof t !== 'string') continue
    const name = t.trim().slice(0, MAX_TASK_LEN)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= MAX_TASKS) break
  }
  return out
}
