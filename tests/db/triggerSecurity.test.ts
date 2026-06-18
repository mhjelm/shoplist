import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// REQUIREMENT (regression guard for the 0019 bug — shared-list sync silently
// broke when a non-owner member wrote to a list they don't own).
//
// The trigger functions that write rows on behalf of ANY user — bumping
// last_activity / last_add_at (on `lists`) or history (on `user_item_history`)
// — MUST be SECURITY DEFINER. They run inside an AFTER-INSERT/UPDATE/DELETE
// trigger as whoever performed the write; without SECURITY DEFINER the
// subsequent `update public.lists ...` is subject to the lists_update RLS
// policy (using owner_id = auth.uid()) and is silently filtered to 0 rows for
// non-owner members. That stale last_activity then makes reconcileList's
// precheck skip the items refetch, so cross-owner writes never reach the other
// user's local cache.
//
// `create or replace function` RESETS all attributes, so a later migration that
// redefines one of these functions and forgets `security definer` reverts it to
// the default SECURITY INVOKER (this is exactly how migration 0019 regressed the
// 0017 fix). This test reads the migrations as the source of truth and asserts
// the EFFECTIVE (last) definition of each guarded function is SECURITY DEFINER.
// Do NOT relax it to match a new definition — fix the migration.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations')

// Trigger functions that mutate rows for arbitrary users and therefore must
// bypass RLS via SECURITY DEFINER.
const GUARDED_FUNCTIONS = [
  'bump_list_activity',
  'bump_list_add_activity',
  'bump_item_history',
]

/** All migration SQL concatenated in filename (apply) order. */
function allMigrationsSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
  return files.map(f => readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')).join('\n')
}

/**
 * Returns the header (everything from `create or replace function public.<name>`
 * up to the `as $...$` body delimiter) of the LAST definition of `name`, or null
 * if the function is never defined. The header is where SECURITY DEFINER lives.
 */
function lastDefinitionHeader(sql: string, name: string): string | null {
  // Match each definition's header. Non-greedy up to the first `as $tag$`.
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)([\\s\\S]*?)\\bas\\s+\\$`,
    'gi',
  )
  let last: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) last = m[1]
  return last
}

describe('migration trigger-function security', () => {
  const sql = allMigrationsSql()

  for (const name of GUARDED_FUNCTIONS) {
    it(`${name} is defined`, () => {
      expect(lastDefinitionHeader(sql, name), `public.${name}() must exist`).not.toBeNull()
    })

    it(`${name} is SECURITY DEFINER in its effective (last) definition`, () => {
      const header = lastDefinitionHeader(sql, name)
      expect(header).not.toBeNull()
      expect(
        /security\s+definer/i.test(header!),
        `public.${name}() must be SECURITY DEFINER — a trigger that writes rows for ` +
          `non-owner members is silently RLS-filtered to 0 rows under the default ` +
          `SECURITY INVOKER. See migration 0033 (regression of 0017 by 0019).`,
      ).toBe(true)
    })

    it(`${name} pins a search_path (defence-in-depth for SECURITY DEFINER)`, () => {
      const header = lastDefinitionHeader(sql, name)
      expect(header).not.toBeNull()
      expect(
        /set\s+search_path\s*=/i.test(header!),
        `public.${name}() should pin search_path (set search_path = public) ` +
          `since SECURITY DEFINER runs with the owner's privileges.`,
      ).toBe(true)
    })
  }
})
