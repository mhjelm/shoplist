import { describe, it, expect } from 'vitest'
import { isUrl, splitNoteText, noteHostname } from '@/lib/notesView'

describe('isUrl', () => {
  it('accepts a bare http(s) URL', () => {
    expect(isUrl('https://example.com/x')).toBe(true)
    expect(isUrl('http://example.com')).toBe(true)
    expect(isUrl('  https://example.com  ')).toBe(true) // trims first
  })

  it('rejects text, URLs with surrounding words, and non-http schemes', () => {
    expect(isUrl('buy milk')).toBe(false)
    expect(isUrl('see https://example.com')).toBe(false)
    expect(isUrl('https://example.com and more')).toBe(false)
    expect(isUrl('ftp://example.com')).toBe(false)
    expect(isUrl('')).toBe(false)
  })
})

describe('splitNoteText', () => {
  it('uses a single line as the title with no body', () => {
    expect(splitNoteText('Call the plumber')).toEqual({ name: 'Call the plumber', note: null })
  })

  it('splits the first line as title and the rest as body', () => {
    expect(splitNoteText('Paint ideas\nblue for the hall\ngreen kitchen')).toEqual({
      name: 'Paint ideas',
      note: 'blue for the hall\ngreen kitchen',
    })
  })

  it('skips leading blank lines when picking the title', () => {
    expect(splitNoteText('\n\nTitle here\nbody')).toEqual({ name: 'Title here', note: 'body' })
  })

  it('returns empty for blank input', () => {
    expect(splitNoteText('   \n  ')).toEqual({ name: '', note: null })
  })

  it('overflows a very long first line into the body', () => {
    const long = 'word '.repeat(40).trim() // ~199 chars
    const { name, note } = splitNoteText(long)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(note).not.toBeNull()
    expect(`${name} ${note}`.replace(/\s+/g, ' ').trim()).toBe(long)
  })
})

describe('noteHostname', () => {
  it('returns the bare host without www', () => {
    expect(noteHostname('https://www.example.com/path')).toBe('example.com')
    expect(noteHostname('https://sub.example.com')).toBe('sub.example.com')
  })

  it('returns null for null or unparseable input', () => {
    expect(noteHostname(null)).toBeNull()
    expect(noteHostname('not a url')).toBeNull()
  })
})
