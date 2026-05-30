# TAGO — Claude Code Context

## What This App Is
Carpooling PWA for university students. `.edu` email is the trust layer. Riders request rides, drivers get push notifications and accept. A QR code scan starts the ride and a second QR scan ends it and triggers payment. No driver needs to manually post anything.

## Current State
Live production. Web (Vercel) + iOS (TestFlight) + Express API (EC2) all serving real users. No "MVP" framing — every shipped feature is held to production polish. Drifts vs the iOS reference (which is the source of truth for UX) get closed in the same sprint, not deferred.

---

## Stack
- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS — all colours via `src/lib/tokens.ts`, never raw hex
- **State:** React Query for server state, Zustand for client UI state
- **Database:** Supabase (PostgreSQL + PostGIS + Realtime + Auth + Storage)
- **Backend:** Node.js + Express in `/server`
- **Payments:** Stripe Connect — live mode in production (EC2 + Vercel build), test mode in `dev` (see "HARD RULE — Prod environment values on prod" below)
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
platform_fee_cents = 0                              // current policy — driver keeps 100%
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
- **Stage 4:** ML model — future roadmap item. Do not build until explicitly scoped.

## Critical Constraints
- **Emergency button** — always in a React portal at the top of the DOM tree. Never inside conditional renders. Never inside a menu.
- **Rider active ride screen** — the PRIMARY end-ride path is "Scan QR to End Ride". A gated secondary "End ride without QR" button is allowed for the radio-loss case (Phase 3.4, 2026-05-23) but MUST stay hidden until the ride has been active for both >5 minutes AND >1 km of GPS distance. Without the gate the rider could end early after 100m and pay only the $5 minimum. The driver-side mirror has the same gate. Anything outside that window stays QR-only on both surfaces.
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

---

## iOS-parity audit — web-side rules (added 2026-05-22)

These rules govern any session that's porting iOS features to the web (the multi-stage parity audit tracked in `WEB_PARITY_PROGRESS.md`). They mirror `ios/CLAUDE.md` but flipped — for new features, **iOS is the source of truth**, web is the platform doing the catching-up. For older flows where web shipped first (auth, fare math, server contracts), web stays canonical.

### Reading order at audit time (hard rule)

Before changing a single line of web code in a parity sprint, read in this order, end to end, no skimming:

1. `WEB_PARITY_PROGRESS.md` — current stage, last decisions, blockers.
2. `WEB_PARITY_REPORT_2026-05-22.md` (current report) — scope of the active stage.
3. The relevant **iOS file(s)** in `ios/Tago/Features/<Area>/`. Top to bottom. Enumerate every screen, every button, every state branch, every endpoint call, every server route reference.
4. The relevant **iOS endpoint definitions** in `ios/Tago/Core/Networking/Endpoints/<Area>*Endpoint.swift`. These tell you the exact request/response shape iOS expects.
5. The current web counterpart in `src/components/**/*` or `src/lib/*`. End to end.
6. The corresponding **Vitest tests** for the web counterpart.
7. The **server route(s)** the feature calls in `server/routes/*.ts`.
8. Any **Supabase migrations** touching the relevant tables in `supabase/migrations/*.sql` — especially anything ≥086.

Skipping this read is how features ship missing buttons / banners / endpoints. Trust erodes fast. Before writing code, list every iOS user-visible element + every endpoint hit in your plan and mark each as "shipping this slice" or "deferring because X" so Tarun can veto.

### iOS planning markdowns are off-limits during audits (hard rule, added 2026-05-30)

When auditing an iOS feature for parity, **only read iOS source code** (`*.swift`), the matching `supabase/migrations/*.sql`, and the matching `server/routes/*.ts`. Do NOT read iOS planning / spec markdown files — `ios/REPORTS_IOS_PLAN.md`, `ios/IOS_PROGRESS.md`, `ios/IOS_ROADMAP.md`, `docs/REPORTS_PLAN.md`, `docs/V1_2_PLAN.md`, `docs/BOARD_REDESIGN_PLAN.md`, `docs/SMART_SEARCH_PLAN.md`, or any other `*_PLAN.md` / `*_PROGRESS.md` under `ios/` or `docs/`.

