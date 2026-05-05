# Production deployment checklist — Tago

Last verified: 2026-05-05.

This is the single source of truth for "what must be true on EC2 +
Vercel + Stripe + Apple before the iOS build can safely go live in
TestFlight or App Store." Tick each line BEFORE you upload an archive.

---

## 1. EC2 — environment variables

SSH into EC2 and verify each line in `/home/ubuntu/hich-web/.env`:

| Var | Required value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | ✅ Already set per 2026-05-01 audit. Tightens Express error reporting + disables verbose logs. |
| `STRIPE_SECRET_KEY` | `sk_live_…` | ✅ Already LIVE per 2026-05-01 audit. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (LIVE webhook) | Confirm the webhook in Stripe Dashboard → LIVE mode → Webhooks points at `https://www.tagorides.com/api/stripe/webhook` and the secret here matches that endpoint's signing secret. |
| `APNS_USE_SANDBOX` | **`false`** | 🔴 **CRITICAL FLIP** — currently `true` per 2026-05-01 audit. Live Activity push-to-update silently fails on TestFlight + App Store builds when this is `true` because iOS hands those builds production APNs tokens; the server must hit `api.push.apple.com` (prod) not `api.sandbox.push.apple.com` (sandbox). |
| `APNS_AUTH_KEY_PATH` | `/home/ubuntu/keys/AuthKey_4MDTUY444W.p8` | ✅ Already correct. |
| `APNS_KEY_ID` | `4MDTUY444W` | ✅ |
| `APNS_TEAM_ID` | `XFDWGTQH9M` | ✅ |
| `APNS_BUNDLE_ID` | `com.tago.rides` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | (the long JWT) | ✅ Same project for dev + prod is fine. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `/home/ubuntu/.../firebase-service-account.json` | Confirm the file is on disk + readable by the pm2 process user. |
| `EIA_API_KEY` | (your EIA key) | ✅ Free, no rotation needed. |
| `ADMIN_TOKEN` | **rotate** | 🟡 The dev value is in committed `.env.example` history — generate a fresh one for prod via `openssl rand -hex 32`. |
| `QR_HMAC_SECRET` | **rotate** | 🟡 Same reasoning. Rotating invalidates outstanding QR tokens, which is fine since they expire in minutes anyway. |

**Twilio Verify SID** — does NOT need to be in EC2 env. Lives only in
Supabase Dashboard → Authentication → Providers → Phone (already set
to `VAbf2217148431e4a4c059f66ad006e57c` per 2026-05-01). Supabase
calls Twilio Verify directly; the Express server never touches it.

After flipping `APNS_USE_SANDBOX=false`:

```bash
cd ~/hich-web && pm2 restart all && pm2 logs --lines 20
```

Watch for `[APNs] Using production gateway api.push.apple.com` (or
similar) on the next ride-request fan-out to confirm the flip took.

---

## 2. Vercel — environment variables

https://vercel.com/your-project/settings/environment-variables

For **Production** environment only:

| Var | Required value | Notes |
|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | Final swap step. Test mode pk_test_ key is fine for Preview / Development environments. |
| `VITE_SKIP_PHONE_VERIFICATION` | `false` | Twilio Verify is live in Supabase as of 2026-05-04. Web doesn't yet consume this flag (see `src/lib/env.ts:37`), but keep it `false` so the flag matches reality. |
| `VITE_APP_STORE_ID` | (leave unset) | Set to `6763382426` only AFTER the first build is live in App Store. While unset, the Landing page hides the "Get the iOS app" CTA so visitors don't bounce to a 404 App Store URL. |
| `VITE_GOOGLE_MAP_ID` | `afc6d35a59fbd53d63b82275` | Already set per 2026-04-30 audit. Required for `<AdvancedMarker>` rendering on `/safety/track`. |
| `VITE_POSTHOG_KEY` | (your PostHog key) | If analytics ON in prod. |

All other `VITE_*` web vars (Supabase, Firebase, Maps) can be the same
keys as dev — they're public-by-design.

---

## 3. iOS — `Tago.Release.xcconfig` swaps before archive

Open `ios/Tago.Release.xcconfig`:

