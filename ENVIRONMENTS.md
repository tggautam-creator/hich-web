# Tago environments — dev vs prod

Created 2026-05-05.

Tago runs in two parallel environments so you can iterate without polluting
real data. Schema is mirrored via the same `supabase/migrations/` files;
only the data and the credentials differ.

## At-a-glance

| Layer | Dev | Prod |
|---|---|---|
| Supabase project | `tago-dev` (`krcwdzwqahcpqsoauttf`) | `pdxtswlaxqbqkrfwailf` |
| Server `.env` | `.env.dev` (local Mac) | `.env.prod` (EC2 `3.139.90.248`) |
| iOS xcconfig | `Tago.local.dev.xcconfig` | `Tago.local.prod.xcconfig` |
| iOS bundle ID | `com.tago.rides` (split to .dev later) | `com.tago.rides` |
| API host (iOS) | `Taruns-MacBook-Air.local:3001` (local Mac) | `3.139.90.248:3001` (EC2) |
| Stripe mode | TEST (`sk_test_*`) | TEST → LIVE eventually |
| Firebase project | `tago-dev-e3ade` | `hich-6f501` |
| iOS Firebase plist | `Tago/GoogleService-Info-Dev.plist` | `Tago/GoogleService-Info-Prod.plist` |
| Server FCM admin JSON | `firebase-service-account.dev.json` | `firebase-service-account.json` |
| Stripe webhook secret | shared (split later) | shared |
| Twilio / EIA / AutoDev / Google Maps | shared with prod | shared |

## Day-to-day workflows

### Local dev session (most common)

```bash
# Server — points at dev Supabase
npm run dev:server          # already wired to load .env.dev (verify package.json)

# iOS — flip the symlink, rebuild
cd ios
ln -sf Tago.local.dev.xcconfig Tago.local.xcconfig
xcodegen generate
xcodebuild -project Tago.xcodeproj -scheme Tago \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

### Switching iOS between dev and prod

A helper script handles BOTH the xcconfig and the Firebase `GoogleService-Info.plist` swap in one command (forgetting the plist swap was an easy mistake):

```bash
cd ios
./use-env.sh dev    # active config: dev Supabase + dev Firebase
./use-env.sh prod   # active config: prod Supabase + prod Firebase
```

The script symlinks both files and re-runs xcodegen automatically. After it
finishes, build + install as usual:

```bash
xcodebuild -project Tago.xcodeproj -scheme Tago \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

### Apply a new migration

Migrations land on **dev first**, prod second.

```bash
# 1. Write the migration file in supabase/migrations/NNN_name.sql
# 2. Apply to dev
export SUPABASE_ACCESS_TOKEN=<your sbp_… token>
supabase db push --password '<dev DB password>'

# 3. QA in iOS Tago Dev (the dev variant of the app)

# 4. Once verified, link to prod and apply
supabase link --project-ref pdxtswlaxqbqkrfwailf --password '<prod DB password>'
supabase db push --password '<prod DB password>'

# 5. Re-link back to dev for next iteration
supabase link --project-ref krcwdzwqahcpqsoauttf --password '<dev DB password>'
```

## Files

- `.env.dev` — dev server secrets (gitignored).
- `.env.prod` — prod server secrets (gitignored). Lives on EC2 too.
- `ios/Tago.local.dev.xcconfig` — dev iOS values (gitignored via `*.local.xcconfig`).
- `ios/Tago.local.prod.xcconfig` — prod iOS values (gitignored).
- `ios/Tago.local.xcconfig` — ACTIVE config. Symlink to dev or prod.

## What's NOT split yet (intentional shortcuts)

These are shared across dev + prod for now to keep the initial cutover small.
Each is a follow-up task you can promote when it starts hurting.

| Item | Risk of sharing | Promote when |
|---|---|---|
| Stripe webhook endpoint | Dev events show in prod Stripe events log | First time you can't tell which env caused a payment_failed |
| Firebase / FCM project | Dev push tokens mixed in prod token table; APNs test pushes go to dev devices | First time a test push lands on a real user's phone |
| Google Maps key | One quota pool | First time dev burning quota throttles prod |
| iOS bundle ID | Can't have dev + prod app installed at same time | When you start needing both on one phone (Phase 4 of CTO plan) |

## Post-migration checklist (one-time, after `supabase db push` completes)

The migration files cover schema (tables, RLS, functions, triggers). They
do NOT cover everything. After the first push to `tago-dev`, walk through
these in the Supabase dashboard for project `krcwdzwqahcpqsoauttf`:

### 1. Storage buckets
**Settings → Storage → Buckets**

Create the same buckets as prod (`pdxtswlaxqbqkrfwailf` → Storage). At
minimum:
- `avatars` — public, 5 MB limit, image MIME types only
- `vehicle-photos` — public, 5 MB limit
- `licenses` — **PRIVATE** per CLAUDE.md "License photos must be in a
  private Supabase Storage bucket. Never a public URL."

Mirror the RLS policies on each bucket from prod (Storage → bucket →
Policies tab). Most are "users can read/write their own folder" patterns.

### 2. Auth providers
**Authentication → Providers**

- **Email**: enabled. Confirm email = OFF for dev so test accounts can be
  made instantly without checking inbox.
- **Phone (Twilio)**: same Twilio Account SID / Auth Token / Service SID
  as prod, OR provision Twilio test creds. With `TAGO_SKIP_PHONE_VERIFICATION
  = YES` in `Tago.local.dev.xcconfig`, the iOS dev variant bypasses OTP, so
  Twilio in dev can be left empty if you only test via dev iOS.

### 3. Realtime publications
**Database → Replication**

Enable realtime for the same set of tables prod has it on. Walk the prod
project's Replication tab and mirror the toggles. Common ones:
`messages`, `rides`, `ride_offers`, `notifications`, `driver_locations`,
`ride_schedules`, `live_activity_tokens`, `payment_nudges`,
`trusted_contacts`.

### 4. Email templates
**Authentication → Email Templates**

Optional. Default templates work fine for dev. Match prod copy if you
care about parity.

### 5. Auth redirect URLs
**Authentication → URL Configuration**

Add:
- `http://localhost:5173` (Vite dev)
- `http://Taruns-MacBook-Air.local:5173` (LAN dev)
- `tago://` (iOS deep link)
- `https://tagorides.com` (web prod, if dev iOS ever opens prod web links)

### 6. Database password rotation (optional, recommended)

The password you used during link is now stored only on your machine.
Rotate it via **Settings → Database → Reset database password** if you
want a fresh one. Update local notes.

### 7. Service role key warning

The dev `service_role_key` lives in `.env.dev`. Treat it like a prod
secret — never commit, never paste in chat without redaction. Anyone
with this key can read/write any row in your dev DB.
