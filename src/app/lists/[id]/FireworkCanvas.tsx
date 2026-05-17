'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

interface FWParticle {
  x: number; y: number; vx: number; vy: number
  size: number; life: number; maxLife: number
  color: string; drag: number; gravity: number; sparkle: boolean
}

const SL_COLORS = ['#EC4899', '#14B8A6', '#F97316', '#FACC15', '#3B82F6']
const FW_PALETTE = [...SL_COLORS, '#ffffff']

function fwRand(min: number, max: number) { return min + Math.random() * (max - min) }
function fwPick() { return FW_PALETTE[Math.floor(Math.random() * FW_PALETTE.length)] }

export const FireworkCanvas = forwardRef<{ explode: (x: number, y: number) => void }, object>(
  function FireworkCanvas(_, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const stateRef = useRef({ particles: [] as FWParticle[], rafId: 0, dpr: 1, w: 0, h: 0 })

    useEffect(() => {
      const canvas = canvasRef.current!
      const s = stateRef.current

      function resize() {
        s.dpr = Math.min(window.devicePixelRatio || 1, 2)
        s.w = window.innerWidth
        s.h = window.innerHeight
        canvas.width  = Math.floor(s.w * s.dpr)
        canvas.height = Math.floor(s.h * s.dpr)
        canvas.style.width  = `${s.w}px`
        canvas.style.height = `${s.h}px`
        canvas.getContext('2d')!.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      }
      resize()
      window.addEventListener('resize', resize)
      return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(s.rafId) }
    }, [])

    useImperativeHandle(ref, () => ({
      explode(x: number, y: number) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const s = stateRef.current
        const color = fwPick()
        const secondary = fwPick()
        for (let i = 0; i < 52; i++) {
          const angle = (Math.PI * 2 * i) / 52 + fwRand(-0.08, 0.08)
          const speed = fwRand(1.8, 6.0)
          s.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: fwRand(1.4, 3.2),
            life: fwRand(38, 62),
            maxLife: 62,
            color: Math.random() > 0.65 ? secondary : color,
            drag: fwRand(0.966, 0.980),
            gravity: fwRand(0.032, 0.068),
            sparkle: Math.random() > 0.86,
          })
        }
        if (s.rafId) return
        function loop() {
          const canvas = canvasRef.current
          if (!canvas) return
          const ctx = canvas.getContext('2d')!
          ctx.globalCompositeOperation = 'source-over'
          ctx.clearRect(0, 0, s.w, s.h)
          for (let i = s.particles.length - 1; i >= 0; i--) {
            const p = s.particles[i]
            p.x  += p.vx
            p.y  += p.vy
            p.vx *= p.drag
            p.vy  = p.vy * p.drag + p.gravity
            p.life -= 1
            const alpha = Math.max(p.life / p.maxLife, 0)
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.fillStyle   = p.color
            ctx.shadowColor = p.color
            ctx.shadowBlur  = p.sparkle ? 14 : 6
            ctx.beginPath()
            ctx.arc(p.x, p.y, p.size * alpha + 0.4, 0, Math.PI * 2)
            ctx.fill()
            if (p.sparkle && Math.random() > 0.6) {
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth   = 0.9
              ctx.beginPath()
              ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y)
              ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4)
              ctx.stroke()
            }
            ctx.restore()
            if (p.life <= 0 || p.y > s.h + 24) s.particles.splice(i, 1)
          }
          if (s.particles.length > 0) {
            s.rafId = requestAnimationFrame(loop)
          } else {
            s.rafId = 0
          }
        }
        s.rafId = requestAnimationFrame(loop)
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 70, pointerEvents: 'none', display: 'block' }}
      />
    )
  }
)
