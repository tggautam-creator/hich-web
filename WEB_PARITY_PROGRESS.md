# Web Parity Progress

> Companion to [WEB_PARITY_REPORT_2026-05-12.md](WEB_PARITY_REPORT_2026-05-12.md). This file is the **live scoreboard** for the web-side parity work. It is read at the start of every Claude session — keep it up to date.

## Sprint 2 — Tier-1 UX gaps

**Goal:** close 6 high-impact UX gaps from the parity report. Web-only;
iOS items stay in the deferred queue below.

**Status:** ⏳ In progress — Slice 1 starting 2026-05-16.

### Decisions (locked 2026-05-16)

| Decision | Value | Implication |
|---|---|---|
| Tip placement | **Inline on RideSummary** (matches iOS) | RideSummary becomes a single screen for stars + tags + comment + tip + Submit. `/ride/rate/:id` either deprecates or renders the same embedded component. |
| Snooze durations | **Full iOS set** | 6 pills: 15 min / 1 h / 2 h / 4 h / 8 h / Until tomorrow. |
| Decline reasons | **7-pill set** (extended) | Too far / Wrong direction / Busy right now / Taking a break / Detour too long / Pickup too far from me / Other |
| Sprint scope | All 6 items, 4 slices | Closes every Tier-1 web UX gap in one sprint. |

### Sprint 2 slice plan

#### Slice 1 — Tip + inline rating on RideSummary (W-T1-R1 + W-T1-R2) ✅ shipped 2026-05-16 (awaiting prod QA)
- [x] Move stars + dynamic tag picker + (low-rating) comment field + tip percentage chips + tip-payment row + Total line + Submit into `RideSummaryPage.tsx`.
- [x] Use fare-scaled chips `15% / 20% / 25%` rounded to nearest $0.50, with flat $1/$2/$5 fallback when fare isn't loaded.
- [x] "Tip charged to Visa / Wallet / Add card" always-visible row above the picker. Tap → navigates to `/payment/methods`.
- [x] Server's `/api/rides/:id/rate` + `/api/rides/:id/tip` endpoints unchanged — single Submit fires both in sequence; ALREADY_RATED/ALREADY_TIPPED treated as success.
- [x] `/ride/rate/:id` now redirects to `/ride/summary/:id` (legacy FCM / email deep-links keep working).

#### Slice 2 — DriverCancelledChoiceOverlay on web (W-T1-R3) ✅ shipped 2026-05-16 (awaiting prod QA)
- [x] New `DriverCancelledOverlay.tsx` — full-screen takeover matching iOS `DriverCancelledChoiceOverlay`.
- [x] Warning vibration on appearance via `navigator.vibrate([60, 40, 60])` (Android-supported; Safari ignores — no-op fallback).
- [x] Standby driver count plumbed off the `driver_cancelled` broadcast payload, drives "N other drivers are ready…" copy with singular / plural / no-standby variants.
- [x] 2-minute idle countdown pill via single `setInterval`, turns danger-styled under 30s, auto-fires Cancel at zero.
- [x] "Find another driver" calls `POST /api/rides/:id/find-new-driver`. "Cancel ride" calls `PATCH /api/rides/:id/cancel`.
- [x] Wired into `MessagingWindow.tsx` (replaces the bare modal) and `RiderPickupPage.tsx` (replaces the 3-second auto-dismiss anti-pattern). WaitingRoom keeps the toast-style handler because the rider is still in the matching loop there.

#### Slice 3 — Decline reason sheet + snooze + Driver Home pill (W-T1-D1 + W-T1-D2) ✅ shipped 2026-05-16 (awaiting prod QA)
- [x] New `DeclineReasonSheet.tsx` component: 7 reason pills + 6 snooze duration pills, "Just decline" skip path, dynamic submit label.
- [x] Wired into `RideRequestNotification.tsx` banner Decline button (the auto-decline countdown stays silent — sheet is for explicit user gestures only).
- [x] Wired into `RideSuggestion.tsx` Decline button (countdown auto-decline and Back-arrow still silent).
- [x] Submit flow: POST `/api/rides/snooze` first (durable, ride-independent), then PATCH `/api/rides/:id/cancel` with reason only. Matches iOS `submitDecline` pattern.
- [x] `DriverHomePage.tsx`: reads `snoozed_until` alongside `is_online` from `driver_locations`, treats past values as not-snoozed, renders orange "Snoozed · Xm left" pill in the top bar (replaces the Online/Offline pill while paused), swaps the online toggle for a Resume button → DELETE `/api/rides/snooze`. Live countdown via single `setInterval` that auto-clears at zero. Optimistic resume with rollback on failure.