| Line | Current | Production value | Status |
|---|---|---|---|
| `TAGO_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` | `pk_live_…` from Stripe Dashboard → LIVE mode → API keys | ✅ Swapped 2026-05-05. Verify it lands in the built `Info.plist` with `/usr/libexec/PlistBuddy -c "Print :TagoStripePublishableKey" <built>.app/Info.plist`. |
| `MARKETING_VERSION` | `1.0.0` | Bump for each App Store release (1.0.1, 1.1.0, etc.) | ✅ Correct for v1. |
| `CURRENT_PROJECT_VERSION` | `1` | Bump for **every** archive uploaded to TestFlight / App Store. Apple rejects duplicate build numbers under the same `MARKETING_VERSION`. | Bump on each new upload. |

Everything else in `Tago.Release.xcconfig` is already production-correct
(prod API URL, www. associated-domain, no local-override leakage,
`DEVELOPMENT_TEAM = XFDWGTQH9M`, `TAGO_SKIP_PHONE_VERIFICATION = NO`
since Twilio Verify went live 2026-05-04).

---

## 4. Stripe — LIVE-mode dashboard

https://dashboard.stripe.com (toggle to Live mode in top-left)

- ✅ API keys → publishable + secret keys captured (Step 1 + 3 above)
- Apple Pay → register `merchant.com.tago.rides` + upload the Apple Pay
  Payment Processing Certificate (Apple Developer portal generates it
  via a CSR Stripe gives you).
- Connect → if you have any test-mode connected accounts (drivers who
  ran Stripe Connect onboarding in test), those don't carry over to
  Live. You'll need a fresh onboarding pass on Live for each driver.

### 4a. Stripe webhook — full first-time setup + health check

The Express server **refuses to boot** without `STRIPE_WEBHOOK_SECRET`
(see `server/env.ts:51-52`), and silently rejects every webhook whose
HMAC doesn't match the secret. There are TWO separate secrets — one for
test, one for live — and getting the live one wrong causes a particularly
nasty failure mode: payments succeed on Stripe, money moves, but our
DB never finds out → ride stays `requested`, driver never paid, rider
charged but no receipt.

**First-time LIVE setup (do this BEFORE App Store users hit production):**

1. https://dashboard.stripe.com → flip top-left toggle to **LIVE mode**.
2. Developers → **Webhooks** → "**+ Add endpoint**".
3. Endpoint URL: `https://www.tagorides.com/api/stripe/webhook`
4. **Events to send** — pick at minimum:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
   - `charge.refunded`
   - `charge.dispute.created`
   - `account.updated` (Stripe Connect — driver onboarding completion)
   - `payout.paid`
   - `payout.failed`
   - `transfer.created` (driver payout transfers)
   - `setup_intent.succeeded` (saved-card flow)
   - To be exhaustive: cross-check against the `switch (event.type)`
     branches in `server/routes/stripeWebhook.ts`.
5. Save → click into the new endpoint → **Signing secret** → "Reveal"
   → copy the `whsec_…` value.
6. SSH to EC2:
   ```bash
   ssh ubuntu@<your-ec2-ip>
   nano /home/ubuntu/hich-web/.env
   # Set/replace:  STRIPE_WEBHOOK_SECRET=whsec_…
   pm2 restart all
   pm2 logs --lines 50
   ```
7. Watch for `Server listening on port 3001` (no env-var error). If you
   see `Missing required server env vars: ... STRIPE_WEBHOOK_SECRET`
   the file isn't being read by pm2's user — fix permissions or use
   `pm2 restart all --update-env`.

**Health check (run after first LIVE charge to confirm signature works):**

