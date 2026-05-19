import type { Theme } from './types'

export function slColorFor(id: string): 0 | 1 | 2 | 3 {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 4) as 0 | 1 | 2 | 3
}

export function slFlareDelay(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 17 + id.charCodeAt(i)) | 0
  const tenths = Math.abs(h) % 90
  return `${(tenths / 10).toFixed(1)}s`
}

export function hasDecorativeTheme(theme: Theme): boolean {
  return theme === 'shoplist' || theme === 'polar' || theme === 'dusk'
}

export const FIREWORK_PALETTES: Record<Theme, string[]> = {
  light:    ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6', '#ffffff'],
  dark:     ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6', '#ffffff'],
  shoplist: ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6', '#ffffff'],
  polar:    ['#4A8EB8', '#9BC1D7', '#D8E7F0', '#F3F9FC', '#2D5B7D', '#ffffff'],
  dusk:     ['#C47B5E', '#D6A888', '#F0B89A', '#FDF6EE', '#8A4A30'],
}