**Why:** Tarun's iOS planning docs are not kept in sync with the shipped iOS code. Reading them produces audit findings that describe what was *planned* rather than what *ships* — phases get re-scoped, deferred items get cut, surprise features get added — and the markdowns lag behind. Reading source-of-truth code avoids the drift entirely.

**How to apply:**
- For every parity stage, the file list is: iOS `.swift` files in `Features/<Area>/` and `Core/Networking/Endpoints/`, iOS models in `ios/Tago/Models/`, the web counterpart, the matching server route, the matching migrations. That's it.
- If you find yourself reaching for a `*_PLAN.md`, stop. Grep the iOS source for the feature name and read those files instead.
- If a stage row in [WEB_PARITY_REPORT_2026-05-22.md](WEB_PARITY_REPORT_2026-05-22.md) cites a planning markdown as a scope input, ignore that reference and discover scope from the iOS source tree.
- The only markdowns whitelisted for parity audits are `CLAUDE.md`, `WEB_PARITY_PROGRESS.md`, and `WEB_PARITY_REPORT_*.md` — those are web-side audit-state, not iOS plans.

### `WEB_PARITY_PROGRESS.md` is the scoreboard — keep it live (hard rule)

The same rule iOS has for `IOS_PROGRESS.md` applies on the web side. At session start, read it. While working, flip `[ ]` → `[~]` the moment a task starts, append decisions to the relevant sprint section as they happen, and on completion flip `[x]` with a short note + update the summary table counts + the "Current focus" line.

A sprint that ships but leaves the progress file stale is a half-done sprint. Don't wait to be told.

### iOS is the source of truth for new features (hard rule, 2026-05-22)

For every feature added on iOS first (everything migrated ≥086 — Reports v2, Caregivers, Accessibility, Suggestions, Trips, Rider Routines, Board Redesign, Smart Geo-Match, Live Activity, Admin Campaigns), iOS is canonical. Web should copy the iOS UX (sheet vs page, copy strings, button order, empty states, error handling) before adding any web-only innovation.

For older flows where web shipped first (auth + onboarding, fare formula in `src/lib/fare.ts`, the historical payment server contract, the matching stages 1-4), **web stays canonical**. iOS came second on those.

When in doubt about which platform is canonical for a specific behaviour: check the migration number. New tables (≥086) → iOS canonical. Older tables → web canonical or already parity-locked.

### Web parity — copy closely, then improve (hard rule, mirrored from iOS)

For every iOS feature being ported:

1. Read the matching iOS file(s) end-to-end (per the Reading Order rule).
2. Enumerate every visible element + every behaviour iOS has and plan to match them 1:1 first.
3. Layer on web-native upgrades only on top of parity — never instead of it. (Web-native means: deep-linkable routes, keyboard shortcuts, SEO, browser back, copy-paste of values.)
4. Scope cuts must be called out in your plan so Tarun can veto before you start writing TypeScript.

The user's repeated feedback: "copy from iOS as close as possible." Not "invent something different." If in doubt, match iOS behavior exactly and upgrade the chrome.

### Tough self-review before any handoff (hard rule)

After every slice — even after the three Definition-of-Done gates pass — do a reviewer pass against the iOS source files:

1. Re-read the iOS file(s) with fresh eyes against the new web code.
2. Walk every iOS user-visible element and confirm the web build has a matching behaviour OR an explicit deferral.
3. Walk every error / empty / loading state on both platforms.
4. Confirm the web build hits the same endpoints with the same payload shape iOS does.
5. List anything that drifted in the QA prompt to Tarun before asking him to test.

Missing this step is how features look right but behave differently from iOS. The user has been burned enough times that this is now mandatory.

### Reviewer parity-check before every slice handoff (hard rule, added 2026-05-30)

Stronger than the tough-self-review rule above. After EVERY slice — even ones that pass lint + tests + build cleanly — a dedicated reviewer pass MUST verify iOS↔web parity for the slice's feature area, and the handoff message MUST contain the reviewer's verdict. Tarun has been burned by drift sneaking through "looks fine to me" self-reviews; from 2026-05-30 the reviewer pass is a separate, explicit step.

