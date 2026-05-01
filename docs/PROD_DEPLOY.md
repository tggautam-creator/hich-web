# Production deployment checklist — Tago

Last verified: 2026-05-01.

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
| `VITE_SKIP_PHONE_VERIFICATION` | `true` | Mirrors the iOS flag — phone collected but unverified for v1. Flip to `false` later when re-enabling Twilio Verify on web. |
| `VITE_GOOGLE_MAP_ID` | `afc6d35a59fbd53d63b82275` | Already set per 2026-04-30 audit. Required for `<AdvancedMarker>` rendering on `/safety/track`. |
| `VITE_POSTHOG_KEY` | (your PostHog key) | If analytics ON in prod. |

All other `VITE_*` web vars (Supabase, Firebase, Maps) can be the same
keys as dev — they're public-by-design.

---

## 3. iOS — `Tago.Release.xcconfig` swaps before archive

Open `ios/Tago.Release.xcconfig`:

| Line | Current | Production value |
|---|---|---|
| `TAGO_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` from Stripe Dashboard → LIVE mode → API keys |
| `MARKETING_VERSION` | `1.0.0` | Bump for each App Store release (1.0.1, 1.1.0, etc.) |
| `CURRENT_PROJECT_VERSION` | `1` | Bump for **every** archive uploaded to TestFlight / App Store. Apple rejects duplicate build numbers under the same `MARKETING_VERSION`. |

Everything else in `Tago.Release.xcconfig` is already production-correct
(prod API URL, www. associated-domain, no local-override leakage,
`DEVELOPMENT_TEAM = XFDWGTQH9M`, `TAGO_SKIP_PHONE_VERIFICATION = YES`).

---

## 4. Stripe — LIVE-mode dashboard

https://dashboard.stripe.com (toggle to Live mode in top-left)

- ✅ API keys → publishable + secret keys captured (Step 1 + 3 above)
- ✅ Webhooks → endpoint at `https://www.tagorides.com/api/stripe/webhook`
  with the events your test webhook subscribes to (PaymentIntent
  succeeded/failed, account.updated for Connect, charge.refunded, etc.)
- Apple Pay → register `merchant.com.tago.rides` + upload the Apple Pay
  Payment Processing Certificate (Apple Developer portal generates it
  via a CSR Stripe gives you).
- Connect → if you have any test-mode connected accounts (drivers who
  ran Stripe Connect onboarding in test), those don't carry over to
  Live. You'll need a fresh onboarding pass on Live for each driver.

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
