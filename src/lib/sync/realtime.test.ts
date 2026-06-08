import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// realtime.ts imports these at module load; stub them so the import is side-effect free.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/db/local', () => ({ localDB: {} }))
vi.mock('@/lib/log', () => ({ log: { warn: vi.fn() } }))

import { applyRealtimeAuth } from './realtime'

// Minimal fake client: a getSession that resolves to the given session, plus a
// realtime.setAuth spy. Cast through unknown — we only exercise the two members
// applyRealtimeAuth touches.
function makeClient(opts: {
  session?: { access_token: string } | null
  getSessionRejects?: boolean
}) {
  const setAuth = vi.fn()
  const getSession = opts.getSessionRejects
    ? vi.fn().mockRejectedValue(new Error('offline'))
    : vi.fn().mockResolvedValue({ data: { session: opts.session ?? null } })
  const client = { auth: { getSession }, realtime: { setAuth } }
  return { client: client as unknown as SupabaseClient, setAuth, getSession }
}

describe('applyRealtimeAuth', () => {
  it('sets the realtime auth token from the current session', async () => {
    const { client, setAuth, getSession } = makeClient({ session: { access_token: 'fresh-jwt' } })
    await applyRealtimeAuth(client)
    expect(getSession).toHaveBeenCalledOnce()
    expect(setAuth).toHaveBeenCalledWith('fresh-jwt')
  })

  it('does not call setAuth when there is no session', async () => {
    const { client, setAuth } = makeClient({ session: null })
    await applyRealtimeAuth(client)
    expect(setAuth).not.toHaveBeenCalled()
  })

  it('swallows errors and never throws (offline / refresh failure)', async () => {
    const { client, setAuth } = makeClient({ getSessionRejects: true })
    await expect(applyRealtimeAuth(client)).resolves.toBeUndefined()
    expect(setAuth).not.toHaveBeenCalled()
  })
})
