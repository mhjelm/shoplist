#!/usr/bin/env node
// Stop hook: run ESLint when Claude finishes a turn. If ESLint reports ANY
// problem — warnings included (via --max-warnings=0) — block the stop and feed
// the output back so it gets fixed instead of quietly accumulating.
//
// Wired up in .claude/settings.json under "hooks".Stop. Runs `node` so it
// behaves the same whether the hook shell is bash or PowerShell.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Resolve the repo root from this file's location (.claude/hooks/ → repo root),
// so it doesn't matter what cwd the hook runner uses.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Hook input arrives as JSON on stdin.
let data = {}
try {
  data = JSON.parse(readFileSync(0, 'utf8') || '{}')
} catch {
  // No/!JSON stdin — treat as empty and proceed.
}

// Loop guard: if this stop is already the continuation of a prior stop-hook
// block, don't block again. Claude got its chance to fix things; let it stop.
if (data.stop_hook_active) process.exit(0)

// Scope guard: only lint when something lintable actually changed. The Stop
// event fires at the end of EVERY turn, including pure-chat answers that never
// touched the repo — no point spawning ESLint then. Ask git whether the working
// tree has uncommitted changes to a file ESLint cares about; if not, no-op.
const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
try {
  const status = execSync('git status --porcelain', {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  // Each line: "XY <path>" (or "XY <old> -> <new>" for renames). Strip the
  // 3-char status prefix and take the final path token.
  const changedLintable = status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, ''))
    .some((path) => LINTABLE.test(path))
  if (!changedLintable) process.exit(0)
} catch {
  // Not a git repo, or git missing — fall through and lint anyway (safe default).
}

let output = ''
try {
  execSync('npx eslint --max-warnings=0', {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (err) {
  // Non-zero exit = errors and/or warnings. Capture both streams.
  output = `${err.stdout || ''}${err.stderr || ''}`.trim()
}

if (output) {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'ESLint reported problems before finishing (warnings count too — ' +
        'this gate runs with --max-warnings=0). Fix every issue below, then ' +
        'finish:\n\n' +
        output,
    }),
  )
}
process.exit(0)
