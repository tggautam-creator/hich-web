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
