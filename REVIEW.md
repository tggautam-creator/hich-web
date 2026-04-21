# TAGO — Senior Code & UX Review

**Scope:** Week 8 MVP-complete carpooling PWA. Review blends Uber (instant match, animated map, rating) and BlaBlaCar (trust, ride board) patterns.

**Scope exclusions:** phone/OTP verification flows, `VITE_SKIP_PHONE_VERIFICATION`, `PhoneVerificationPage` route, Stripe test-mode keys — all intentionally paused.

**Method:** three parallel Explore passes (concurrency / UI-UX / bugs) against the `main` branch at `d25d29e`.

---

## Severity summary

| Bucket | Count | Ship order |
|---|---|---|
| HIGH — concurrency & correctness | 10 | P0 |
| MEDIUM — other bugs | 3 | P0 tail |
| UX polish | 8 items | P1 |

---

## A. Concurrency & correctness (HIGH — ship first)

| # | Location | Risk | Fix direction |
|---|---|---|---|
| A1 | [server/routes/rides.ts:1324](server/routes/rides.ts#L1324) | Non-atomic accept — `UPDATE rides SET driver_id` with no status guard. Two drivers can both win. | Single conditional `UPDATE ... WHERE status='requested' AND driver_id IS NULL RETURNING *`; reject on zero rows. |
| A2 | [server/routes/wallet.ts:148-162](server/routes/wallet.ts#L148-L162) | Wallet credit + `wallet_transactions` insert are two queries. Insert failure → balance credited with no record. | New Supabase RPC `wallet_apply_delta` that mutates both in one transaction. |
| A3 | [server/routes/rides.ts:2518-2585](server/routes/rides.ts#L2518-L2585) | Ride marked `completed` **before** `chargeRideFare()`. Charge failure leaves ride closed + payment in limbo. | Charge first; only on success mark `completed`. Mark `payment_failed` + surface to rider otherwise. |
| A4 | [server/routes/stripeWebhook.ts:189-211](server/routes/stripeWebhook.ts#L189-L211) | Topup webhook reads-then-writes balance. Concurrent webhooks race → lost credit. | Use `wallet_apply_delta` RPC (atomic `balance = balance + delta`). |
| A5 | [src/components/ride/RiderPickupPage.tsx:217-240](src/components/ride/RiderPickupPage.tsx#L217-L240) | 15s `channel.send()` interval captures stale `riderLat/Lng` from closure. Driver sees old position. | Ref-based pattern: geolocation watcher updates `posRef.current`; interval reads ref. |
| A6 | [server/routes/rides.ts:279-348](server/routes/rides.ts#L279-L348) | No idempotency on `/api/rides/request`. Client retry = duplicate ride + duplicate push fan-out. | `Idempotency-Key` header + `request_idempotency` table; return cached response on replay. |
| A7 | [server/routes/rides.ts:833-1078](server/routes/rides.ts#L833-L1078) | Accept endpoint does not reject drivers already on an active single-rider ride. | Pre-check: `SELECT 1 FROM rides WHERE driver_id=? AND status IN ('coordinating','active')` before atomic UPDATE. |
| A8 | [server/routes/rides.ts:937-977](server/routes/rides.ts#L937-L977) | Standby-accept upsert can resurrect a `released` offer (read-then-upsert). | Conditional update with `WHERE status != 'released'`; inspect affected rows. |
| A9 | [src/components/ride/WaitingRoom.tsx:91-135](src/components/ride/WaitingRoom.tsx#L91-L135) | `handleSelectOrNavigate` deps missing `rideId`/`destination` — auto-select fires on stale values after remount. | Add missing deps or ref-ize `location.state`. |
| A10 | [server/routes/rides.ts:2730-2774](server/routes/rides.ts#L2730-L2774) | Scan-driver start is not idempotent. Retry returns 404/409 instead of the current state. | Idempotency key (shared infra with A6). Return current ride state on replay. |

## B. Other bugs (MEDIUM)

| # | Location | Risk | Fix direction |
|---|---|---|---|
| B1 | [server/env.ts:6-39](server/env.ts#L6-L39) | Stripe/FCM/HMAC secrets only `warn` on startup. Runtime failure inside request handlers. | Throw at boot for required secrets; keep warn for optional keys (`VITE_POSTHOG_*`). |
| B2 | [server/routes/rides.ts:2845-2855](server/routes/rides.ts#L2845-L2855) | Scan-end: payment recorded + broadcast sent even if final `rides` UPDATE errors. | Move broadcast after UPDATE success; wrap in transaction with payment. |
| B3 | [src/components/ride/DriverMultiRidePage.tsx:184-193](src/components/ride/DriverMultiRidePage.tsx#L184-L193) | GPS ping failures swallowed silently; fare distance can degrade to 0. | Count consecutive failures; show "GPS weak" banner; log PostHog event. |

## C. UI/UX (ship after A)

- **Screens inventoried:** ~35 across auth / rider / driver / schedule / payment. Token adherence excellent; `PrimaryButton` (31×), form primitives, `PageSkeleton` reused well.
- **Motion:** Framer Motion **not** installed. 276 Tailwind transitions; a `slide-down` keyframe in `tailwind.config.cjs` is defined but unused. No driver-reveal animation. → Install Framer Motion for `BottomSheet`, driver reveal, page transitions.
- **Car marker:** [src/components/map/CarMarker.tsx](src/components/map/CarMarker.tsx) is a static SVG — no bearing rotation, no tween between GPS ticks (teleports). → Accept `bearing` prop + `useAnimatedPosition` RAF hook (reuse confetti RAF pattern from `RideSummaryPage`).
- **Driver reveal:** [src/components/ride/WaitingRoom.tsx](src/components/ride/WaitingRoom.tsx) polls for offers with no cinematic reveal. → Slide-up driver sheet (photo, car, plate, ETA, trust badges) via Framer `AnimatePresence`.
- **Pickup ETA:** No countdown component exists. → New `src/components/ride/PickupEta.tsx` on both rider and driver pickup pages.
- **Trust badges:** No .edu / rides-completed / avg-rating surface on driver card or profile. → New `src/components/ui/TrustBadges.tsx`; pull from `profiles`.
- **Rating + tip:** [src/components/ride/RatePage.tsx](src/components/ride/RatePage.tsx) ships star+tag rating; no tip flow. → Tip picker ($1/$2/$5/custom) via new wallet RPC.
- **Ride board:** `RideBoard*` lacks filters/sort and no route-match section. → Filter chips (time, seats, price) + "Matches your route" section using `calculateInterceptPoint` from [src/lib/geo.ts](src/lib/geo.ts).
- **Small cleanups:** `WalletPage` spinner → `ListPageSkeleton`; `RiderHomePage` `text-[2rem]` → `text-2xl`; delete unused `slide-down` keyframe (or use it in #10).

---

## Verification bar

Per CLAUDE.md Definition of Done: `npm test -- --run` / `npm run lint` / `npm run build` all green on every task. Plus:

1. Race simulation — 2 concurrent accepts → exactly one 200, one 409.
2. Wallet atomicity — inject insert failure, assert balance rolls back.
3. Idempotency — replay POST; assert cached response + no new row.
4. Stale-closure repro — `vi.useFakeTimers()` + state mutation + interval advance.
5. Motion regression — real phone, verify `prefers-reduced-motion` is honoured.
6. User-tested locally before any `git push` (standing rule).

The execution plan lives at `/Users/tarungautam/.claude/plans/you-are-a-senior-wobbly-thacker.md`.

---

## D. Frictionless driver onboarding (CTO initiative — 2026-04-19)

**Problem.** Drivers drop off before connecting a bank. Today `DriverHomePage` hard-gates **Go Online** on `stripe_onboarding_complete`, so a driver who just finished signup, registered a car, and wants to give a ride *right now* hits a Stripe Connect KYC wall before ever seeing a ride request. Cold-start skepticism ("why would I give my bank to a random app?") converts this gate into churn.

**Goal.** Driver can Go Online and take rides immediately after car registration. Real money still moves on every ride. Driver is asked to connect a bank *only when they want their money out* — at peak motivation, not at peak friction.

**Rider side stays strict.** Riders still must have a payment method before requesting — that's a fraud / abandonment guard, not a friction point.

### D.1 Decisions (locked with user 2026-04-19)

| Decision | Choice | Why |
|---|---|---|
| **Money custody** | Charge rider → TAGO's Stripe platform balance. Credit driver's in-app wallet atomically via `wallet_apply_delta`. Transfer to driver's Connect account only on withdrawal. | Removes the Connect-account precondition. Relies on Stripe as money transmitter of record; peer-app precedent (BlaBlaCar-style). |
| **Wallet cap** | **$100 hard gate**: driver can earn up to $100 with no bank; new ride broadcasts filter them out above cap. | ~3–5 rides worth. Motivation peak without unbounded custody liability. |
| **Prompt** | Both: soft modal after ride 1 (`"You earned $X! Add your bank to withdraw"`) + persistent Wallet banner. | Ride-1 moment is the highest-intent withdraw trigger. |
| **Ghost driver** | Auto-refund rider after 90 days of driver inactivity. Day-60 "last chance" email. | Closes legal + accounting loop; generous enough for summer-break .edu users. |

### D.2 Current architecture to demolish

- [src/components/ride/DriverHomePage.tsx:30, 87-88, 200-204](src/components/ride/DriverHomePage.tsx) — `hasBank` gate forces offline without `stripe_onboarding_complete`.
- [server/lib/stripeConnect.ts:37-54](server/lib/stripeConnect.ts#L37-L54) — `paymentIntents.create` uses `transfer_data: { destination: driverAccountId }`, which **requires** the driver already have a Connect account. This is the root of the friction.
- [server/routes/rides.ts:2612](server/routes/rides.ts#L2612) — only charge site; calls `chargeRideFare`.
- [server/routes/wallet.ts](server/routes/wallet.ts) — no withdraw endpoint; drivers currently go through Stripe Express dashboard, which only exists once onboarded.
- Migrations: 027 (Stripe Connect columns), 044 (`wallet_apply_delta`).

### D.3 Target money flow

```
Ride ends → chargeRideFare()
   ├─ stripe.paymentIntents.create({ amount, customer: rider, payment_method, confirm: true })
   │     (charge to TAGO platform balance — NO transfer_data)
   ├─ wallet_apply_delta(driver_id, +fare_cents, 'ride_earning', ride_id, { payment_intent })
   └─ rides.status = 'completed', payment_status = 'paid'

Driver taps "Withdraw" → POST /api/wallet/withdraw
   ├─ if no stripe_account_id → create Express account + onboarding link → return link
   ├─ if onboarding incomplete → return resume link
   ├─ else:
   │     wallet_apply_delta(driver_id, -amount, 'withdrawal', null, { transfer_id })
   │     stripe.transfers.create({ amount, destination: stripe_account_id })
   │     stripe.payouts.create({ amount }, { stripeAccount: driver_account }) — or let default payout schedule fire
   └─ return { status: 'transferring', eta_days: 2 }

Ghost driver (cron daily):
   ├─ find drivers with wallet_balance > 0 AND stripe_onboarding_complete = false
   │     AND last_ride_at < now() - 60 days AND reminder_60_sent = false
   │     → send reminder email, set flag
   └─ find same set where last_ride_at < now() - 90 days
         → for each wallet_transaction (kind='ride_earning'), issue stripe.refunds.create
         → wallet_apply_delta(driver_id, -sum, 'ghost_refund', null, { refunded_rides })
         → mark ride.payment_status = 'refunded_ghost_driver'
```

### D.4 Feature breakdown (ship in this order)

| # | Feature | Files touched | Why in this slot |
|---|---|---|---|
| **F1** | **Rewire charge to platform** — drop `transfer_data.destination`; charge rider to TAGO balance; credit driver wallet via `wallet_apply_delta`. Add new `wallet_transactions.kind = 'ride_earning'`. | [server/lib/stripeConnect.ts](server/lib/stripeConnect.ts), [server/routes/rides.ts:2612](server/routes/rides.ts#L2612), new migration `049_ride_earning_kind.sql` | Nothing else works until money stops requiring Connect. This is the keystone. |
| **F2** | **Remove hard bank gate on go-online** — `DriverHomePage` no longer blocks on `stripe_onboarding_complete`. Driver registered a car → can Go Online. Replace gate with soft banner "Add bank to withdraw earnings" on WalletPage only. | [src/components/ride/DriverHomePage.tsx:30, 87-88, 200-204](src/components/ride/DriverHomePage.tsx), [src/components/ride/WalletPage.tsx](src/components/ride/WalletPage.tsx) | Unlocks the UX win. Only safe after F1. |
| **F3** | **$100 wallet cap gate** — server-side: `matchDriversForRide` filters out drivers whose `wallet_balance >= 10_000 AND stripe_onboarding_complete = false`. Client-side: Go Online disabled + "Add bank to keep earning — you've hit the $100 limit" banner. | [server/routes/rides.ts](server/routes/rides.ts) (broadcast filter), [src/components/ride/DriverHomePage.tsx](src/components/ride/DriverHomePage.tsx) | Caps custody liability. Must land with F2 or drivers earn unbounded. |
| **F4** | **Ride-1 onboarding modal** — on `DriverHomePage` return, if `rides_completed === 1 AND !stripe_onboarding_complete`, show modal: "You earned $X! Add your bank to withdraw." CTA launches Stripe Connect onboarding. Dismissible; reappears after each ride until onboarded. Persistent WalletPage banner too. | [src/components/ride/DriverHomePage.tsx](src/components/ride/DriverHomePage.tsx), [src/components/ride/WalletPage.tsx](src/components/ride/WalletPage.tsx), new `src/components/ride/BankOnboardPrompt.tsx` | Highest-intent conversion moment. Analytics: track `bank_prompt_shown`, `bank_prompt_accepted`. |
| **F5** | **Withdraw endpoint** — `POST /api/wallet/withdraw` creates Connect Express account if missing, debits wallet via RPC, creates Stripe Transfer + Payout. Idempotency-Key required (reuse R.4 middleware). New `WithdrawSheet` in Wallet. | new `server/routes/wallet.ts` section, new migration `050_withdrawal_kind.sql` if needed, new `src/components/ride/WithdrawSheet.tsx`, [src/components/ride/WalletPage.tsx](src/components/ride/WalletPage.tsx) | The actual payoff of all the above. |
| **F6** | **Wallet UX for pre-bank drivers** — show balance with "Pending payout" label; history shows ride earnings as "Credited — add bank to withdraw" until onboarded; once onboarded, flip to standard "Available". | [src/components/ride/WalletPage.tsx](src/components/ride/WalletPage.tsx) | Clarity. Without this drivers panic-email asking where their money is. |
| **F7** | **Ghost-driver reconciliation** — daily Supabase cron (pg_cron or edge function): day-60 reminder email, day-90 refund via `stripe.refunds.create` + wallet debit + ride flag. New `wallet_transactions.kind = 'ghost_refund'`. Admin dashboard entry showing pending-refund queue. | new migration `051_ghost_refund.sql`, new `server/jobs/ghostRefund.ts`, admin route under `/api/admin/ghost-refunds` | Closes the legal loop. Can ship a week behind F1-F6 since no driver hits 60 days in the beta window. |

### D.5 Verification bar

- **F1**: unit test `chargeRideFare` asserts no `transfer_data` on the `PaymentIntent`, and `wallet_apply_delta` called with `+fare_cents`. Integration: test-mode end-to-end charge on a driver with no `stripe_account_id`.
- **F2**: manual — new driver signup → register car → Go Online works. No Connect onboarding yet.
- **F3**: unit test `matchDriversForRide` with a wallet ≥ $100 and no Connect → excluded from broadcast. UI: Go Online disabled with banner copy correct.
- **F4**: e2e — complete first ride → modal appears on next load of DriverHomePage. Dismiss → reappears after next ride.
- **F5**: replay test (Idempotency-Key) returns cached; concurrent withdraws of same amount — one succeeds, one 409. Stripe test-mode: transfer + payout objects created.
- **F6**: visual — pre-onboard driver sees "Pending payout $X", post-onboard sees "Available $X".
- **F7**: time-travel test (mock `now()` to 90 days forward) → refund issued, wallet debited to exactly 0, ride flagged, no double-refund on replay.
- **All features**: `npm test -- --run`, `npm run lint`, `npm run build` green. User-tested locally before push (standing rule).

### D.6 Risks + mitigations

| Risk | Mitigation |
|---|---|
| **MTL licensing exposure** — TAGO briefly holds rider funds. | Stripe is the regulated money transmitter of record. $100 cap + 90-day refund keeps holdings short-lived. Consult counsel before scaling past beta. |
| **Stripe Connect delays on withdraw** — onboarding can bounce for missing docs, leaving a driver with "money but can't get it". | F5 surfaces Connect requirement errors inline; F4 pre-warns. Ghost-refund path (F7) catches the long tail. |
| **Chargebacks hit TAGO balance, not driver** — with `transfer_data.destination` gone, disputes come out of TAGO. | Existing fare cap ($40) + .edu email trust layer keeps dispute volume low. Track `stripe.charge.dispute.created` via webhook in Phase 2. |
| **Rider refund when driver already withdrew** — if wallet was already debited and payout landed in driver's bank, we can't claw it back automatically. | For beta: flag to admin, resolve manually. Phase 2: hold last $X (configurable) as a dispute buffer before allowing withdraw. Not blocking MVP. |

