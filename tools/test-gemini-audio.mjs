#!/usr/bin/env node
// Throwaway diagnostic: fire synthetic audio at Gemini across a matrix of
// models x request-shapes x formats, and report which combinations error.
// We only care about HTTP status here, not transcription quality.
//
//   node tools/test-gemini-audio.mjs
//
// Always tests a synthesized WAV (zero deps). If `ffmpeg` is on PATH it also
// transcodes to webm/opus, ogg/opus, mp3, m4a, flac and tests those — webm/opus
// is what the real browser app produces, so that's the format that matters most.
// Reads GEMINI_API_KEY from .env.local (or the environment).

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  for (const f of ['.env.local', '.env']) {
    const p = join(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '').trim()
    }
  }
  return null
}

const API_KEY = loadApiKey()
if (!API_KEY) {
  console.error('GEMINI_API_KEY not found in env or .env.local — aborting.')
  process.exit(1)
}

// --- synthesize a 2s 440Hz mono 16kHz 16-bit WAV --------------------------
function makeWav() {
  const rate = 16000, secs = 2
  const n = rate * secs
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3
    buf.writeInt16LE((s * 0x7fff) | 0, 44 + i * 2)
  }
  return buf
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

// Build the list of { mime, base64 } audio samples to test.
function buildSamples() {
  const wav = makeWav()
  const samples = [{ name: 'wav', mime: 'audio/wav', base64: wav.toString('base64') }]
  if (!hasFfmpeg) {
    console.log('ffmpeg not found — testing WAV only. Install ffmpeg to also test webm/opus, mp3, m4a, etc.\n')
    return samples
  }
  const dir = mkdtempSync(join(tmpdir(), 'gem-audio-'))
  const wavPath = join(dir, 'in.wav')
  writeFileSync(wavPath, wav)
  const targets = [
    { name: 'webm-opus', file: 'out.webm', mime: 'audio/webm', args: ['-c:a', 'libopus'] },
    { name: 'ogg-opus', file: 'out.ogg', mime: 'audio/ogg', args: ['-c:a', 'libopus'] },
    { name: 'mp3', file: 'out.mp3', mime: 'audio/mp3', args: ['-c:a', 'libmp3lame'] },
    { name: 'm4a-aac', file: 'out.m4a', mime: 'audio/mp4', args: ['-c:a', 'aac'] },
    { name: 'flac', file: 'out.flac', mime: 'audio/flac', args: [] },
  ]
  for (const t of targets) {
    const out = join(dir, t.file)
    const r = spawnSync('ffmpeg', ['-y', '-i', wavPath, ...t.args, out])
    if (r.status === 0 && existsSync(out)) {
      samples.push({ name: t.name, mime: t.mime, base64: readFileSync(out).toString('base64') })
    } else {
      console.log(`(skipped ${t.name}: ffmpeg couldn't encode it)`)
    }
  }
  rmSync(dir, { recursive: true, force: true })
  return samples
}

// --- matrix ---------------------------------------------------------------
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash']
const PROMPT = 'Transcribe any spoken items in the attached audio and return JSON {"items":[{"name":"..."}]}. If there is no speech, return {"items":[]}. JSON only.'

const thinkingFor = model => (model.startsWith('gemini-3') ? { thinkingLevel: 'low' } : { thinkingBudget: 0 })

const SHAPES = {
  // Proven image-import shape: snake_case, binary-first.
  'image-shape': (mime, b64, model) => ({
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4000, thinkingConfig: thinkingFor(model), responseMimeType: 'application/json' },
  }),
  // Original failing shape: camelCase, text-first.
  'camel-shape': (mime, b64, model) => ({
    contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: mime, data: b64 } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4000, thinkingConfig: thinkingFor(model), responseMimeType: 'application/json' },
  }),
}

async function callGemini(model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) {
      let status = String(res.status)
      try { status = `${res.status} ${JSON.parse(text).error?.status ?? ''}`.trim() } catch {}
      return { ok: false, label: status }
    }
    return { ok: true, label: '200 OK' }
  } catch (e) {
    return { ok: false, label: `fetch error: ${e.message}` }
  }
}

const samples = buildSamples()
console.log(`Testing ${samples.length} format(s) x ${MODELS.length} models x ${Object.keys(SHAPES).length} shapes...\n`)

const pad = (s, n) => s.padEnd(n)
let okCount = 0, total = 0

for (const sample of samples) {
  console.log(`=== format: ${sample.name} (${sample.mime}, ${Math.round(sample.base64.length * 0.75 / 1024)} KB) ===`)
  for (const model of MODELS) {
    for (const [shapeName, build] of Object.entries(SHAPES)) {
      total++
      const result = await callGemini(model, build(sample.mime, sample.base64, model))
      if (result.ok) okCount++
      const mark = result.ok ? 'OK  ' : 'FAIL'
      console.log(`  [${mark}] ${pad(model, 24)} ${pad(shapeName, 12)} -> ${result.label}`)
    }
  }
  console.log('')
}

console.log(`Done: ${okCount}/${total} combinations returned 2xx.`)
