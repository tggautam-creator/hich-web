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
time_cost_cents = round(duration_min * 8)           // 8 cents/min
base_cents      = 200                               // $2.00 base
raw             = base_cents + gas_cost_cents + time_cost_cents
fare_cents      = max(500, min(4000, raw))          // $5 minimum, $40 maximum
platform_fee_cents = 0                              // driver keeps 100% during MVP
driver_earns_cents = fare_cents
```
Default: mpg=25, gas_price=$3.50/gal

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

## Definition of Done (every task)
A task is not done until all three pass:
1. `npm test -- --run` — all tests pass, including tests for the feature just built
2. `npm run lint` — zero errors
3. `npm run build` — builds without errors
