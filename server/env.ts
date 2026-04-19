/**
 * Server-side environment variable access.
 * Called lazily — only throws when `getServerEnv()` is invoked,
 * so tests that mock supabaseAdmin and fcm never trigger this.
 */
export function getServerEnv() {
  const url = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  const firebasePath = process.env['FIREBASE_SERVICE_ACCOUNT_PATH']
  const qrHmacSecret = process.env['QR_HMAC_SECRET']

  if (!url || !serviceRoleKey || !firebasePath) {
    throw new Error(
      'Missing required server env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIREBASE_SERVICE_ACCOUNT_PATH',
    )
  }

  if (!qrHmacSecret) {
    throw new Error('Missing required server env var: QR_HMAC_SECRET')
  }

  const stripeSecretKey = process.env['STRIPE_SECRET_KEY']
  const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET']

  // Hard fail at boot rather than warn. Missing Stripe creds will blow up
  // the wallet/payment routes at runtime with cryptic errors; prefer a
  // fast, loud exit.
  if (!stripeSecretKey || !stripeWebhookSecret) {
    throw new Error(
      'Missing required server env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET',
    )
  }

  return {
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_JWT_SECRET: process.env['SUPABASE_JWT_SECRET'] ?? '',
    FIREBASE_SERVICE_ACCOUNT_PATH: firebasePath,
    QR_HMAC_SECRET: qrHmacSecret,
    STRIPE_SECRET_KEY: stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
    PORT: process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3001,
  }
}

/**
 * Validate that all required Stripe env vars exist.
 * Call this at server startup (not per-request) to fail fast.
 */
export function validateStripeEnv(): void {
  if (!process.env['STRIPE_SECRET_KEY'] || !process.env['STRIPE_WEBHOOK_SECRET']) {
    throw new Error('Missing required server env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET')
  }
}
