export const CATEGORIES = [
  { slug: 'frukt-gront', label: 'Frukt & grönt' },
  { slug: 'mejeri',      label: 'Mejeri' },
  { slug: 'kott-fisk',   label: 'Kött & fisk' },
  { slug: 'brod',        label: 'Bröd & bageri' },
  { slug: 'frys',        label: 'Frys' },
  { slug: 'skafferi',    label: 'Skafferi' },
  { slug: 'drycker',     label: 'Drycker' },
  { slug: 'snacks',      label: 'Snacks & godis' },
  { slug: 'hushall',     label: 'Hushåll' },
  { slug: 'hygien',      label: 'Hygien' },
  { slug: 'ovrigt',      label: 'Övrigt' },
] as const

export type CategorySlug = typeof CATEGORIES[number]['slug']

export const DEFAULT_CATEGORY_ORDER: CategorySlug[] = CATEGORIES.map(c => c.slug)

const labelMap = Object.fromEntries(CATEGORIES.map(c => [c.slug, c.label])) as Record<CategorySlug, string>
export function categoryLabel(slug: CategorySlug | string): string {
  return labelMap[slug as CategorySlug] ?? slug
}

export function isValidCategorySlug(s: string): s is CategorySlug {
  return s in labelMap
}
