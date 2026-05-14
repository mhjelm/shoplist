const FRACTION_MAP: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
}

const APPROX_RE = /^(ca|cirka|ungefär)\s+/i

function normalizeFractions(s: string): string {
  // Replace unicode fractions, handling mixed numbers like "2½"
  for (const [frac, val] of Object.entries(FRACTION_MAP)) {
    s = s.replace(new RegExp(`(\\d*)${frac}`, 'g'), (_, whole) => {
      return String((parseInt(whole || '0', 10) + val))
    })
  }
  return s
}

export function parseMeasurement(s: string): { value: number; unit: string } | null {
  let t = s.trim()
  t = t.replace(APPROX_RE, '')
  t = normalizeFractions(t)
  // Swedish decimal comma → period
  t = t.replace(/(\d),(\d)/g, '$1.$2')

  // Must not be a range (e.g. "350-400")
  if (/\d-\d/.test(t)) return null

  // Must not contain parentheses or "à" (compound like "2 förp à 500 g")
  if (/[()]|à/.test(t)) return null

  const m = t.match(/^(\d+(?:\.\d+)?)\s*([a-zåäö]*)$/i)
  if (!m) return null

  const value = parseFloat(m[1])
  if (isNaN(value)) return null

  return { value, unit: m[2].toLowerCase() }
}

function formatValue(n: number): string {
  // Round to 2 decimals, strip trailing zeros
  const rounded = Math.round(n * 100) / 100
  return rounded % 1 === 0 ? String(rounded | 0) : String(rounded).replace(/\.?0+$/, '')
}

export function tryCombine(measurement: string): string | null {
  const segments = measurement.split(' + ')
  if (segments.length < 2) return null

  const parsed = segments.map(s => parseMeasurement(s.trim()))
  if (parsed.some(p => p === null)) return null

  // Group by unit in insertion order
  const groups = new Map<string, number>()
  for (const p of parsed as { value: number; unit: string }[]) {
    groups.set(p.unit, (groups.get(p.unit) ?? 0) + p.value)
  }

  const parts = Array.from(groups.entries()).map(([unit, sum]) =>
    unit ? `${formatValue(sum)} ${unit}` : formatValue(sum)
  )

  const result = parts.join(' + ')

  // If nothing actually changed (all different units, already one each), signal inert
  if (result === measurement) return null

  return result
}