**Who reviews:** the same session can play reviewer (no need to spawn a sub-agent unless the slice is large enough to warrant fresh eyes). The point is the SEPARATE, STRUCTURED pass — not who runs it.

**What the reviewer must do (each slice):**
1. Open every iOS source file (`.swift`) the slice touches OR mirrors, end-to-end. No skimming. Same files cited in the audit findings count as the canonical iOS surface.
2. Walk every user-visible element on iOS: every button, label, copy string, empty state, error state, loading state, gating predicate, sub-row, footer, success state, push notification handler. For each, decide: ✅ matches on web / ⚠️ drifted on web (call out exactly how) / ➖ explicitly deferred for a later slice (cite the slice).
3. Verify the wire shape: every server endpoint the slice touches receives the same payload keys + types on web as on iOS. Verify by reading the actual write call sites on both platforms, not by trusting comments.
4. Verify the read shape: every server field the slice surfaces is decoded + rendered on web the same way iOS renders it (or explicitly deferred).
5. Produce a parity verdict matrix in the handoff message with columns: `iOS element / web counterpart / verdict`. Use `:white_check_mark:` / `:warning:` / `:heavy_minus_sign:`. Tarun reads this before deciding to push.

**The handoff message structure (mandatory):**
- One-paragraph summary of what the slice ships
- The parity verdict matrix (see above)
- Outstanding gaps the reviewer flagged
- Test + lint + build gate status
- Plain English summary
- "What's next" pointer to the next slice
- The "awaiting your go" line per the per-feature green-light rule

**What this rule replaces:** the "Tough self-review before any handoff" rule above is the floor; this rule layers a structured parity matrix on top so drift never sneaks through unnoticed. Self-review is "I checked my own code"; parity review is "I confirmed web matches iOS or flagged exactly what drifted."

**Anti-patterns this rule blocks:**
- Shipping a slice and saying "looks good, matches iOS" without the matrix.
- Burying parity gaps in prose instead of a matrix row.
- Marking a parity gap as ✅ because the column is "kind of similar" — the only acceptable verdicts are full match, explicit drift, or explicit deferral.
- Calling the reviewer pass "done" when an iOS element wasn't enumerated at all (silent omission is failure).

**Mandatory exception:** a slice that's pure docs / rules / tests (no user-visible behaviour change) can skip the parity matrix but MUST still note "N/A — no user-visible parity surface in this slice" in the handoff so Tarun sees the reviewer made the call deliberately.

### Don't push without Tarun's "go" (hard rule, from memory)

The per-feature green-light memory rule applies here too. After every slice:
1. Lint + tests + build green.
2. Tough self-review pass complete + findings reported.
3. **Stop and wait** for Tarun's explicit "go" / "push" / "ship it" before pushing the next slice.

The audit advances one slice at a time, not one sprint at a time.

### Instant-ride UX must feel like Uber (mirrored from iOS)

The full iOS rule applies on web too. For the request → match → waiting room → en-route pickup → active ride → drop-off → summary loop (plus every cancel / change / chat inside it), the bar is Uber-class — not just "does the same thing as before." Web shipped a lot of this in Sprints 1–4 already (DriverCancelledOverlay, optimistic chat bubbles, two-step accept, etc.). Keep the bar high.

### What's off-limits without user approval

- Anything under `ios/`, `supabase/migrations/`, or `server/routes/` that's actively being changed by the parallel admin / v1.2 session. Check `git status` for files modified within the last hour — if another session is editing them, flag and wait. (Mirrors the iOS-side "wait for parallel session" memory rule.)
- Deleting files outside the slice scope.
- `git push` without explicit "go" / "push" / "ship it" (per the per-feature green light memory).
- Force-pushing to main. Ever. Without explicit user request.
- Adding a new npm dependency (ask first — dependencies are a long-term cost).
- Changing `tsconfig.*.json`, `vite.config.ts`, or `package.json` "scripts" without flagging it.
- Changing the production Stripe keys, Supabase project URL, or Firebase project ID. (The HARD RULE above already covers this.)