```bash
# 1. Endpoint is mounted (returns 400 because we sent no signature)
curl -i -X POST 'https://www.tagorides.com/api/stripe/webhook' \
  -H 'Content-Type: application/json' -d '{}'
# Expected: HTTP/1.1 400  (route alive, signature missing)
# 401/404: route NOT deployed, redeploy EC2.
# 502/504: server crashed, check pm2 logs.

# 2. Trigger a $0 test event from Stripe and confirm it lands
#    Stripe Dashboard → LIVE mode → Webhooks → your endpoint
#    → "Send test webhook" → pick `payment_intent.succeeded` → Send
#    Then check the "Events" tab on that endpoint:
#      ✅ HTTP 200  = secret matches, server validated successfully
#      ❌ HTTP 400 ("signature verification failed") = wrong whsec_
#      ❌ HTTP 500 = server crashed processing the event, check pm2 logs

# 3. End-to-end real-world check (after a TestFlight user makes a
#    real $X.XX ride payment on production):
ssh ubuntu@<your-ec2-ip> 'pm2 logs --lines 100 | grep -i stripe'
# Look for:
#   [stripe-webhook] Verified signature, type=payment_intent.succeeded
#   [stripe-webhook] Marked ride <id> as paid
```

**Connect webhooks** — Stripe Connect events (`account.updated`,
`payout.*`, `transfer.*`) are delivered through the SAME endpoint as
long as you check those event types in step 4 above. If you want
Connect events on a separate endpoint (some teams do for traffic
separation), Stripe issues a separate `whsec_…` for that endpoint, and
you'd add a second env var. Today the codebase expects ONE
`STRIPE_WEBHOOK_SECRET` so keep everything on one endpoint unless you
refactor `server/routes/stripeWebhook.ts` first.

**Local-dev webhook** — for local Stripe testing, use the Stripe CLI:
```bash
stripe listen --forward-to localhost:3001/api/stripe/webhook
# CLI prints:  Your webhook signing secret is whsec_…  (copy this)
# Put it in your local .env as STRIPE_WEBHOOK_SECRET=whsec_…
# Restart `npm run dev:server` to pick it up.
```
This secret is DIFFERENT from the LIVE one and changes every time you
restart `stripe listen` — store it in `.env` (gitignored), not anywhere
that ships.

---

## 5. Apple Developer + App Store Connect — pre-flight

- ✅ Bundle ID `com.tago.rides` registered with Push, Associated
  Domains, Apple Pay capabilities enabled.
- ✅ AASA file at `https://www.tagorides.com/.well-known/apple-app-site-association`
  returns 200 with `appIDs: ["XFDWGTQH9M.com.tago.rides"]` (verified
  2026-05-01).
- Distribution certificate + App Store provisioning profile generated
  at developer.apple.com (or auto-managed via Xcode "Automatically
  manage signing").
- App Store Connect listing created with bundle ID, name, screenshots,
  privacy questionnaire, age rating, demo-account credentials in App
  Review Information.

---

## 6. Final pre-archive smoke checklist

Right before you `xcodebuild archive`:

```bash
# 1. Verify Release build is clean
cd ios && xcodebuild -project Tago.xcodeproj -scheme Tago \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -configuration Release build

# 2. Confirm EC2 is on prod APNs gateway (the critical one)
ssh ubuntu@your-ec2 'grep APNS_USE_SANDBOX ~/hich-web/.env'
#   Expected: APNS_USE_SANDBOX=false

# 3. Confirm prod Stripe webhook endpoint is healthy
curl -i -X POST 'https://www.tagorides.com/api/stripe/webhook' \
  -H 'Content-Type: application/json' -d '{}'
#   Expected: 400 (signature missing) — confirms route is mounted.
#   401 / 404 means the route isn't deployed; redeploy EC2.

# 4. Confirm Vercel has the LIVE Stripe publishable key in prod
#    (Settings → Environment Variables → filter on VITE_STRIPE_PUBLISHABLE_KEY)
#    Should show pk_live_… for "Production".
```

Once all 4 return as expected, you're cleared to archive + upload.

---

## 7. Archive + upload

```bash
cd /Users/tarungautam/Desktop/Hich/ios
xcodebuild -project Tago.xcodeproj -scheme Tago \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath ~/Desktop/Tago.xcarchive \
  archive

# Then either open in Xcode Organizer (Product → Archive) and click
# "Distribute App", or use altool / xcrun notarytool from CLI.
```

Apple processing: ~10 min to appear in TestFlight. Internal-tester
testing requires no Apple review. External-tester testing requires
Apple Beta App Review (~24h). Public submission after that.
