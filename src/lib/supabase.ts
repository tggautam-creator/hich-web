/**
 * Typed Supabase client — import `supabase` from here everywhere.
 *
 * Every `.from('table')` call is fully typed via the Database generic, so
 * inserts, selects, and updates all get autocompletion and compile-time checks.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'
import { authCookieStorage } from '@/lib/authCookieStorage'

export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      // Use cookie-backed storage so sessions survive iOS PWA force-kill.
      // Cookies persist where localStorage gets cleared on iOS when the app
      // is removed from the app switcher. Falls back to localStorage in
      // non-browser environments (e.g. SSR, tests).
      storage: typeof window !== 'undefined' ? authCookieStorage : undefined,
    },
  },
)