#### Slice 4 — Two-step accept flow (W-T1-D3) ✅ shipped 2026-05-16 (awaiting prod QA)
- [x] Split `RideSuggestion.tsx::handleAccept` into stage 1 (`handleAcceptStage1` — POST `/accept` with empty body) and stage 2 (`handleSubmitDestination` — PATCH `/driver-destination`).
- [x] Stage 1 now shows a single Accept CTA + an "only accept if you're heading this direction" disclaimer instead of the destination input. Standby branch still early-returns.
- [x] Stage 2 renders a success hero ("Ride accepted — Rider has been notified."), the destination search affordance, a Continue button (disabled until a destination is picked), and a "Cancel ride" pill in the header.
- [x] Cancel pill opens a confirm dialog with the iOS copy verbatim ("The rider has already been notified you accepted. Cancelling now will release the ride back to other drivers."); confirm PATCHes `/cancel` with reason `Cancelled after accept` then navigates home.
- [x] Browser Back blocked on stage 2 via `pushState` + `popstate` intercept that re-pins history and opens the confirm dialog. Auto-decline countdown is killed the moment stage 1 commits so it can't ambush the driver mid-destination-entry.

### Sprint 2 summary

| Status | Count |
|---|---|
| Not started | 0 |
| In progress | 0 |
| Done (awaiting QA) | 6 |
| Done (verified + pushed) | 0 |

### Current focus
All Tier-1 web items shipped. Awaiting prod QA across Slices 1–4.

### Next action
User QA on prod, then mark items as verified + close Sprint 2.

---

## Sprint 1 — Correctness bugs ✅ shipped 2026-05-13

**Goal:** ship the 12 Tier-0 fixes flagged in the parity report. Each fix is a true correctness divergence (broken endpoint, dropped state, stale data, wrong copy). No new features in this sprint.

