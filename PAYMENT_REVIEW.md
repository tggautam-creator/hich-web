# TAGO — Pre-Deploy Payment Audit

**Scope:** Stripe charge / driver credit / refund / withdraw paths across instant rides, ride board, and wallet.
**Verdict:** 🚨 **Do not deploy as-is.** Two ship-blocking bugs (B1, B2). Three high-severity issues. Several medium items to land before real money.

---

## 1 · How money is supposed to move

1. **Rider adds card** (Stripe Elements) → stored as `stripe_customer_id` + `default_payment_method_id` on `users`.
2. **Driver ends ride** (scan-QR or `/rides/:id/end`) → server calls `chargeRideFare()` (off-session PaymentIntent, idempotency-key `ride-payment-${rideId}`) → funds land in TAGO's Stripe balance.
3. **On charge success** → server calls `wallet_apply_delta` RPC to atomically credit the driver's in-app wallet with `ride_earning`. `ride.payment_status='processing'` → webhook flips to `'paid'`.
4. **Driver withdraws** → `/api/wallet/withdraw` creates a Stripe Connect `Transfer` to the driver's Express account, debits the wallet atomically.
5. **Ghost safety net:** day-60 reminder + day-90 auto-refund for stale unpayoutable earnings (migration 049 + `server/jobs/ghostRefund.ts`).

---

## 2 · Bugs found

### 🚨 B1 — Ride charged to void: rider without a card still books a ride
**Severity:** ship-blocker

