'use client'

import { useEffect } from 'react'
import { log } from '@/lib/log'

// Last-resort error boundary. Catches render crashes that escape every route
// boundary — including the root layout itself, which is why this renders its own
// <html>/<body> and replaces the whole document. Production-only (Next.js shows
// the dev overlay in development).
//
// Deliberately self-contained: inline styles + system font, no Tailwind class or
// globals.css dependency, because the CSS/theme pipeline may be exactly what
// failed. The whole point is to always paint *something* with a way out.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface render crashes in app_logs — otherwise they're invisible.
    // PII-safe: digest + message only, never component/route data.
    log.error('ui.global_error', { digest: error.digest, error: error.message })
  }, [error])

  return (
    <html lang="sv">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f9fafb',
          color: '#111827',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: '20rem', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', lineHeight: 1, marginBottom: '12px' }} aria-hidden>
            🛒
          </div>
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px' }}>
            Något gick fel
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px' }}>
            Appen kraschade oväntat. Dina listor är sparade — försök igen.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => reset()}
              style={{
                appearance: 'none',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#ffffff',
                background: '#2563eb',
                cursor: 'pointer',
              }}
            >
              Försök igen
            </button>
            <button
              onClick={() => { window.location.href = '/lists' }}
              style={{
                appearance: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
                background: '#ffffff',
                border: '1px solid #d1d5db',
                cursor: 'pointer',
              }}
            >
              Ladda om
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
