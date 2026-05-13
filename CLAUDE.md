# TAGO — Claude Code Context

## What This App Is
Carpooling PWA for university students. `.edu` email is the trust layer. Riders request rides, drivers get push notifications and accept. A QR code scan starts the ride and a second QR scan ends it and triggers payment. No driver needs to manually post anything.

## Current State
Week 8 — MVP feature-complete. Analytics, CI, code splitting done.

---

## Stack
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS — all colours via `src/lib/tokens.ts`, never raw hex
- **State:** React Query for server state, Zustand for client UI state
- **Database:** Supabase (PostgreSQL + PostGIS + Realtime + Auth + Storage)
- **Backend:** Node.js + Express in `/server`
- **Payments:** Stripe (test mode for entire MVP)
- **Push notifications:** Firebase Cloud Messaging (FCM)
- **Maps:** @vis.gl/react-google-maps (Google Maps JS API)
- **Testing:** Vitest
- **Linting:** ESLint with typescript-eslint
- **Analytics:** PostHog (posthog-js)
- **CI:** GitHub Actions (`.github/workflows/ci.yml`)

## Folder Structure
```
src/
  components/
    ui/         — base components: PrimaryButton, SecondaryButton, InputField, Card, DayPill, BottomSheet
    map/        — map-related components
    ride/       — ride flow screens
    schedule/   — scheduling and routine screens
    auth/       — authentication screens
  lib/
    supabase.ts    — typed Supabase client
    env.ts         — validates all env vars exist at startup, throws if missing
    tokens.ts      — design tokens (single source of truth for all colours)
    geo.ts         — calculateInterceptPoint and bearing utilities
    fare.ts        — fare calculation
    analytics.ts   — PostHog analytics wrapper
  stores/
    authStore.ts
    rideStore.ts
  types/
    database.ts — TypeScript types for all Supabase tables
  test/
    e2e/        — end-to-end tests
server/
  routes/       — Express route handlers
  middleware/   — auth validation, error handling
  lib/          — server-side utility modules
```

## Environment Variables
All accessed through `src/lib/env.ts` only — never `import.meta.env` directly in components.
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_GOOGLE_PLACES_KEY
VITE_STRIPE_PUBLISHABLE_KEY
VITE_POSTHOG_KEY          (optional)
VITE_POSTHOG_HOST         (optional)
FCM_SERVER_KEY
QR_HMAC_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

## Key Conventions
- **Money:** always in cents (integers). `fare_cents`, `wallet_balance`, `amount_cents`. Display only as dollars. Never floats.
- **Design tokens:** import from `src/lib/tokens.ts`. Never use raw hex values in components.
- **Server state:** React Query. Never `useState` + `useEffect` for API calls.
- **Client state:** Zustand only.
- **API errors:** every endpoint returns `{ error: { code: string, message: string } }` on failure.
- **TypeScript:** strict mode. Never `any`. Use `unknown` and narrow it.
- **Every component** accepts a `data-testid` prop.
- **Code splitting:** use `React.lazy` for route-level components. Keep initial bundle small.
- **Analytics:** track events via `src/lib/analytics.ts`. Never import posthog-js directly in components.
- **CI:** all PRs must pass `.github/workflows/ci.yml` (lint, test, build) before merge.

## Fare Formula
```
gas_cost_cents  = round((distance_km * 0.621371 / mpg) * gas_price_per_gallon * 100)
time_cost_cents = round(duration_min * 5)           // 5 cents/min (was 8 before 2026-05-01)
raw             = gas_cost_cents + time_cost_cents  // base fare removed 2026-05-01
fare_cents      = max(500, raw)                     // $5 minimum, no upper cap (removed 2026-04-24)
platform_fee_cents = 0                              // driver keeps 100% during MVP
driver_earns_cents = fare_cents
```
Default: mpg=25. `gas_price_per_gallon` comes from EIA via `GET /api/gas-price?state=CA`
(server-cached 6h, iOS-cached 30min via `GasPriceStore`); falls back to $3.50 if EIA is
unreachable.

