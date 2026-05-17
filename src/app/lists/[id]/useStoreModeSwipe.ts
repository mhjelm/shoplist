'use client'

import { useRef } from 'react'

export function useStoreModeSwipe({
  enabled,
  transformRef,
  onCommit,
  onTap,
}: {
  enabled: boolean
  transformRef: React.RefObject<HTMLDivElement | null>
  onCommit: () => void
  onTap: () => void
}): React.HTMLAttributes<HTMLLIElement> {
  const g = useRef({ active: false, locked: false, aborted: false, startX: 0, startY: 0, startT: 0, pid: -1, dx: 0 })

  if (!enabled) return {}

  function slide(dx: number) {
    const el = transformRef.current
    if (el) el.style.transform = dx > 0 ? `translateX(${dx}px)` : ''
  }

  function snapBack() {
    const el = transformRef.current
    if (!el) return
    el.style.transition = 'transform 180ms ease-out'
    el.style.transform = 'translateX(0)'
    setTimeout(() => { const e = transformRef.current; if (e) { e.style.transition = ''; e.style.transform = '' } }, 200)
  }

  return {
    onPointerDown(e: React.PointerEvent<HTMLLIElement>) {
      if (e.pointerType === 'mouse') return
      const s = g.current
      s.active = true; s.locked = false; s.aborted = false
      s.startX = e.clientX; s.startY = e.clientY; s.startT = e.timeStamp; s.pid = e.pointerId; s.dx = 0
    },
    onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || s.aborted || e.pointerId !== s.pid) return
      const adx = Math.abs(e.clientX - s.startX)
      const ady = Math.abs(e.clientY - s.startY)
      if (!s.locked) {
        if (ady > 6 && ady > adx) { s.aborted = true; return }
        if (adx > 6 && adx > ady) { s.locked = true; try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }
        else return
      }
      s.dx = Math.max(0, e.clientX - s.startX)
      slide(s.dx)
    },
    onPointerUp(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || e.pointerId !== s.pid) return
      s.active = false
      const adx = Math.abs(e.clientX - s.startX)
      const ady = Math.abs(e.clientY - s.startY)
      const elapsed = e.timeStamp - s.startT
      if (!s.locked && !s.aborted && adx < 6 && ady < 6 && elapsed < 250) { onTap(); return }
      if (!s.locked || s.aborted) { snapBack(); return }
      const w = transformRef.current?.getBoundingClientRect().width ?? 300
      const velocity = elapsed > 0 ? s.dx / elapsed : 0
      if (s.dx >= w * 0.4 || (s.dx >= 60 && velocity >= 0.5)) {
        const el = transformRef.current
        if (el) { el.style.transition = 'transform 120ms ease-out'; el.style.transform = `translateX(${w}px)` }
        setTimeout(() => { slide(0); const e2 = transformRef.current; if (e2) e2.style.transition = ''; onCommit() }, 130)
      } else {
        snapBack()
      }
    },
    onPointerCancel(e: React.PointerEvent<HTMLLIElement>) {
      const s = g.current
      if (!s.active || e.pointerId !== s.pid) return
      s.active = false
      snapBack()
    },
  }
}
