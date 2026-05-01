# Tago iOS — Next Phase PRD
**Author:** Claude (drafted 2026-04-30 from end-to-end iOS audit)
**Status:** For Tarun's review
**Scope:** Auth + Payment hardening, observability, and small UX wins. Built in 4 phases, smallest first.

---

## TL;DR

The iOS app is architecturally sound (324 Swift files, native-first SwiftUI, Stripe SDK + Supabase SDK in use). The audit surfaced **2 inherited web blockers**, **2 iOS-specific CRITICAL gaps**, and **~15 ranked UX papercuts** — most concentrated in auth session security and post-ride payment edge cases.

**v1 (Phase 1) is a 1-week quick win** that closes the user-trust loop: nobody can request a ride without a card, no driver loses an earning to a silent failure, tokens move out of UserDefaults, and we get crash visibility before real users join. Everything else is sequenced behind it.

**No new vendors needed in v1.** Stack stays Stripe + Supabase + APNs/FCM + MapKit + PostHog (web already). Three free additions: Sentry iOS, Stripe MCP, Supabase MCP.

---

## 1. Background

Tago is a SwiftUI carpool app for university students. `.edu` email is the trust layer. The iOS port is feature-complete (auth, onboarding, ride board, instant ride, QR start/end, wallet, Stripe Connect, Live Activity). The user is now hunting for bad UX, bugs, and inefficiency before opening the door wider — focus on **auth** and **payment** because those are the areas where a single bad experience kills the user.

Audit was done end-to-end across iOS Auth, iOS Payment/Wallet, and the matching server endpoints. Findings cite `file:line` so each item is one click from action.

---

## 2. Phase 1 — Trust Floor (1 week, ship-ready)

**Goal:** No first-time user can hit a "this is broken" wall in auth or payment. We get crash visibility. We do nothing else.

### 2.1 Payment ship-blockers (inherited from web — must land server-side)

These are the same B1/B2 already in `PAYMENT_REVIEW.md`. Until they ship, the wallet flow has silent failures.

| ID | File | Problem | Fix |
|---|---|---|---|
| **P1.1** | [server/routes/rides.ts](server/routes/rides.ts) (request handler ~line 200+) | `/api/rides/request` accepts a ride with **zero card validation**. Rider with no payment method gets a driver match, ends ride, charge fails silently, driver never paid. | Reject with `400 NO_PAYMENT_METHOD` if `users.default_payment_method_id IS NULL` AND wallet balance < estimated min fare. |
| **P1.2** | [server/routes/rides.ts](server/routes/rides.ts) end-ride handler + [server/routes/payment.ts](server/routes/payment.ts) `chargeRideFare` | When card charge fails post-ride, `payment_status='failed'` is written but driver wallet **never credited**. No driver-visible recovery path. | Two-part: (a) **Platform reserve** — credit driver from a reserve account; (b) **Dunning queue** — flag rider for next-charge retry on next card add. Surface in [PendingEarningsPage.swift](ios/Tago/Features/Payment/PendingEarningsPage.swift) which already has the UI shell. |

### 2.2 iOS-side gates (client-side belt-and-suspenders)

