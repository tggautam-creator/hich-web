/**
 * Typed Supabase client — import `supabase` from here everywhere.
 *
 * Every `.from('table')` call is fully typed via the Database generic, so
 * inserts, selects, and updates all get autocompletion and compile-time checks.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'

export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      // Explicitly use localStorage — avoids iOS PWA falling back to
      // sessionStorage (which is cleared when the app is force-killed).
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
  },
)
