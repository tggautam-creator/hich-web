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
  GOOGLE_MAPS_KEY: import.meta.env['VITE_GOOGLE_MAPS_KEY'] as string | undefined,
  // Required by `<AdvancedMarker>` — without it the Map silently
  // renders as a blank container. Provisioned in Google Cloud
  // Console → Maps Management. MUST also exist on Vercel project
  // env vars for production tagorides.com to render the public
  // TrackPage map.
  GOOGLE_MAP_ID: import.meta.env['VITE_GOOGLE_MAP_ID'] as string | undefined,
  STRIPE_PUBLISHABLE_KEY: import.meta.env['VITE_STRIPE_PUBLISHABLE_KEY'] as string | undefined,
  FIREBASE_API_KEY: import.meta.env['VITE_FIREBASE_API_KEY'] as string | undefined,
  FIREBASE_AUTH_DOMAIN: import.meta.env['VITE_FIREBASE_AUTH_DOMAIN'] as string | undefined,
  FIREBASE_PROJECT_ID: import.meta.env['VITE_FIREBASE_PROJECT_ID'] as string | undefined,
  FIREBASE_MESSAGING_SENDER_ID: import.meta.env['VITE_FIREBASE_MESSAGING_SENDER_ID'] as string | undefined,
  FIREBASE_APP_ID: import.meta.env['VITE_FIREBASE_APP_ID'] as string | undefined,
  FIREBASE_VAPID_KEY: import.meta.env['VITE_FIREBASE_VAPID_KEY'] as string | undefined,
  // Set to 'true' in .env to bypass phone verification (dev/testing only)
  SKIP_PHONE_VERIFICATION: import.meta.env['VITE_SKIP_PHONE_VERIFICATION'] === 'true',
}

// True when the publishable Stripe key starts with `pk_test_`. Used to
// render a sandbox banner so testers cannot mistake a test session for
// a live one (the cross-environment contamination this guards against
// was traced via `/Users/.../scenario-2-stripe-purring-hollerith.md`).
export const IS_TEST_STRIPE = !!env.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')
