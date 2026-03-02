/**
 * Centralised environment variable access.
 * Throws at startup if any required var is missing.
 * All components must import from here — never use import.meta.env directly.
 */

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const

for (const key of required) {
  if (!import.meta.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

export const env = {
  SUPABASE_URL: import.meta.env['VITE_SUPABASE_URL'] as string,
  SUPABASE_ANON_KEY: import.meta.env['VITE_SUPABASE_ANON_KEY'] as string,
  GOOGLE_PLACES_KEY: import.meta.env['VITE_GOOGLE_PLACES_KEY'] as string | undefined,
  STRIPE_PUBLISHABLE_KEY: import.meta.env['VITE_STRIPE_PUBLISHABLE_KEY'] as string | undefined,
}
