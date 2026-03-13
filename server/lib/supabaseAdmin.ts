import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.ts'
import { getServerEnv } from '../env.ts'

const env = getServerEnv()

export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
