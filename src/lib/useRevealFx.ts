import { useLayoutEffect, useRef, useState } from 'react'

/** The six subtle screen-reveal animations (CSS classes in globals.css). */
export const REVEAL_FX = [
  'sl-fx-fade',
  'sl-fx-rise',
  'sl-fx-blur',
  'sl-fx-zoom',
  'sl-fx-bright',
  'sl-fx-stagger',
] as const

/**
 * Picks ONE of the six reveal animations at random once `ready` flips true,
 * applies its class, then clears it after the animation window (~0.8s).
 *
 * - Returns '' until ready and on the server, so it never causes a hydration
 *   mismatch (the random pick only ever happens client-side, post-mount).
 * - useLayoutEffect (not useEffect) so the class is in place before the first
 *   paint — no flash of un-animated content.
 * - Clearing the class afterwards matters for the stagger variant, whose rule
 *   targets descendant <li>; leaving it on would animate rows that mount later
 *   (autocomplete suggestions, etc.).
 *
 * Globally disabled by the reduce-motion setting and prefers-reduced-motion
 * (see globals.css) — no extra check needed here.
 */
export function useRevealFx(ready: boolean): string {
  const [fx, setFx] = useState('')
  const fired = useRef(false)
  useLayoutEffect(() => {
    if (!ready || fired.current) return
    fired.current = true
    setFx(REVEAL_FX[Math.floor(Math.random() * REVEAL_FX.length)])
    const t = setTimeout(() => setFx(''), 800)
    return () => clearTimeout(t)
  }, [ready])
  return fx
}