## Matching — What to Build (read before touching any notification code)
The matching logic has stages. Build in order, do not skip ahead.
- **Stage 1:** notify all drivers — build this first, ship it, confirm a push arrives on a real phone
- **Stage 2:** PostGIS 15km radius filter — add this same week once Stage 1 works
- **Stage 3:** bearing filter — only applies when a driver has a saved route in `driver_routines`. If no saved route → Stage 2. Only add Stage 3 in Week 4 when scheduling is built.
- **Stage 4:** ML model — Phase 2, not MVP. Do not build.

## Critical Constraints
- **Emergency button** — always in a React portal at the top of the DOM tree. Never inside conditional renders. Never inside a menu.
- **Rider active ride screen** — has NO End Ride button. Only "Scan QR to End Ride". Enforce in component and test.
- **Wallet transactions** — debit + credit always in a single database transaction (`BEGIN / COMMIT`). Never separate queries.
- **QR tokens** — HMAC-signed. Reject any token without a valid signature.
- **License photos** — stored in a private Supabase Storage bucket. Never a public URL.
- **JWT** — validate on every API endpoint before any other logic. Return 401 if invalid.

## HARD RULE — Prod environment values on prod
Added 2026-05-12 by Tarun: every production environment MUST use prod
infra exclusively. Never mix dev and prod values. This applies to BOTH
the EC2 Express server AND the Vercel web build.

**On the EC2 server (`/home/ubuntu/hich-web/.env` or whatever PM2
loads):**
| Variable | Prod value | What goes wrong with dev value |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_*` (Account B) | Real charges go to test mode; drivers see fake earnings that never deposit |
| `STRIPE_WEBHOOK_SECRET` | `whsec_*` of the **live** Stripe endpoint | Webhook signature validation fails; payments succeed but the ride row never flips to `paid` |
| `SUPABASE_URL` | `https://pdxtswlaxqbqkrfwailf.supabase.co` | Rides / wallet / users data scattered into the dev project, invisible to ops |
| `SUPABASE_SERVICE_ROLE_KEY` | The JWT for the prod project | API requests bounce with auth errors |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `./firebase-service-account.json` (prod key) | FCM pushes return `mismatched-credential`; users never get notifications |
| `VITE_FIREBASE_PROJECT_ID` | `hich-6f501` | Same as above |
| `NODE_ENV` | `production` | The fail-fast guards in `server/index.ts` only fire when this is set; without it, misconfigs run silently |

**On the Vercel build (production env vars in Vercel dashboard, also
matches the local `.env` for `npm run build`):**
- `VITE_SUPABASE_URL` → `https://pdxtswlaxqbqkrfwailf.supabase.co`
- `VITE_FIREBASE_PROJECT_ID` → `hich-6f501`
- `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_51T9AU79…`
- All other `VITE_FIREBASE_*` keys → the prod project

**Enforcement (already wired):**
- `server/index.ts` boot guards `process.exit(1)` if `NODE_ENV=production`
  AND any of (`sk_test_*` secret, dev Supabase URL, `.dev.json` service
  account path) is detected. This trips PM2's restart loop, so a
  misconfigured deploy crashes immediately instead of silently mis-routing
  data.
- `vite.config.ts` `assertProdEnv()` aborts the build (`process.exit(1)`)
  when `mode='production'` AND the resolved env points at the dev
  project. Vercel's build log shows the failure.

**What this rule blocks:**
- Running prod EC2 with the dev `.env.dev` file by mistake
- Pushing a webapp build that's pointed at dev Supabase to www.tagorides.com
- Symlinking `.env → .env.dev` and then running `npm run build` without
  thinking
- Forgetting to update Vercel env vars when rotating prod credentials

**Override path:** if there's a legitimate need (e.g. a staging
deployment that uses dev infra deliberately), update both the boot
guard and the Vite assert to recognize the new mode (`mode='staging'`
or similar). Don't disable the guards.

## Definition of Done (every task)
A task is not done until all three pass:
1. `npm test -- --run` — all tests pass, including tests for the feature just built
2. `npm run lint` — zero errors
3. `npm run build` — builds without errors
