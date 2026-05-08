# Tago environments — dev vs prod

Created 2026-05-05. **Layout simplified 2026-05-07** — no more symlink swap, no more `use-env.sh`. See "What changed" at the bottom for the migration notes.

Tago runs in two parallel environments so you can iterate without polluting real data. Schema is mirrored via the same `supabase/migrations/` files; only the data and the credentials differ.

## At-a-glance

| Layer | Dev (Debug build) | Prod (Release build) |
|---|---|---|
| Supabase project | `tago-dev` (`krcwdzwqahcpqsoauttf`) | `pdxtswlaxqbqkrfwailf` |
| Server `.env` | `.env.dev` (local Mac) | `.env.prod` (EC2 `3.139.90.248`) |
| iOS xcconfig | `ios/Tago.local.xcconfig` (gitignored) | `ios/Tago.Release.xcconfig` (committed) |
| iOS bundle ID | `com.tago.rides.dev` | `com.tago.rides` |
| API host (iOS) | `Taruns-MacBook-Air.local:3001` (local Mac) | `www.tagorides.com` (EC2) |
| Stripe mode | TEST (`pk_test_*`/`sk_test_*` from Account A) | LIVE (`pk_live_*` Account B; **EC2 must match**) |
| Firebase project | `tago-dev-e3ade` | `hich-6f501` |
| iOS Firebase plist | `Tago/GoogleService-Info-Dev.plist` | `Tago/GoogleService-Info-Prod.plist` |
| Server FCM admin JSON | `firebase-service-account.dev.json` | `firebase-service-account.json` |
| Stripe webhook secret | shared with prod (split later) | shared |
| Twilio / EIA / AutoDev / Google Maps | shared with prod | shared |

## How dev vs prod gets selected (no more swapping)

After 2026-05-07 cleanup, build configuration alone decides which environment the app talks to. There is no symlink swap, no helper script, no manual file ceremony.

| Build action | Configuration | Reads | Bundle ID | Backend |
|---|---|---|---|---|
| Xcode → Run (⌘R) | Debug | `Tago.xcconfig` → `#include? Tago.local.xcconfig` | `com.tago.rides.dev` | Dev |
| Xcode → Archive | Release | `Tago.Release.xcconfig` (no local include) | `com.tago.rides` | Prod |

The Firebase plist is selected at runtime by `AppDelegate.configureFirebaseForBuildFlavor()` via `#if DEBUG`. A runtime project-ID assert verifies the right plist loaded — if it ever gets misconfigured, the app crashes on launch with a clear message instead of silently registering tokens against the wrong project.

## Day-to-day workflows

### Local dev session (most common)

```bash
# Server — points at dev Supabase + dev Firebase
npm run dev:server          # tsx watch --env-file=.env.dev

# iOS — Xcode → Run on iPhone 17 sim. Done.
# (No xcconfig swap, no use-env.sh.)
```

### Pushing to TestFlight

```bash
# Xcode → Product → Archive  (always uses Release config = prod backend)
# Window → Organizer → Distribute App → TestFlight
```

The dev app and the TestFlight prod app coexist on the same iPhone (different bundle IDs). You can sideload dev via Xcode's Run target while keeping the TestFlight prod build installed.

### Apply a new migration

Migrations land on **dev first**, prod second.

```bash
# 1. Write the migration file in supabase/migrations/NNN_name.sql

# 2. Apply to dev
export SUPABASE_ACCESS_TOKEN=<your sbp_… token>
supabase link --project-ref krcwdzwqahcpqsoauttf --password '<dev DB password>'
supabase db push --password '<dev DB password>'

# 3. QA on the dev iOS app (Xcode → Run)

# 4. Once verified, link to prod and apply
supabase link --project-ref pdxtswlaxqbqkrfwailf --password '<prod DB password>'
supabase db push --password '<prod DB password>'

# 5. Re-link back to dev for next iteration
supabase link --project-ref krcwdzwqahcpqsoauttf --password '<dev DB password>'
```

## Production source of truth — EC2 `.env`

**Repo `.env.prod` is a TEMPLATE, not the runtime prod file.** The actual production environment lives on EC2 at `/home/ubuntu/hich-web/.env` and is manually maintained there. The PM2 process loads `--env-file=.env`, not `.env.prod`.

The Stripe LIVE secrets diverged from the repo when EC2 was provisioned — someone updated the box directly without pushing the change back. As of 2026-05-07 the repo's `.env.prod` has the dangerous Stripe values replaced with `sk_live_REPLACE_FROM_EC2` / `whsec_REPLACE_FROM_EC2` placeholders so a misdeploy fails loudly instead of charging fake test cards in prod.

**To deploy / restore prod:**

```bash
# 1. SSH to EC2
ssh ubuntu@3.139.90.248
cd /home/ubuntu/hich-web

# 2. Confirm the running env has live Stripe (sanity check, see "How to verify" below)
grep -E "^STRIPE_SECRET_KEY|^STRIPE_WEBHOOK_SECRET" .env | awk -F= '{print $1"="substr($2,1,15)"…"}'

# Expected:
#   STRIPE_SECRET_KEY=sk_live_51T9AU7…
#   STRIPE_WEBHOOK_SECRET=whsec_<live-endpoint-secret>…
# If you see sk_test_*, payments are broken — fetch live values from
# Stripe dashboard → LIVE mode → Developers → API keys / webhook endpoint
# and update the file:
nano .env
pm2 restart tago-server
```

**To bring up a brand-new EC2 instance:**