| ID | File:line | Problem | Fix |
|---|---|---|---|
| **P1.3** | [RideConfirmPage](ios/Tago/Features/RiderHome/) (locate Request button) | iOS lets the user tap "Request" with no default card. Server may reject, but the user sees a generic error mid-flow. | If `defaultCard == nil` AND wallet balance < estimated min fare → disable Request, show inline banner "Add a card to request rides" with link to PaymentMethodsPage. |
| **P1.4** | [PaymentMethodsPage.swift:99–105](ios/Tago/Features/Payment/PaymentMethodsPage.swift#L99-L105) | User can delete their only card without warning, then can't ride. | Detect `cards.count == 1` in delete confirmation — change copy to "This is your only card. You won't be able to request rides without it." |
| **P1.5** | RideConfirmPage + [PaymentCard.swift:60–66](ios/Tago/Models/PaymentCard.swift#L60-L66) | Expired card stays selectable as default; charge fails post-ride. | If `selectedCard.isExpired == true` → disable Request, show banner "This card expired — update it from Payment Methods." |
| **P1.6** | [PaymentMethodsPage.swift:537–543](ios/Tago/Features/Payment/PaymentMethodsPage.swift#L537-L543) | SetupIntent fetch can hang forever on slow network — spinner with no timeout. | Wrap `api.send(SetupIntentEndpoint())` in 30s timeout. On timeout: "Network too slow — try again?" |

### 2.3 Auth ship-blocker

| ID | File:line | Problem | Fix |
|---|---|---|---|
| **A1.1** | [AuthStore.swift:13](ios/Tago/State/AuthStore.swift#L13) + [TagoSupabase.swift:44–47](ios/Tago/Core/Supabase/TagoSupabase.swift) | Supabase session persists to **plain UserDefaults**. Access + refresh tokens readable by another app on a jailbroken device. `KeychainStorage` already exists at [Core/Persistence/](ios/Tago/Core/Persistence/) but is not wired. | Implement `AuthLocalStorage` protocol backed by existing `KeychainStorage`. Swap in at `TagoSupabase.init()`. Migrate existing UserDefaults sessions on first launch (read → write to keychain → wipe defaults). |

### 2.4 Observability (one-shot, ~2 hours)

We're shipping fixes blind without crash data. Land Sentry before Phase 1 closes so the next phase has real signal.

| ID | Action | Why |
|---|---|---|
| **O1.1** | Add **Sentry iOS SDK** (free 5K errors/mo). Initialize in [TagoApp.swift](ios/Tago/TagoApp.swift) with DSN from env. Upload dSYMs via Fastlane post-archive. | We currently have zero crash visibility on prod iOS. Without it, we'll re-find the same bugs by user complaint. |
| **O1.2** | Install three MCP servers in `.mcp.json`: **Stripe MCP** (live customer/charge queries), **Supabase MCP** (RLS-aware schema/queries), **Sentry MCP** (error log queries from Claude sessions). | Free dev acceleration. All three are first-party and live in 2026. Speeds up future sessions on this same code. |

### 2.5 Phase 1 acceptance criteria

A first-time user, fresh install, fresh Supabase account:
1. Cannot request a ride without a card or wallet balance.
2. Cannot delete their last card by accident.
3. Cannot request a ride with an expired card.
4. Token is in Keychain (verify via `xcrun simctl …` or Keychain dump on device).
5. A simulated crash (`fatalError("test")` behind a debug flag) appears in Sentry within 60s.
6. Driver gets a wallet credit (or pending-earning row) for **every** completed ride — no silent loss.
7. Server returns structured `{ error: { code, message } }` for all failures from §2.1.

**Definition of Done** (per CLAUDE.md):
- `npm test -- --run` passes
- `npm run lint` clean
- `npm run build` succeeds
- iOS: `xcodebuild` for device + install on Tarun's iPhone + manual walkthrough of the 7 acceptance steps

---

## 3. Phase 2 — Auth & Payment Polish (2 weeks)

Once Phase 1 is on real users, these become the next visible papercuts.

### 3.1 Auth resilience

| ID | File:line | Problem | Fix |
|---|---|---|---|
| **A2.1** | [APIClient.swift:175](ios/Tago/Core/Networking/APIClient.swift#L175) | 401 throws immediately even when Supabase SDK is mid-refresh — user sees spurious "unauthorized" errors. | If 401 received, check SDK refresh state; if refreshing, `await` once and retry. Else surface unauthorized. |
| **A2.2** | [RootView.swift:170–172](ios/Tago/App/RootView.swift#L170-L172) + [AuthStore.refreshProfile](ios/Tago/State/AuthStore.swift#L422-L443) | If profile row is deleted server-side, user is stuck in infinite onboarding loop. | After 3 failed profile fetches, sign out with friendly "Your profile was deleted, please sign in again." |
| **A2.3** | [LoginPage.swift:210–217](ios/Tago/Features/Auth/LoginPage.swift#L210-L217) | `humanize(error)` only catches `"invalid login credentials"` — every other error shows raw API string. | Build `func friendlyAuthErrorMessage(_:) -> String` mapper; use across LoginPage, SignupPage, CheckInboxPage, ForgotPasswordPage. |
| **A2.4** | [PhoneVerificationPage.swift:90, 164–177](ios/Tago/Features/Auth/PhoneVerificationPage.swift) | Initial SMS fail → user must wait full 60s cooldown before retry. | "Try again now" button when `sendError != nil`, bypassing cooldown. Cooldown only after successful send. |
| **A2.5** | [AuthCallbackPage.swift:72–90](ios/Tago/Features/Auth/AuthCallbackPage.swift) | OAuth/PKCE code exchange has no timeout — hangs forever on bad network. | 30s timeout via `Task.sleep` race; on timeout show error cover with retry. |
| **A2.6** | [LoginPage.swift](ios/Tago/Features/Auth/LoginPage.swift) + [SignupPage.swift](ios/Tago/Features/Auth/SignupPage.swift) | No return-key submit on email/password forms. | Add `.onSubmit { Task { await submit() } }` to last required field in each form. |
| **A2.7** | [CheckInboxPage.swift:178–180](ios/Tago/Features/Auth/CheckInboxPage.swift#L178-L180) | Pasting a stale OTP code auto-submits → fails → field clears with no breadcrumb. User confused. | Subtle 2s "Code auto-submitted" hint when paste triggers submit. |
| **A2.8** | New | Settings → Change Password screen does not exist. ForgotPasswordPage line 99 promises it. | Build `SettingsPage.ChangePassword` + wire Universal Link recovery (`?type=recovery`) → `ResetPasswordPage` (already built). |

### 3.2 Payment polish

| ID | File:line | Problem | Fix |
|---|---|---|---|
| **P2.1** | [ApplePayCoordinator.swift:76–105](ios/Tago/Core/Stripe/ApplePayCoordinator.swift) | Saved-card path shows confirm alert; Apple Pay path goes straight to Face ID with no preview of charge. | Add same confirmation dialog before `ApplePayCoordinator.present()` for first-time top-ups. |
| **P2.2** | [PendingEarningsPage.swift:51–54](ios/Tago/Features/Payment/PendingEarningsPage.swift#L51-L54) | 1Hz `Task.sleep` re-renders even when no row has an active cooldown — battery cost. | Tick only while at least one row has `cooldownSecondsLeft > 0`. |
| **P2.3** | [WithdrawSheet.swift:157–173](ios/Tago/Features/Payment/WithdrawSheet.swift#L157-L173) | Disabled amount field during submit looks broken. | Add inline "Confirming withdrawal…" copy below disabled field. |
| **P2.4** | [TransactionDetailPage.swift](ios/Tago/Features/Payment/TransactionDetailPage.swift) | No way to share or export a receipt. | Add `ShareLink` with rendered receipt PDF (use `ImageRenderer` + `PDFKit`). |
| **P2.5** | [WalletTransaction.swift:190–234](ios/Tago/Models/WalletTransaction.swift#L190-L234) | `refundReasonDisplay` does string `.hasPrefix()` matching — fragile to server copy changes. | Add typed `refund_reason_code` enum to schema + API + iOS model. |

### 3.3 Phase 2 nice-to-haves (only if time)

- Country picker default to `.large` detent + search field on small devices ([CreateProfilePage.swift:227–272](ios/Tago/Features/Auth/CreateProfilePage.swift)).
- ModeSelectionPage individual card spinner instead of disabling all three ([ModeSelectionPage.swift:48–50](ios/Tago/Features/Auth/ModeSelectionPage.swift)).
- Code-field countdown task cancellation on disappear ([CheckInboxPage.swift:280–283](ios/Tago/Features/Auth/CheckInboxPage.swift), [PhoneVerificationPage.swift:239–242](ios/Tago/Features/Auth/PhoneVerificationPage.swift)).

---

## 4. Phase 3 — Analytics, KYC, Real Refunds (4 weeks)

Defer until Phase 1 + 2 are on real users for ~2 weeks. Order by user-data signal.

| Initiative | Why now | Cost |
|---|---|---|
| **PostHog iOS SDK** | Web already has PostHog. Unified web→iOS funnel. Free 1M events/mo. | 1 day |
| **Stripe Identity** for driver KYC (US, $1.50/verification, native iOS SDK) | Only if real fraud appears in Phase 2 metrics. Stripe Connect Express already KYCs drivers — Identity is for selfie+ID layer on top. | 1 week, only triggered by signal |
| **Refund / dispute UX** | "I was charged for a cancelled ride" path doesn't exist on iOS today. Land after seeing first dispute volume. | 1 week |
| **Stripe Connect dashboard polish** | Embedded onboarding redirect into the app; payout schedule UI; bank account update. | 3 days |

---

## 5. Phase 4 — Scale (deferred, no v1 commitment)

These are real options when Tago has user pain that justifies the cost. Not part of v1/v2/v3.

- **Mapbox Navigation SDK iOS** — only when drivers complain about MapKit routing. ~$0.20/active-trip.
- **H3 hex grid dispatch** — only at >10k drivers/city. Not needed at student scale; PostGIS `ST_DWithin` + `ST_Azimuth` covers v1–v3.
- **SheerID** — only when `.edu` email + manual review breaks down. Enterprise-priced.
- **Mapbox/Tuist migration** — re-evaluate at >5 modules.
- **Periphery dead-code sweep** — one-shot pre-App-Store-submit pass.

---

## 6. What we are NOT doing in v1 (and why)

- **No new auth provider.** Supabase + Apple AuthenticationServices covers it. SheerID, Twilio Verify, Auth0, Clerk all skipped.
- **No new map vendor.** MapKit is free and looks native. Mapbox is a Phase 4 maybe.
- **No KYC vendor.** Stripe Connect Express runs free KYC on every driver during onboarding. Stripe Identity is Phase 3 if needed.
- **No ML / dispatch-engine.** Stage 4 in CLAUDE.md says don't build it for MVP.
- **No PaymentSheet upgrade.** [IOS_PROGRESS.md notes (2026-04-28)](IOS_PROGRESS.md) Stripe SDK 24.25 PaymentSheet crashes on iOS 26.3.1 due to PassKit shared-cache UAF. Custom `STPPaymentCardTextField` + `STPApplePayContext` is working — re-evaluate only when Stripe ships ≥24.30 with a fix.
- **No JWT lib.** `CryptoKit` covers HMAC token signing.
- **No FCM-only push migration.** Direct APNs is partially built ([server/lib/apns.ts](server/lib/apns.ts)) and required for Live Activity payloads (FCM can't deliver those). Keep FCM for Android-future and non-LA.

---

## 7. Tools to install for v1 (free, no vendor lock-in)

| Tool | Why | Where |
|---|---|---|
| **Sentry iOS SDK** | Crash visibility — currently zero. | TagoApp.swift init |
| **Stripe MCP** | Live customer/charge/dispute queries from Claude sessions. | `.mcp.json` |
| **Supabase MCP** | RLS-aware schema + query from Claude sessions. | `.mcp.json` |
| **Sentry MCP** | Pull error logs into Claude sessions for debugging. | `.mcp.json` |
| **SwiftLint + SwiftFormat** | Style enforcement — should already be configured; verify CI runs them. | `.swiftlint.yml` + Run Script phase |
| **Fastlane** | App Store deploys + dSYM upload to Sentry. | `fastlane/Fastfile` |

---

## 8. Open questions for Tarun

1. **B1/B2 dunning vs. platform-reserve** — for §2.1 P1.2, do you want me to credit drivers from a platform reserve account immediately (clean UX, small float cost), or queue the missing charge against the rider's next card-add (no float, but driver waits)?
2. **Apple Pay confirmation alert** (P2.1) — Face ID is already a hard confirmation. Want this UX consistency tweak, or is Face ID enough?
3. **ChangePassword in Settings** (A2.8) — is Settings even a designed screen yet, or do you want me to spec it as part of Phase 2?
4. **Sentry vs. Bugsnag vs. Datadog** — I'm proposing Sentry (free 5K errors, best iOS dSYM story). Push back if you want different.
5. **PostHog timing** — Phase 3 in this PRD. Want it pulled into Phase 1 alongside Sentry so funnels light up immediately?

---

## 9. Phase 1 work-breakdown (for estimation)

| Block | Files | Est. effort |
|---|---|---|
| P1.1 + P1.2 server fixes | server/routes/rides.ts, payment.ts, lib/stripeConnect.ts, new migration | 2 days |
| P1.3–P1.5 iOS payment gates | RideConfirmPage, PaymentMethodsPage | 0.5 day |
| P1.6 SetupIntent timeout | PaymentMethodsPage | 0.25 day |
| A1.1 Keychain migration | AuthStore, TagoSupabase, KeychainStorage adapter | 0.5 day |
| O1.1 Sentry + dSYMs | TagoApp.swift, Fastlane lane | 0.25 day |
| O1.2 MCP servers | .mcp.json | 0.1 day |
| Tests + QA on real device | — | 1 day |
| **Total** | | **~5 working days** |

---

**Recommendation:** approve Phase 1 scope, decide on the open questions in §8, and I'll start with P1.1 (the highest-impact server fix) so the iOS gates in §2.2 have something correct to call.
