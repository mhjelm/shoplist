export function splitPlainItems(raw: string): string[] {
  const delimiter = raw.includes('\n') ? '\n' : ','
  return raw.split(delimiter).map(s => s.trim()).filter(Boolean)
}