```bash
# On the new box:
git clone <repo>
cd hich-web && cp .env.prod .env       # template values
nano .env                              # ⚠️  fill in sk_live_* + whsec_* from Stripe
npm ci && pm2 start ecosystem.config.cjs
```

**Never** edit prod Stripe values in the repo's `.env.prod`. That file is the template; EC2's `.env` is the truth.

## Files

- `.env.dev` — dev server secrets (gitignored). Used by `npm run dev:server`.
- `.env.prod` — **template only** (gitignored). See "Production source of truth" above. Real prod env is `/home/ubuntu/hich-web/.env` on EC2.
- `ios/Tago.local.xcconfig` — dev iOS values (gitignored via `*.local.xcconfig`). Single file, no variants.
- `ios/Tago.local.xcconfig.example` — template; `cp` and edit on a fresh checkout.
- `ios/Tago.Release.xcconfig` — committed prod iOS values. Includes a ⚠️ Stripe-key warning above the `pk_live_*` line.
- `ios/Tago/GoogleService-Info-Dev.plist` — dev Firebase config (gitignored).
- `ios/Tago/GoogleService-Info-Prod.plist` — prod Firebase config (gitignored).
- `firebase-service-account.dev.json` — dev server FCM admin JSON (gitignored).
- `firebase-service-account.json` — prod server FCM admin JSON (gitignored).

## What's NOT split yet (intentional shortcuts)

These are shared across dev + prod for now to keep the initial cutover small. Each is a follow-up task you can promote when it starts hurting.

| Item | Risk of sharing | Promote when |
|---|---|---|
| Stripe webhook endpoint | Dev events show in prod Stripe events log | First time you can't tell which env caused a payment_failed |
| Apple Pay merchant ID | `merchant.com.tago.rides` only — dev (`com.tago.rides.dev`) Apple Pay is not testable | When you actually need to QA Apple Pay on dev (vs only TestFlight) |
| Universal Links AASA | Only `com.tago.rides` listed at `www.tagorides.com/.well-known/apple-app-site-association` — dev bundle's magic-link / Stripe-Connect-return callbacks fall back to Safari | When you need to test the Universal Link flow against dev backend |
| Stripe webhook secret | Same as endpoint — one webhook signs both | Same as above |
| Google Maps key | One quota pool | First time dev burning quota throttles prod |

## Post-migration checklist (one-time, after `supabase db push` completes)

The migration files cover schema (tables, RLS, functions, triggers). They do NOT cover everything. After the first push to `tago-dev`, walk through these in the Supabase dashboard for project `krcwdzwqahcpqsoauttf`:

### 1. Storage buckets
**Settings → Storage → Buckets**

Create the same buckets as prod (`pdxtswlaxqbqkrfwailf` → Storage). At minimum:
- `avatars` — public, 5 MB limit, image MIME types only
- `vehicle-photos` — public, 5 MB limit
- `licenses` — **PRIVATE** per CLAUDE.md "License photos must be in a private Supabase Storage bucket. Never a public URL."

Mirror the RLS policies on each bucket from prod (Storage → bucket → Policies tab). Most are "users can read/write their own folder" patterns.

### 2. Auth providers
**Authentication → Providers**

- **Email**: enabled. Confirm email = OFF for dev so test accounts can be made instantly without checking inbox.
- **Phone (Twilio)**: same Twilio Account SID / Auth Token / Service SID as prod, OR provision Twilio test creds. With `TAGO_SKIP_PHONE_VERIFICATION = YES` in `ios/Tago.local.xcconfig`, the iOS dev variant bypasses OTP, so Twilio in dev can be left empty if you only test via dev iOS.

### 3. Realtime publications
**Database → Replication**

Enable realtime for the same set of tables prod has it on. Walk the prod project's Replication tab and mirror the toggles. Common ones: `messages`, `rides`, `ride_offers`, `notifications`, `driver_locations`, `ride_schedules`, `live_activity_tokens`, `payment_nudges`, `trusted_contacts`.

### 4. Email templates
**Authentication → Email Templates**

Optional. Default templates work fine for dev. Match prod copy if you care about parity.

### 5. Auth redirect URLs
**Authentication → URL Configuration**

Add:
- `http://localhost:5173` (Vite dev)
- `http://Taruns-MacBook-Air.local:5173` (LAN dev)
- `tago://` (iOS deep link)
- `https://www.tagorides.com` (web prod, if dev iOS ever opens prod web links)

### 6. Database password rotation (optional, recommended)

The password you used during link is now stored only on your machine. Rotate it via **Settings → Database → Reset database password** if you want a fresh one. Update local notes.

### 7. Service role key warning

The dev `service_role_key` lives in `.env.dev`. Treat it like a prod secret — never commit, never paste in chat without redaction. Anyone with this key can read/write any row in your dev DB.

---

## What changed in 2026-05-07 cleanup

**Removed:**
- `ios/Tago.local.dev.xcconfig` (renamed to `ios/Tago.local.xcconfig`)
- `ios/Tago.local.prod.xcconfig` (deleted — never actually used in practice)
- `ios/use-env.sh` (deleted — no env to swap)
- `ios/check-prod-ready.sh` (deleted — no symlinks to verify)
- `ios/Tago/GoogleService-Info.plist` symlink (deleted — runtime selection via `#if DEBUG`)

**Added:**
- `AppDelegate.configureFirebaseForBuildFlavor()` — picks Dev or Prod plist by build flavor with a runtime project-ID assert.

**Why:** the symlink dance drifted out of sync once (FCM cross-project token bug, fixed by commit `28ba6cf`). Single-config-per-build with a runtime safety check eliminates the entire failure mode and removes ~60 lines of helper-script ceremony.
