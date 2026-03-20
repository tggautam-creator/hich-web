/**
 * Typed Supabase client — import `supabase` from here everywhere.
 *
 * Every `.from('table')` call is fully typed via the Database generic, so
 * inserts, selects, and updates all get autocompletion and compile-time checks.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'
import { idbStorage } from '@/lib/idbStorage'

export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      // Disable URL-based session detection in standalone PWA mode.
      // PWAs launched from the home screen never have auth callback URLs,
      // and parsing stale URL fragments can interfere with session restoration.
      detectSessionInUrl: typeof window !== 'undefined'
        ? !window.matchMedia?.('(display-mode: standalone)').matches
        : true,
      // IndexedDB-backed storage — more persistent than localStorage on iOS PWAs.
      // Survives force-kills where localStorage and JS cookies get cleared.
      // Falls back to localStorage if IndexedDB is unavailable.
      storage: typeof window !== 'undefined' ? idbStorage : undefined,
    },
  },
)
