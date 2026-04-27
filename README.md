# Tago

Carpooling PWA for university students. `.edu` email is the trust layer.
Riders request rides, drivers get push notifications and accept. A QR
scan starts the ride and a second QR scan ends it and triggers payment.

Stack: React + Vite + TypeScript, Tailwind, React Query, Zustand,
Supabase (Postgres + PostGIS + Realtime + Auth + Storage), Express in
`/server`, Stripe (Connect + Customer charges), Firebase Cloud
Messaging, Google Maps. Tests on Vitest. CI in
`.github/workflows/ci.yml`.

See [`CLAUDE.md`](./CLAUDE.md) for the project conventions.

---

## Environments

**Two environments. Two databases. Two Stripe accounts.** Mixing them
caused the cross-environment Stripe contamination tracked in
`/Users/<…>/.claude/plans/scenario-2-stripe-purring-hollerith.md`. Don't
share state between them.

| | Local development | Production |
|---|---|---|
| **Server URL** | `http://localhost:3001` | `https://tagorides.com` |
| **Supabase project** | `tago-dev` | prod project (`main`) |
| **Stripe keys** | `sk_test_…` / `pk_test_…` | `sk_live_…` / `pk_live_…` |
| **Stripe webhook URL** | local tunnel (e.g. ngrok) | `https://tagorides.com/api/stripe/webhook` |

Why this matters: Stripe IDs (`stripe_customer_id`,
`default_payment_method_id`, `stripe_account_id`) are written into the
`users` row by whichever environment the user is currently signing in
to. If localhost (test mode) shares a database with production, those
columns get overwritten with test-mode IDs whose live API can no longer
resolve them. Charges then fail with `"No such customer"` and the
`chargeRideFare → wallet_apply_delta` path leaves real driver wallets
holding phantom credits.

### Safety rails (already in code)

- **Server startup guard** ([`server/index.ts`](./server/index.ts)) —
  `process.exit(1)` if `NODE_ENV=production` is paired with a
  `sk_test_*` key. The boot log prints `Stripe=TEST|LIVE · supabase=<host>`
  on every start so deploy logs surface mismatches immediately.
- **Sandbox banner** ([`src/main.tsx`](./src/main.tsx)) — yellow
  fixed-top strip "Sandbox · payments are not real" whenever
  `VITE_STRIPE_PUBLISHABLE_KEY` starts with `pk_test_`.
- **Cross-mode error tag** ([`server/lib/stripeConnect.ts`](./server/lib/stripeConnect.ts))
  — `chargeRideFare` log lines include `[CROSS_MODE_STRIPE]` when
  Stripe returns `No such customer`, making contamination grep-able.

### Setting up a fresh local environment

```bash
# 1. Create a separate dev Supabase project
#    Supabase Dashboard → New Project → name "tago-dev"

# 2. Replicate schema from this repo
supabase link --project-ref <tago-dev-project-ref>
supabase db push    # applies every migration in supabase/migrations/

# 3. Copy .env.example → .env and point at the new dev project
cp .env.example .env
# Edit VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# Keep STRIPE_SECRET_KEY=sk_test_… and VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…

# 4. Configure the Stripe TEST webhook
#    Stripe Dashboard → Developers → Webhooks (Test view) → endpoint = your
#    local tunnel URL → copy the signing secret into STRIPE_WEBHOOK_SECRET

# 5. Run
npm install
npm run dev          # Vite (frontend on :5173)
npm run dev:server   # Express (backend on :3001)
```

---

## Scripts

```bash
npm run dev          # Vite dev server
npm run dev:server   # Express dev server (tsx, --env-file=.env)
npm run build        # tsc -b && vite build
npm run lint         # ESLint, --max-warnings 0
npm test             # Vitest
```

CI runs `lint`, `test`, and `build` on every PR
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).
