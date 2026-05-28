# Measurement system (`src/lib/measurement.ts`)

Items store measurements as **free-form text** (`measurement text` column, max 80 chars) — Swedish recipe units are too irregular for a structured `{value, unit}` model (ranges like `350-400`, fractions `½ dl`, approximations `ca 500 g`, parentheticals `2 förp à 500 g`).

Two pure helpers:
- `parseMeasurement(s)` — best-effort parse to `{ value, unit }`. Handles unicode fractions (`½` → `0.5`), Swedish decimal commas (`1,5` → `1.5`), and `ca` / `cirka` / `ungefär` prefixes. Returns `null` for ranges, parentheticals, or anything ambiguous.
- `tryCombine(measurement)` — for measurements like `1 dl + 5 dl + 3 dl`, returns `9 dl`. Returns `null` if nothing can be combined (mixed incompatible units, single segment, parse failure). Used by `MeasurementBadge` to offer an inline "→ 9 dl · Slå ihop" popover when the user clicks a multi-segment badge.
