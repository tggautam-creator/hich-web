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
    // Slice 1.5 — optional. Only checked when an email broadcast
    // actually tries to send. Lets the rest of the server boot
    // without Resend configured (e.g. local dev where ops doesn't
    // care about email tests yet).
    RESEND_API_KEY: process.env['RESEND_API_KEY'] ?? '',
    // 2026-05-21 — Phase 4 of REPORTS_PLAN.md. Optional. When set,
    // emergency + urgent severity reports fire a Slack webhook +
    // email page-out to admin. When empty, alerts are silently
    // skipped (a `console.warn` is logged once so missing config
    // surfaces in PM2 logs without crashing the report-create
    // endpoint).
    SLACK_ALERTS_WEBHOOK_URL: process.env['SLACK_ALERTS_WEBHOOK_URL'] ?? '',
    ADMIN_ALERT_EMAILS: process.env['ADMIN_ALERT_EMAILS'] ?? '',
    // 2026-05-22 — Phase 6b of REPORTS_PLAN.md. Optional shared
    // secret used to verify Resend's inbound webhook calls. When
    // empty, signature verification is SKIPPED and a warning is
    // logged once per boot — fine for local dev, never for prod.
    // Set to the secret string Resend's "Add Webhook" dashboard
    // gives you when wiring inbound delivery to
    // /api/webhooks/resend-inbound.
    RESEND_WEBHOOK_SECRET: process.env['RESEND_WEBHOOK_SECRET'] ?? '',
    // 2026-05-24 — marketing panel. Optional. Powers the story +
    // poster + advisor generators. When empty, the marketing UI
    // surfaces a "configure GEMINI_API_KEY" banner; rest of the
    // admin keeps working.
    GEMINI_API_KEY: process.env['GEMINI_API_KEY'] ?? '',
    SLACK_MARKETING_WEBHOOK_URL: process.env['SLACK_MARKETING_WEBHOOK_URL'] ?? '',
    // 2026-06-02 — lifecycle email v2. Used to build the public
    // unsubscribe link inside outbound HTML. Defaults to the prod
    // domain; override per env in .env.dev / .env.prod.
    PUBLIC_BASE_URL: process.env['PUBLIC_BASE_URL'] ?? 'https://www.tagorides.com',
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
