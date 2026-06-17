import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Exclude /manifest.webmanifest and /sw.js so PWA fetches by Chrome's
  // installability checker (which is uncookied) don't get redirected to login.
  // Exclude welcome.html so the public marketing page is shareable without auth.
  // Exclude vm-2026-schema.html and its /fb alias so the World Cup schedule loads without login.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|welcome.html|vm-2026-schema.html|fb$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