**Scope:** **Webapp only.** iOS T0 items are deferred to a separate iOS session and recorded in the [iOS-deferred queue](#ios-deferred-queue) at the bottom of this file.

**Status:** ⏳ Planning — awaiting user approval of slice plan.

### Summary

| Status | Count |
|---|---|
| Not started | 0 |
| In progress | 0 |
| Done (awaiting QA) | 12 |
| Done (verified + pushed) | 0 |

### Current focus
🎉 **All 12 Tier-0 fixes implemented on disk.** Awaiting user QA across slices 1-7.

### Next action
User walks through the test plans for any slices not yet validated. On full sprint confirmation, push to GitHub in one go (per the 2026-05-12 decision).

---

## Rules of engagement (carried over from `ios/CLAUDE.md`, web-adapted)

The iOS sessions follow strict rules from `ios/CLAUDE.md`. These apply to web work in this sprint too:

### Asking questions — `AskUserQuestion`, not prose (hard rule)
Any time there's a product question, behavioral choice, or "should I do A or B" — use `AskUserQuestion`. Multi-choice with sensible options + "Other". Never ask in prose. Never end a turn with "let me know which you prefer" in plain text.

### Read web components end-to-end before changing
Don't skim. Open the file top-to-bottom. Enumerate every button, state branch, and conditional render before editing. If the slice touches multiple files, read all of them first.

### Self-review before asking the user to QA
After the slice is implemented, read the diff with reviewer eyes. Walk every state branch. List the test cases that exercise the change. THEN tell the user "run this, expect this" — don't just say "done."

### Build-quality gates (per slice, all three required)
1. `npm run lint` — zero errors
2. `npm test -- --run` — all tests pass; add tests for behavior changes
3. `npm run build` — full vite bundler must succeed (per memory `feedback_run_full_build_before_push.md` — tsc alone misses vite failures)

A slice isn't done until all three gates are green.

### Don't push to GitHub before the user tests locally — single push at sprint end
Per memory `feedback_test_before_push.md` AND the workflow Tarun chose 2026-05-12:
1. Implement each slice end-to-end (lint + build + tests green).
2. User reviews and tests locally, confirms.
3. Continue to the next slice. **No commits or pushes between slices.**
4. After all slices are confirmed, user says "push everything." Then commit + push in one go.

### No Co-Authored-By trailers
Per memory `feedback_no_coauthored_by.md` — user keeps git log free of AI attribution.

### Optimistic + rollback over silent fail
Whenever the change involves a user-facing mutation: optimistic UI first, paired with a rollback path on error. iOS audit found a pattern of web silently swallowing errors — this sprint includes fixes for several of those.

### Confirm destructive actions
Wherever a slice touches a destructive flow (cancel ride, delete row, withdraw, irreversible state change), surface a confirmation modal. Don't fire on first tap.

### Keep this file live
Flip checkboxes inline as work progresses. Append decisions to the Decisions Log immediately, not at end-of-session. Update the Summary table counts.

### When the sprint is over
Update the [Recent Sessions](#recent-sessions) table at the bottom with date, slices worked, one-line result. Move completed iOS-deferred items to a "Done" list in the iOS-deferred section once worked.

---

## Sprint 1 — Slice plan

Slices are ordered by user-visible impact (highest first). Each slice is cohesive — same area, similar risk, similar test surface.

### Slice 1 — Cancel & decline endpoint correctness ⏳ Awaiting user QA
- [x] **W-T0-1** Fix `MyRidesPage` cancel routing for board-requests (call `/withdraw-board` instead of `/cancel`) — 2026-05-12
  - File: `src/components/ride/MyRidesPage.tsx`
  - Change: `cancelRide(rideId)` → `cancelRide(ride)` accepting `{id, status, schedule_id}`. Branch: `status==='requested' && schedule_id != null` → PATCH `/api/schedule/withdraw-board` with body `{ride_id}`; else fall through to existing PATCH `/api/rides/:id/cancel`.
- [x] **W-T0-2** Wire driver decline to release ride_offer — 2026-05-12
  - File: `src/components/ride/RideSuggestion.tsx` — `handleDecline` now fires a fire-and-forget PATCH `/api/rides/:id/cancel` before navigating home. Auto-decline (countdown 0) reuses this function so it gets the same treatment.
  - File: `src/components/ride/RideRequestNotification.tsx` — added `declineNotification` helper. Skips the cancel POST for board_request entries (those go through `/api/schedule/decline-board` via BoardRequestReview). For instant rides, fires PATCH `/cancel` then dismisses. Wired to the Decline button + auto-expire timer.
- [x] **W-T0-11** Tighten stale `ride_request` filter from 1h → 5min — 2026-05-12
  - File: `src/components/ride/NotificationsPage.tsx` — `60*60*1000` → `5*60*1000`. Matches iOS NotificationsPage.swift:186.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

**Why grouped:** All three are cancel/decline lifecycle correctness. One test session covers: cancel a board request, decline a ride, look at notifications.

**Test plan:**
- Create a board-request as rider → from MyRides tap Cancel → verify board-request row is withdrawn server-side (Supabase ride_offers status='released' / schedule row not in 'requested' anymore).
- Open driver banner → Decline → verify server gets PATCH /cancel and ride_offer flips to 'released'.
- Inject a 6-min-old ride_request notification → verify it's filtered out of the inbox.

### Slice 2 — Auth & session resilience ⏳ Awaiting user QA
- [x] **W-T0-3** `authStore.refreshProfile` keeps last-known profile on transient fetch failure — 2026-05-12
  - File: `src/stores/authStore.ts`
  - Change: error branch now distinguishes PostgREST `PGRST116` (true "no rows" — clear profile) from any other error (network, 5xx, throttle — preserve profile). `isLoading` always flips to `false` so the spinner stops; only `profile` is conditionally preserved.
- [x] **W-T0-9** Surface email-confirmation link expiry in `AuthCallback` — 2026-05-12
  - File: `src/components/auth/AuthCallback.tsx`
  - Change: detects Supabase URL error params (query OR hash: `error_description`, `error_code`, `error`) immediately. Falls back to a 15s timeout if no SIGNED_IN event arrives. Renders a danger-tinted "Sign-in link expired" panel with retry copy + "Back to sign in" / "Create a new account" CTAs.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

### Slice 3 — Cold-launch driver visibility ⏳ Awaiting user QA
- [x] **W-T0-4** Driver inbox bootstrap reads `unread_only=false` + 165 s window so a force-closed tab re-surfaces still-actionable ride_requests — 2026-05-12
  - File: `src/components/ride/RideRequestNotification.tsx`
  - Change: new `bootstrapResume()` helper inside the existing driver-poll `useEffect`. Fetches `/api/notifications?unread_only=false&limit=5`, filters to `type === 'ride_request'` rows whose `created_at` is within the last 165 s (150 s server window + clock-drift cushion), then ingests through `handleRideRequest` (same dedup as realtime/FCM). Bootstrap runs once before the 15 s regular poll begins; both share `seenInboxNotifIdsRef` so rows are never double-processed.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

### Slice 4 — Server contract correctness ⏳ Awaiting user QA
- [x] **W-T0-7** Replace direct-dropoff fare formula with canonical `src/lib/fare.ts` `calculateFare` — 2026-05-12
  - File: `src/components/ride/DropoffSelection.tsx`
  - Change: removed the inline arithmetic that hardcoded the (long-removed) $2 base fare, $8/min time rate, and $40 upper cap. Now derives `estMin` from `distKm / 40 km·h × 60` and passes both to `calculateFare(distKm, estMin)`. Tracks server's actual charge.
- [x] **W-T0-12** Render `needsReverification` Stripe Connect banner — 2026-05-12
  - File: `src/components/driver/DriverPayoutsPage.tsx`
  - Change: derive `needsReverification = has_account && onboarding_complete && (!charges_enabled || !payouts_enabled)` client-side (matches iOS `ConnectStatus.needsReverification` — no server change needed). When true, the green "Payouts active" status pill flips to amber "Verification needed," and a new warning banner sits above the payout method card with copy that adapts to which of charges/payouts is paused, plus an "Open Stripe dashboard" CTA wired to the existing `openDashboard` handler.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

### Slice 5 — Foreground notifications + phone re-verify ⏳ Awaiting user QA
- [x] **W-T0-10** Add typed foreground toast dispatcher — 2026-05-12
  - New file: `src/components/ui/ForegroundPushToast.tsx` — subscribes to `onForegroundMessage`, skips types already handled by `RideRequestNotification` (ride_request, board_*, ride_cancelled, etc.), renders a tinted 6 s toast for payment_received / payment_failed / payment_needed / topup_succeeded / withdrawal_landed / withdrawal_failed / schedule_match. Tap routes to RideSummary / Wallet / RideBoard as appropriate.
  - Mounted in `src/components/auth/AuthGuard.tsx` next to `<RideRequestNotification />`.
  - Test mock updated in `src/test/auth/AuthGuard.test.tsx` to bypass the new component (same pattern as the existing RideRequestNotification mock).
- [x] **W-T0-8** Re-enable phone re-verify save (skip OTP per product decision) — 2026-05-12
  - File: `src/components/ride/ProfilePage.tsx`
  - Change: uncommented `phoneChanged` detection + `phone_verified: false` write on phone change. Did NOT re-enable the navigate-to-verify call — that path is owned by `AuthGuard.tsx:108-112` and gated by `VITE_SKIP_PHONE_VERIFICATION` (currently `true` in dev/prod). Once Twilio is approved and the env flips to `false`, AuthGuard automatically routes phone-unverified users to `/onboarding/verify-phone` on next gate check.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

### Slice 6 — Routine delete semantics ⏳ Awaiting user QA
- [x] **W-T0-6** Pause + Delete reconciliation (matches iOS RoutinesSheet) — 2026-05-12
  - File: `src/components/schedule/RideBoard.tsx`
  - Changes:
    - `fetchRoutines` no longer filters by `is_active=true` — paused routines now appear in the list. Sorted active-first, then by creation date.
    - **New** `handlePauseRoutine(id, isCurrentlyActive)` — toggles `is_active` between true/false. Soft action; doesn't cancel pending requests.
    - `handleDeleteRoutine(id)` — now a **real DELETE** (was `UPDATE is_active=false`). Migration-058 trigger cascades to projected ride rows and pending requests on them. Gated by a confirm overlay.
    - **New** confirm overlay (`confirmDeleteRoutineId` state) renders the iOS cascade-warning copy: *"This permanently removes the routine AND the next 7 days of projected board posts. Any pending rider requests on those days will be cancelled. Use Pause if you only want to stop projecting it for a while."*
    - **New** Active/Paused badge on each card. Paused cards render at 70% opacity.
    - Card actions are now **Edit / Pause-or-Resume / Delete** (three buttons).

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

### Slice 7 — Firebase project dev/prod split in SW ⏳ Awaiting user QA
- [x] **W-T0-5** Build-time env injection for `firebase-messaging-sw.js` — 2026-05-12
  - Files: `public/firebase-messaging-sw.js`, `vite.config.ts`
  - Changes:
    - `public/firebase-messaging-sw.js` now uses `__FIREBASE_*__` placeholders for `apiKey` / `authDomain` / `projectId` / `messagingSenderId` / `appId` instead of hardcoded prod values.
    - **New** `firebaseMessagingSwEnvPlugin` in `vite.config.ts` replaces those placeholders both at dev-serve time (via `configureServer` middleware intercepting `GET /firebase-messaging-sw.js`) AND at build time (via `writeBundle` rewriting `dist/firebase-messaging-sw.js` after Vite copies it from `public/`).
    - Uses `loadEnv(mode, cwd, '')` so `npm run dev` (`--mode dev` → `.env.dev`) injects dev Firebase and `npm run build` (production mode → `.env`) injects prod Firebase.
  - Verified end-to-end: `curl localhost:5173/firebase-messaging-sw.js` shows `projectId: 'tago-dev-e3ade'`; `dist/firebase-messaging-sw.js` after `npm run build` shows `projectId: 'hich-6f501'`.

Quality gates passed: lint 0 warnings · vite build clean · 1035/1035 tests.

---

## Product decisions

These need user input before the slice can land. As they're answered, the answer + date goes here.

| # | Slice | Question | Answer | Decided |
|---|---|---|---|---|
| 1 | 6 | Routine delete: hard-delete with cascade, or rename to "Pause" and keep soft semantics? | **Add both — Pause + Delete.** Match iOS exactly. Keep button labelled "Delete" as a true hard-delete with cascade warning copy; add separate Pause/Resume row for soft-pause. | 2026-05-12 |
| 2 | 5 | Phone re-verify: is Twilio toll-free approved? Re-enable, or leave deferred? | **Re-enable but skip OTP.** Save phone with `phone_verified=false`; let AuthGuard redirect to verify-phone gated by env var (`VITE_SKIP_PHONE_VERIFICATION`). Cleaner than the commented-out code but doesn't force OTP until Twilio is approved. | 2026-05-12 |

---

## Decisions log

Free-form journal of non-obvious decisions made during the sprint. One line per entry, with date.

(empty)

---

## iOS-deferred queue

iOS T0 items found during the parity audit. Not worked in this sprint. Listed here so the next iOS session picks them up.

- [ ] **I-T0-1** `ScheduleRequestEndpoint` missing `estimated_fare_cents` → wallet-only riders fail with NO_PAYMENT_METHOD
  - File: `ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift:38-69`
- [ ] **I-T0-2** No `is_driver` gate on offer-to-drive flow on rider-posted board rows
  - File: `ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift:116`
- [ ] **I-T0-3** No driver-side `/gps-ping` loop during active ride → fare-distance accuracy degraded
  - File: `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift`
- [ ] **I-T0-4** Cancel modal hard-codes "notifies the rider" — wrong copy for rider-initiated cancels
  - File: `ios/Tago/Features/Messaging/MessagingPage.swift:636-647`
- [ ] **I-T0-5** No `chat-badge:{rideID}` subscription on active-ride drawer → no unread badge
  - File: `ios/Tago/Features/RiderHome/RiderActiveRideDrawer.swift` + `ios/Tago/Features/DriverHome/DriverPickupPage.swift`
- [ ] **I-T0-6** Missing vehicle color/year/make/model/plate row in chat header (rider side)
  - File: `ios/Tago/Features/Messaging/MessagingSubviews.swift`
- [ ] **I-T0-7** find-new-driver flow has a residual rider WaitingRoom stale-state tail (already documented in memory `project_find_new_driver_known_issue.md`)

---

## Recent sessions

| Date | Slices worked | Result |
|---|---|---|
| 2026-05-12 | Sprint 1 planning + setup | Slice plan drafted; product decisions answered (routine delete = Pause+Delete; phone re-verify = re-enable, skip OTP) |
| 2026-05-12 | Slice 1 implementation | W-T0-1, W-T0-2, W-T0-11 implemented; gates green; awaiting user QA |
| 2026-05-12 | Vite local dev env fix | `package.json` `dev` script → `vite --mode dev` so browser reads `.env.dev` (dev Supabase / dev Firebase). Web + iOS sim now share dev project. |
| 2026-05-12 | Slice 2 implementation | W-T0-3, W-T0-9 implemented; gates green; awaiting user QA |
| 2026-05-12 | Slice 3 implementation | W-T0-4 cold-launch resume implemented; gates green; awaiting user QA |
| 2026-05-12 | Slice 4 implementation | W-T0-7 (direct-dropoff fare → canonical fare.ts) + W-T0-12 (Stripe Connect reverification banner) implemented; gates green; awaiting user QA |
| 2026-05-12 | Slice 5 implementation | W-T0-10 (ForegroundPushToast for payment/schedule_match events) + W-T0-8 (phone re-verify flag — skip OTP per env gate); gates green; awaiting user QA |
| 2026-05-12 | Slice 6 implementation | W-T0-6 Routine Pause + Delete pattern (hard-delete with cascade warning + soft-pause toggle); gates green; awaiting user QA |
| 2026-05-12 | Slice 7 implementation | W-T0-5 SW Firebase env injection (Vite plugin rewrites placeholders at dev-serve + build time); end-to-end verified (dev → `tago-dev-e3ade`, prod → `hich-6f501`); gates green |
