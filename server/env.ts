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

  const stripeSecretKey = process.env['STRIPE_SECRET_KEY'] ?? ''
  const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] ?? ''

  if (!stripeSecretKey || !stripeWebhookSecret) {
    console.warn('[ENV] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing — wallet/payment routes will fail')
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