**Instant flow** — [server/routes/rides.ts:200+](server/routes/rides.ts#L200) `/api/rides/request` accepts the request with **no server-side check** that the rider has `stripe_customer_id` + `default_payment_method_id`. The only gate is client-side in [RideConfirm.tsx:424](src/components/ride/RideConfirm.tsx#L424) (`disabled={!selectedCard}`). Any curl/devtools bypass creates a ride that cannot be paid.

**Ride-board flow** — [server/routes/schedule.ts:497](server/routes/schedule.ts#L497) `/api/schedule/request` has zero card check. Client-side [RideBoardConfirmSheet.tsx:503-509](src/components/schedule/RideBoardConfirmSheet.tsx#L503-L509) also has **no gate** — the Send Request button only checks pickup/destination, not payment method. **Answer to your specific question: yes, a rider with no card on file can request a ride from the board today, and they are never prompted to add one until the ride ends and the charge silently fails.**

**Fix direction:** add `SELECT stripe_customer_id, default_payment_method_id FROM users WHERE id = :userId` at the top of both `/api/rides/request` and `/api/schedule/request`; return `{ code: 'NO_PAYMENT_METHOD' }` 400 if null. Mirror the client gate in `RideBoardConfirmSheet` — link to `/payment/add` with `returnTo=/rides/board`.

---

### 🚨 B2 — Driver loses the ride when rider has no card on file
**Severity:** ship-blocker

[server/routes/rides.ts:2654-2658](server/routes/rides.ts#L2654-L2658) and mirror at [:2941-2960](server/routes/rides.ts#L2941-L2960):

```ts
} else {
  paymentStatus = 'failed'
  console.warn(`[rides/end] Missing rider Stripe setup ...`)
}
// ... later: UPDATE rides SET status='completed', payment_status='failed'
```

Consequence chain when rider lacks a card:
1. `chargeRideFare` is **never called** → no PaymentIntent, no Stripe record.
2. Ride is still marked `completed`.
3. `wallet_apply_delta('ride_earning', ...)` is **skipped** → driver wallet stays 0.
4. There's no ghost_refund row because nothing was charged.
5. Rider sees `payment_status='failed'` on the summary → taps "Retry payment" → `/retry-payment` returns `NO_PAYMENT_METHOD` → rider can add a card and retry, but the **driver has no recourse until the rider opens the app** and chooses to pay.

This is the single most dangerous corner: a driver can drive a real trip and end up at $0 forever if a rider deletes their card between request and end-of-ride.

**Fix direction:** gate `/rides/:id/end` (and `/scan-driver` end) on `rider.default_payment_method_id`. If missing, mark `payment_status='pending'`, enqueue a dunning push every 24h for 7 days, then fall through to ghost-refund analog (driver gets compensated from platform reserve or ride is forced-refunded). At minimum: log a PostHog `payment_missing_pm_on_end` event and alert on it.

---

### ⚠️ H1 — No in-app path for the driver when a charge fails
**Severity:** high

[src/components/ride/RideSummaryPage.tsx:302](src/components/ride/RideSummaryPage.tsx#L302) only shows Retry Payment for `!isDriver`. The driver sees the "Payment failed" pill and no CTA. There's no list view of rides in limbo, no email, no notifier. If the rider never opens the app again, the only safety net is the 90-day ghost refund — which debits the driver, not compensates them.

**Fix direction:** driver-side notification + a "Payments in limbo" section on WalletPage showing any `ride_earning` with `rides.payment_status IN ('failed','pending')`, with the rider's contact info or a "Nudge rider" button (server sends FCM).

---

### ⚠️ H2 — `ghost_refunds.refunded_at` / `stripe_refund_id` are set unconditionally in dry-run paths?
**Severity:** high (needs verification before deploy)

`server/jobs/ghostRefund.ts` — confirm the happy path actually writes both `refunded_at` and `stripe_refund_id`, and that the Stripe failure branch is **not** writing either (otherwise a Stripe 502 looks like a successful refund on replay). The test at [src/test/server/ghostRefund.test.ts:219](src/test/server/ghostRefund.test.ts#L219) asserts the happy path but we should add: "Stripe fails → `refunded_at IS NULL`, replay allowed."

**Fix direction:** unit test the failure branch; in production, wrap the Stripe call + DB finalize in a try/catch that only marks `refunded_at` after the DB update succeeds.

---

### ⚠️ H3 — Topup via `confirm-topup` + webhook race is **only** guarded by a 23505 unique constraint
**Severity:** high, currently contained

[server/routes/stripeWebhook.ts:191-208](server/routes/stripeWebhook.ts#L191-L208) and the confirm-topup endpoint both call `wallet_apply_delta` with the same `payment_intent_id`. The unique index on `payment_intent_id` in `wallet_transactions` is what prevents double-credit — but if a DBA or migration drops that index, double-credits become silent.

**Fix direction:** add a comment to [migration 044](supabase/migrations/044_wallet_apply_delta.sql) stating the UNIQUE is load-bearing for idempotency, plus a CI assertion or a RLS test that verifies the index exists.

---

### ⚠️ M1 — Wallet tab navigation gap (fixed, flag for regression test)
User reported Payment tab opened `/payment/methods` not `/wallet`. Fixed at [src/components/ui/BottomNav.tsx:107](src/components/ui/BottomNav.tsx#L107). Regression test added in DriverHomePage/RiderHomePage suites. ✅

### ⚠️ M2 — `payment_status='processing'` never flips if webhook is delayed
If Stripe webhook delivery is delayed > rider closes app, the summary stays "Payment processing". The success path already writes `processing` optimistically; we rely on `payment_intent.succeeded` to flip to `paid`. Add a 60-second client poll of `ride.payment_status` on the summary page after a retry.

### ⚠️ M3 — Retry-payment does not check schedule-initiated rides differently
[server/routes/rides.ts:4206](server/routes/rides.ts#L4206) reads `ride.payment_status IN ('failed','pending')` — correct, but does not assert the caller is actually the rider (other than JWT). Add `WHERE rider_id = :userId`.

### ⚠️ M4 — `driver_earns_cents` is computed but never validated against `fare_cents` at end
Sanity invariant: `driver_earns_cents + platform_fee_cents == fare_cents`. Add a 1-line assertion and a PostHog alert on mismatch.

---

## 3 · Does the happy path work?

Yes, under the narrow conditions below it works end-to-end; I traced every branch:

| Step | Where | Status |
|---|---|---|
| Rider adds card | [server/routes/payment.ts:22-95](server/routes/payment.ts#L22-L95) | ✅ |
| Request ride (instant) | [server/routes/rides.ts:200+](server/routes/rides.ts#L200) | ⚠️ (B1) |
| Request ride (board) | [server/routes/schedule.ts:497](server/routes/schedule.ts#L497) | ⚠️ (B1) |
| Driver accepts atomic | [server/routes/rides.ts:833+](server/routes/rides.ts#L833) | ✅ (after recent P0 fix) |
| End ride → charge | [server/routes/rides.ts:2611-2658](server/routes/rides.ts#L2611-L2658) | ⚠️ (B2) |
| Driver credit (atomic RPC) | [wallet_apply_delta](supabase/migrations/044_wallet_apply_delta.sql) | ✅ |
| Webhook → `paid` | [server/routes/stripeWebhook.ts:39-55](server/routes/stripeWebhook.ts#L39-L55) | ✅ |
| Retry (rider) | [server/routes/rides.ts:4200+](server/routes/rides.ts#L4200) | ✅ |
| Withdraw to bank | [server/routes/wallet.ts withdraw](server/routes/wallet.ts) | ✅ (covered by F5 tests) |
| Ghost refund day-90 | [server/jobs/ghostRefund.ts](server/jobs/ghostRefund.ts) | ⚠️ (H2 needs failure-branch test) |

---

## 4 · Deployment checklist (my recommendation)

Before any real student charges a card:

- [ ] **B1 fix** — server-side card precondition on `/api/rides/request` + `/api/schedule/request`; client gate in `RideBoardConfirmSheet`; `/payment/add` wired as the redirect target from both flows.
- [ ] **B2 fix** — either block `end` when rider has no card, or guarantee driver compensation via a platform-reserve top-up when the rider is unrecoverable.
- [ ] **H1** — driver-side "Payments in limbo" UI + push.
- [ ] **H2** — test the Stripe-failure branch of `processGhostDriverRefunds`.
- [ ] **M2** — client poll or realtime subscribe on `payment_status` after retry.
- [ ] **Webhook secret rotated**, Stripe dashboard endpoint verified.
- [ ] **Stripe mode** still toggled via `STRIPE_SECRET_KEY` at boot — confirm the prod key is live (CLAUDE.md says "test mode for entire MVP"; re-confirm before flipping).
- [ ] Run `npm test -- --run && npm run lint && npm run build`.
- [ ] Run a full trip on staging with a real test card and a real bank account, front-to-back.

---

## 5 · Questions I need answered before I can finalize the fix PR

These affect the shape of the B1/B2 fix — they're judgment calls, not technical lookups:

1. **For B1 (ride-board request without card):** should the rider be *blocked* from sending the request, or allowed to send with a pending-card flag and prompted to add a card before the driver accepts? (Blocking is safer; flag-and-prompt is better UX for students browsing.)
2. **For B2 (rider loses card before end-of-ride):** should the driver be compensated from a platform reserve and the rider billed later, or should the ride sit in limbo until the rider re-adds a card? (First is Uber-like; second is cleaner legally for MVP.)
3. **For H1 (payments-in-limbo visibility):** is a simple list on WalletPage enough, or do you want push notifications on every stale-24h ride to nudge the rider?
4. **Timeline to deploy:** are you targeting this week? That changes which fixes ship pre-deploy vs. as a fast-follow.
