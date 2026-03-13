import { createClient } from '@supabase/supabase-js'

const c = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { error } = await c.from('push_tokens').delete().eq('user_id', 'f520e948-37f7-4528-952b-2a2b0f31f384')
console.log(error ? 'Error: ' + error.message : 'Deleted all tokens for driver f520e948')
process.exit(0)
