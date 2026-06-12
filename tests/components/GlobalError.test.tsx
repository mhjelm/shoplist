import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GlobalError from '@/app/global-error'

vi.mock('@/lib/log', () => ({ log: { error: vi.fn() } }))

describe('GlobalError', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders the Swedish recovery copy', () => {
    render(<GlobalError error={new Error('boom')} reset={vi.fn()} />)
    expect(screen.getByText('Något gick fel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeInTheDocument()
  })

  it('calls reset() when "Försök igen" is clicked', () => {
    const reset = vi.fn()
    render(<GlobalError error={new Error('boom')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('logs the crash to app_logs (digest + message, no PII)', async () => {
    const { log } = await import('@/lib/log')
    const err = Object.assign(new Error('kaboom'), { digest: 'abc123' })
    render(<GlobalError error={err} reset={vi.fn()} />)
    expect(log.error).toHaveBeenCalledWith('ui.global_error', { digest: 'abc123', error: 'kaboom' })
  })
})
