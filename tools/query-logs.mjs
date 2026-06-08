#!/usr/bin/env node
// Read durable logs from the app_logs table (migration 0027) via PostgREST.
// The service-role key bypasses RLS, so this reads the locked-down table
// directly — no Supabase CLI / psql / dashboard round-trip needed.
//
//   node tools/query-logs.mjs                 # latest 100, newest first
//   node tools/query-logs.mjs --limit 200
//   node tools/query-logs.mjs --lvl error     # only errors
//   node tools/query-logs.mjs --side client    # only client-tier rows
//   node tools/query-logs.mjs --ev reconcile.% # event-key LIKE pattern
//   node tools/query-logs.mjs --since 2h        # rows newer than 2h ago (m/h/d)
//   node tools/query-logs.mjs --json            # raw JSON instead of a table
//
// Triage watermark — so a later session only looks at entries it hasn't seen:
//   node tools/query-logs.mjs --new            # only rows since the last --mark
//   node tools/query-logs.mjs --new --mark      # show new rows AND mark reviewed
//   node tools/query-logs.mjs --mark            # just record "reviewed up to now"
// The watermark (latest reviewed created_at) is stored in
// tools/.logs-watermark.json (machine-local, gitignored). --mark advances it to
// the newest row currently in the table, independent of any display filters.
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (or the environment). Zero deps — built-in fetch only.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WATERMARK_FILE = join(dirname(fileURLToPath(import.meta.url)), '.logs-watermark.json')

function loadEnv(name) {
  if (process.env[name]) return process.env[name]
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`))
      if (m) return m[1].replace(/^["']|["']$/g, '').trim()
    }
  }
  return undefined
}

function readWatermark() {
  try {
    return JSON.parse(readFileSync(WATERMARK_FILE, 'utf8')).last_read ?? null
  } catch {
    return null
  }
}

function writeWatermark(iso) {
  writeFileSync(WATERMARK_FILE, JSON.stringify({ last_read: iso }, null, 2) + '\n')
}

function parseArgs(argv) {
  const out = { limit: 100, json: false, new: false, mark: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--new') out.new = true
    else if (a === '--mark') out.mark = true
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 100
    else if (a === '--lvl') out.lvl = argv[++i]
    else if (a === '--side') out.side = argv[++i]
    else if (a === '--ev') out.ev = argv[++i]
    else if (a === '--since') out.since = argv[++i]
  }
  return out
}

function sinceToIso(s) {
  const m = String(s).match(/^(\d+)\s*([mhd])$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]
  return new Date(Date.now() - n * ms).toISOString()
}

const url = loadEnv('NEXT_PUBLIC_SUPABASE_URL')
const key = loadEnv('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
  process.exit(1)
}

const base = url.replace(/\/$/, '')
const headers = { apikey: key, Authorization: `Bearer ${key}` }
const args = parseArgs(process.argv.slice(2))

const params = new URLSearchParams()
params.set('select', '*')
params.set('order', 'created_at.desc')
params.set('limit', String(args.limit))
if (args.lvl) params.append('lvl', `eq.${args.lvl}`)
if (args.side) params.append('side', `eq.${args.side}`)
if (args.ev) params.append('ev', `like.${args.ev}`)
if (args.since) {
  const iso = sinceToIso(args.since)
  if (!iso) {
    console.error(`Bad --since "${args.since}" (use e.g. 30m, 2h, 7d).`)
    process.exit(1)
  }
  params.append('created_at', `gte.${iso}`)
}

let watermark = null
if (args.new) {
  watermark = readWatermark()
  if (watermark) {
    params.append('created_at', `gt.${watermark}`)
    console.log(`(--new: only entries after last mark ${watermark})`)
  } else {
    console.log('(--new: no watermark recorded yet — showing all; run --mark to set one)')
  }
}

const res = await fetch(`${base}/rest/v1/app_logs?${params.toString()}`, { headers })
if (!res.ok) {
  console.error(`PostgREST ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const rows = await res.json()

if (args.json) {
  console.log(JSON.stringify(rows, null, 2))
} else if (rows.length === 0) {
  console.log('(no rows)')
} else {
  for (const r of rows) {
    const when = (r.created_at || '').replace('T', ' ').replace(/\.\d+.*$/, '')
    const detail = r.detail ? ' ' + JSON.stringify(r.detail) : ''
    const user = r.user_id ? ` u=${r.user_id.slice(0, 8)}` : ''
    console.log(`${when}  ${r.side.padEnd(6)} ${r.lvl.padEnd(8)} ${r.ev}${user}${detail}`)
  }
  console.log(`\n${rows.length} row(s).`)
}

// --mark: advance the watermark to the newest row currently in the table, so a
// later --new shows only rows inserted after this point. Done as its own lookup
// so it's correct regardless of the display filters above.
if (args.mark) {
  const r = await fetch(`${base}/rest/v1/app_logs?select=created_at&order=created_at.desc&limit=1`, { headers })
  if (r.ok) {
    const [latest] = await r.json()
    const iso = latest?.created_at ?? new Date().toISOString()
    writeWatermark(iso)
    console.log(`\n✓ marked reviewed up to ${iso}`)
  } else {
    console.error(`\n--mark failed: PostgREST ${r.status}`)
  }
}
