'use client'

import type { Theme } from '@/lib/types'

interface Props {
  theme: Theme
  variant: 'no-items' | 'all-shopped'
}

interface ThemeCopy { glyph: string | null; headline: string; subline: string | null }

const COPY: Record<Theme, Record<Props['variant'], ThemeCopy>> = {
  light: {
    'no-items':    { glyph: null, headline: 'No items yet.',     subline: null },
    'all-shopped': { glyph: null, headline: 'Everything shopped', subline: null },
  },
  dark: {
    'no-items':    { glyph: null, headline: 'No items yet.',     subline: null },
    'all-shopped': { glyph: null, headline: 'Everything shopped', subline: null },
  },
  shoplist: {
    'no-items':    { glyph: '🎉', headline: 'Inga varor än.', subline: 'Lägg till din första vara.' },
    'all-shopped': { glyph: '🎉', headline: 'Allt klart!',    subline: null },
  },
  polar: {
    'no-items':    { glyph: '❄', headline: 'Tyst lista.',  subline: 'Lägg till din första vara.' },
    'all-shopped': { glyph: '❄', headline: 'Allt klart.', subline: 'Listan vilar.' },
  },
  dusk: {
    'no-items':    { glyph: '☾', headline: 'Tom lista.',          subline: 'Lägg till din första vara.' },
    'all-shopped': { glyph: '☾', headline: 'Klart för i kväll.', subline: 'Andas ut.' },
  },
  editorial: {
    'no-items':    { glyph: null, headline: 'No items yet.',     subline: null },
    'all-shopped': { glyph: null, headline: 'Everything shopped', subline: null },
  },
}

export function EmptyState({ theme, variant }: Props) {
  const copy = COPY[theme][variant]
  return (
    <div className="empty-state text-center py-10" role="status">
      {copy.glyph && (
        <div className="empty-state-glyph text-4xl leading-none mb-2" aria-hidden="true">{copy.glyph}</div>
      )}
      <p className="empty-state-headline text-base font-medium text-gray-500 dark:text-gray-400">{copy.headline}</p>
      {copy.subline && (
        <p className="empty-state-subline mt-1 text-sm text-gray-400 dark:text-gray-500">{copy.subline}</p>
      )}
    </div>
  )
}
