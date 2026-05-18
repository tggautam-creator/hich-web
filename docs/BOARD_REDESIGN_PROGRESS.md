# Ride Board redesign — progress

Live tracker for the work spec'd in
[`BOARD_REDESIGN_PLAN.md`](./BOARD_REDESIGN_PLAN.md).
Updated every time a slice changes state.

## Summary

| Phase | Slices | Done                  | In progress | Not started |
|---|---|---|---|---|
| A — Payment gate | 6 | 3 (A1, A2, A3 full)   | 0           | 3 |
| B — Geo search   | 3 | 0                     | 0           | 3 |

**Current focus:** Slice A3 SHIPPED end-to-end. The full
rider-board-offer flow is now wired: driver taps Offer → server
creates offer → rider gets push → tap → BoardOfferAcceptPage → add
card if needed → accept → ride created → chat opens.

**Next action:** Slice A4 — trust badges (server adds
`rider_has_payment` + `rider_rating_*` to board list; iOS renders
pills on each rider's post).

**Blockers:** **user must apply migration 073** (drops the
`enforce_rider_post_has_card` trigger from migration 051) in
Supabase Dashboard → SQL Editor before rider-mode posts will
succeed without a card. iOS UI is already updated; the DB trigger
is the last gate. Discovered 2026-05-17 during end-to-end testing.

### Late-discovered gate: migration 051 trigger

The screenshots Tarun shared on 2026-05-17 showed the post page
still blocking rider posts with no card. Investigation found a
BEFORE-INSERT trigger from mig 051 that hard-fails the row before
it even hits Supabase RLS / Express. Added migration 073 to drop
it. Also removed the iOS `paymentSection` from `SchedulePostPage`
(it was never blocking, just an upsell hint that's no longer
relevant for rider posts).

### 42P10 — partial unique index doesn't work with supabase-js upsert

After 073 unblocked posts, the driver-side "Offer to Drive" hit a
new 500 from Postgres: `42P10 there is no unique or exclusion
constraint matching the ON CONFLICT specification`. Root cause:
migration 072 made `uq_ride_offers_schedule_driver` a PARTIAL unique
index (`WHERE schedule_id IS NOT NULL`). Supabase-js's
`.upsert({onConflict: 'cols'})` emits the column list but no
predicate, so Postgres can't match the partial index. Fix in
migration 075 (originally 074, renumbered because of an existing
`074_admin_audit_log.sql` from a parallel work stream): drop the
partial index, recreate as a plain (non-partial) unique index.
NULLS DISTINCT semantics keep instant-ride rows unaffected.

### Missing inbox persistence — push-only offers vanished if dismissed

After 075 unblocked offer creation, Tarun reported that a rider who
dismissed the system push lost the offer entirely — it didn't show
up in the notification-bell inbox so there was no way back to the
BoardOfferAcceptPage. Root cause: the offer-create endpoint was
only firing the FCM push, not inserting into the `notifications`
table. Push notifications are ephemeral by design.

Fix (2026-05-17, no migration): server-side, the offer-create path
now does TWO writes — `notifications` row first (durable inbox
surface) then FCM push (ephemeral banner). Both run in the same
fire-and-forget async block. The notif row's `data` carries
`schedule_id` + `offer_id` so the existing inbox tap handler (added
in Slice A3b) presents `BoardOfferAcceptPage` correctly when the
rider opens the bell.

Also patched 3 unrelated test fixtures (`scaffold`, `authStore`,
`supabase`) that were failing TS build with missing `suspended_at`
+ `suspended_reason` fields. Someone added user-suspension columns
to the Database type during a parallel work stream; the fixtures
need the matching null values to compile.

---

## Slice status

### Phase A — Payment gate

#### A1 — Backend: drop card gate on rider-board offers
**Status:** `[x]` Implementation done 2026-05-16. Awaiting migration apply + test run.

- [x] Migration 072_ride_offers_for_board.sql
  - [x] Made `ride_offers.ride_id` nullable
  - [x] Added `schedule_id UUID REFERENCES ride_schedules(id) ON DELETE CASCADE`
  - [x] CHECK constraint `ride_offers_target_check`: exactly one of
        `ride_id` or `schedule_id` is set
  - [x] Added `proposed_pickup_point`, `proposed_dropoff_point`,
        `proposed_pickup_name`, `proposed_dropoff_name`,
        `proposed_fare_cents`, `proposed_eta_minutes` columns
  - [x] Partial unique index on `(schedule_id, driver_id)` for upserts
  - [x] Index on `(schedule_id)` WHERE status='pending'
  - [x] Extended RLS so rider can SELECT offers on their schedules
- [x] New endpoint: `POST /api/schedule/board/offers`
        (chose `/api/schedule/*` namespace over `/api/rides/*` to match
        existing `/api/schedule/board` GET — keeps board logic colocated)
  - [x] Validates the requester is a driver
  - [x] Validates the schedule is `mode='rider'`
  - [x] Does NOT check rider card / wallet
  - [x] Driver can't offer on their own post (403 OWN_POST)
  - [x] Falls back to driver's first active vehicle when `vehicle_id`
        not provided
  - [x] Idempotent on `(schedule_id, driver_id)` — re-offer updates
        proposed_* fields via upsert
  - [x] Push notification (fire-and-forget) to schedule owner with
        `type='board_offer'`, title "John W wants to drive you",
        body "Davis → SF · $14"
- [ ] **Pending user action:**
  - [ ] Apply migration 072 in Supabase Dashboard → SQL Editor
  - [ ] Restart EC2 (`pm2 restart all`) if not on `tsx watch`
  - [ ] Smoke test: curl the new endpoint with a real JWT
- [ ] Tests (deferred to a follow-up — will add a `schedule.board-offers.test.ts`
      file in `src/test/server/` once the migration is live and we can
      run real Supabase fixtures)

**Build status:** ✅ `npm run build` clean (TS + Vite), `npm run lint` clean.
**TS cast:** `as never` on the upsert payload because the generated
`Database` type doesn't yet know about migration 072's new columns —
same pattern as `notification_preferences` insert in `lib/fcm.ts`.
Cast disappears the next time we regenerate Supabase types.

#### A2 — Backend: accept/decline endpoints
**Status:** `[x]` Done 2026-05-16. Endpoints live; awaiting end-to-end test via Slice A3 iOS UI.

- [x] `GET /api/schedule/board/schedule/:scheduleId/offers` — rider
      lists pending offers on their post. Joins driver profile +
      vehicle. Sorted cheapest-first, then oldest-first.
- [x] `POST /api/schedule/board/offers/:offerId/accept`
  - [x] Verifies offer status='pending', schedule_id set, ride_id null
  - [x] Verifies caller is schedule owner
  - [x] Detects already-matched race (409 ALREADY_MATCHED) by querying
        sibling offers for 'selected'
  - [x] Payment gate: rider must have card OR wallet ≥ proposed_fare_cents
        — 400 NO_PAYMENT_METHOD if not, so iOS can surface AddCardSheet
  - [x] Creates `rides` row with status='accepted', pre-confirmed
        pickup + dropoff (driver's proposed = both parties agreed)
  - [x] Flips offer to 'selected', sibling offers to 'released'
  - [x] Pushes `board_offer_accepted` to chosen driver,
        `board_offer_released` to each sibling driver
- [x] `POST /api/schedule/board/offers/:offerId/decline`
  - [x] Verifies offer is pending + caller is schedule owner
  - [x] Flips just that one offer to 'released'
  - [x] Pushes `board_offer_declined` to that driver
  - [x] Does NOT touch sibling offers — rider keeps the others
- [ ] Tests covering race conditions, RLS, payment gate edge cases
      (deferred; will land alongside Phase A end-to-end test once
      iOS UI exists to drive the flow)

**Build status:** ✅ `npm run build` + `npm run lint` clean.

**TS casts:** Inline type aliases (`BoardOfferRow`, `DeclineOfferRow`)
+ `as never` on select strings, because Supabase generated types
don't yet know about migration 072's new columns. Same pattern as
A1. All casts disappear when we regenerate Supabase types.

#### A3 — iOS: BoardOfferAcceptPage
**Status:** `[~]` Partial. Page + endpoints done 2026-05-16. Wiring pending.

- [x] `ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift`
      with 4 new endpoint structs + DTOs:
  - [x] `CreateBoardOfferEndpoint` (driver-side POST)
  - [x] `ListBoardOffersEndpoint` (rider-side GET)
  - [x] `AcceptBoardOfferEndpoint` (rider-side POST with NO_PAYMENT_METHOD handling)
  - [x] `DeclineBoardOfferEndpoint` (rider-side POST)
- [x] `ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift`
  - [x] Loads offers via `ListBoardOffersEndpoint`
  - [x] Renders single-offer detail (driver photo, rating, vehicle,
        route, fare, ETA)
  - [x] Multi-offer scroller at top when `offers.count > 1`
  - [x] Accept button → `AcceptBoardOfferEndpoint`
  - [x] Decline button → `DeclineBoardOfferEndpoint`
  - [x] Payment gate: catches `APIError.server` with `code='NO_PAYMENT_METHOD'`
        → fetches SetupIntent → presents `AddCardSheet` → on success
        auto-retries Accept
  - [x] Handles `ALREADY_RELEASED` / `ALREADY_MATCHED` race conditions
        with friendly error + refresh
  - [x] Empty state when all offers gone
  - [x] `onCompleted(rideID)` callback for parent to push MessagingPage
- [x] **Wiring (A3b sub-slice, shipped 2026-05-17):**
  - [x] PushManager: new `onBoardOfferTap: ((UUID, UUID) -> Void)?`
        callback, fired on `type='board_offer'` push tap with
        schedule_id + offer_id
  - [x] SignedInTabs: new `pendingBoardOffer` state + fullScreenCover
        presenting `BoardOfferAcceptPage`. `onCompleted` routes to
        MessagingPage with the new ride_id.
  - [x] Notifications inbox: new `onOpenBoardOffer` callback, board_offer
        rows short-circuit the rideID guard and route through the
        same fullScreenCover (350ms sheet-dismiss pause for animation
        smoothness)
  - [x] Driver-side: `RideBoardConfirmViewModel.submit()` now branches
        — `isDriverPost=true` keeps using legacy `ScheduleRequestEndpoint`
        (rider-books-driver-seat still needs upfront card), but
        `isDriverPost=false` swaps to the new
        `CreateBoardOfferEndpoint` (offer flow, no card required)
  - [x] Server: relaxed `POST /api/schedule/board/offers` validation —
        only `schedule_id` is required, all proposed_* fields are
        optional with sensible fallbacks (pickup/dropoff names default
        to the schedule's posted addresses; fare can be NULL until
        chat reconciles)
  - [x] iOS: `CreateBoardOfferEndpoint` updated — all proposed_*
        fields are now optional with default `nil`, encoded via
        `encodeIfPresent`
- [x] xcodegen ran successfully — both new files registered in
      `Tago.xcodeproj/project.pbxproj`
- [x] Build status: ✅ `xcodebuild ... build` clean on iPhone 17 sim
      AND `npm run build` clean

**TS / Swift casts:** none — all types are clean Swift structs that
match the server's JSON shape via CodingKeys snake-case mapping.

#### A4 — iOS + server: trust badges on board listings
**Status:** `[ ]` Not started

#### A5 — Driver-posted seat booking unchanged (verify)
**Status:** `[ ]` Not started

#### A6 — Web parity
**Status:** `[ ]` Not started

### Phase B — Geo search

#### B1 — PostGIS search backend
**Status:** `[ ]` Not started

#### B2 — iOS RideBoardSearchPage
**Status:** `[ ]` Not started

#### B3 — Web search UI
**Status:** `[ ]` Not started

---

## Decisions log

- **2026-05-16** — Reuse existing `ride_offers` table (mig 018) rather
  than inventing `board_offers`. Add nullable `ride_id` + new
  `schedule_id` FK with a CHECK that exactly one is set. Keeps the
  selected/released/standby state machine we already trust.
- **2026-05-16** — Defer Elasticsearch. PostGIS in Supabase covers
  geo-on-route queries up to 10⁴-10⁵ rides per region; we're at 10¹-10².
  Revisit when p95 search latency exceeds 200ms.
- **2026-05-16** — New endpoints under `/api/rides/board/*` rather
  than extending `/api/schedule/request`. Existing path stays as-is
  for backwards compatibility with iOS clients that haven't been
  updated yet.

---

## Recent sessions

| Date | Slices worked | Outcome |
|---|---|---|
| 2026-05-16 | A1 (started) | Plan + progress docs committed; migration draft started |
