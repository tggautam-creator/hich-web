# Web Parity Progress

> Companion to [WEB_PARITY_REPORT_2026-05-22.md](WEB_PARITY_REPORT_2026-05-22.md) (current — supersedes the 2026-05-12 one, which is kept for historical reference). This file is the **live scoreboard** for the web-side parity work. It is read at the start of every Claude session — keep it up to date.

---

## 🎯 Multi-stage iOS-parity audit (started 2026-05-22)

iOS has added 22 migrations (086–107), 22 new endpoints, and entire new Feature directories (Reports, AdminCampaign, LiveActivity, MultiRider, Suggestions, expanded Profile/RideBoard) since the 2026-05-12 report. We're running a fresh top-to-bottom audit in stages so every iOS file gets read end-to-end before web changes land.

**See [WEB_PARITY_REPORT_2026-05-22.md](WEB_PARITY_REPORT_2026-05-22.md) for the full stage plan + scope.**

### Audit stage status

| # | Stage | iOS scope | Status |
|---|---|---|---|
| 0 | Audit plan + new rules in `CLAUDE.md` | n/a — inventory + rules only | ✅ shipped 2026-05-22 |
| 1 | **Reports v2** | mig 086, `Features/Reports/`, `REPORTS_IOS_PLAN.md`, `docs/REPORTS_PLAN.md`, Reports endpoints | ✅ audit complete 2026-05-30 — see [Sprint 5](#sprint-5--reports-v2-parity) below |
| 2 | **Caregivers** | mig 089, 091, 092, 093, iOS surface much wider than originally scoped (Profile + Auth + Schedule + RideBoard + Driver UX + 3 DesignSystem components + repository, no Endpoints/ files — iOS goes direct via Supabase SDK) | ✅ audit complete 2026-05-30 — see [Sprint 6](#sprint-6--caregivers-v12-parity) below |
| 3 | **Vehicle + user accessibility** | mig 087 (user-profile expansion: bio/gender/school/major/grad-year), 088 (accessibility profile), 090 (vehicle wheelchair_capable + trunk_size) | ✅ audit complete 2026-05-30 — see [Sprint 7](#sprint-7--accessibility--user-profile-v12-parity) below |
| 4 | **Rider routines + Suggestions** | mig 099–106, `Features/Suggestions/`, `Features/Schedule/Routines*`, `Features/Profile/ProfileRoutinesSection`, suggestion + project-routine + sync-routine endpoints | ✅ audit complete 2026-05-30 — see [Sprint 8](#sprint-8--suggestions--rider-routines-v13-parity) below |
| 5 | **Trips & segments (split fare)** | mig 097, 098, `Features/Rides/`, `Features/MultiRider/`, `Features/DriverHome/DriverMultiRidePage+TripComplete`, `server/lib/trips.ts` + `server/lib/segments.ts`, no dedicated endpoint yet (iOS reads Supabase direct via `CoRidersFetcher`) | ✅ audit complete 2026-05-30 — see [Sprint 9](#sprint-9--trips--segments-split-fare-foundation-v13-parity) below |
| 6 | **Board redesign + Smart geo-match** | 25 `Features/RideBoard/` .swift files, board endpoints (`BoardOfferEndpoints`, `BoardSearchEndpoint`, `BoardRequestActionEndpoints`, `ScheduleBoardEndpoint`), migrations 072 + 075 + 078 + 083 (smart polylines + transit details), parallel-session coordination cleared (no `RideBoard/` activity from them in 14d) | ✅ audit complete 2026-06-01 — see [Sprint 10](#sprint-10--board-redesign--smart-geo-match-v13-parity) below |
| 7 | **Ride safety + forensics (admin)** | mig 094, 095, 096, `Features/Safety/`, `Features/Profile/ProfileSafetySection.swift`, safety endpoints | ✅ audit complete 2026-06-02 — see [Sprint 11](#sprint-11--ride-safety--forensics-v13-parity) below |
| 8 | **Endpoint coverage audit** | all 72 endpoints in `ios/Core/Networking/Endpoints/` + ~25 server routes + every web fetch / Supabase call site | ✅ audit complete 2026-06-03 — see [Sprint 12](#sprint-12--endpoint-coverage-v13-parity) below |
| 9 | **Re-walk Tier 2 polish from 2026-05-12** | copy / sort / filter / banner items | ⏳ pending |

Each stage produces a numbered sprint that lands below. The next stage doesn't start until the previous stage's sprint is pushed.

### Stage execution protocol (per the new web rules)

For every stage:
1. **Read iOS files end-to-end.** No skimming. Enumerate every screen, button, endpoint call, server route.
2. **Read the web counterpart end-to-end.** Same files Tarun expects to be matching.
3. **List the gaps as actionable items.** Component-level OR endpoint-level. Group into a numbered sprint and add the section below.
4. **Slice the sprint.** Each slice: lint + tests + build green → tough self-review → commit + push → hand back to user with QA plan.
5. **Wait for the user's "go" before starting the next stage** (per-feature green light memory rule).

### Currently pending decisions

- **Stages 1–8 audits landed**. Stage 9 still queued.
- **Sprint 12 (Endpoint coverage v1.3)** — ✅ Audit complete 2026-06-03. 13-slice plan landed below; no code yet. Headline: 24 contract-shape mismatches (wrong field names / methods / payloads to existing server routes), 11 HIGH-severity WEB_MISSING endpoints, 3 audit-log-bypass direct-Supabase writes, 4 chat realtime channels web silently dropped in favour of polling, and dead-code calls to nonexistent server routes. Slice 0 is a verification spike (3 open questions reshape later slices). 1500-LoC React Query extraction sweep + 1200-LoC v1.3 catch-up deferred to Sprint 13 + Sprint 14 standalone.
- **Sprint 11 (Ride safety + forensics v1.3)** — ✅ ALL 7 slices shipped + pushed (commits through `cd7bc26` + tsc/eslint hotfixes). CI green. 136 new tests added across the sprint. Closed 5 BLOCKER + 8 HIGH gaps.
- **Sprint 10 (Board redesign + Smart geo-match v1.3)** — ✅ All 6 slices shipped + pushed.
- **Sprint 9 (Trips & segments v1.3)** — ✅ All 5 slices shipped + pushed.
- **Sprint 8 (Suggestions + rider routines v1.3)** — ✅ Audit complete 2026-05-30. 6-slice plan landed; no code yet. Open question #9: rider-home Waymo redesign blocks Slice 4's natural placement.
- **Sprint 7 (accessibility / user profile)** — ✅ Slices 1–5 shipped + pushed (CI green 2026-05-30). Slice 6 (UserProfilePreviewCard polish) parked.
- **Sprint 6 (caregivers)** — ✅ Slices 1–6 shipped + pushed.
- **Sprint 5 (Reports v2 polish)** — ⏳ Not started. Notifications-drift slice is highest blast radius; awaiting "go".

### Current focus

Stage 8 audit just landed (2026-06-03). Stages 1–8 of the multi-stage iOS-parity audit are now complete. Sprint 11 is **shipped to prod**. 13-slice Sprint 12 endpoint-coverage plan waits on user direction — biggest scope yet, but each slice is independently mergeable + reversible. Slice 0 is a zero-LoC verification spike that resolves 3 open questions before any code.

### Next action

Tarun decides:
1. **Sprint 12 Slice 0** (verification spike — zero-LoC, ~30min, resolves the 3 open questions that reshape Slices 1c + 4a + 5a).
2. **Sprint 12 Slice 1a** (ride-flow contract fixes — 6 endpoints aligned to iOS, ~180 LoC, smallest contract slice). Can run after Slice 0.
3. **Sprint 8 Slice 1** (Suggestions foundation) — bigger unrelated direction.
4. **Sprint 5 Slice 1** (Reports v2 notifications drift — bounded UX fix).
5. Run **Stage 9 audit** (Tier 2 polish re-walk — copy / sort / filter / banners from 2026-05-12 report).
6. Resolve **Sprint 12 open questions** (Slice 0 spike answers + Sprint 13/14 scope confirms — caregivers REST routes deprecation, report attachments, hook extraction scope, v1.3 catch-up scope).

---

## Sprint 12 — Endpoint coverage v1.3 parity

**Audit-first mode.** Stage 8 of the multi-stage iOS-parity audit completed 2026-06-03 with no code changes. This section is the side-by-side findings + 13-slice plan. Nothing here is shipped on the web app yet.

### Slice 0 — verification spike (RESOLVED 2026-06-03)

Three open questions blocked the next slices. All three answered via read-only investigation; matrix rows updated below.

**Q1 — Does `GET /api/rides/:rideId` return a full RideSnapshot, or is iOS reading via Supabase RPC?**
- iOS endpoint defined at [`GetRideEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/GetRideEndpoint.swift) — returns `RideSnapshot { id, status, driver_id, pickup_point, destination_name }`.
- Three iOS call sites: `WaitingRoomPage+Live.swift:34`, `RideSuggestionPage.swift:1381`, `DropoffSelectionPage+Actions.swift:148` — all use `try?` (silent failure on error).
- Server has `/api/rides/:id/status` (lightweight `{status}`), `/:id/notification-status`, `/:id/offers`, `/:id/qr` — but **NO bare `GET /api/rides/:id` handler**.
- **Finding**: iOS endpoint 404s today; silent failure swallowed by `try?`. iOS has a latent bug; rider waiting-room state actually updates via realtime + `/api/rides/active` polling. **Web has zero work here.** Flag for iOS session.
- **Matrix row reclassified**: `GET /api/rides/:rideId` → IOS_BUG / LOW (was OPEN_QUESTION / HIGH).

**Q2 — Does web `RideBoard.tsx` fetch `/api/schedule/board` or read `ride_schedules` via Supabase direct?**
- Web `RideBoard.tsx:715` calls `fetch(/api/schedule/board?${qs})` — server endpoint used.
- iOS `RideBoardViewModel.swift:87` calls the same `/api/schedule/board`.
- **Finding**: Wire-compatible. PARITY. The separate `/api/schedule/board/offers` drift on `RideBoard.tsx:272` (iOS uses `/schedule/:id/offers`) stays in Slice 1c as previously planned.
- **Matrix row reclassified**: `GET /api/schedule/board` → PARITY / LOW (was OPEN_QUESTION / HIGH).

**Q3 — Does iOS `VehicleRegistrationPage` write `vehicles.insert` directly or via a server route?**
- iOS routes through `Core/Supabase/Repositories/VehiclesRepository.swift` — direct `from("vehicles")` access for insert + select + update + delete.
- Web `VehicleRegistrationPage.tsx:326` — `supabase.from('vehicles').insert(...)` — direct Supabase access.
- **Finding**: Both clients use direct Supabase by design (no `vehicleRouter` write route exists in `server/routes/vehicle.ts` — only `POST /plate-lookup`). PARITY.
- **Matrix row reclassified**: `Direct Supabase: vehicles.insert` → PARITY / LOW (was OPEN_QUESTION / MEDIUM).

**Net impact on slice plan:**
- **Slice 1a** unblocked — no longer needs to bridge a phantom `GET /api/rides/:rideId` handler.
- **Slice 1c** unchanged — `/api/schedule/board` is fine; only the per-schedule offers fetch shifts to `/schedule/:id/offers`.
- **Slice 5a** unchanged — vehicles direct-Supabase write is intentional parity, not an audit-log violation.
- **Audit-log violations remaining after Slice 0**: 3 (down from 4 — `vehicles.insert` removed from the list).

### Slice 1a — verification findings (NO-OP, 2026-06-03)

Started Slice 1a by reading each iOS endpoint + server handler + every web call site to confirm the audit's 6 claimed contract drifts. **5 of the 6 are false positives — web is already aligned.** Existing contract tests (DropoffSelection.test + RideSuggestion.test, 26 tests) pass.

Verification table:

| Endpoint | Audit claim | Actual web shape | Verdict |
| --- | --- | --- | --- |
| POST /api/rides/scan-driver | Web sends `{token}` only | RiderActiveRidePage:348 + RiderPickupPage:366 both send `{driver_code, lat, lng}` | ✅ Aligned |
| POST /api/rides/:id/signal | Web sends `{kind}` | RiderPickupPage:416 sends no body | ✅ Aligned |
| POST /api/rides/:id/accept-location | Missing `{location_type}` | MessagingWindow:1034 sends `{location_type: locationType}` | ✅ Aligned |
| PATCH /api/rides/:id/driver-destination | Web `{lat,lng,address}` vs iOS `{destination_lat,_lng,_name}` | All 3 sites (DriverDestinationCard:91, RideSuggestion:555, DropoffSelection:201) send `{destination_lat, destination_lng, destination_name}` | ✅ Aligned |
| POST /api/rides/:id/suggest-transit-dropoff | Web sends 3 fields; iOS sends 14 | TransitSuggestionCard:164-178 + DropoffSelection:348-362 both send all 14 fields verbatim | ✅ Aligned |
| PATCH /api/rides/:id/accept | Missing driver_destination_* + driver_route_polyline + overlap_pct | Web's 2-stage pattern: `/accept` with `{}` then `/driver-destination` second. iOS optionally inlines destination in `/accept`. polyline/overlap_pct: iOS doesn't send these either (audit was wrong on this part). End state equivalent. | ⚠️ Different flow, same end state |

**Audit-log violation claim — also wrong**: Audit said web's direct `rides.update progress_pct` write should be removed because "server already derives from /gps-ping". Reading `server/routes/rides.ts:5172-5195` confirms the `/gps-ping` handler updates `gps_distance_metres + last_gps_lat/lng` but **does NOT compute or write progress_pct**. The web direct-write at `RiderActiveRidePage:459` + `DriverActiveRidePage:383` is the ONLY writer for this column. Removing it without adding a server-side computer would null out the admin Live screen's progress bar.

**Conclusion**: Slice 1a is effectively a no-op given the actual code state. The single remaining ambiguity is `/accept`'s flow difference, and even there the web 2-stage pattern produces identical server state to iOS's inline pattern — not a correctness issue.

**Action taken**: zero code changes. Matrix rows reclassified to PARITY. Slice 1a is closed.

**Lessons for the rest of Sprint 12**: the audit's per-slice contract-drift claims need per-slice verification on entry. Run the verification before applying edits — false positives are likely concentrated where the scout couldn't see recent fixes that landed in Sprint 9/10/11. Slices 1b through 6 should each begin with a 5-minute "read current shape" pass before writing any TypeScript.

### Slice 1b — verification findings (NO-OP, 2026-06-03)

Same pattern as Slice 1a — every audit-claimed contract drift verified false. **All 5 endpoints are already aligned with iOS.**

| Endpoint | Audit claim | Actual web shape | Verdict |
| --- | --- | --- | --- |
| POST /api/rides/:id/tip | iOS sends `{tip_cents}`; web sends extra `payment_method_id` | RideSummaryPage:710 sends `{ tip_cents }` only | ✅ Aligned |
| POST /api/rides/:id/retry-payment | Web sends `{payment_method_id}` | RideSummaryPage:526 sends NO body | ✅ Aligned |
| POST /api/payment/default-method | Server POST; web sends PUT | Both sites (PaymentMethodsPage:56 + SaveCardPage:77) use `method: 'POST'` | ✅ Aligned |
| POST /api/wallet/topup | Web sends extra `payment_method_id` | Both sites (AddFundsPage:143 + 237) send `{ amount_cents }` only | ✅ Aligned |
| POST /api/wallet/withdraw | Verify Idempotency-Key header | WithdrawSheet:118 sends `'Idempotency-Key': genIdempotencyKey()` | ✅ Aligned |

**Slice 1b action**: zero code changes. Matrix rows reclassified to PARITY. Slice closed.

**Pattern observation**: Slices 1a + 1b combined = 11 audit-claimed contract drifts, **all 11 are false positives**. The audit's CONTRACT_DRIFT detection on the rides/payments/wallet domains has ~0% accuracy in this sprint — the scout agents read pre-Sprint-9/10/11 snapshots that pre-date the alignment work already shipped. Slices 1c–1f should be checked the same way before starting.

### Current focus
Close the largest cluster of iOS↔web drift left in the catalog: 24 contract-shape mismatches where web is sending wrong field names / methods / payloads to existing server routes, 11 HIGH-severity WEB_MISSING endpoints (notification-status, driver-pending-offer resume, tap-to-call, pickup/dropoff proposals, RLS-safe profile write, BoardOffer create), the chat realtime channels web silently dropped in favour of polling, and four direct-Supabase writes that bypass server audit. The sprint is sequenced smallest-first so each slice is independently mergeable, reversible, and tied to one user-visible win or one matrix row class.

### Sprint 12 sequenced plan (one paragraph plain-English)
We start with a tiny verification spike (Slice 0) to resolve two blocking open questions — does GET /api/rides/:rideId actually exist as a full snapshot, and does the web RideBoard read /api/schedule/board or fall back to Supabase direct — because the answers reshape later slices. Then six small contract-fix slices (1a–1f) ship one user-visible domain at a time (ride flow, payments/wallet, scheduling, notifications/preferences, safety, Stripe Connect) so a regression in any one fix can roll back without touching the others. Next come small, focused WEB_MISSING surfaces in single-win slices: WaitingRoom CTA (2a), driver PWA resume (2b), tap-to-call (3), pickup/dropoff proposals via chat (4a), seats edit on MyRidesPage (4b), RLS-safe profile write path (5a), profile stats tiles (5b), driver "make an offer" composer (6), and the chat realtime subscription fix (7, replacing the original mega-extraction Slice 7). The big React Query hook-extraction sweep is deferred to Sprint 13 because it requires Slices 1a–6 to land first and would otherwise rewrite code those slices just shipped. The iOS-canonical Suggestions hero and Rider Routines page are deferred to Sprint 14 as a standalone v1.3 catch-up sprint. New rows added by the completeness critic — including a HIGH chat realtime gap, audit-log violations on progress/driver-locations direct writes, FCM data.type handler coverage, and missing accessibility/caregiver fields on profile upsert — are folded into the slice that already touches that surface.

### Parity matrix — endpoint by endpoint

| Endpoint | iOS | Web | Status | Severity | Gap |
| --- | --- | --- | --- | --- | --- |
| POST /api/rides/request | RideConfirmPage.swift:614 | RideConfirm.tsx:150 (inline) | WEB_INLINE | MEDIUM | Missing caregiver_id (v1.2 F6.2) + origin_name (reverse-geocoded label, 2026-05-01); no RQ wrapper |
| GET /api/rides/:rideId (full RideSnapshot) | WaitingRoomPage+Live.swift:34, RideSuggestionPage.swift:1381, DropoffSelectionPage+Actions.swift:148 | none | OPEN_QUESTION | HIGH | Server catalog shows only GET /:id/status returning {status}. Either iOS reads via Supabase RPC or a handler isn't enumerated. **Resolved in Slice 0** |
| GET /api/rides/active | RidesTabViewModel.swift:152 | RiderHomePage.tsx:44, MyRidesPage.tsx:96, DriverHomePage.tsx:93 (3× inline) | WEB_INLINE | MEDIUM | No shared hook; cross-page invalidation ad hoc — folded into Sprint 13 extraction |
| PATCH /api/rides/:id/accept | RideSuggestionPage.swift:1152 | RideRequestNotification.tsx:907, RideSuggestion.tsx:501 (inline) | CONTRACT_DRIFT | MEDIUM | Missing driver_destination_{lat,lng,name} **and** driver_route_polyline + overlap_pct that server reads on /accept handler |
| PATCH /api/rides/:rideId/cancel | WaitingRoomPage.swift:571 | 10 inline call sites | WEB_INLINE | HIGH | snooze_minutes / reason field drift across 10 surfaces — Sprint 13 |
| POST /api/rides/scan-driver | DriverPickupPage.swift:1517 | RiderActiveRidePage.tsx:342, RiderPickupPage.tsx:360 | CONTRACT_DRIFT | HIGH | iOS sends `{driver_code, lat?, lng?}`; web sends `{token}` only |
| POST /api/rides/:id/signal | DriverPickupPage.swift:1474 | RiderPickupPage.tsx:416 | CONTRACT_DRIFT | MEDIUM | iOS empty body; web sends `{kind}` — server contract is bodyless |
| GET /api/rides/:rideId/notification-status | WaitingRoomPage.swift:636 | none | WEB_MISSING | HIGH | "No drivers nearby — try Ride Board" CTA never surfaces. **Slice 2a** |
| POST /api/rides/:id/accept-location | MessagingPage+MessageRows.swift:145 | MessagingWindow.tsx:1028 | CONTRACT_DRIFT | HIGH | Missing `{location_type: 'pickup'\|'dropoff'}` — wrong column flipped |
| PATCH /api/rides/:id/pickup-point | DriverPickupPage.swift:1312 | none | WEB_MISSING | HIGH | **Slice 4a** |
| PATCH /api/rides/:id/dropoff-point | DriverPickupPage.swift:1323 | none | WEB_MISSING | HIGH | **Slice 4a** |
| PATCH /api/rides/:id/driver-destination | DriverDestinationEntryPage.swift:352 | RideSuggestion.tsx:549, DriverDestinationCard.tsx:85, DropoffSelection.tsx:195 | CONTRACT_DRIFT | MEDIUM | Web `{lat,lng,address}` vs iOS `{destination_lat,destination_lng,destination_name}` |
| POST /api/rides/:id/suggest-transit-dropoff | DropoffSelectionPage+Actions.swift:84 | DropoffSelection.tsx:342, TransitSuggestionCard.tsx:158 | CONTRACT_DRIFT | HIGH | Web sends 3 fields; iOS sends 14 — drops every transit-routing field |
| GET /api/rides/driver-pending-offer | RideRequestListener.swift:154 | none | WEB_MISSING | HIGH | PWA reload loses pending offer. **Slice 2b** |
| GET /api/rides/:rideId/counterparty-contact | CallButton.swift:141 | none | WEB_MISSING | HIGH | Tap-to-call missing on web. **Slice 3** |
| POST /api/rides/:id/tip | RateRidePage.swift:565 | RideSummaryPage.tsx:704 | CONTRACT_DRIFT | MEDIUM | iOS `{tip_cents}` only; web sends extra `payment_method_id` |
| POST /api/rides/:id/retry-payment | DunningBanner.swift:180 | RideSummaryPage.tsx:526 | CONTRACT_DRIFT | MEDIUM | Web sends `{payment_method_id}`; server uses default |
| POST /api/rides/:id/safety-end | DriverActiveRidePage.swift:799 | rideManualEndGate.ts:90 | CONTRACT_DRIFT | MEDIUM | Web sends empty body; iOS sends `{reason}` (enum: `rider_left\|driver_left\|manual_end`) |
| POST /api/rides/:id/safety-warning-response | RideSafetyCheckOverlay.swift:296 | safetyWarningResponseApi.ts:102 | CONTRACT_DRIFT | HIGH | Action enum mismatch + web doesn't surface `trusted_contacts[]` + `share_token` returned on `help_requested` |
| POST /api/rides/snooze | RideSuggestionPage.swift:1239 | RideRequestNotification:217, RideSuggestion:362, DriverHomePage:277 | CONTRACT_DRIFT | MEDIUM | Web sends `{seconds}`; iOS sends `{snooze_minutes}` |
| POST /api/payment/default-method | PaymentMethodsPage.swift:483 | PaymentMethodsPage.tsx:55, SaveCardPage.tsx:76 | CONTRACT_DRIFT | MEDIUM | Server POST; web sends PUT |
| POST /api/wallet/topup | AddFundsSheet.swift:533 | AddFundsPage.tsx:142,236 | CONTRACT_DRIFT | MEDIUM | Web sends extra `payment_method_id` |
| POST /api/wallet/withdraw | WithdrawSheet.swift:311 | WithdrawSheet.tsx:114 | CONTRACT_DRIFT | MEDIUM | Verify Idempotency-Key header — without it, double-tap on slow networks double-withdraws |
| GET /api/connect/dashboard | PayoutsPage.swift:464 | DriverPayoutsPage.tsx:57 | CONTRACT_DRIFT | MEDIUM | Server GET; web uses POST (405) |
| GET /api/connect/onboard/complete | StripeOnboardingCompletePage.swift:202 | StripeOnboardingCompletePage:26, DriverHomePage:246 | CONTRACT_DRIFT | MEDIUM | Server GET; web POST (405) |
| GET /api/schedule/board | RideBoardViewModel.swift:154 | none (likely Supabase direct) | OPEN_QUESTION | HIGH | **Resolved in Slice 0** |
| GET /api/schedule/by-id/:id | SuggestedRidesHero.swift:249 | RideBoard.tsx:451, MyRidesPage.tsx:135 (uses /api/schedule/:id — 404) | CONTRACT_DRIFT | HIGH | Server only registers `/by-id/:id` |
| GET /api/schedule/:id/seats | none | RideBoard.tsx:477 (inline) | CONTRACT_DRIFT | HIGH | No server route — likely 404 |
| GET /api/schedule/board/offers | none (iOS uses `/schedule/:id/offers`) | RideBoard.tsx:272 | CONTRACT_DRIFT | HIGH | Server only has `/board/schedule/:scheduleId/offers` |
| PATCH /api/schedule/:id/seats | RideBoardPage+Actions.swift:103 | none | WEB_MISSING | MEDIUM | **Slice 4b** |
| POST /api/schedule/notify | SchedulePostViewModel+Submit.swift:827 | SchedulePage.tsx:425,691 | CONTRACT_DRIFT | MEDIUM | Web sends `{scheduleId}`; server expects full match params |
| POST /api/schedule/request | RideBoardConfirmViewModel.swift:712 | RideBoard.tsx:246 | CONTRACT_DRIFT | HIGH | Web 2-field; iOS 11-field (coords + caregiver_id) |
| POST /api/schedule/sync-routines | RoutinesViewModel.swift:66 | RideBoard.tsx:768 | CONTRACT_DRIFT | MEDIUM | Web sends `{}`; iOS sends `{client_date}` |
| POST /api/transit/preview | RideBoardConfirmViewModel.swift:540 | RideBoardConfirmSheet.tsx:210 | CONTRACT_DRIFT | MEDIUM | Web sends nested objects; iOS sends 6 flat lat/lng fields |
| POST /api/schedule/board/offers | RideBoardConfirmViewModel.swift:765 | none | WEB_MISSING | HIGH | **Slice 6** |
| PATCH /api/schedule/accept-board | NotificationsPage.swift:255 | NotificationsPage.tsx:102, BoardRequestReview.tsx:163 | CONTRACT_DRIFT | MEDIUM | Web `{requestId}` vs iOS `{ride_id}` |
| PATCH /api/schedule/decline-board | NotificationsPage.swift:277 | NotificationsPage.tsx:132, BoardRequestReview.tsx:141 | CONTRACT_DRIFT | MEDIUM | Same `{ride_id}` drift + missing reason |
| POST /api/messages/:rideId | MessagesViewModel.swift:324 | MessagingWindow.tsx:826,875, DriverGroupChatPage:154 | CONTRACT_DRIFT | HIGH | Web sends `{locationLat,locationLng,locationLabel,clientMessageId}` — server only reads `content` (silent drop). Folded into **Slice 4a** |
| Realtime: chat:{rideId} | MessagesViewModel subscribes | MessagingWindow polls instead | DRIFT | HIGH | **Slice 7** — replace polling with realtime |
| Realtime: chat-badge:{rideId} | iOS subscribes | none | DRIFT | MEDIUM | **Slice 7** |
| Realtime: chat-confirm:{rideId} (locations_confirmed) | iOS subscribes | none | DRIFT | MEDIUM | **Slice 7** |
| Realtime: ride:{rideId} (transit_suggestions) | DropoffSelectionPage listens | none | DRIFT | MEDIUM | **Slice 7** |
| PATCH /api/notifications/:id/read | RideRequestListener.swift:405 | RideRequestNotification:765,832 | CONTRACT_DRIFT | MEDIUM | Web sends POST; server is PATCH (405) |
| PUT /api/users/me/notification-preferences | NotificationPreferences.swift:98 | SettingsPage.tsx:96 | CONTRACT_DRIFT | MEDIUM | Web PATCH; server PUT (405) |
| POST /api/safety/share-location | EmergencySheet.swift:360 | EmergencySheet.tsx:255 | CONTRACT_DRIFT | MEDIUM | Web `{rideId?}`; server requires `ride_id` |
| POST /api/safety/share-location/:token (web only) | none | EmergencySheet.tsx:192 | DEAD_CODE | HIGH | **No such server route** — 404. Removed in **Slice 1e** |
| POST /api/users/me/profile | AuthStore.swift:249 | none (3 sites: CreateProfile, ProfilePage is_driver toggle, ProfilePage avatar) | WEB_MISSING | HIGH | **Slice 5a** — RLS-safe write + accessibility_profile + waive_caregiver_fee fields |
| GET /api/users/me/stats | ProfilePage.swift:329 | none | WEB_MISSING | MEDIUM | **Slice 5b** |
| Direct Supabase: driver_locations.upsert | LocationPingService uses /api/users/me/location | DriverHomePage.tsx:176,319 | CONTRACT_DRIFT | HIGH | Web bypasses iOS canonical /me/location. Folded into **Slice 5a** |
| Direct Supabase: rides.update progress_pct | iOS computes server-side via /gps-ping | RiderActiveRidePage:459, DriverActiveRidePage:383 | AUDIT_LOG_VIOLATION | HIGH | No server route; bypasses audit. **Slice 1a** removes the direct write |
| Direct Supabase: users.update is_driver/avatar | iOS uses /me/profile | ProfilePage.tsx:246,307 | AUDIT_LOG_VIOLATION | HIGH | Folded into **Slice 5a** |
| GET /api/suggestions/top | SuggestedRidesHero.swift:223 | none | WEB_MISSING | MEDIUM | Sprint 14 |
| GET /api/rider-routines (+ POST/PUT/DELETE) | (none in catalog) | none | WEB_MISSING | MEDIUM | Sprint 14 |
| FCM data.type handlers (30+ values) | iOS routes all in NotificationService | RideRequestNotification handles subset; many unhandled | DRIFT | HIGH | payment_received, payment_failed, dropoff_reminder_*, safety_warning, ride_cancelled, board_offer_*, schedule_match, locations_confirmed, details_accepted, rider_signal, ride_ended — folded into **Slice 7** |

**Note:** Full 100+ row matrix is in the audit output ([Stage 8 workflow result](w5qvzke05)). Above shows the actionable rows (CONTRACT_DRIFT / WEB_MISSING / DRIFT / DEAD_CODE / AUDIT_LOG_VIOLATION / OPEN_QUESTION); PARITY + SERVER_ORPHAN + IOS_CANONICAL + SYSTEM_ONLY + ADMIN_LANE rows are omitted from this table for readability.

### Sprint 12 slice plan

**Slice 0: Verification spike**
- Scope: Pin down 3 open questions that reshape later slices: (a) does GET `/api/rides/:rideId` actually return a full RideSnapshot or is iOS reading via Supabase RPC; (b) does web RideBoard.tsx fetch `/api/schedule/board` or read `ride_schedules` directly via Supabase; (c) does iOS VehicleRegistration write `vehicles.insert` directly or via a server route not enumerated.
- iOS reference files: `GetRideEndpoint.swift`, `RideBoardViewModel.swift`, `VehicleRegistrationPage.swift`
- Web files: read-only inspection
- LoC estimate: 0 (documentation only)
- Dependencies: none
- Scope cuts: no code changes

**Slice 1a: Ride flow contract fixes**
- Scope: Align 6 ride-flow endpoint payloads — `/scan-driver` (token→driver_code + lat/lng), `/signal` (drop body), `/accept-location` (add `location_type`), `/driver-destination` (rename fields), `/suggest-transit-dropoff` (full 14-field payload), `/accept` (add driver_route_polyline + overlap_pct). Also remove direct Supabase `rides.update progress_pct` write (audit-log violation).
- LoC estimate: 180
- Dependencies: Slice 0
- Endpoints: 6 ride-flow routes

**Slice 1b: Payments + wallet contract fixes**
- Scope: `/tip` (drop payment_method_id), `/retry-payment` (drop body), `/payment/default-method` (PUT→POST), `/wallet/topup` (drop payment_method_id), `/wallet/withdraw` Idempotency-Key verification.
- LoC estimate: 90
- Dependencies: none

**Slice 1c: Scheduling contract fixes**
- Scope: `/schedule/notify` (full payload), `/schedule/request` (11-field payload + caregiver_id), `/schedule/sync-routines` (add client_date), `/transit/preview` (flatten 6 lat/lng), `/schedule/by-id/:id` (correct path), fix 2 web ghost routes (`/api/schedule/:id/seats`, `/api/schedule/board/offers`) that 404 today.
- LoC estimate: 140
- Dependencies: Slice 0

**Slice 1d: Notifications + preferences contract fixes**
- Scope: `/notifications/:id/read` (POST→PATCH), `/notification-preferences` (PATCH→PUT), `/schedule/accept-board` + `/schedule/decline-board` (requestId→ride_id + reason), `/rides/snooze` (seconds→snooze_minutes).
- LoC estimate: 80
- Dependencies: none

**Slice 1e: Safety contract fixes + dead code removal**
- Scope: `/safety-warning-response` (correct action enum + render `trusted_contacts[]` + `share_token` from response), `/safety-end` (add reason enum), `/safety/share-location` (require `ride_id`). Delete dead `POST /api/safety/share-location/:token` call site (no such server route, silent 404).
- LoC estimate: 90
- Dependencies: none
- Scope cuts: manual-end gate (>5min AND >1km) logic unchanged; only adds `reason` field

**Slice 1f: Stripe Connect contract fixes**
- Scope: `/connect/dashboard` (POST→GET), `/connect/onboard/complete` (POST→GET) — both currently return 405.
- LoC estimate: 30
- Dependencies: none

**Slice 2a: WaitingRoom notification-status CTA**
- Scope: New `useRideNotificationStatus` hook polling every 5s while ride status=`requested`. When `drivers_notified === 0`, surface "No drivers nearby — try Ride Board" CTA.
- LoC estimate: 180
- Dependencies: none

**Slice 2b: Driver PWA-after-kill resume**
- Scope: New `useDriverPendingOffer` hook on app focus + mount. Rehydrate RideSuggestion overlay if `{offer: ride}` returned.
- LoC estimate: 150
- Dependencies: none

**Slice 3: Tap-to-call counterparty contact**
- Scope: New `useCounterpartyContact` hook gated to status ∈ `accepted|coordinating|active`. New CallButton component — `tel:` link on mobile, copy-to-clipboard fallback on desktop. Mount in MessagingWindow header + both active-ride drawers.
- LoC estimate: 350
- Dependencies: none

**Slice 4a: Pickup / dropoff point proposals via chat**
- Scope: Wire `PATCH /api/rides/:id/pickup-point` + `PATCH /api/rides/:id/dropoff-point` into MessagingWindow's location-share button. Replaces dead pattern where web POSTs location fields to `/api/messages/:rideId` (server silently drops them). New `usePickupPoint` + `useDropoffPoint` hooks.
- LoC estimate: 280
- Dependencies: Slice 1a (accept-location contract aligned first)

**Slice 4b: MyRidesPage seats edit**
- Scope: Wire `PATCH /api/schedule/:id/seats` into MyRidesPage poster controls.
- LoC estimate: 120
- Dependencies: none

**Slice 5a: RLS-safe profile write + driver_locations + accessibility fields**
- Scope: Migrate 3 direct-Supabase profile writes to `POST /api/users/me/profile` (CreateProfile, ProfilePage is_driver toggle, ProfilePage avatar). Include `has_accessibility_needs`, `accessibility_profile`, `waive_caregiver_fee` per iOS contract. Migrate `DriverHomePage` `driver_locations.upsert` to `POST /api/users/me/location`. Resolves 3 audit-log violations.
- LoC estimate: 320
- Dependencies: none — critical-path

**Slice 5b: ProfilePage stats tiles**
- Scope: New `useMyStats` hook calling `GET /api/users/me/stats`. Render rides_completed, rating_avg, rating_count tiles.
- LoC estimate: 110
- Dependencies: Slice 5a

**Slice 6: BoardOffer create — driver "make an offer" composer**
- Scope: New `RideBoardOfferComposeSheet` mirroring iOS. New `useCreateBoardOffer` hook with full proposed_* payload. Wired from RideBoard.tsx driver-mode rider-post detail.
- LoC estimate: 380
- Dependencies: Slice 1c (transit-preview contract aligned first)

**Slice 7: Chat realtime + FCM push handler coverage**
- Scope: Replace polling in MessagingWindow with realtime subscriptions to `chat:{rideId}`, `chat-badge:{rideId}`, `chat-confirm:{rideId}`. Add `ride:{rideId}` subscription in DropoffSelection for `transit_suggestions`. Audit `src/lib/fcm.ts` `onMessage` vs server `data.type` (payment_received, payment_failed, dropoff_reminder_*, safety_warning, ride_cancelled, board_offer_*, schedule_match, locations_confirmed, details_accepted, rider_signal, ride_ended) and add missing routes.
- LoC estimate: 400
- Dependencies: Slices 1a-6 (don't touch surfaces still mid-fix)
- Scope cuts: no React Query hook extraction (deferred to Sprint 13)

### Cross-cutting notes
- **HARD RULE — Prod env values on prod**: Slice 1b (payments) + 1f (Connect) touch Stripe/Supabase/Firebase surface; both are pure contract fixes (no env changes).
- **Manual-end gate unchanged** — Slice 1e adds a `reason` field to the existing `/safety-end` call inside `rideManualEndGate.ts`. Gate logic (>5min AND >1km) stays intact.
- **Wallet transactions stay single-transaction** — Slice 1b only changes wire shape; server-side `BEGIN/COMMIT` unchanged.
- **Reviewer parity-check before every slice** — 3-column iOS↔web matrix in every handoff per the 2026-05-30 hard rule.
- **Don't push without "go"** — per-feature green-light memory rule.
- **Audit log discipline** — Slice 1a + Slice 5a remove the 3 direct-Supabase writes that bypass server audit. After Sprint 12 the only intentional client direct write is `ride_schedules.insert` (matches iOS pattern).
- **Parallel admin lane** — no slice touches `src/components/admin/**` or `server/routes/admin/**`.
- **Migration numbering** — Sprint 12 ships zero new migrations.

### Out-of-scope (admin lane handoff)
- All 178 `/api/admin/*` endpoints — parallel admin session
- 23 `useAdmin*.ts` hooks — admin lane
- `/api/live-activity/*` — iOS ActivityKit only
- `/api/stripe/webhook`, `/api/webhooks/resend-inbound` — server-to-server
- `/api/auth/session` POST/GET/DELETE — web-only PWA cookie mirror
- `/api/ops/*`, cron jobs — system ops
- `POST /api/connect/account-session` — iOS-canonical Embedded Components onboarding; web's redirect flow isn't a parity blocker
- `POST /api/directions/validate-polyline` — iOS MapKit cost optimization
- `GET /api/safety/track/:token` — intentionally web-only public viewer

### Open questions (need Tarun's call)
1. **Slice 0 must resolve**: does `GET /api/rides/:rideId` return a full RideSnapshot or is iOS reading via Supabase RPC?
2. **Slice 0 must resolve**: does web `RideBoard.tsx` read `/api/schedule/board` or fall back to `ride_schedules` via Supabase direct?
3. **Slice 0 must resolve**: does iOS `VehicleRegistrationPage` write `vehicles.insert` directly or via a server route?
4. Should `useCaregivers` server routes be officially DEPRECATED, or kept as fallback for a future RLS tighten?
5. `POST /api/report/:id/attachments` — ship in Sprint 13 or wait for iOS struct enumeration?
6. **Sprint 13 hook-extraction sweep scope** — confirm extracting every WEB_INLINE row into `src/hooks/*` with React Query? ~1500 LoC standalone sprint.
7. **Sprint 14 v1.3 catch-up scope** — confirm Suggestions hero + Rider Routines + project-routine + scan-routine + purge-routine? ~1200 LoC standalone sprint.

### Deprecation candidates (server routes with no caller)
- `GET /api/suggestions/board` — defined server-side + as iOS struct; zero callers
- `POST/GET/PATCH/DELETE /api/caregivers/*` — both clients bypass per 2026-05-20
- `POST /api/notifications/send` — defined; no caller
- `GET /api/transit/options` — distinct from `POST /preview` which is used
- `GET /api/rides/:id/qr` — no callers
- `PATCH /api/rides/:id/confirm-dropoff`, `/decline-dropoff`, `POST /:id/accept-details`, `POST /:id/preview-overlap` — likely superseded by `/accept-location`; verify before removal
- `GET /api/connect/onboard/refresh` — Stripe redirect target only

### What this audit dropped from the initial matrix and why
- **Slice 7 React Query extraction sweep (~1500 LoC, ~45 hooks)** → **deferred to Sprint 13**. Violated 400-LoC ceiling + "mergeable alone" rule; would rewrite code Slices 1a–6 just shipped.
- **Slice 8 Suggestions hero + Rider Routines (~1200 LoC, two distinct features)** → **deferred to Sprint 14**.
- **`POST /api/connect/account-session`** → out-of-scope. iOS-canonical UX upgrade, not a parity blocker.
- **`POST /api/report/:id/attachments`** → deferred to Sprint 13 pending iOS struct verification (Open Q #5).

### Critic verdicts
- **Completeness**: PASS — 18 missed-endpoint findings folded in (full-RideSnapshot, chat realtime channels, 3 audit-log violations, FCM data.type handler coverage, accessibility fields on /me/profile, caregiver_id + origin_name on /rides/request, driver_route_polyline + overlap_pct on /accept, wallet/withdraw Idempotency-Key, safety-warning-response trusted_contacts surface, dead web call to /share-location/:token, ghost routes, messages.ts body field drop). 3 deferred (`/report/:id/attachments` pending iOS verification, `POST /api/messages/:rideId` extra fields superseded by Slice 4a, web-only multi-ride channels pending iOS verification).
- **Contract**: PASS — 7 findings folded in (full RideSnapshot ambiguity → Slice 0 spike; dead /share-location/:token call → Slice 1e removal; /api/schedule/:id 404 promoted LOW→HIGH; PATCH /:id/read confirmed; /connect/onboard/complete + /connect/dashboard confirmed GET; /safety-end reason enum clarified).
- **Sprint shape**: PASS — All 15 findings addressed. Slice 1 split into 1a-1f (6 domain slices, each 30-180 LoC). Slice 7 mega-extraction replaced with focused realtime/FCM slice; React Query sweep → Sprint 13. Slice 8 → Sprint 14. Slice 4 split 4a+4b. Slice 5 split 5a+5b. Slice 2 split 2a+2b for independent rollback. Slice 0 added as verification spike. Slice 3 estimate raised to 350 LoC. Final 13 slices, all under 400 LoC ceiling.

### Sprint 12 summary

| Status | Count |
|---|---|
| Not started | 13 slices (0, 1a, 1b, 1c, 1d, 1e, 1f, 2a, 2b, 3, 4a, 4b, 5a, 5b, 6, 7) |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

Sprint 12 ships 13 small, independently-mergeable slices closing 24 contract-shape mismatches, 11 HIGH-severity WEB_MISSING endpoints, 3 audit-log-bypass direct-Supabase writes, 4 chat realtime subscription gaps, and dead-code calls to nonexistent server routes. The original mega-slices for React Query extraction (~1500 LoC) and v1.3 Suggestions/Rider Routines (~1200 LoC) are deferred to standalone Sprints 13 and 14 respectively so this sprint stays smallest-first and reversible. Slice 0 is a zero-LoC verification spike resolving three open questions before any code is written. Every slice has a single user-visible win, mandatory parity matrix in the handoff, explicit per-feature green-light wait, and no overlap with the parallel admin session lane.

---

## Sprint 11 — Ride safety + forensics v1.3 parity

**Audit-first mode.** Stage 7 of the multi-stage iOS-parity audit completed 2026-06-02 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Current focus
Sprint 11 closes the user-facing safety gap surfaced by the Stage 7 audit (2026-06-02): web has no `RideSafetyCheckOverlay`, no `ride-safety:{rideID}` realtime subscription, no Trusted Contacts CRUD, no role-aware safety report categories, no gated Phase-3.4 manual-end button, and — critically — a CLAUDE.md hard-rule violation where the emergency button is hidden inside `JourneyDrawer` during QR scanning on both active-ride pages. The sprint ships the missing divergence-warning flow end-to-end (foreground realtime + background push + countdown UI + three role-aware action submits), unblocks the dead `Text trusted contacts` button by adding the Profile-side CRUD, and restores parity on the report taxonomy (rider vs driver categories), the EmergencySheet structure, and the post-pickup safety pill. Every slice mirrors an iOS surface in `ios/Tago/Features/Safety/` or `ios/Tago/Features/Profile/`; nothing in this sprint is a web-native invention.

### Sprint 11 sequenced plan (one paragraph plain-English)
We start with the smallest, highest-leverage fix: the always-visible safety pill (Slice 1) closes the CLAUDE.md hard rule and lands a tiny shared component the rest of the sprint reuses. Slice 2 builds the Trusted Contacts list/add/delete UI on the Profile page so the existing "Text trusted contacts" button stops being a dead-end and so the divergence overlay's "Get help" branch has someone to text. Slice 3 introduces the `useRideRole` hook and makes the EmergencySheet report wizard role-aware (rider sees 5 rider categories, driver sees 5 driver categories) — this hook is the shared primitive for Slice 4. Slice 4a wires the `ride-safety:{rideID}` realtime channel, reseat-on-mount via `GET /api/rides/active`, and a passive "warning detected" banner that auto-clears on `warning_responded` / `safety_ended`. Slice 4b layers the interactive `RideSafetyCheckOverlay` on top — 90s countdown ring, three role-aware action buttons, sms help branch with desktop fallback, FCM Web background push handler for `warning_fired`/`warning_responded`/`safety_ended`, and stale-tap silent dismiss. Slice 5 adds the gated "End ride without QR" secondary button on both rider and driver active pages (Phase 3.4 mandate, `elapsed>5min AND gpsDistance>1km`). Slice 6 finishes with EmergencySheet structural polish — three semantic sections, state-driven footer copy, toast confirmations, sms-fallback for desktop, and the symmetric TrackPage copy fix.

### Parity matrix
| iOS Surface | Web Status | Severity | Gap |
| --- | --- | --- | --- |
| Top-bar always-visible safety pill (rider active + driver active + driver pickup) | DRIFT | BLOCKER | Web mounts emergency trigger inside `JourneyDrawer` only — not rendered during QR scanning mode on `RiderActiveRidePage` (L441-489). Violates CLAUDE.md "Emergency button always in portal at top of DOM tree. Never inside conditional renders." Three iOS surfaces (`RiderActiveRidePage.swift:475-490`, `DriverActiveRidePage.swift:446-461`, `DriverPickupPage.swift:919-941`) all host the 36x36 disc top-bar pill. |
| `RideSafetyCheckOverlay` — divergence warning UI | MISSING | BLOCKER | iOS shows a `fullScreenCover` with 90s countdown ring (green→yellow→red) and three role-aware actions triggered by `warning_fired` realtime event. Web has zero subscription, zero overlay, zero client callers. Server cron auto-ends the ride after 90s with no rider/driver chance to respond. |
| `ride-safety:{rideID}` realtime channel subscription | MISSING | BLOCKER | iOS subscribes on both active-ride pages to `warning_fired` / `warning_responded` / `safety_ended`. Web has no subscription on either page. |
| Submit `rider_in_car` / `driver_in_car` ("still here") | MISSING | BLOCKER | No web caller for `POST /api/rides/:id/safety-warning-response`. Action prefix must match per-ride role or server returns 403 WRONG_ROLE. |
| Submit `rider_left` / `driver_left` ("got out") | MISSING | BLOCKER | No web caller; ride-ending branch unreachable from web overlay. Server broadcasts `safety_ended` (not `warning_responded`) on this branch. |
| Submit `help_requested` + sms pre-fill to trusted contacts | MISSING | BLOCKER | iOS mints share token via response and opens MFMessageComposeViewController pre-filled. Web equivalent: sms: deep-link with helpComposedBody on mobile; Copy/Share fallback on desktop where sms: doesn't resolve. |
| Trusted Contacts CRUD on Profile (list + add + delete) | MISSING | BLOCKER | iOS `ProfileSafetySection.swift` shows up to 5 contacts; web has zero CRUD UI. EmergencySheet's "Text trusted contacts" button and the overlay's "Get help" branch are both dead today. iOS mounts on Profile page (`ProfilePage.swift:113`), not Settings — web should match. |
| `AddTrustedContactSheet` (name + phone + cap + normalisation) | MISSING | BLOCKER | iOS sheet with name/phone fields, 5-contact cap, `normalisePhone` helper (trim, preserve leading +, strip non-digits), and exact INVALID_NAME/INVALID_PHONE/LIMIT_REACHED error mappings. Web has nothing. |
| Safety report category taxonomy (rider vs driver-aware) | DRIFT | HIGH | iOS `SafetyReportCategory.availableFor(role:)` shows rider-specific OR driver-specific categories based on viewer role. Web shows rider-only categories regardless of role. Adds: `rider_aggression`, `rider_damage`, `rider_threat`, `rider_no_show` for drivers. Server's legacy alias map (`server/routes/report.ts:84-92`) already handles these rawValues. |
| Reseat overlay on mount (`divergence_state === 'warning'`) | MISSING | HIGH | iOS reads `divergence_state` + `warning_fired_at` on initial fetch and re-seats the overlay if user re-opens app mid-warning. Web has no overlay and the bare `GET /api/rides/:id` handler does NOT exist on the server (verified via exhaustive grep) — must read from `GET /api/rides/active` instead, which already `select('*')`s the row. Polling backstop on the 10s/15s loops also required for realtime drops. |
| Role-aware overlay subtitle + button labels | MISSING | HIGH | Rider sees "You and your driver appear to be apart…" + "I'm still in the car" / "I got out — end the ride" / "Something's wrong — get help". Driver sees "{counterpartyName ?? 'your rider'} is no longer near the vehicle…" + "{Name} is still with me" / "{Name} got out — end the ride" / "Report a problem". |
| Overlay error states (3 distinct copies + restart countdown) | MISSING | HIGH | iOS sets `errorMessage` to "Couldn't confirm — {error}" / "Couldn't end ride — {error}" / "Couldn't notify — {error}" and restarts the countdown so user can retry. Without these the overlay looks broken on error. |
| Help-flow no-trusted-contacts guidance | MISSING | HIGH | iOS shows "No trusted contacts saved. Add them in Profile → Safety so we can text them next time." with 2.5s pause before resolving. Cross-references Slice 2. |
| Help-flow desktop fallback (no sms: handler) | MISSING | HIGH | iOS `helpFallback` view with Copy link / ShareLink / Close actions. Desktop browsers have no sms: handler — the help branch is functionally broken without a Copy/Share fallback. |
| Gated "End ride without QR" — rider | MISSING | HIGH | CLAUDE.md Phase 3.4 mandates rider-side secondary end gated to `elapsed>5min AND gpsDistance>1km`. Web has no button and no gate. Anti-fraud risk: if shipped without gate, rider ends at $5 minimum after 100m. iOS posts `reason='manual_end'` to `POST /api/rides/:id/safety-end`. |
| Gated "End ride without QR" — driver mirror | MISSING | HIGH | Same gap as rider; CLAUDE.md mandates mirror with same `>5min AND >1km` gate (`DriverActiveRidePage.swift:757-767 manualEndEligible`). Posts `reason='manual_end'`. |
| Delete trusted contact + destructive dialog copy | MISSING | HIGH | iOS shows "Remove this contact?" with subtitle "They won't receive your live-tracking link in an emergency." Web has no UI. |
| Trusted contacts cap (5) + client-side hide + server `409 LIMIT_REACHED` mapping | MISSING | MEDIUM | iOS hides add button at count >= 5 AND maps server 409 (defence-in-depth). Web needs both. |
| Stale-tap silent dismiss (`409 NO_ACTIVE_WARNING`) | MISSING | MEDIUM | iOS treats 409 NO_ACTIVE_WARNING/NOT_ACTIVE as silent dismiss. Web overlay must mirror. |
| Countdown ring (90s green→yellow→red) | MISSING | MEDIUM | Color-graded SVG ring on iOS; web uses CSS ring with matching color stops. |
| `EmergencySheet` shell (three semantic sections) | DRIFT | MEDIUM | Web ships single flat sheet; iOS uses three sections (Emergency Services / Share Location / Report) with state-driven footer copy. |
| Report wizard navigation pattern | DRIFT | MEDIUM | iOS pushes `ReportSafetyView` via NavigationLink; web renders inline. Functionally equivalent — keep web's inline pattern (web-native flow). |
| `DriverPickupPage` hardcoded `viewerRole:.driver` (iOS bug) | WEB_AHEAD | MEDIUM | iOS hardcodes driver role on pickup-page EmergencySheet. Web is currently rider-only by default; once role-aware (Slice 3) web will be correct on BOTH platforms before iOS catches up. |
| `RiderPickupPage` / `DriverPickupPage` emergency mounts (parallel to active-ride hard-rule) | DRIFT | MEDIUM | Web already mounts EmergencySheet on both pickup pages; safety pill needs the same always-visible top-bar treatment there too. Folded into Slice 1. |
| EmergencySheet desktop sms: fallback (`canSendText==false` equivalent) | MISSING | MEDIUM | Desktop browsers don't resolve `sms:` URLs. Web needs "Open on phone" or copy-to-clipboard messaging. |
| FCM Web push handlers for safety events | MISSING | MEDIUM | Web has FCM-Web infra but no handler for `warning_fired`/`warning_responded`/`safety_ended` payloads. Foreground covered by realtime; push covers background. Folded into Slice 4b. |
| Server-side WRONG_ROLE 403 mapping | MISSING | MEDIUM | Web overlay must derive role per-ride before posting; mistaken prefix → 403. Slice 4b uses Slice 3's `useRideRole` hook. |
| `warning_responded` realtime auto-dismiss (when counterparty responds first) | MISSING | MEDIUM | Overlay clears without local action when other party posts first. Must be unit-tested. |
| `help_sms_sent_at` response field | MISSING | LOW | Server timestamps when help branch fires; overlay may read it back to throttle re-taps. |
| `AddTrustedContactSheet` phone normalisation | MISSING | MEDIUM | Without `normalisePhone` mirror, users entering "(415) 555-1234" hit server INVALID_PHONE. |
| Trusted Contacts list refresh on settings/profile refresh | MISSING | LOW | iOS reacts to `refreshSignal`; web should invalidate React Query on parent refresh. |
| ProfileSafetySection silent retry-once on load error | MISSING | LOW | iOS retries with 1s sleep before surfacing error banner. |
| ProfileSafetySection empty-state copy | MISSING | LOW | Exact cap-substituted hint: "Add up to 5 people you'd want to reach in an emergency. They'll receive your live-tracking link with one tap from the Safety menu during a ride." |
| Add sheet auto-focus on `.name` after 250ms | MISSING | LOW | Lets sheet finish slide-in before opening keyboard; web should mirror on mount. |
| Two-section structure of add sheet (Pick from Contacts + Or enter manually) | DRIFT | LOW | Web omits Picker but keeps the "Or enter manually" section header for cross-platform familiarity. |
| `ContactPickerView` (CNContactPickerViewController) | MISSING | LOW | Pure native — no cross-browser web equivalent. Acceptable defer; web users type manually. |
| `ReportSafetyView` `.dismissKeyboardOnTap()` + FocusState | MISSING | LOW | Hard-rule per memory; ensure web textarea has Done/Escape handling. |
| `ReportSafetyView` details footer + placeholder + Done button | MISSING | LOW | Exact copy parity for footer, "Select a category" placeholder, and submitted-state Done button. |
| `EmergencySheet` Done toolbar item + interactive-dismiss-disabled + `.large` detent | DRIFT | LOW | Web's close button placement/copy differs; confirm not swipe-dismissible. |
| `EmergencySheet` share-link row (copy button + monospace + middle-truncate) | DRIFT | LOW | Web shows plain text; iOS exposes dedicated copy button with `doc.on.doc` + monospaced footnote + middle truncation. |
| `EmergencySheet` "Share link via…" row (ShareLink) | MISSING | LOW | iOS exposes distinct re-share row in `.shared` state; web only invokes navigator.share at mint-time. |
| `EmergencySheet` state-driven footer copy under Share Location | MISSING | LOW | Three strings (idle/shared/revoked) explaining 4h TTL. Web has no footer. |
| Toast confirmations (copy/sent/revoke) | MISSING | LOW | iOS shows transient 2.4s capsule toast; web has no feedback. |
| Revoke failure toast: "Couldn't reach server — link still active" | MISSING | LOW | Error state for DELETE share-location is missing; web silently logs today. |
| Mint failure toast: "Couldn't create the link. Try again." | MISSING | LOW | Re-enable retry on `shareLocationCTARow(title: 'Try again')`. |
| `composedMessageBody` SMS pre-fill exact string | MISSING | LOW | "I'm using Tago and wanted you to be able to follow my ride. Live tracking link (expires in 4 hrs): {url}" — exact parity. |
| `helpComposedBody` SMS pre-fill exact string | MISSING | LOW | Distinct from above: "I'm using Tago and might need help. Live tracking link (expires in 4 hrs): {url}". Folded into Slice 4b. |
| Trusted contacts count subtitle pluralization | MISSING | LOW | "Send to N saved contact" / "Send to N saved contacts". |
| Driver-side overlay `errorFallback` silently ignored | DRIFT | LOW | iOS intentionally silent on driver-side overlay error fallback; web should mirror or upgrade with toast — document the choice. |
| Driver-side `safety_ended` also bumps `rideEndedSignal` | MISSING | LOW | Belt-and-suspenders redundancy with the rider-active `ride_ended` channel; web driver page should mirror. |
| `clearDropoffReminderBanner` on `rideEndedSignal` | MISSING | LOW | Slice 4b service-worker handler for `safety_ended` must also clear any pending notification banners. |
| Accessibility identifiers for overlay testability | MISSING | LOW | Web overlay must expose matching `data-testid` (overlay/card/stillHere/gotOut/help). |
| TrackPage copy "Driver location is being shared" | DRIFT | LOW | Server is symmetric but UI hardcodes "Driver" — misleading when a rider shared. Without a server contract change to expose `share_role`, web falls back to neutral "Live location is being shared". |
| `GET /api/safety/share-location` 403 not_participant / 404 ride_not_found | MISSING | LOW | EmergencySheet should show graceful error toast on these server responses. |
| Migration 095 forensic columns persisted by web QR flow | PARITY | LOW | Server writes pickup_scan_lat/lng/at, dropoff_scan_lat/lng/at, gas_price_per_gallon_cents, gas_cost_cents, time_cost_cents via existing endpoints; web already exercises via existing flow. Verify in Slice 5 implementation but no new code needed. |
| `ride_audit_log` trigger (write-path discipline) | PARITY | MEDIUM | Cross-cutting note: web must NEVER write directly to `rides` row from the client — every mutation must go through a server route or audit trail breaks. Called out as a cross-cutting constraint, not a slice. |
| `divergence_pattern` column (migration 096) | DEAD | LOW | Declared but never written/read. Web decoders should ignore it. Informational only. |
| TrackPage public live tracking | PARITY (web AHEAD) | LOW | Already shipping with Google Maps, 10s polling, all error states. No iOS equivalent. |
| GpsPingEndpoint integration | PARITY | LOW | Both platforms ping every 10s feeding server divergence detection. |
| EmergencySheet auto-load trusted contacts on open | PARITY | LOW | Both lazy-load on first open. |
| Call 911 row | PARITY | LOW | Web `tel:` anchor; iOS adds warning haptic. Acceptable — web has no haptic API. |
| Share my location CTA (mint share-token) | PARITY | LOW | Same endpoint, same URL construction. |
| Text trusted contacts row (depends on Slice 2 to become functional) | PARITY (functionally dead) | LOW | Both load contacts and build sms: link. Becomes useful once Slice 2 ships. |
| Stop sharing row | PARITY | LOW | Both DELETE the token. |
| Submitted success screen | PARITY | LOW | Both show green checkmark + thank-you copy. |
| MyReportsPage / MyReportDetailPage / report attachments | MISSING | MEDIUM/LOW | Out of Sprint 11 — belongs to Reports v2 stage. |
| Forensic columns on RideSummary (`end_reason`/`cancel_reason` user-facing tag) | MISSING | LOW | Defer until iOS source confirms a corresponding surface. |
| Admin-lane safety surfaces (EmergencyBanner, SafetyEndedPage, audit-log read) | PARITY | LOW | Parallel admin session lane — out of scope. |

### Sprint 11 slice plan

**Slice 1: Always-visible top-bar safety pill (HARD-RULE fix) + pickup-page mount**
- Scope: Mount a portal-level 36x36 safety pill at the top of `RiderActiveRidePage`, `DriverActiveRidePage`, `RiderPickupPage`, and `DriverPickupPage`. Pill is visible at all times including during QR scanning mode (fixes CLAUDE.md hard-rule violation where `JourneyDrawer`-mounted emergency trigger is hidden during scanning). Reuse existing `EmergencySheet` as the sheet target. New shared `SafetyPill.tsx` component lives in `src/components/ui/`.
- iOS reference files: `ios/Tago/Features/RiderHome/RiderActiveRidePage.swift:475-490`, `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:446-461`, `ios/Tago/Features/DriverHome/DriverPickupPage.swift:919-941`
- Web files to create/modify: `src/components/ui/SafetyPill.tsx` (new, ~80 LoC), `src/components/ride/RiderActiveRidePage.tsx`, `src/components/ride/DriverActiveRidePage.tsx`, `src/components/ride/RiderPickupPage.tsx`, `src/components/ride/DriverPickupPage.tsx`
- Endpoints touched: none
- Tests: SafetyPill renders during scanning mode on `RiderActiveRidePage`; tap opens EmergencySheet; pill survives mode flips between scan/active/journey-drawer; pill renders on both pickup pages; pill is portal-mounted (not inside conditional renders).
- Estimated LoC: ~180
- Dependencies: none
- Scope cuts (explicit defers): haptic feedback on long-press (web has no haptic API).

**Slice 2: Trusted Contacts CRUD on Profile (unblocker for safety flows)**
- Scope: Add `TrustedContactsSection` to the Profile page (matching iOS `ProfilePage.swift:113` mount point — NOT Settings). List up to 5 contacts with name/phone. `AddTrustedContactSheet` with single "Or enter manually" section header (no native contact picker), name (1-60 chars) + phone fields, `normalisePhone` helper mirroring iOS (trim, preserve leading +, strip non-digits → `+{digits}` or `{digits}`), auto-focus on name after 250ms. Delete with destructive confirmation: "Remove this contact?" + "They won't receive your live-tracking link in an emergency." Empty state with exact iOS copy. Cap of 5 — hide add button client-side AND map server 409 LIMIT_REACHED (defence-in-depth). Silent retry-once-after-1s on load error before surfacing the banner. React Query invalidate on parent refresh.
- iOS reference files: `ios/Tago/Features/Profile/ProfileSafetySection.swift`, `ios/Tago/Features/Profile/AddTrustedContactSheet.swift`, `ios/Tago/Features/Profile/ProfilePage.swift:113`
- Web files to create/modify: `src/components/profile/TrustedContactsSection.tsx` (new), `src/components/profile/AddTrustedContactSheet.tsx` (new), `src/components/profile/ProfilePage.tsx` (mount new section — verify exact path), `src/hooks/useTrustedContacts.ts` (new — React Query CRUD)
- Endpoints touched: `GET /api/safety/trusted-contacts`, `POST /api/safety/trusted-contacts`, `DELETE /api/safety/trusted-contacts/:id`
- Tests: list renders empty state with exact copy; add flow validates name 1-60 + phone 7-20 via `normalisePhone`; add button hidden when count >= 5 (client cap); server 409 LIMIT_REACHED also maps to user copy "You can save up to 5 trusted contacts." (separate test from cap hide); INVALID_NAME → "Name must be 1-60 characters."; INVALID_PHONE → "Phone must be a valid number."; delete confirmation flow with exact destructive copy; silent retry-once on load error before banner; auto-focus name after 250ms.
- Estimated LoC: ~450 (at upper edge — split if it crosses 500 during implementation)
- Dependencies: none
- Scope cuts (explicit defers): `CNContactPickerViewController`-equivalent — Web Contacts Picker API is Chromium-only/secure-context, skipped for cross-browser parity. Sheet keeps "Or enter manually" section header so structure mirrors iOS even without the picker.

**Slice 3: Role-aware safety report categories + `useRideRole` shared primitive**
- Scope: Introduce `useRideRole(rideId)` hook deriving role from `rides.rider_id`/`driver_id` (per the role-per-ride memory rule). Make `EmergencySheet`'s report wizard show 5 rider categories (`unsafe_driving`, `inappropriate_behavior`, `wrong_route`, `no_show`, `other`) OR 5 driver categories (`rider_aggression`, `rider_damage`, `rider_threat`, `rider_no_show`, `other`) based on `useRideRole` result. Send the raw category rawValues to the server — `server/routes/report.ts:84-92` legacy alias map already normalizes them. Add `.dismissKeyboardOnTap()`-equivalent for the description textarea, exact `detailsFooter` copy ("Tago's safety team reviews every report. Add as much detail as you can — driver behaviour, location, time, anything that helps."), "Select a category" placeholder option, and an explicit Done button on the submitted state that clears wizard state. Keep web's inline wizard pattern (don't push to a separate page — web-native flow is fine).
- iOS reference files: `ios/Tago/Features/Safety/ReportSafetyView.swift`, `ios/Tago/Models/SafetyReportCategory.swift`
- Web files to create/modify: `src/components/ui/EmergencySheet.tsx`, `src/lib/safetyReportCategories.ts` (new — role-aware enum + labels), `src/hooks/useRideRole.ts` (new — shared with Slice 4)
- Endpoints touched: `POST /api/report`
- Tests: rider sees 5 rider categories; driver sees 5 driver categories; submission posts correct rawValue; server legacy aliases still normalize correctly (Vitest server assertion for `rider_aggression`/`rider_threat` → `safety_during_ride`, `rider_damage` → `rider_conduct`, `rider_no_show` → `cancellation_dispute`); Done button on submitted state clears wizard.
- Estimated LoC: ~200
- Dependencies: none (lands the `useRideRole` hook for Slice 4 to consume)
- Scope cuts (explicit defers): native pushed-page report flow (web's inline wizard is acceptable parity).

**Slice 4a: `ride-safety:{rideID}` realtime channel + passive warning detection + reseat-on-mount**
- Scope: New `useRideSafetyChannel(rideId, role)` hook subscribing to `ride-safety:{rideID}` channel for `warning_fired` / `warning_responded` / `safety_ended` events. Both rider and driver active pages consume it. Reseat-on-mount: on initial active-ride fetch, read `divergence_state` + `warning_fired_at` from the response and re-seat overlay state if `divergence_state === 'warning'`. Polling backstop on the existing 10s/15s loops to recover from realtime drops. Render a passive "Safety check detected — verifying" banner during this slice; full interactive overlay lands in 4b. Auto-clear banner on `warning_responded` (counterparty responded first) and `safety_ended`. NOTE: `GET /api/rides/:id` bare handler does NOT exist on the server (verified) — reseat must use `GET /api/rides/active` which `select('*')`s the row and already surfaces `divergence_state` + `warning_fired_at`.
- iOS reference files: `ios/Tago/Features/RiderHome/RiderActiveRidePage+Live.swift`, `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:1273-1320`, `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:1130-1138` (10s poll reads `divergence_state`)
- Web files to create/modify: `src/hooks/useRideSafetyChannel.ts` (new), `src/components/ride/RiderActiveRidePage.tsx`, `src/components/ride/DriverActiveRidePage.tsx`, possibly extend `src/components/safety/SafetyWarningBanner.tsx` (small passive banner — replaced by overlay in 4b)
- Endpoints touched: `GET /api/rides/active` (read `divergence_state` + `warning_fired_at` from existing projection — verify field surfaced)
- Tests: `warning_fired` event mounts banner; `warning_responded` from counterparty auto-clears banner; `safety_ended` clears banner; reseat-on-mount shows banner when `divergence_state === 'warning'` on initial active-ride fetch; polling backstop recovers banner if realtime event missed; banner clears cleanly on ride end.
- Estimated LoC: ~250
- Dependencies: none (Slice 3's `useRideRole` is consumed in 4b, not 4a)
- Scope cuts (explicit defers): all interactive overlay UI → Slice 4b.

**Slice 4b: `RideSafetyCheckOverlay` interactive UI + 3 action submits + FCM Web background push**
- Scope: Replace the 4a passive banner with full `RideSafetyCheckOverlay` — 90s CSS countdown ring (green → yellow → red color stops matching iOS), role-aware subtitle ("You and your driver appear to be apart…" for rider; "{counterpartyName ?? 'your rider'} is no longer near the vehicle…" for driver), three role-aware action buttons (rider: "I'm still in the car" / "I got out — end the ride" / "Something's wrong — get help"; driver: "{Name} is still with me" / "{Name} got out — end the ride" / "Report a problem"). Submit handlers use Slice 3's `useRideRole` hook to derive the correct action prefix (`rider_in_car`/`driver_in_car`, `rider_left`/`driver_left`, `help_requested`) — never let the wrong prefix hit the server (would 403 WRONG_ROLE). Three distinct error copies with countdown-restart: "Couldn't confirm — {error}" / "Couldn't end ride — {error}" / "Couldn't notify — {error}". Help branch opens sms: deep-link to trusted contacts using exact `helpComposedBody`: "I'm using Tago and might need help. Live tracking link (expires in 4 hrs): {url}". Desktop fallback (no sms: handler) shows Copy link + Web Share API + Close actions. Help-with-zero-trusted-contacts shows exact guidance: "No trusted contacts saved. Add them in Profile → Safety so we can text them next time." with 2.5s pause before resolving. `409 NO_ACTIVE_WARNING`/`NOT_ACTIVE` = silent dismiss. Driver-side `safety_ended` also bumps `rideEndedSignal`-equivalent (belt-and-suspenders). `data-testid` attributes: `ride-safety-check-overlay`, `-card`, `-still-here`, `-got-out`, `-help`. FCM Web service worker handler for `warning_fired`/`warning_responded`/`safety_ended` payloads (background); foreground covered by 4a realtime. `safety_ended` push handler also clears any pending drop-off reminder banner.
- iOS reference files: `ios/Tago/Features/Safety/RideSafetyCheckOverlay.swift` (entire file), `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:1311` (safety_ended bumps rideEndedSignal)
- Web files to create/modify: `src/components/safety/RideSafetyCheckOverlay.tsx` (new), `src/components/safety/CountdownRing.tsx` (new — CSS SVG ring), `src/components/ride/RiderActiveRidePage.tsx`, `src/components/ride/DriverActiveRidePage.tsx`, `public/firebase-messaging-sw.js` (extend), `src/lib/fcm.ts` (extend handlers)
- Endpoints touched: `POST /api/rides/:id/safety-warning-response`
- Tests: `warning_fired` mounts overlay with 90s countdown; still-here posts `rider_in_car`/`driver_in_car` based on role; got-out posts `rider_left`/`driver_left` and overlay clears on `safety_ended` (NOT `warning_responded` — server only broadcasts `warning_responded` on still-here + help branches); help posts `help_requested` and opens sms: with helpComposedBody; help desktop fallback shows Copy/Share/Close; help-with-zero-contacts shows guidance + 2.5s pause; `409 NO_ACTIVE_WARNING` silently dismisses; `warning_responded` from counterparty auto-clears overlay; three error copies render + countdown restarts; FCM service-worker handler for `warning_fired` triggers notification with click-through to active-ride route; `safety_ended` SW handler clears pending banners; driver-side WRONG_ROLE 403 path covered.
- Estimated LoC: ~400 (overlay + countdown + sms branches + SW handlers — at the ceiling but tightly coupled)
- Dependencies: Slice 2 (help branch needs trusted contacts to be meaningful), Slice 3 (`useRideRole` hook), Slice 4a (channel hook + reseat)
- Scope cuts (explicit defers): iOS-style critical alerts (not available on web; standard severity); haptics; native iMessage composer (sms: deep-link is the web equivalent).

**Slice 5: Gated "End ride without QR" secondary button (rider + driver mirror)**
- Scope: Add gated secondary end button on both `RiderActiveRidePage` and `DriverActiveRidePage`. Gate predicate: `elapsed > 5min AND gpsDistance > 1000m` (matches CLAUDE.md Phase 3.4 + iOS `DriverActiveRidePage.manualEndEligible:757-767`). Below the gate, button stays hidden. Both rider and driver post `reason: 'manual_end'` to `POST /api/rides/:id/safety-end` (NOT `rider_left`/`driver_left` — those are reserved for the overlay's got-out branch). PRE-SLICE VERIFICATION: grep `server/routes/rides.ts` for `gps_distance_metres` in the user-facing select projection; if missing, add field-surfacing to this slice. Place button inside the existing active-ride action area, below the QR scan primary — JourneyDrawer is a different shape on web so inline placement is the natural home.
- iOS reference files: `ios/Tago/Features/RiderHome/RiderActiveRidePage.swift:373 submitManualEnd`, `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:799 submitManualEnd`, `ios/Tago/Features/DriverHome/DriverActiveRidePage.swift:757-767 manualEndEligible`
- Web files to create/modify: `src/components/ride/RiderActiveRidePage.tsx`, `src/components/ride/DriverActiveRidePage.tsx`, `src/lib/rideManualEndGate.ts` (new — shared gate predicate)
- Endpoints touched: `POST /api/rides/:id/safety-end`
- Tests: button hidden when `elapsed < 5min`; hidden when `gpsDistance < 1km`; hidden when only one of two met; visible when both met; rider posts `reason='manual_end'`; driver posts `reason='manual_end'`; success transitions to RideSummary; client never writes directly to `rides` row (audit-log discipline).
- Estimated LoC: ~250
- Dependencies: none (independent of Slices 1-4)
- Scope cuts (explicit defers): special "manual end" badge on RideSummary; forensic-tag surfacing — pending iOS source confirmation of a corresponding surface.

**Slice 6: EmergencySheet polish — sections, footers, toasts, sms-fallback, TrackPage copy**
- Scope: Restructure `EmergencySheet` to three semantic sections (Emergency Services / Share Location / Report). Add state-driven footer copy under Share Location (idle/shared/revoked exact strings explaining 4h TTL). Add toast component + wire transient confirmations: "Link copied" / "Sent to N contact(s)" / "Tracking link turned off" (pluralization-aware). Add error toasts: "Couldn't create the link. Try again." (mint fail), "Couldn't reach server — link still active" (revoke fail). Add dedicated copy button next to share link with monospaced footnote styling + middle-truncate. Add explicit "Share link via…" row in `.shared` state using `navigator.share`. Add desktop sms: fallback (when `navigator` lacks sms handler — e.g. desktop browsers) — show "Open on phone" messaging with copy-link affordance. Confirm Done toolbar item + non-swipe-dismissible behaviour. Use exact `composedMessageBody` for trusted-contact sms: "I'm using Tago and wanted you to be able to follow my ride. Live tracking link (expires in 4 hrs): {url}". TrackPage copy: change hardcoded "Driver location is being shared" to neutral "Live location is being shared" (server response doesn't expose `share_role` to differentiate — would require a server contract addition to render asymmetrically). Graceful error UI when `POST /api/safety/share-location` returns 403 not_participant / 404 ride_not_found.
- iOS reference files: `ios/Tago/Features/Safety/EmergencySheet.swift` (entire file), `ios/Tago/Features/Safety/EmergencySheet+TrustedContacts.swift`
- Web files to create/modify: `src/components/ui/EmergencySheet.tsx`, `src/components/safety/TrackPage.tsx`, `src/components/ui/Toast.tsx` (new or reuse existing)
- Endpoints touched: none new
- Tests: three sections present in DOM; footer copy flips on share state (idle/shared/revoked); toast appears + auto-dismisses on copy/sent/revoke; pluralization correct for 1 vs N contacts; mint/revoke error toasts surface; desktop sms: fallback renders when navigator can't handle sms:; sheet is not swipe-dismissible; TrackPage shows neutral "Live location" copy; symmetric Track copy fix verified.
- Estimated LoC: ~300
- Dependencies: Slice 1 (don't churn EmergencySheet pre-pill restructure), Slice 3 (don't churn EmergencySheet pre-role-aware report fix)
- Scope cuts (explicit defers): server contract change to expose `share_role` on TrackPage response — out of scope of user-side parity (web falls back to neutral copy); haptics; native iMessage composer.

### Cross-cutting notes
- **CLAUDE.md hard rule (Emergency button portal)**: Slice 1 closes the active violation. Every future change touching active-ride pages must verify the safety pill remains portal-mounted at top of DOM tree.
- **CLAUDE.md hard rule (Phase 3.4 gate)**: Slice 5 must enforce `elapsed>5min AND gpsDistance>1km`. Without the gate, riders end at $5 minimum after 100m. Anti-fraud risk.
- **CLAUDE.md hard rule (Wallet transactions)**: not touched this sprint.
- **`ride_audit_log` write-path discipline**: every ride mutation in this sprint MUST go through a server route (`/safety-warning-response`, `/safety-end`). Never write to `rides` row directly from the web client — the audit-log trigger needs an authenticated server actor.
- **Role-per-ride memory rule**: Slice 3's `useRideRole` hook is the canonical primitive; Slice 4b derives action prefix from it before posting. Never read role from a tab/sub-app/nav context.
- **Parallel admin session lane**: do NOT read or stage `src/components/admin/EmergencyBanner.tsx`, `ReportsInboxPage.tsx`, `ReportDetailPage.tsx`, `SafetyEndedPage.tsx`, `UserDetailPage` TrustedContactsCard, `useAdminSafetyEnded`, `useAdminRides ride_audit_log` read, `server/routes/admin/rideSafetyActions.ts`, `audit.ts`, `safetyEnded.ts`. Those are owned by the parallel session.
- **No iOS planning markdowns**: per the audit hard rule, only `.swift` source + `supabase/migrations/*.sql` + `server/routes/*.ts` were consulted. No `*_PLAN.md` / `*_PROGRESS.md` from `ios/` or `docs/` were read.
- **Reviewer parity-check before slice handoff**: every slice produces a 3-column iOS↔web parity matrix (✅/⚠️/➖) as part of its handoff message. No exception.
- **Per-feature green-light**: stop after each slice (lint + tests + build green + tough self-review + reviewer parity matrix) and wait for explicit "go" / "push" / "ship it" from Tarun before starting the next slice.
- **Commit-only, never push**: each slice commits locally as soon as gates pass; push requires a separate explicit instruction.
- **`tsx watch` doesn't reload `.env`**: no environment changes are expected this sprint, but if Slice 4b's FCM SW handler needs new keys, restart `npm run dev:server` manually.
- **Migration discipline**: this sprint adds NO new migrations — all server endpoints already exist. If a slice surfaces a missing column (e.g. Slice 5's gps_distance_metres projection check), flag and discuss before adding a migration.

### Out-of-scope (admin lane handoff)
- `src/components/admin/EmergencyBanner.tsx` — admin-side warning visibility
- `src/components/admin/ReportsInboxPage.tsx` and `ReportDetailPage.tsx` — admin report triage
- `src/components/admin/SafetyEndedPage.tsx` — admin view of auto-ended rides
- `UserDetailPage` TrustedContactsCard — admin view of a user's trusted contacts
- `useAdminSafetyEnded`, `useAdminRides` ride_audit_log timeline read
- `server/routes/admin/rideSafetyActions.ts`, `server/routes/admin/audit.ts`, `server/routes/admin/safetyEnded.ts`
- `ride_audit_log` user-facing surface — no iOS user surface either; admin-only
- `divergence_pattern` column (migration 096) — dead schema, requires server-side writer first
- `share_role` field on `GET /api/safety/track/:token` response — server contract addition required to ship truly symmetric TrackPage copy; out of user-side parity scope (web ships neutral copy as fallback)
- Bare `GET /api/rides/:id` handler — does not exist on the server; iOS `GetRideEndpoint` actually 404s today. Sprint 11 routes around by using `GET /api/rides/active`. Adding the bare handler is server work outside this sprint.

### Open questions (need Tarun's call before or during Sprint 11)
1. **`AddTrustedContactSheet` host page**: iOS mounts `ProfileSafetySection` on `ProfilePage.swift:113`. Web `SettingsPage` is a different shape — should `TrustedContactsSection` live on the Profile page (mirrors iOS) or on the Settings page (web convention)? Slice 2 currently plans Profile page to match iOS canonical placement.
2. **FCM Web permission prompt UX**: should Slice 4b prompt for notification permission proactively in Profile → Safety, or piggyback on the existing push prompt flow? Default plan: piggyback to avoid an extra prompt.
3. **`RiderPickupPage` iOS counterpart**: iOS scout enumerated `DriverPickupPage` only. Web grep shows EmergencySheet mounts on both pickup pages — does iOS have a `RiderPickupPage` emergency mount too? If yes, Slice 1's RiderPickupPage pill is parity; if no, it's web-AHEAD. Either way Slice 1 ships the pill on both for the hard-rule fix.
4. **TrackPage symmetric copy**: ship neutral "Live location is being shared" (Slice 6 plan) or request a server contract change to expose `share_role` and render true symmetric copy? Default plan: neutral fallback.
5. **End-reason tag on RideSummaryPage**: iOS may render "Ride ended automatically" for `auto_divergence` rides on summary. Worth confirming iOS source has a user-facing surface before adding to a future sprint.
6. **`/report-issue` mailto and `/report/:rideId` ReportReason taxonomy**: three different category lists exist across web today. Worth a separate cleanup slice in a Reports v2 stage — confirm not to fold into Sprint 11.

### What this audit dropped from the initial matrix and why
- **MyReportsPage / MyReportDetailPage / Report attachments**: MEDIUM/LOW per matrix, belong to a Reports v2 stage. Not closely coupled to the safety net.
- **`divergence_pattern` column surfacing**: dead schema (0 references outside migration 096) — informational only, no client surface needed until a server writer exists.
- **`ride_audit_log` user-facing read**: no iOS user surface; admin-only.
- **All admin-lane safety surfaces**: parallel session owns them. Flagging in cross-cutting notes is enough.
- **`CNContactPickerViewController` equivalent**: pure-native iOS; Web Contacts Picker API is Chromium-only/secure-context. Acceptable indefinite defer per matrix; users type name+phone manually.
- **Bare `GET /api/rides/:id` server handler**: server-side work, not user-parity. Slice 4a routes around via `GET /api/rides/active`.
- **`share_role` field addition to TrackPage response**: server contract change; Sprint 11 ships neutral fallback copy.
- **`/report-issue` mailto cleanup + `/report/:rideId` taxonomy reconciliation**: belongs to a separate Reports v2 cleanup stage — flagging as Open Question #6.
- **User-facing `end_reason` / `cancel_reason` tag on RideSummaryPage**: defer until iOS source confirms a corresponding surface.
- **`ReportSafetyView` push-to-page navigation pattern**: web's inline wizard is functional parity — keep it.
- **Haptics across all surfaces**: web has no haptic API; acceptable native-only differentiation.
- **Migration 095 forensic columns**: server already writes via existing endpoints; web QR flow already exercises them. Verify-only, no new code.

### Critic verdicts
- **Completeness**: PASS — 36 missed elements folded in (4 critical: help-flow desktop fallback, role-aware overlay subtitles + button labels, three distinct error copies + countdown restart, no-trusted-contacts guidance). 5 LOW items deferred with explicit rationale (admin lane, MyReportsPage, ContactPicker, divergence_pattern dead column, mailto cleanup).
- **Contract**: PASS — BLOCKER (`GET /api/rides/:id` 404) resolved by routing Slice 4a reseat through `GET /api/rides/active`. HIGH (wrong event name on safety channel) resolved by listening for `safety_ended` not `ride_ended`. MEDIUM (TrackPage role) resolved by neutral fallback copy + open question. LOW items (legacy alias map, got-out branch broadcasts safety_ended not warning_responded, manual_end reason clarity, LIMIT_REACHED split tests, divergence_pattern dead, WRONG_ROLE 403 path, UUID case asymmetry) all folded into slice scope/tests.
- **Sprint shape**: PASS — Slice 4 split into 4a (channel + reseat + passive banner, ~250 LoC) and 4b (interactive overlay + 3 actions + FCM Web SW, ~400 LoC). Slice 5 (FCM Web push handlers) merged into 4b for atomicity. Pickup-page pill folded into Slice 1. Slice 7 polish promoted to Slice 6, kept as single slice given tight semantic coupling around EmergencySheet/Share Location. Sprint lands at 7 slices (1, 2, 3, 4a, 4b, 5, 6) — within tolerance. Slice 5 (manual-end button) has pre-slice gps_distance_metres projection verification step. Slice 2 LoC flagged as upper-edge with split escape hatch.

### Sprint 11 summary

| Status | Count |
|---|---|
| Not started | 7 slices (1, 2, 3, 4a, 4b, 5, 6) |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

Sprint 11 ships the missing user-side safety net: always-visible top-bar emergency pill (closing a CLAUDE.md hard-rule violation), full `RideSafetyCheckOverlay` flow with 90s countdown + role-aware actions + sms help branch + desktop fallback, `ride-safety:{rideID}` realtime channel + FCM Web background push parity, Trusted Contacts CRUD on the Profile page (unblocking the dead "Text trusted contacts" button), role-aware safety report categories in the EmergencySheet, the gated Phase-3.4 "End ride without QR" secondary on both rider and driver active pages, and an EmergencySheet structural polish pass (sections + footers + toasts + sms-fallback + symmetric TrackPage copy). Seven slices, sequenced smallest-first with the shared `useRideRole` and `SafetyPill` primitives landing early so later slices compose. Closes 5 BLOCKER + 8 HIGH gaps from the Stage 7 audit. Admin-lane safety surfaces, Reports v2 page set, and one server-side contract addition (`share_role` on TrackPage) explicitly deferred.

### Current focus

Awaiting Tarun's "go" on Slice 1 (always-visible top-bar safety pill — closes CLAUDE.md hard rule, ~180 LoC, smallest possible win, lands shared `SafetyPill.tsx`). No code changes have shipped from this audit yet.

### Next action

If Tarun greenlights Slice 1: read [`ios/Tago/Features/RiderHome/RiderActiveRidePage.swift`](ios/Tago/Features/RiderHome/RiderActiveRidePage.swift) (focus on `safetyPill()` mount + emergency presentation at L475-490), [`ios/Tago/Features/DriverHome/DriverActiveRidePage.swift`](ios/Tago/Features/DriverHome/DriverActiveRidePage.swift) (L446-461), [`ios/Tago/Features/DriverHome/DriverPickupPage.swift`](ios/Tago/Features/DriverHome/DriverPickupPage.swift) (L919-941), then web counterparts in [`src/components/ride/`](src/components/ride/) end-to-end before any TypeScript. Confirm `git status` is clean of parallel-session WIP on the active-ride pages at slice kickoff.

### Plain English

The web app has a safety button to call 911 / share live location / report problems / text trusted contacts — but right now it lives inside a slide-up drawer that disappears the moment the rider opens the QR scanner. That's the active CLAUDE.md hard-rule violation. We also don't have a way for users to add their own trusted contacts (so the "text them" button is permanently dead). And there's a much bigger gap: when the server thinks the rider and the driver have drifted apart mid-ride (the "safety check"), iOS pops up a 90-second countdown asking "are you still in the car / did you get out / do you need help?" — the web app has NO way to receive that alert at all. After 90 seconds with no response, the server just auto-ends the ride. Sprint 11 ships all of that: pinned top-bar safety button visible at all times, a way to add up to 5 trusted contacts on Profile, the full mid-ride safety check screen with three actions, separate categories for rider-reports-driver vs driver-reports-rider, a gated "end the ride without scanning" button for when the QR fails, and a polish pass on the share-link sheet. Seven slices, sequenced smallest-first.

---

## Sprint 10 — Board redesign + Smart geo-match v1.3 parity

**Audit-first mode.** Stage 6 of the multi-stage iOS-parity audit completed 2026-06-01 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Headline

As of 2026-06-01 the web Board ships a functional twin of the iOS browse-and-confirm loop and is wire-compatible on every server endpoint (mig 072 `ride_offers`, mig 078 polyline smart-match, mig 083 `transit_details`, v1.2.1 S2.1 reverse handoff, mig 086 caregivers), but iOS has pulled ahead on **five load-bearing surfaces** verified against the `.swift` source:

1. **`BoardOfferAcceptPage` offer card** does NOT render `proposed_transit_line_name` / walk / transit / total minutes the server already returns (mig 083).
2. **`reverse_transit_handoff` match type** is dropped at the web type boundary (`boardSearch.ts`); smart-search→confirm hand-off never pre-fills `proposed_pickup_*`.
3. **`RideBoardConfirmSheet` station picker** is a flat text button row where iOS ships a 180pt MapKit mini-map with numbered pins + tap-to-peek + 'Use this stop'.
4. **`PosterProfilePreviewSheet`** on avatar tap (v1.2 F18.1, endpoint live at `server/routes/users.ts:338`).
5. **`RideBoardConfirmSheet` has no `CaregiverPickerSection`** (real F7.2 gap — `caregiver_id` never reaches request enrichment from the Board flow) AND `RideBoardCard` Withdraw branch reads `ride_id` only (never `my_offer_id`, so driver-side outgoing-offer withdraw is dark on web).

Sprint 10 ships **6 tight slices** in dependency order, sized for safe per-feature green-light cadence: smallest/zero-dep first (`proposed_transit_*` on offer card), then reverse-handoff contract, then a pure refactor extracting the existing `TransitSuggestionCard` map primitive, then the confirm-sheet mini-map + peek built on that primitive, then `PosterProfilePreviewSheet`, then `CaregiverPickerSection` + `my_offer_id` Withdraw. `FareEducatorInlineCard` is deferred to Sprint 11 (see openQuestions).

### Files read end-to-end during the audit

**iOS source-of-truth surface (25 RideBoard `.swift` files + 9 endpoint structs):**

Wall + search:
- [`RideBoardPage.swift`](ios/Tago/Features/RideBoard/RideBoardPage.swift), [`+Actions`](ios/Tago/Features/RideBoard/RideBoardPage+Actions.swift), [`RideBoardHomePage.swift`](ios/Tago/Features/RideBoard/RideBoardHomePage.swift), [`RideBoardViewModel.swift`](ios/Tago/Features/RideBoard/RideBoardViewModel.swift), [`RideBoardSearchBar.swift`](ios/Tago/Features/RideBoard/RideBoardSearchBar.swift), [`RideBoardFilterSheet.swift`](ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift), [`RideBoardFilters.swift`](ios/Tago/Features/RideBoard/RideBoardFilters.swift), [`RideBoardEmptyState.swift`](ios/Tago/Features/RideBoard/RideBoardEmptyState.swift), [`RideBoardCityChipStrip.swift`](ios/Tago/Features/RideBoard/RideBoardCityChipStrip.swift), [`RideBoardCityPresets.swift`](ios/Tago/Features/RideBoard/RideBoardCityPresets.swift), [`RideBoardRecentSearchStore.swift`](ios/Tago/Features/RideBoard/RideBoardRecentSearchStore.swift), [`RideBoardCard.swift`](ios/Tago/Features/RideBoard/RideBoardCard.swift)

Confirm + detail flow:
- [`RideBoardConfirmSheet.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmSheet.swift), [`RideBoardConfirmViewModel.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift), [`RideBoardConfirmPickupSection.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmPickupSection.swift), [`RideBoardConfirmDestinationSection.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmDestinationSection.swift), [`RideBoardDetailSheet.swift`](ios/Tago/Features/RideBoard/RideBoardDetailSheet.swift), [`+Actions`](ios/Tago/Features/RideBoard/RideBoardDetailSheet+Actions.swift), [`RideBoardHelpers.swift`](ios/Tago/Features/RideBoard/RideBoardHelpers.swift), [`RideBoardGlass.swift`](ios/Tago/Features/RideBoard/RideBoardGlass.swift), [`RequestEnrichment.swift`](ios/Tago/Features/RideBoard/RequestEnrichment.swift)

Offer / transit / preview:
- [`BoardOfferAcceptPage.swift`](ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift), [`RideBoardOfferSections.swift`](ios/Tago/Features/RideBoard/RideBoardOfferSections.swift), [`RideBoardTransitMiniMap.swift`](ios/Tago/Features/RideBoard/RideBoardTransitMiniMap.swift), [`PosterProfilePreviewSheet.swift`](ios/Tago/Features/RideBoard/PosterProfilePreviewSheet.swift)

Endpoints:
- [`BoardOfferEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift), [`BoardRequestActionEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/BoardRequestActionEndpoints.swift), [`BoardSearchEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/BoardSearchEndpoint.swift), [`ScheduleBoardEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ScheduleBoardEndpoint.swift), [`ScheduleManageEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/ScheduleManageEndpoints.swift), [`ScheduleRequestEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift), [`ScheduleNotifyEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ScheduleNotifyEndpoint.swift), [`ComputeScheduleRouteEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ComputeScheduleRouteEndpoint.swift), [`GetScheduleByIDEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/GetScheduleByIDEndpoint.swift)

**Server + migrations:**

- [`supabase/migrations/072_ride_offers_for_board.sql`](supabase/migrations/072_ride_offers_for_board.sql) — `ride_offers` table foundation
- [`supabase/migrations/075_ride_offers_unique_schedule_driver.sql`](supabase/migrations/075_ride_offers_unique_schedule_driver.sql)
- [`supabase/migrations/078_smart_search_polylines.sql`](supabase/migrations/078_smart_search_polylines.sql) — smart-geo-match foundation
- [`supabase/migrations/082_users_last_known_location.sql`](supabase/migrations/082_users_last_known_location.sql) — smart-match seeding
- [`supabase/migrations/083_ride_offers_transit_details.sql`](supabase/migrations/083_ride_offers_transit_details.sql) — transit-handoff payloads
- [`server/routes/schedule.ts`](server/routes/schedule.ts) — board handlers (search by `/board`, `ride_offers`, `board-search`, `smart`)
- [`server/lib/boardSearch.ts`](server/lib/boardSearch.ts) (server-side smart-match scoring)

**Web user-facing surface (audit result):**

At parity (no Sprint 10 work):
- [`src/components/schedule/RideBoard.tsx`](src/components/schedule/RideBoard.tsx) — wall of posts, realtime, filters
- [`src/components/schedule/RideBoardHome.tsx`](src/components/schedule/RideBoardHome.tsx) — smart-search entry + recent searches
- [`src/components/schedule/RideBoardCard.tsx`](src/components/schedule/RideBoardCard.tsx) — ♿ mobility-aid pill (Sprint 7 Slice 4 `2b3913e`)
- [`src/components/ride/BoardOfferAcceptPage.tsx`](src/components/ride/BoardOfferAcceptPage.tsx) — caregiver waiver banner (Sprint 6 Slice 5 `8a44be2`)
- `RideBoardFilterSheet.tsx` accessibility filter, FROM/TO/WHEN inputs, `MatchBadge` for `direct`/`transit_handoff`/`endpoint`

Missing entirely (Sprint 10 scope):
- ❌ No `proposed_transit_*` rendering on offer card (HIGH)
- ❌ No `reverse_transit_handoff` type / badge / confirm pickup pre-fill (HIGH)
- ❌ Confirm sheet transit station picker is text-only (HIGH — Uber-bar violation)
- ❌ No `PosterProfilePreviewSheet` on avatar tap (MEDIUM)
- ❌ No `CaregiverPickerSection` on Board confirm + no `my_offer_id` Withdraw branch (HIGH + MEDIUM)
- ❌ No `FareEducatorInlineCard` on detail sheet (MEDIUM — deferred to Sprint 11)

### Side-by-side parity matrix

| Surface | iOS | Web | Severity |
|---|---|---|---|
| `BoardOfferAcceptPage` offer card — transit leg metadata | `transitStop()` + `transitLegPills()` (lines 653-728) render line name + walk/transit/total | `BoardOffer` interface drops the 4 `proposed_transit_*` fields entirely | 🚨 HIGH |
| Reverse-handoff match type (driver pickup at transit station) | `match_type='reverse_transit_handoff'` with `transit_handoff.direction='reverse'` (v1.2.1 S2.1); "Meet via transit" badge; confirm sheet pre-fills `proposed_pickup_*` | `boardSearch.ts` union is `direct|transit_handoff|endpoint` — reverse dropped at type boundary; no badge, no pre-fill | 🚨 HIGH |
| Confirm sheet — transit mini-map + station peek | 180pt MapKit mini-map with numbered station pins + context pins + tap-to-peek + 'Use this stop' CTA | `RideBoardConfirmSheet.tsx` renders flat button row of up to 5 stations — no map, no peek, no commit | 🚨 HIGH (Uber-bar violation) |
| `PosterProfilePreviewSheet` on avatar tap (F18.1) | Tap poster/driver avatar → sheet seeds from snapshot, fetches `/api/users/:id/public-profile`, shows bio + school + vehicle + member-since + accessibility pills | No equivalent; avatars decorative | ⚠️ MEDIUM |
| Confirm sheet — `CaregiverPickerSection` (F7.2) | `RideBoardConfirmSheet.swift:54-115` mounts inline, gated on `hasAccessibilityNeeds && needsWheelchair && !caregivers.isEmpty`; `caregiver_id` + `distance_km` reach `/api/schedule/request` | No picker on Board confirm; `RequestEnrichment` missing both fields. Picker IS shipped (Sprint 6 Slice 3) — just never mounted in Board flow | 🚨 HIGH |
| `RideBoardCard` — driver outgoing-offer Withdraw | `offerSentRow` (lines 445-453): "Offer Sent" badge + Withdraw button when `alreadyRequested && my_offer_id`; calls `POST /api/schedule/board/offers/:offerId/withdraw` | `RideBoardCard.tsx:160-167` Withdraw branch reads `ride_id` only (rider-side withdraw); no `my_offer_id` branch | ⚠️ MEDIUM |
| `RideBoardDetailSheet` — `FareEducatorInlineCard` | Always mounted below action buttons (except poster's own post); per-surface tracker via `FareEducatorTracker.Surface` | Grep `FareEducator` in `src/` → zero hits | ⚠️ MEDIUM (deferred to Sprint 11) |
| `RideBoardHome` — recent searches + hero + mode pills | `recentSearchesSection` (640-691), animated `heroTitle`, two-pill mode chip row | Ships recent recall + mode toggle + inputs; some polish gaps in hero animation + mode pill treatment | LOW (defer) |
| Mobility-aid pill + Accessibility filter + Caregiver-waiver banner on `BoardOfferAcceptPage` | F5.2 + F5.3 + F14.2 | All three already shipped on web (Sprint 6 Slice 5 + Sprint 7 Slice 4) | ➖ PARITY |
| City chip strip + realtime polling fallback | `RideBoardCityChipStrip` with 8 city presets + 'All' + re-tap-to-clear; 30s polling fallback in `RideBoardViewModel.startRealtimeIfNeeded()` | Free-text search only (no city chips); realtime present, no explicit polling fallback | LOW (defer) |

### Cross-cutting notes (apply to every slice)

- **Role-per-ride hard rule** (memory `feedback_role_per_ride.md`): rider vs driver branching in `RideBoardConfirmSheet` / `RideBoardCard` / `BoardOfferAcceptPage` must derive role from `rides.rider_id` / `driver_id` (or `schedule.mode` for board), never from tab/sub-app/nav context. Slices 2, 4, 6 all touch role-conditional rendering. **Special call-out for Slice 2:** a reverse-handoff result is rider-as-actor on a rider-post — `RideBoard.tsx::handleStartRequest` must NOT trip `/become-driver` gate. Add the test explicitly.
- **No iOS planning markdowns** (hard rule, `CLAUDE.md` + memory `feedback_no_ios_planning_docs.md`). Reading order for every slice: iOS `.swift` files in `iosReferenceFiles` → migrations 072/075/078/082/083/086 → `server/routes/schedule.ts` + `users.ts` → web counterpart. Skip every `ios/*_PLAN.md` / `ios/*_PROGRESS.md` / `docs/*_PLAN.md`.
- **AUDIT before creating new infra** (memory `feedback_audit_before_creating.md`). Slice 3 is the operational expression — extract existing `TransitSuggestionCard` map block instead of building `RideBoardTransitMiniMap` from scratch. Slice 6's caregiver picker REUSES the existing `CaregiverPickerSection` from `SchedulePage.tsx:920-925` (Sprint 6 Slice 3). Slice 5 will grep `src/components/profile/` for parallel-session activity before mounting new files.
- **Copy-verbatim rule**: every user-visible string on new slices must match iOS `.swift` source character-for-character. Slice 1 "Take <line> · walk Xm · transit Ym · total Zm", Slice 2 "Meet via transit" + Proposed Handoff Card direction-aware copy, Slice 4 "Use this stop", Slice 6 caregiver gating copy — all need string-grep verification against iOS source in the reviewer pass.
- **Per-feature green-light cadence** (memory `feedback_per_feature_green_light.md`): after each slice — lint + full `npm run build` + tests + reviewer parity matrix + plain-English summary in handoff — STOP and wait for Tarun's explicit "go" / "push" / "ship it" before starting the next slice. Do not chain slices.
- **Parallel session lanes** (memory `project_parallel_admin_session.md` + `feedback_parallel_webapp_session.md`). Sprint 10 touches `src/components/schedule/`, `src/components/ride/`, `src/components/profile/`, `src/components/map/`, `src/lib/`, `src/test/`. Admin session owns `src/components/admin/`, `server/routes/admin/`, marketing files. Webapp session owns caregivers/onboarding/profile WIP (current `git status` shows their `WheelchairSection.tsx` WIP + `VehicleRegistrationPage.tsx` / `VehicleEditPage.tsx` — all theirs). **Slice 5 explicitly re-greps `/components/profile/` at kickoff** before adding `UserProfilePreviewSheet` / `Card`.
- **Design tokens only** (`CLAUDE.md`): every color in new components from `src/lib/tokens.ts`. Slice 3's `RideMapPrimitive` (new) and Slice 5's `UserProfilePreviewCard` (new) are the easiest places for raw hex to slip in. Verify with `git diff` grep for `#[0-9a-fA-F]{3,6}` before each commit.
- **Money in cents always**: `proposed_fare_cents`, `caregiver_fare_cents`, `estimated_fare_cents` stay as integer cents end-to-end. Slice 1's transit row shows minutes (integer), not money, but the fare cell above it must keep cents → dollars formatting via existing fare-display helpers.
- **Commit-locally-never-push** (memory `feedback_commit_locally_never_push.md` + `feedback_commit_only_not_push.md`): as each slice's gates go green, commit immediately (no `Co-Authored-By` trailer per `feedback_no_coauthored_by.md`), then wait for explicit "push" / "ship it". Pre-commit gate is strict (memory `feedback_pre_commit_gates_strict.md`): lint + full `npm run build` (NOT `npx tsc -b` alone) + tests + `git diff --cached` on the same line as `git add` to defend against parallel-session contamination (memory `feedback_diff_cached_after_add.md`).
- **Reviewer parity-check before slice handoff** (`CLAUDE.md` hard rule 2026-05-30): every slice handoff message must contain a 3-column iOS↔web matrix (iOS element / web counterpart / ✅⚠️➖ verdict) covering every user-visible element on the touched iOS source files — not just a prose recap. **Slice 3 is the only allowed exception** (pure refactor, no user-visible parity surface) and the handoff must explicitly note "N/A — no user-visible parity surface" per the mandatory-exception clause.
- **Plain-English summary** (memory `feedback_plain_english_summary.md`): every slice handoff includes a "Plain English" section in non-technical language describing what shipped + what's next. Technical detail goes in a separate section.

### Sprint 10 slice plan

Per the per-feature green-light + reviewer parity-check + tough-self-review hard rules. Every slice ends with lint + tests + build green + reviewer parity matrix + commit + wait for Tarun's "go" before the next.

#### Slice 1 — Render `proposed_transit_*` on `BoardOfferAcceptPage` offer card

Smallest, zero-dependency, highest-value slice. Extend the web `BoardOffer` interface to include `proposed_transit_line_name`, `proposed_transit_walk_minutes`, `proposed_transit_to_dest_minutes`, `proposed_transit_total_minutes` (server returns them per mig 083, verified at `schedule.ts:4983-4984`). Render an inline transit-leg row on each offer card mirroring iOS `transitStop()` + `transitLegPills()` copy + ordering (walk → transit → total). ~150 LoC including tests.

- **iOS reference:** `BoardOfferAcceptPage.swift` (`transitStop` 653-686, `transitLegPills` 700-728), `BoardOfferEndpoints.swift` (BoardOffer struct with `proposed_transit_*` fields), `ios/Tago/Models/BoardOffer.swift`
- **Web files to touch:** `src/components/ride/BoardOfferAcceptPage.tsx` (extend `BoardOffer` interface, render transit row when `proposed_transit_line_name` non-null), `src/test/ride/BoardOfferAcceptPage.transitDetails.test.tsx` (new)
- **Server contract:** `GET /api/schedule/board/schedule/:scheduleId/offers` returns `offers[].proposed_transit_line_name` (string|null), `proposed_transit_walk_minutes` (int|null), `proposed_transit_to_dest_minutes` (int|null), `proposed_transit_total_minutes` (int|null). **No server changes** — only widen client interface and render.
- [ ] `BoardOffer` interface declares all 4 `proposed_transit_*` fields
- [ ] Offer card renders "Take {line_name} · walk Xm · transit Ym · total Zm" row when `line_name` present; hidden when null
- [ ] Visual matches iOS drawer copy + ordering (walk → transit → total) character-for-character
- [ ] vitest: test asserts decode + render when fields present and absent
- [ ] All 3 gates green
- [ ] Reviewer parity matrix posted (every iOS user-visible element on `transitStop`+`transitLegPills` enumerated ✅/⚠️/➖)

#### Slice 2 — Surface `reverse_transit_handoff` end-to-end (contract + badge + pickup pre-fill)

Widen web `BoardSearchResult` union to include `reverse_transit_handoff`, add `direction='forward'|'reverse'` to `TransitHandoff`, render "Meet via transit" `MatchBadge` on `RideBoardHome` for reverse results, and extend `setConfirmInitialEnrichment` to pre-fill `proposed_pickup_lat/lng/name` (station coords) when `direction='reverse'`. Wire `RideBoardConfirmSheet` to surface the direction-aware Proposed Handoff Card iOS already ships. **Also handle the role-gate edge case:** a reverse-handoff result on a rider-post where the viewer is the rider-actor must NOT trip `/become-driver` routing in `RideBoard.tsx::handleStartRequest`.

Narrow framing: `TransitHandoffCard` already renders `line_name` (`RideBoardHome.tsx:775-778`) — only the `MatchBadge` variant + type union + confirm pre-fill are gaps.

- **iOS reference:** `RideBoardHomePage.swift` (matchBadge switch 819-947 incl. `.reverseTransitHandoff` case), `RideBoardViewModel.swift` (selectedMatchTypeLabel + handoff direction), `RideBoardConfirmViewModel.swift` (proposed_pickup overrides on reverse handoff), `RideBoardConfirmSheet.swift` (Proposed Handoff Card 421-472), `BoardSearchEndpoint.swift` (`TransitHandoff.direction` enum + `reverse_transit_handoff` match_type)
- **Web files to touch:** `src/lib/boardSearch.ts` (add `reverse_transit_handoff` to `BoardSearchMatchType`, add `direction` to `TransitHandoff`), `src/components/schedule/RideBoardHome.tsx` (`MatchBadge` reverse variant; nav state carries pickup coords), `src/components/schedule/RideBoard.tsx` (`handleStartRequest` must NOT trip `/become-driver` for reverse-handoff rider-actor; `setConfirmInitialEnrichment` reads `handoff.direction` and writes `pickup_lat/lng/name` when reverse), `src/components/schedule/RideBoardConfirmSheet.tsx` (Proposed Handoff Card with direction-aware copy: "You take transit from {pickup} to {station}" for reverse), `src/test/schedule/RideBoardHome.reverseHandoff.test.tsx` (new), `src/test/schedule/RideBoard.reverseHandoffRouting.test.tsx` (new — role-gate edge case)
- **Server contract:** `POST /api/schedule/board/search` returns `results[].match_type ∈ {direct, transit_handoff, reverse_transit_handoff, endpoint}` and `results[].transit_handoff.direction ∈ {forward, reverse}` (v1.2.1 S2.1, verified live). Confirm submits via `POST /api/schedule/board/offers` carrying `proposed_pickup_lat/lng/name` for reverse — same endpoint as forward, different fields populated.
- [ ] `BoardSearchMatchType` union includes `'reverse_transit_handoff'` and `TransitHandoff` has `direction: 'forward'|'reverse'`
- [ ] `RideBoardHome` renders "Meet via transit" badge (primary tint) for reverse results with `total_rider_minutes`
- [ ] Tapping a reverse-handoff result routes to confirm sheet WITHOUT tripping `/become-driver` gate when viewer is rider-actor
- [ ] Confirm sheet pre-fills pickup coords + shows direction-aware Proposed Handoff Card
- [ ] vitest covers decoded badge text, confirm enrichment pickup pre-fill, and rider-actor routing
- [ ] All 3 gates green
- [ ] Reviewer parity matrix posted

#### Slice 3 — Extract reusable `RideMapPrimitive` from `TransitSuggestionCard` (pure refactor)

**Pure refactor, zero behavior change.** Lift the inline map block from `src/components/ride/TransitSuggestionCard.tsx` (Map + AdvancedMarker + useMap + MapBoundsFitter, lines ~79-300) into a shared primitive at `src/components/map/RideMapPrimitive.tsx` that takes pins (numbered + context), an optional polyline, and a bounds-fit mode (`overview` | `peek`). Re-wire `TransitSuggestionCard` to consume the primitive — its rendered output MUST be pixel-identical before and after. This is the AUDIT-before-create discipline (memory `feedback_audit_before_creating.md`). Slice 4 depends on this primitive. ~100 LoC of pure refactor + render-equivalence snapshot test.

- **iOS reference:** `RideBoardTransitMiniMap.swift` (camera fit modes + numbered pins — informs the primitive's API surface, not the implementation)
- **Web files to touch:** `src/components/map/RideMapPrimitive.tsx` (new — exported shared component), `src/components/ride/TransitSuggestionCard.tsx` (refactor to consume `RideMapPrimitive`; visual output unchanged), `src/test/components/map/RideMapPrimitive.test.tsx` (new), `src/test/ride/TransitSuggestionCard.equivalence.test.tsx` (new — snapshot ensures no visual regression)
- **Server contract:** None. Pure refactor.
- [ ] `RideMapPrimitive` accepts `pins` (with optional numbered label), `polyline`, and `bounds-fit` mode props
- [ ] `TransitSuggestionCard` rendered output unchanged (snapshot test passes)
- [ ] Zero raw hex — all colors via `src/lib/tokens.ts`
- [ ] All 3 gates green
- [ ] Reviewer matrix: **N/A — no user-visible parity surface in this slice (refactor only)**. Note exemption in handoff per CLAUDE.md mandatory-exception clause.
- **Dependencies:** Slice 2 (light coupling — both touch confirm-sheet adjacent code; sequence to avoid merge churn)

#### Slice 4 — Transit mini-map + station peek in `RideBoardConfirmSheet`

Replace the flat transit-station button row with a 180px `RideMapPrimitive` (from Slice 3) showing numbered station pins + context pins (rider dest, driver origin/dest), a station list with walk/transit/total per row, tap-to-peek that tightens the map to selected station + rider dest, and a "Use this stop" button on the peeked card. Mirror iOS `RideBoardTransitMiniMap` + `RideBoardConfirmDestinationSection`. Highest-visibility native-first gap. Sized at ~600 LoC including tests. **If it runs hot, the openQuestion split (4a map only, 4b peek + 'Use this stop') is the pre-planned escape hatch** — confirm with Tarun at slice kickoff.

- **iOS reference:** `RideBoardTransitMiniMap.swift` (entire file — camera fit modes, peek vs overview), `RideBoardConfirmDestinationSection.swift` (station list, peek state, 'Use this stop' 199-343), `RideBoardConfirmViewModel.swift` (`transitSuggestions` state, `peekedStationID`)
- **Web files to touch:** `src/components/schedule/RideBoardConfirmSheet.tsx` (lift transit suggestion state, embed `RideMapPrimitive`, peek state machine), `src/components/schedule/RideBoardTransitStationRow.tsx` (new — numbered icon + walk/transit/total + chevron), `src/test/schedule/RideBoardConfirmSheet.transitMiniMap.test.tsx` (new — mocks `/api/transit/preview`, asserts list render + peek transition + 'Use this stop' commit)
- **Server contract:** `POST /api/transit/preview` body `{driver_origin_lat/lng, driver_dest_lat/lng, rider_dest_lat/lng}` returns `{suggestions: [{station_name, station_place_id, station_lat, station_lng, walk_to_station_minutes, transit_to_dest_minutes, total_rider_minutes, transit_option?: {line_name, duration_minutes, walk_minutes, total_minutes}}]}` — existing endpoint, no server work.
- [ ] Map renders inside confirm sheet at 180px with numbered station markers (1/2/3) + rider dest + driver origin/dest pins
- [ ] Tapping a station row highlights row, tightens camera to that station + rider dest, shows "Use this stop" CTA
- [ ] "Use this stop" commits station coords as `proposed_dropoff_*` and wires into existing offer submit
- [ ] Hidden when driver destination unselected; loading spinner while `/api/transit/preview` pending
- [ ] All colors via `tokens.ts` (verified via `git diff` grep for raw hex before commit)
- [ ] All 3 gates green; reviewer parity matrix enumerates every iOS element from `RideBoardTransitMiniMap` + `RideBoardConfirmDestinationSection`
- **Dependencies:** Slice 3 (consumes `RideMapPrimitive`), Slice 2 (reverse-handoff direction so the map renders reverse-direction context pins symmetrically)

#### Slice 5 — `PosterProfilePreviewSheet` on avatar tap

Ship web `UserProfilePreviewCard` + `UserProfilePreviewSheet` components. Tap poster avatar on `RideBoardCard` or driver avatar on `BoardOfferAcceptPage` → bottom-sheet renders. Seed instantly from poster snapshot (name, avatar, rating, accessibility flags, `waive_caregiver_fee`), fetch `GET /api/users/:id/public-profile` in background to fill bio / school / vehicle / member-since. **Pre-flight check:** grep `src/components/profile/` for parallel-session activity at slice kickoff (the parallel webapp session lane owns caregivers/onboarding/profile per memory; `WheelchairSection.tsx` untracked at session start is theirs).

- **iOS reference:** `PosterProfilePreviewSheet.swift`, `UserProfilePreviewSheet.swift`, `UserProfilePreviewCard.swift` (waive_caregiver_fee pill at line 124), `RideBoardPage.swift` (posterPreview state 55-60, sheet presentation 249-255)
- **Web files to touch:** `src/components/profile/UserProfilePreviewSheet.tsx` (new — reuses `BottomSheet`), `src/components/profile/UserProfilePreviewCard.tsx` (new), `src/lib/publicProfile.ts` (new — fetcher), `src/components/schedule/RideBoardCard.tsx` (make avatar tappable when `!isOwn`, mount sheet on tap), `src/components/ride/BoardOfferAcceptPage.tsx` (make driver avatar tappable, mount sheet), `src/test/profile/UserProfilePreviewSheet.test.tsx` (new)
- **Server contract:** `GET /api/users/:id/public-profile` returns full public profile (bio, school, vehicle make/model/year, member_since, has_accessibility_needs, needs_wheelchair, waive_caregiver_fee, rating_avg, rating_count) — verified live at `server/routes/users.ts:338`. No server work.
- [ ] Tapping non-own `RideBoardCard` avatar opens `BottomSheet` seeded from poster snapshot (no loading flash)
- [ ] Background fetch fills bio/school/vehicle/member-since; spinner only on fields that didn't seed
- [ ] Same sheet opens from `BoardOfferAcceptPage` driver avatar
- [ ] Sheet shows accessibility flag pill + caregiver-waiver pill when relevant — same icons/tokens as iOS
- [ ] Pre-flight grep confirms no parallel-session edits on `/components/profile/` at kickoff (stash-isolate if needed)
- [ ] vitest covers seed + background-fetch + error-state
- [ ] All 3 gates green; reviewer parity matrix
- **Dependencies:** Slice 1 (both touch `BoardOfferAcceptPage` — sequence to avoid merge conflicts)

#### Slice 6 — `CaregiverPickerSection` in `RideBoardConfirmSheet` + `my_offer_id` Withdraw branch on `RideBoardCard`

Two symmetric reads of fields the server already returns.

**(a) Mount the existing reusable `CaregiverPickerSection`** (Sprint 6 Slice 3, used by `SchedulePage.tsx:920-925`) into `RideBoardConfirmSheet` on the rider-on-driver-post branch, gated on `hasAccessibilityNeeds && needsWheelchair && !caregivers.isEmpty`. Extend `RequestEnrichment` with `caregiver_id` + `distance_km` and forward them in the `POST /api/schedule/request` payload. Mirror iOS `RideBoardConfirmSheet.swift:54-115` + `RideBoardConfirmViewModel.swift:635`.

**(b) On `RideBoardCard`**, add Offer Sent badge + Withdraw button branch when `ride.my_offer_id` is populated and `!ride.ride_id` (driver has outgoing pending offer on a rider-post). Calls `POST /api/schedule/board/offers/:offerId/withdraw`.

**Critical correction:** the earlier draft proposed a "caregiver-waiver banner" here — verification confirms iOS `RideBoardConfirmSheet` has ZERO `waive`/`waiver` references; dropped that subscope.

- **iOS reference:** `RideBoardConfirmSheet.swift` (caregiverSectionVisible 54-115, gateThenSubmit 697-722), `RideBoardConfirmViewModel.swift` (selectedCaregiverID + enrichment.caregiverID 635, distance_km handling), `RideBoardCard.swift` (offerSentRow 445-453, 582-603; inlineActionRow alreadyRequested branch), `RideBoardPage+Actions.swift` (withdrawOffer(offerID) handler), `BoardOfferEndpoints.swift` (`WithdrawBoardOfferEndpoint`)
- **Web files to touch:** `src/components/schedule/RideBoardConfirmSheet.tsx` (mount `CaregiverPickerSection` on rider-on-driver-post branch with gating predicate), `src/lib/scheduleBoard.ts` (extend `RequestEnrichment` with `caregiver_id` + `distance_km`), `src/components/schedule/RideBoardCard.tsx` (add Offer Sent badge + Withdraw branch when `my_offer_id && !ride_id`), `src/components/schedule/RideBoard.tsx` (wire `withdrawOffer` action calling `POST /api/schedule/board/offers/:offerId/withdraw`; widen `ScheduledRide` type to declare `my_offer_id`), `src/test/schedule/RideBoardConfirmSheet.caregiverPicker.test.tsx` (new), `src/test/schedule/RideBoardCard.withdrawOffer.test.tsx` (new)
- **Server contract:** `POST /api/schedule/request` accepts `caregiver_id` + `distance_km` in enrichment (already wired for Schedule flow per Sprint 6 Slice 3 — board flow uses same endpoint). `GET /api/schedule/board` returns enriched `ride.my_offer_id` (verified at `schedule.ts:544`). `POST /api/schedule/board/offers/:offerId/withdraw` returns `{offer_id, status: 'withdrawn'}` per mig 072 + v1.2.1 S2.
- [ ] `CaregiverPickerSection` mounts in confirm sheet on rider-on-driver-post branch with correct gating
- [ ] `caregiver_id` + `distance_km` reach the `POST /api/schedule/request` payload (asserted via test on the fetch body)
- [ ] `RideBoardCard` renders Offer Sent badge + Withdraw button when `ride.my_offer_id && !ride.ride_id`
- [ ] Withdraw success refetches board + clears `my_offer_id` locally
- [ ] vitest covers both surfaces incl. negative cases (no caregivers → no picker, no `my_offer_id` → no Offer Sent row)
- [ ] All 3 gates green; reviewer parity matrix
- **Dependencies:** Slice 5 (touches `RideBoardCard` avatar wiring — sequence to avoid conflicts)

### Open questions (need Tarun's call before or during Sprint 10)

1. **Slice 4 sizing** — if the mini-map + peek + 'Use this stop' grows past ~600 LoC including tests, split into 4a (map render only, no peek state) and 4b (peek + 'Use this stop' commit). Sprint cap goes to seven slices in that case. Confirm at slice 4 kickoff whether to pre-split or grow-and-see.
2. **Slice 5 self-preview** — should the avatar on the rider's own posts (`isOwn=true`) also open the preview sheet (self-preview, useful for QA + "how others see me") or stay non-tappable to match iOS? iOS `RideBoardCard.swift:175-220` gates `posterAvatar` tap on `!isOwn`. **Default: match iOS** (non-tappable on own posts) unless Tarun wants the web-native upgrade.
3. **Slice 6 empty-caregivers behavior** — does iOS suppress `CaregiverPickerSection` when rider has `has_accessibility_needs=true` but no caregivers attached (showing nothing vs an "Add a caregiver" CTA)? iOS gating predicate at `RideBoardConfirmSheet.swift:54-115` is `hasAccessibilityNeeds && needsWheelchair && !caregivers.isEmpty` — confirm behavior matches when the array is empty (silent suppression, not a CTA).
4. **Sprint 11 candidates** pulled from this audit's defer pile: **(a)** `RideBoardCityChipStrip` with re-tap-to-clear (low-impact polish); **(b)** realtime polling fallback if ops sees stuck-card reports (defer until evidence); **(c)** `RideBoardHome` hero-title animation + mode-pill visual treatment polish; **(d)** `FareEducatorInlineCard` + `FareEducatorTracker` on `RideBoardDetailSheet` — promoted to MEDIUM severity per shape-critic but bound to Sprint 11 because Sprint 10 is already at six slices. **Tarun confirm if FareEducator should pre-empt one of the lower-value Sprint 10 slices instead.**
5. **Slice 3 refactor risk** — `TransitSuggestionCard` has a non-trivial `cardRefs` scroll-sync mechanism (line 108) that may not lift cleanly into `RideMapPrimitive`. If extraction reveals coupling that can't be cleanly broken, fall back to creating a thinner `RideMapPrimitive` that handles only pins + bounds-fit, and leave scroll-sync inside `TransitSuggestionCard`. Reviewer pass at end of Slice 3 must confirm zero behavior change.

### Verifier deltas applied to the draft plan

**Added Slice 6's `CaregiverPickerSection` subscope** because completeness critic + shape critic both flagged it: iOS `RideBoardConfirmSheet.swift:54-115` + `RideBoardConfirmViewModel.swift:635` mount the picker and fold `caregiver_id` into enrichment, while web `RideBoardConfirmSheet` has no picker. Verified by direct grep of iOS `.swift` files. Promoted from MEDIUM to HIGH severity in the matrix.

**Dropped the previous Slice 5(a) "caregiver-waiver banner on `RideBoardConfirmSheet`"** that was in the draft. Shape critic flagged it as inventing a feature; my own verification (grep `waive`/`waiver` across `RideBoardConfirmSheet.swift` + `RideBoardOfferSections.swift` + `RideBoardConfirmViewModel.swift`) returned zero matches — banner only exists on iOS in `BoardOfferAcceptPage` and `UserProfilePreviewCard`. Building it on the confirm sheet would violate the "copy from iOS as close as possible" hard rule.

**Added Slice 3 (pure refactor extracting `RideMapPrimitive` from existing `TransitSuggestionCard`)** because shape critic correctly flagged the AUDIT-before-create violation in the original Slice 3 plan (which proposed building `RideBoardTransitMiniMap` from scratch). Verified `TransitSuggestionCard.tsx` ships `@vis.gl` Map + AdvancedMarker + MapBoundsFitter at lines 79-300. Slice 3 becomes the dependency for the now-Slice-4 confirm-sheet mini-map.

**Resequenced per shape critic:** original Slice 2 (`proposed_transit_*` offer card render) promoted to Slice 1 — zero dependencies, ~150 LoC, smallest, highest-value. Original Slice 1 (reverse-handoff) becomes Slice 2 because it requires confirm-sheet pickup pre-fill + role-gate handling.

**Narrowed Slice 2 (reverse-handoff) framing** per shape critic: removed the "web `TransitHandoffCard` only shows total minutes" claim — verified `RideBoardHome.tsx:775-778` already renders `line_name` + walk/ride/total. The real gap is the `MatchBadge` variant + type union + confirm pre-fill, not the handoff card itself. Added an explicit DoD test for the rider-as-actor `/become-driver` gate edge case shape critic raised.

**Promoted `FareEducatorInlineCard`** from LOW (deferred polish) to MEDIUM in the matrix per shape critic — iOS `RideBoardDetailSheet.swift:93` mounts it always (except own posts). Did NOT add it as a Sprint 10 slice because (a) Sprint 10 is already at six slices, (b) it's lower-value than the booking-loop slices already scoped, (c) it's self-contained enough to ship cleanly in Sprint 11. Called out explicitly in openQuestion #4.

**Did NOT fold in** completeness critic's miss about the iOS `.reverseTransitHandoff` enum case "not existing" — verified the case IS named in iOS source per the 2026-05-21 comment at `RideBoardHomePage.swift:837-842`. The gap is on web (`boardSearch.ts` type union missing the variant), not on iOS. Slice 2 framing is correct.

**Did NOT fold in** completeness critic's miss about iOS `RideBoardCityChipStrip` and recent-search UI elements — these are LOW severity polish per shape critic and deferred to Sprint 11. Sprint 10 caps at six slices.

**Did NOT fold in** completeness critic's miss about `RideBoardConfirmSheet` `PermissionsRequiredSheet` (location + push gate). Verified web `RideBoardConfirmSheet.tsx` already does permissions gating via existing infra (`gateThenSubmit` pattern). Not a parity gap; not added as a slice.

**Dropped Mobility-aid pill, Accessibility filter, and `BoardOfferAcceptPage` `CaregiverWaiverBanner` rows** from active scope per all three verifiers — already shipped on web (Sprint 6 Slice 5 + Sprint 7 Slice 4). Kept the rows in the parity matrix tagged PARITY for auditable record but no Sprint 10 work attached.

**Server contract verifier (SHIP_AS_IS)** — no contract corrections needed. All slice `serverContract` fields verified live at the cited line numbers (`schedule.ts:544` `my_offer_id`, `schedule.ts:4983-4984` `proposed_transit_*`, `users.ts:338` public-profile route, `schedule.ts:1418/1427/2006/2226/2423/2609` reverse_transit_handoff, mig 086 caregivers).

**Added pre-flight parallel-session grep to Slice 5 DoD** per shape critic — Slice 5 touches `src/components/profile/` which is the active parallel webapp session lane (current `git status` shows their `WheelchairSection.tsx` WIP). Crosscutting note made explicit.

### Sprint 10 summary

| Status | Count |
|---|---|
| Not started | 6 slices |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

### Current focus

Awaiting Tarun's "go" on Slice 1 (`proposed_transit_*` render on `BoardOfferAcceptPage` offer card — smallest, zero-dependency, ~150 LoC). No code changes have shipped from this audit yet.

### Next action

If Tarun greenlights Slice 1: read [`ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift`](ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift) (focus on `transitStop()` + `transitLegPills()` at 653-728), [`ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift) (BoardOffer struct shape), then web [`src/components/ride/BoardOfferAcceptPage.tsx`](src/components/ride/BoardOfferAcceptPage.tsx) (current `BoardOffer` interface) end-to-end before any TypeScript. Confirm `git status` is clean of parallel-session WIP on `BoardOfferAcceptPage.tsx` at slice kickoff.

### Plain English

The Ride Board on web works — riders can search, see results, request rides, accept offers, all the basics. But iOS has gotten a bunch of polish on top that web is missing: (1) when a rider gets an offer where the driver is going to drop them at a transit station for the last leg, iOS shows the transit line name and walk + transit + total minutes right on the offer card; web shows the price + ETA only. (2) iOS has a new "reverse handoff" feature where a rider can take transit to meet the driver at a station (instead of the driver coming to them), and the smart-search highlights these matches with a "Meet via transit" badge; web's smart-search doesn't know this feature exists yet. (3) When picking which transit station to use, iOS shows a little map with numbered pins and lets you tap to peek; web shows a flat list of buttons. (4) Tapping the poster's photo opens a profile preview sheet on iOS; web's photos are decorative. (5) On the rider's "confirm this ride" sheet there's no way to attach a caregiver (a feature web already has on the regular request flow but forgot to mount on the Board), and a driver can't withdraw their own offer from the Board cards — they can only do it from a different screen.

Six slices, dependency-ordered. The first slice is the smallest (just rendering 4 extra text fields the server already sends), the trickiest is Slice 4 (the mini-map), and Slice 3 is a pure refactor to make Slice 4 cleaner. Sprint 10 sticks to six slices to keep the cadence sane; one more "fare-educator" surface from the audit is deferred to Sprint 11 unless Tarun wants it pulled in.

---

## Sprint 9 — Trips & segments (split-fare foundation) v1.3 parity

**Audit-first mode.** Stage 5 of the multi-stage iOS-parity audit completed 2026-05-30 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Headline

As of 2026-05-30, iOS has shipped the F17 Trips & Segments stack end-to-end (migrations 097/098): Rides tab with stacked-rider group cards, `MultiRiderListSection` in driver drawers, `MultiRiderSubtitle` pill on rider drawer, per-rider Trip Earnings + Your Share cards on `RideSummaryPage` with caregiver-fee badges and waiver-detection, multi-rider trip-completion panel, and a `TodaysAnytimeBanner` above the role filter. Web has solid 1:1 parity on the Rides-tab list/group/posted/routines/empty-state surfaces and on `DriverMultiRidePage` live operations (web actually **exceeds iOS** with proximity-sorted pickup ordering + GPS-weak banner), but is missing the **entire trip-summary fare-split layer**: no Your Share card, no per-rider Trip Earnings card with caregiver-fee badges or waiver-detection, no `MultiRiderSubtitle` pill on the rider drawer, no `TodaysAnytimeBanner`.

Crucially, **there is no server endpoint exposing `ride_rider_shares` / `ride_segments` to any client yet** — iOS reads directly from Supabase via RLS-gated SELECT in `CoRidersFetcher`. Sprint 9 starts with a server contract before touching UI. The rest of the slices ship the lowest-risk standalone surface first (TodaysAnytimeBanner, zero server dependency) and split the largest driver-summary work into two halves so no single slice exceeds an ~800 LoC budget.

### Files read end-to-end during the audit

**iOS source-of-truth surface (~2,000 lines):**

Rides tab:
- [`ios/Tago/Features/Rides/RidesTabPage.swift`](ios/Tago/Features/Rides/RidesTabPage.swift) — main container; segmented role filter; Active / Posted-awaiting-match / Routines sections; empty state; PostTripFAB.
- [`ios/Tago/Features/Rides/RidesTabViewModel.swift`](ios/Tago/Features/Rides/RidesTabViewModel.swift) — `statusBadge` mapping (mirrors web `MyRidesPage.tsx:69-85`).
- [`ios/Tago/Features/Rides/MyRideCard.swift`](ios/Tago/Features/Rides/MyRideCard.swift) — single-ride card.
- [`ios/Tago/Features/Rides/MyRideGroupCard.swift`](ios/Tago/Features/Rides/MyRideGroupCard.swift) — multi-rider driver group with stacked avatars + combined names ("Alice & Bob +2") + per-rider chips + "Tap to manage riders →" affordance.
- [`ios/Tago/Features/Rides/TodaysAnytimeBanner.swift`](ios/Tago/Features/Rides/TodaysAnytimeBanner.swift) — anytime-ride day-of banner with three copy variants + warning stroke (opacity 0.32) + fill overlay (opacity 0.06).
- [`ios/Tago/Features/Rides/RoutineSummaryRow.swift`](ios/Tago/Features/Rides/RoutineSummaryRow.swift)

Multi-rider:
- [`ios/Tago/Features/MultiRider/MultiRiderListSection.swift`](ios/Tago/Features/MultiRider/MultiRiderListSection.swift) — driver drawer section with conditional header copy ("{N} aboard · {total} on this trip" vs "{total} riders on this trip") + 3 status pill labels (En route / Aboard / Dropped off) + "Trip earnings so far" footer.
- [`ios/Tago/Features/MultiRider/MultiRiderSubtitle.swift`](ios/Tago/Features/MultiRider/MultiRiderSubtitle.swift) — rider-drawer capsule pill with phase-aware copy: "Shared trip · N others on this route" (coordinating phase) / "Shared ride · N others aboard" (active phase). `person.2.fill` icon, primary-color background at 10% opacity.
- [`ios/Tago/Features/MultiRider/CoRider.swift`](ios/Tago/Features/MultiRider/CoRider.swift) — co-rider model.
- [`ios/Tago/Features/MultiRider/CoRidersFetcher.swift`](ios/Tago/Features/MultiRider/CoRidersFetcher.swift) — RLS-gated Supabase-direct SELECT against `ride_segments` + `trips`. Returns ALL riders ever on the trip (including those already dropped off), excluding the caller.

Driver multi-rider completion:
- [`ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift`](ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift) — hero-then-list completion panel: checkmark hero + "All riders dropped off" (both hero copy AND subtitle) + total earnings (27pt green) + "PER-RIDER SUMMARY" label (heavy weight, tracked) + tappable rows + Done button.

Per-rider summary cards (on `RideSummaryPage.swift`):
- Rider "Your share" card (lines 274-276, 982-1057, 1042-1046) — three-way segment label grammar: "Solo · X.X mi" (0 others), "With 1 other · X.X mi" (1 other), "With N others · X.X mi" (2+ others). Then base share / caregiver seat / companion seat / "Your total" rows.
- Driver "Trip earnings" card (lines 1073-1155, 1242-1260) — per-rider rows with avatar + name + "To: {dest}" + distance shared + "+caregiver $X" badge (when `caregiver_share_cents > 0`); waiver-detection edge case showing "Caregiver seat fee waived by driver" + heart icon when `persistedTotal <= baseSum`.

**Server + migrations (~944 lines):**

- [`supabase/migrations/097_trips_and_segments.sql`](supabase/migrations/097_trips_and_segments.sql) (218 lines) — `trips` table + `ride_segments` + `ride_rider_shares` + columns added to `rides` (trip_id, segment_id, is_first_segment, is_last_segment); RLS policies (lines 110-117, 146-159, 207-208).
- [`supabase/migrations/098_backfill_trips.sql`](supabase/migrations/098_backfill_trips.sql) (95 lines) — backfills each historical ride to its own trip row (multi-rider history gets multiple trip rows, no shared parent).
- [`server/lib/trips.ts`](server/lib/trips.ts) (221 lines) — `getOrCreateTripForRide()` called from `/start` and `/end` handlers.
- [`server/lib/segments.ts`](server/lib/segments.ts) (411 lines) — `computeRiderTotals` (server-canonical fare split math; folds `caregiver_share_cents` in per Sprint 6).
- [`server/routes/rides.ts`](server/routes/rides.ts) — `/start` calls `getOrCreateTripForRide` (line ~3845), `/end` calls it again (line ~4034) + `computeRiderTotals` finalizes shares. **No `/share-details` endpoint exists yet.**

**Web user-facing surface (audit result):**

At parity:
- [`src/components/ride/MyRidesPage.tsx`](src/components/ride/MyRidesPage.tsx) — Active / Posted-awaiting-match / Routines sections + segmented role filter with counts (`MyRidesPage.tsx:319-518`). `listItems` folding logic for stacked-rider groups (`MyRidesPage.tsx:524-619`).
- [`src/components/ride/DriverMultiRidePage.tsx`](src/components/ride/DriverMultiRidePage.tsx) — driver live operations view (web exceeds iOS with proximity-sorted pickup ordering + GPS-weak banner).
- [`src/components/ride/MultiDriverMap.tsx`](src/components/ride/MultiDriverMap.tsx) — multi-rider map.
- [`src/components/ride/DriverGroupChatPage.tsx`](src/components/ride/DriverGroupChatPage.tsx) — group chat (wired from `DriverMultiRidePage`).

Missing entirely:
- ❌ No `TodaysAnytimeBanner` on `MyRidesPage` (anytime label only appears inline on the posted-schedule row at `MyRidesPage.tsx:438`).
- ❌ No `MultiRiderSubtitle` pill on `RiderActiveRidePage` (rider has zero visual cue they're on a shared trip).
- ❌ No "Your share" card on `RideSummaryPage` for riders — only single fare total displayed.
- ❌ No driver "Trip earnings" card with per-rider breakdown + caregiver-fee badge + waiver detection (`DriverMultiSummaryFlow.tsx` shows per-rider rating + final total but no `caregiver_share` breakout, no per-rider distance-shared, no waiver copy).
- ❌ `DriverMultiSummaryFlow.tsx` is a **stepper** that walks rider-by-rider — iOS uses hero-then-list pattern.
- ❌ No `GET /api/rides/:id/share-details` endpoint.

### Side-by-side parity matrix

| Surface | iOS | Web | Severity |
|---|---|---|---|
| **Rides tab role filter** | Segmented picker with conditional "• N" bullet suffix (Unicode •) only when count > 0 | Segmented filter with counts present | ➖ PARITY (verify Unicode bullet in reviewer) |
| **Rides tab three sections + empty state** | Active / Posted / Routines rendered conditionally; role-aware empty state | Same three sections + same empty state | ➖ PARITY |
| **`MyRideGroupCard`** | Stacked avatars, "Name1 & Name2 +N", worst-status badge, per-rider chips, "Tap to manage riders →" affordance, "You are the driver · N riders" fallback | Same `listItems` folding logic with stacked avatars + per-rider chips | ➖ PARITY (verify affordance + fallback verbatim) |
| **`TodaysAnytimeBanner`** | Sun-icon banner with three copy variants (single / multi / destination-missing fallback) + trailing chevron + dual warning overlay (stroke 0.32, fill 0.06) | No equivalent | ⚠️ MEDIUM — tied to 9AM server push (mig 059); iOS shows in-app reinforcement, web only relies on push |
| **`MultiRiderSubtitle` pill** | Capsule pill: "Shared trip · N others on this route" (enroute) → "Shared ride · N others aboard" (active); `person.2.fill` icon, primary at 10% opacity | Not rendered on `RiderActiveRidePage` | 🚨 HIGH — rider has no visual cue they're on a shared trip; requires `/share-details` endpoint |
| **`MultiRiderListSection` in driver drawer** | Header "{N} aboard · {total} on this trip" / "{total} riders on this trip"; status pills (En route / Aboard / Dropped off); "Trip earnings so far" footer | Web has full-page `DriverMultiRidePage` but lacks drawer integration + earnings-so-far footer + conditional header copy | LOW — acceptable as web-native full-page variant for Sprint 9; deferred |
| **Rider "Your share" card** | Renders only when share exists AND segments not empty; per-segment "Solo · X.X mi" / "With 1 other" / "With N others" grammar + base/caregiver/companion line items + "Your total" | Single fare total only; no per-segment breakdown, no line items | 🚨 **CRITICAL** — requires `/share-details` |
| **Driver "Trip earnings" card** | Per-rider rows with avatar + name + "To: {dest}" + distance shared + "+caregiver $X" badge + waiver-detection edge case "Caregiver seat fee waived by driver" with heart icon | Per-rider rating + final total only; no caregiver break-out, no waiver copy | 🚨 HIGH — requires `/share-details` + redesign of driver final-summary surface |
| **Multi-rider trip-completion panel** | Hero + "All riders dropped off" (both hero AND subtitle) + total earnings (27pt green) + "PER-RIDER SUMMARY" label + tappable rows + Done button | `DriverMultiSummaryFlow.tsx` is a stepper walking rider-by-rider | ⚠️ MEDIUM — per "copy iOS UX first": replace stepper with hero-then-list, keep deep-link drill-in as web-native upgrade |
| **Group Chat entry on multi-rider trips** | Outline button at bottom of `DriverMultiRidePage` when `riders.count > 1` | `DriverGroupChatPage` wired from `DriverMultiRidePage` | ➖ PARITY |
| **Server endpoint for trip + segments + shares** | iOS reads Supabase direct via RLS-gated SELECT in `CoRidersFetcher` | No equivalent; web has no direct-read path and no REST endpoint | 🚨 **CRITICAL** — must add `GET /api/rides/:id/share-details` (active + completed phases) |
| **Server-derived trip creation (trip_id read-only)** | Trips created server-side via `getOrCreateTripForRide()` in `/start` + `/end` handlers; `trip.kind = 'board' if schedule_id else 'instant'` | Same backend, no client action needed | ➖ PARITY (web MUST NOT POST/PATCH/DELETE trips) |

### Cross-cutting notes (apply to every slice)

- **Server contract — trips/segments/shares are server-canonical reads.** `/share-details` returns precomputed values from `ride_rider_shares` (written by `computeRiderTotals` at `/end`). Web MUST consume `base_share_cents` / `caregiver_share_cents` / `companion_share_cents` / `total_cents` verbatim. Web IS allowed to derive PRESENTATIONAL helpers (distance-shared per rider from `segments[].distance_meters`, solo-vs-shared label from `active_rider_ids.length`, per-segment per-rider split as `totalCents / denom` — same client-side pattern iOS uses at `RideSummaryPage.swift:1040`) but **never re-derive canonical money values**.
- **Server contract — `trip_id` is read-only on the wire.** Trips are server-derived inside `getOrCreateTripForRide()` called from `/start` and `/end` handlers (`rides.ts:3845-3851, 4034-4036`). Web client MUST NOT POST/PATCH/DELETE trips or segments. `trip_id` may be null on pre-097 backfilled rides — `/share-details` returns 404 in that case and the UI gracefully hides (per Slice 3 DoD).
- **Server contract — `/share-details` supports both active and completed phases** (Slice 2 DoD). During active phase, `shares[]` may be partial or empty (a rider not yet dropped off has no row yet). UI consumers (Slice 5 SURFACE B) MUST handle empty `shares[]` without throwing.
- **Copy is verbatim from iOS `.swift` files** for every label, headline, empty state, pill, and badge in Slices 1, 3, 4, 5. No web-only copywriting permitted in this sprint. Specific verbatim sets to match: `TodaysAnytimeBanner` three copy variants (Slice 1), three segment grammar variants (Slice 3), caregiver-waiver copy + heart icon (Slice 4), "Shared trip/ride · N others on this route/aboard" (Slice 5 SURFACE B), "All riders dropped off" + "PER-RIDER SUMMARY" (Slice 5 SURFACE A).
- **All colors via `src/lib/tokens.ts`** — no raw hex anywhere in the new banners, cards, badges, pills, or hero. iOS tone colors (warning=orange, success=green, primary=brand-blue, neutral=gray) map onto the existing token palette.
- **All `*_cents` fields stay as integers in TypeScript types** per CLAUDE.md money rule; only the formatter at render time converts to dollars. Never store fare values as floats.
- **Every new component must accept `data-testid`** (CLAUDE.md convention) and ideally match the iOS accessibility ID where one exists (e.g. `rides-anytime-today-banner`, `rideSummary.yourShareCard`, `rideSummary.tripEarningsCard`, `multiRide.subtitle`).
- **NO new analytics events in this sprint** unless iOS has a matching PostHog/event call in the source files for the same surface. If a follow-up iOS analytics audit reveals events for trip-summary surfaces, add as a Sprint 10 polish slice — do not bundle into Slices 3/4/5.

### Sprint 9 slice plan

Per the per-feature green-light + tough-self-review-before-handoff + reviewer parity-check hard rules. Every slice ends with lint + tests + build green + reviewer parity matrix + commit + wait for Tarun's "go" before shipping the next.

#### Slice 1 — Web: `TodaysAnytimeBanner` on `MyRidesPage` (zero-server-dependency early win)

Add a banner component to `src/components/ride/MyRidesPage.tsx` rendered above the role-filter segmented control when the user has at least one active ride with `time_flexible=true` AND `trip_date` equals today's local-tz date. THREE verbatim copy variants from `TodaysAnytimeBanner.swift:61-74`: **(1)** single-ride "Today's the day!" + "Your anytime ride to {dest_address} is scheduled today.", **(2)** multi-ride "Today's the day — {N} anytime rides" + "Open Tago when you're ready to head out.", **(3)** destination-missing fallback "Today's the day!" + "Your anytime ride is scheduled today. Open Tago when you're ready to head out." Sun icon (warning tint), trailing right chevron affordance, warning-tinted background composed of TWO overlays per iOS lines 98/102: stroke at `tokens.warning` at opacity 0.32 lineWidth 1 + fill at `tokens.warning` at opacity 0.06. `data-testid='rides-anytime-today-banner'` matching iOS accessibility ID. Tap is a no-op for v1 (iOS also relies on user opening the relevant card next). Date comparison via the user's local tz, NOT UTC. Component lives in its own file to minimize `MyRidesPage` merge surface (flag at slice-kickoff per parallel-admin lane rule — insertion point should be a single one-liner).

- **iOS reference:** [`TodaysAnytimeBanner.swift`](ios/Tago/Features/Rides/TodaysAnytimeBanner.swift), [`RidesTabPage.swift`](ios/Tago/Features/Rides/RidesTabPage.swift)
- **Web files to touch:** `src/components/ride/MyRidesPage.tsx`, `src/components/ride/TodaysAnytimeBanner.tsx` (new), `src/lib/anytime.ts` (new — local-tz today predicate), `src/test/ride/TodaysAnytimeBanner.test.tsx` (new)
- **Server contract:** No new server contract. Consumes existing `GET /api/rides/active` fields: `time_flexible` (boolean), `trip_date` (date), `schedule.dest_address`. All already returned by `rides.ts:5814-5817`.
- [ ] Banner renders for `time_flexible=true` rides scheduled today, hidden otherwise
- [ ] All three verbatim copy variants (single / multi / fallback) correct vs `TodaysAnytimeBanner.swift` lines 61-74
- [ ] Trailing chevron present and warning stroke + fill overlay composition matches iOS opacity values
- [ ] Local-tz comparison correct across midnight + DST edge cases (Vitest with fake-timers)
- [ ] All colors via `src/lib/tokens.ts`, zero raw hex
- [ ] `data-testid='rides-anytime-today-banner'` matches iOS accessibility ID
- [ ] `MyRidesPage` insertion is a single one-liner above the role filter (minimizes merge surface vs parallel sessions)
- [ ] `npm test` passes, `npm run lint` zero errors, `npm run build` succeeds
- [ ] Reviewer parity matrix against `TodaysAnytimeBanner.swift` attached to handoff

#### Slice 2 — Server: `GET /api/rides/:id/share-details` endpoint (supports BOTH active and completed phases)

Add a single read endpoint returning canonical settlement payload for ANY ride that has a `trip_id` (active or completed). Payload: `{ trip: {id, kind, started_at, ended_at, gps_distance_metres, gas_cost_cents, time_cost_cents}, segments: [{segment_index, started_at, ended_at, distance_meters, active_rider_ids, gas_cost_cents, time_cost_cents}], co_riders: [{rider_id, full_name, avatar_url, destination_name}], shares: [{rider_id, base_share_cents, caregiver_share_cents, companion_share_cents, total_cents, segments_in_count, payment_status}] }`. RLS-equivalent gating: 403 unless caller is `driver_id` on the trip OR `rider_id` on any of the trip's rides (mirrors RLS in `097:110-117, 146-159, 207-208`). Reads from `ride_rider_shares` + `ride_segments` + `trips` — does NOT call `computeRiderTotals` (math is finalized server-side at `/end`).

**Active-phase semantics:** `shares[]` MAY be empty or partial (a rider not yet dropped off has no row yet — handle gracefully), `segments[]` includes all segments including the currently-open one with `ended_at=null`. `co_riders` includes EVERY rider ever on the trip (including those who already completed), NOT just those overlapping with caller in a segment — iOS `CoRidersFetcher` reads the full set. Returns 404 if `ride.trip_id IS NULL` (pre-097 backfill miss). Pre-097 backfilled historical multi-rider rides each got their own `trip` row, so they'll return 200 with a single-rider `shares[]` and a single-segment `segments[]` — acceptable degraded summary, no special marker.

- **iOS reference:** [`CoRidersFetcher.swift`](ios/Tago/Features/MultiRider/CoRidersFetcher.swift), `ios/Tago/Features/RiderHome/RideSummaryPage.swift`, [`DriverMultiRidePage+TripComplete.swift`](ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift)
- **Web files to touch:** `server/routes/rides.ts`, `server/lib/segments.ts` (read-only import), `src/test/server/rides.shareDetails.test.ts` (new)
- **Server contract:** `GET /api/rides/:id/share-details → 200 { trip: {id: UUID, kind: 'instant'|'board', started_at: ISO8601, ended_at: ISO8601|null, gps_distance_metres: number, gas_cost_cents: number, time_cost_cents: number}, segments: [{segment_index: number, started_at: ISO8601, ended_at: ISO8601|null, distance_meters: number, active_rider_ids: UUID[], gas_cost_cents: number, time_cost_cents: number}], co_riders: [{rider_id: UUID, full_name: string, avatar_url: string|null, destination_name: string|null}], shares: [{rider_id: UUID, base_share_cents: number, caregiver_share_cents: number, companion_share_cents: number, total_cents: number, segments_in_count: number, payment_status: 'pending'|'paid'|'processing'|'failed'}] }`. 403 on non-participant. 404 ONLY when `ride.trip_id IS NULL`. Auth: `validateJwt`. READ-ONLY — no write surface.
- [ ] Endpoint returns 200 with full payload for COMPLETED multi-rider ride
- [ ] Endpoint returns 200 with possibly-partial `shares[]` for ACTIVE multi-rider ride (Slice 5 SURFACE B requires this)
- [ ] Endpoint returns 200 with single-rider `shares[]` for solo trip (consumers use `shares.length` to detect solo vs multi)
- [ ] Returns 403 for non-participants (Vitest with mocked auth)
- [ ] Returns 404 when `ride.trip_id IS NULL` (pre-097 backfill miss path)
- [ ] Co-rider list omits the caller themselves
- [ ] Co-rider list includes riders who have already been dropped off (matches iOS `CoRidersFetcher` read scope)
- [ ] Mid-trip ride with no shares row yet: `shares[] = []` for that rider (does NOT 500)
- [ ] `npm test` passes, `npm run lint` zero errors, `npm run build` succeeds

#### Slice 3 — Web: "Your share" card on `RideSummaryPage` (rider) + shared `useShareDetails` React Query hook

Create `src/lib/shareDetails.ts` exporting a React Query hook `useShareDetails(rideId, { enabled })` and typed response interfaces — built generic enough to be consumed unchanged by Slice 5 SURFACE B's `MultiRiderSubtitle` pill. Then add a Glass "Your share" card to `src/components/ride/RideSummaryPage.tsx` that renders when `/share-details` returns `shares.length >= 2` AND `segments.length > 0` AND viewer is a rider (matches dual-guard in `RideSummaryPage.swift:274-276`).

Header: `person.2`-equivalent icon + "Your share" + "{segments_in_count} leg(s)". Per-segment rows computed from `segments[]` filtered to those whose `active_rider_ids` includes viewer, with THREE verbatim grammar variants from `RideSummaryPage.swift:1042-1046`: **"Solo · X.X mi"** (0 others), **"With 1 other · X.X mi"** (1 other, singular), **"With N others · X.X mi"** (2+ others, plural). Per-segment per-rider share derived presentationally as `totalCents / denom` (iOS does this client-side at line 1040 — same pattern allowed on web; this is presentation math, NOT canonical fare math). Totals rows: "Base share" (always), "Caregiver seat" (only if `caregiver_share_cents > 0`), "Companion seat" (only if `companion_share_cents > 0`), "Your total" bold. Solo trip (`shares.length=1`) → card hidden. Pre-097 ride returning 404 from `/share-details` → card hidden (NOT a thrown error — silent graceful degradation).

- **iOS reference:** `ios/Tago/Features/RiderHome/RideSummaryPage.swift`, [`CoRidersFetcher.swift`](ios/Tago/Features/MultiRider/CoRidersFetcher.swift)
- **Web files to touch:** `src/components/ride/RideSummaryPage.tsx`, `src/lib/shareDetails.ts` (new — React Query hook + types, designed for reuse by Slice 5 with `{ enabled }` gate), `src/test/ride/RideSummaryPage.yourShare.test.tsx` (new)
- **Server contract:** Consumes `GET /api/rides/:id/share-details` from Slice 2. No new server work.
- [ ] Card renders for rider on completed multi-rider trip with correct per-segment labels (all three grammar variants tested)
- [ ] Card hidden for solo trips (`shares.length=1`)
- [ ] Card hidden when viewer is driver
- [ ] Card hidden on 404 (pre-097 backfill miss) — graceful degradation, no thrown error in console
- [ ] Caregiver / companion line items only render when their cents > 0
- [ ] Per-segment per-rider share derivation matches iOS computation pattern (presentational, not canonical)
- [ ] All colors via `tokens.ts`, no raw hex; every interactive element has `data-testid`
- [ ] Vitest snapshot + behavior tests for solo / 2-rider / 3-rider / 404 / caregiver-only / companion-only variants
- [ ] `useShareDetails` hook accepts `{ enabled: boolean }` option so Slice 5 can gate by phase without forking
- [ ] Reviewer parity matrix against `RideSummaryPage.swift` attached to handoff
- **Dependencies:** Slice 2

#### Slice 4 — Web: "Trip earnings" card on `RideSummaryPage` driver branch (per-rider breakdown + caregiver-fee badge + waiver detection)

Add a sibling "Trip earnings" card on `src/components/ride/RideSummaryPage.tsx` that renders when viewer is the driver AND `/share-details` returns `shares.length >= 2`. Header: `person.3`-equivalent icon + "Trip earnings" + "{N} rider(s)". Per-rider rows from `/share-details.shares` joined to `co_riders`: avatar (44x44 circle, initials fallback), name, "To: {destination_name}", distance shared (computed client-side from segments where rider in `active_rider_ids`), **"+caregiver $X" badge** when `caregiver_share_cents > 0` (icon + `tokens.primary` color), trailing earnings "+${total_cents/100}" in heavy green.

**Caregiver-fee-waived edge case** from iOS `RideSummaryPage.swift:1242-1260`: when `total_cents <= base_share_cents + per-rider gas_share + per-rider time_share` (i.e. driver waived the caregiver fee), render **"Caregiver seat fee waived by driver"** with `heart.fill` icon INSTEAD of the +caregiver badge. Footer divider + "Total earnings" label + summed total in heavy green. Per-rider row tappable → opens `/ride/{ride_id}/summary` (web-native deep-link upgrade on top of iOS `fullScreenCover`). **Slice 4 DOES NOT replace `DriverMultiSummaryFlow.tsx`** — that redesign is Slice 5 to keep this slice bounded.

- **iOS reference:** `ios/Tago/Features/RiderHome/RideSummaryPage.swift` (lines 1073-1155, 1242-1260), [`DriverMultiRidePage+TripComplete.swift`](ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift)
- **Web files to touch:** `src/components/ride/RideSummaryPage.tsx`, `src/test/ride/RideSummaryPage.tripEarnings.test.tsx` (new)
- **Server contract:** Consumes `GET /api/rides/:id/share-details` from Slice 2. Distance-shared per rider derived client-side from `segments[].active_rider_ids` and `segments[].distance_meters` (read-only computation, NOT fare math).
- [ ] Card renders for driver on completed multi-rider trip with all co-riders surfaced
- [ ] "+caregiver $X" badge renders iff `caregiver_share_cents > 0` AND waiver predicate is false
- [ ] "Caregiver seat fee waived by driver" + `heart.fill` renders when waiver predicate is true (per iOS lines 1242-1260)
- [ ] Total earnings = sum of `shares.total_cents`
- [ ] Per-rider row routes to `/ride/{ride_id}/summary` on click (verify existing route accepts any participant `ride_id`, not just viewer's own)
- [ ] All colors via `tokens.ts`, no raw hex
- [ ] Vitest tests for 2-rider, 3-rider, 2-rider-with-caregiver, 2-rider-with-waived-caregiver variants
- [ ] Reviewer parity matrix against `RideSummaryPage.swift` (1073-1155, 1242-1260) attached to handoff
- **Dependencies:** Slice 2

#### Slice 5 — Web: Redesign `DriverMultiSummaryFlow` to iOS hero-then-list + `MultiRiderSubtitle` pill on `RiderActiveRidePage`

TWO related surfaces bundled because they share the same data source (`/share-details`) and the same reviewer-parity scope (multi-rider read surfaces).

**SURFACE A — `DriverMultiSummaryFlow.tsx` replacement:** replace the existing stepper with the iOS hero-then-list pattern from `DriverMultiRidePage+TripComplete.swift:60-255`: checkmark hero + "All riders dropped off" as both hero copy AND subtitle + total earnings (large green) + "PER-RIDER SUMMARY" label (heavy, tracked) + tappable per-rider rows with avatar, name, destination, trailing earnings, dividers between rows + Done button. Tappable rows route to `/ride/{ride_id}/summary` (Slice 4's deep-link).

**SURFACE B — `MultiRiderSubtitle` pill on `RiderActiveRidePage.tsx`** (and `JourneyDrawer` if separate): render a capsule pill via the Slice 3 `useShareDetails` hook with `{ enabled: ride.status in ['coordinating','active'] }`. Two verbatim copy variants from `MultiRiderSubtitle.swift:22-30`: enroute phase **"Shared trip · {N} others on this route"**, active phase **"Shared ride · {N} others aboard"**. `person.2.fill` equivalent icon, `tokens.primary` background at 10% opacity. Hidden when `co_riders.length < 1` OR `/share-details` 404s.

- **iOS reference:** [`DriverMultiRidePage+TripComplete.swift`](ios/Tago/Features/DriverHome/DriverMultiRidePage+TripComplete.swift), [`MultiRiderSubtitle.swift`](ios/Tago/Features/MultiRider/MultiRiderSubtitle.swift), `ios/Tago/Features/RiderHome/RiderActiveRideState.swift`
- **Web files to touch:** `src/components/ride/DriverMultiSummaryFlow.tsx`, `src/components/ride/RiderActiveRidePage.tsx`, `src/components/ride/JourneyDrawer.tsx` (if used by rider), `src/test/ride/DriverMultiSummaryFlow.heroList.test.tsx` (new), `src/test/ride/RiderActiveRidePage.multiRiderSubtitle.test.tsx` (new)
- **Server contract:** Consumes `GET /api/rides/:id/share-details` from Slice 2 (active-phase support is what makes Surface B work — already in Slice 2's DoD).
- [ ] `DriverMultiSummaryFlow` rendered as iOS hero-then-list (not stepper); "All riders dropped off" present as both hero AND subtitle copy; "PER-RIDER SUMMARY" label in heavy weight
- [ ] Per-rider rows tappable, route to `/ride/{ride_id}/summary`; dividers between rows match iOS
- [ ] `MultiRiderSubtitle` pill renders "Shared trip · N others on this route" during coordinating phase and "Shared ride · N others aboard" during active phase (verbatim vs `MultiRiderSubtitle.swift:22-30`)
- [ ] Pill hidden for solo trips (`co_riders.length=0`) and on `/share-details` 404
- [ ] Pill updates on ride status realtime broadcast
- [ ] Colors via `tokens.ts` at 10% opacity for pill background, no raw hex anywhere
- [ ] Vitest tests: hero-then-list rendering vs stepper, pill copy variants for solo / 2-on-trip / 4-on-trip + phase transitions
- [ ] Reviewer parity matrix against `DriverMultiRidePage+TripComplete.swift` AND `MultiRiderSubtitle.swift` attached to handoff
- **Dependencies:** Slice 2, Slice 3

### Open questions (need Tarun's call before or during Sprint 9)

1. **Does the existing `/ride/{ride_id}/summary` route accept any participant `ride_id`** (not just the viewer's own)? Slice 4's per-rider row deep-link assumes yes; if not, Slice 4 DoD must add "allow any participant ride_id on the summary route" as an explicit sub-task.
2. **`/share-details` refresh logic in Slice 5 SURFACE B** (`MultiRiderSubtitle` pill) — poll on every ride status broadcast, or cache once and refresh only on explicit events (e.g. status transition coordinating→active)? iOS `CoRidersFetcher` fetches once on bootstrap and does not refresh live — same approach acceptable on web, but Realtime subscription is the more web-native option.
3. **Should the redesigned Slice 5 SURFACE A driver hero-then-list display `payment_status` per rider** as a "pending payment" badge (web-native upgrade)? iOS does not currently show this. `/share-details` exposes the field — answer is presentational only. **Default: do NOT show it in Sprint 9** to preserve iOS parity; revisit as Sprint 10 polish.
4. **`TodaysAnytimeBanner` on iOS is reinforced by the 9AM push notification** from migration 059. Does the web user receive the same push (FCM web), and should the banner suppress itself if the push was acknowledged? **Default for Sprint 9: always render regardless of push state** (iOS does the same — banner is in-app reinforcement of the push, not a substitute).
5. **DEFERRED to Sprint 10** (cut from Sprint 9 to keep ≤5 slices): `MultiRiderListSection` drawer integration + "Trip earnings so far" footer on driver's active-ride drawer overlay (web currently has this as a standalone `DriverMultiRidePage` view, which is web-native and acceptable for now). Severity LOW per parity matrix.
6. **DEFERRED to Sprint 10 backlog:** decide whether the web-only `DriverMultiRidePage` proximity-sorted pickup ordering + GPS-weak banner should be ported back to iOS, or whether it stays as a web-native enhancement. Currently web exceeds iOS here — not a parity gap, but worth a deliberate decision.

### Verifier deltas applied to the draft plan

RESEQUENCED per shape critic: `TodaysAnytimeBanner` promoted from Slice 5 to Slice 1 because it has zero server dependency and is the smallest/lowest-risk surface — gives an early win before the server-contract chain begins. Original Slice 1 (server endpoint) became Slice 2; original Slice 2 (Your Share card) became Slice 3; original Slice 3 (Driver Trip Earnings) was SPLIT per shape critic into Slice 4 (add Trip Earnings card to `RideSummaryPage` driver branch — bounded mirror of Slice 3) and Slice 5 (redesign `DriverMultiSummaryFlow` to iOS hero-then-list pattern). Slice 5 BUNDLES the `MultiRiderSubtitle` pill (originally Slice 4) with the `DriverMultiSummaryFlow` redesign because both consume `/share-details` and share the multi-rider reviewer-parity scope — keeps the sprint at **5 slices total** (within 3-6 bound).

Folded in from completeness critic: all three `TodaysAnytimeBanner` copy variants (single/multi/destination-missing-fallback) + trailing chevron + dual warning overlay composition; full "Shared trip/ride · N others on this route/aboard" verbatim labels (not truncated); all three segment grammar variants with explicit singular vs plural; caregiver-fee-waived edge case ("Caregiver seat fee waived by driver" + heart icon) which the original plan missed entirely; conditional header copy and three status pill labels for `MultiRiderListSection`; "Tap to manage riders" affordance and "You are the driver · N riders" fallback for `MyRideGroupCard`; Unicode bullet separator for `RidesTabPage` role filter.

Folded in from server-contract verifier: `/share-details` explicitly supports BOTH active and completed phases; 404 condition reworded from "ride is completed" to "trip_id IS NULL"; mid-trip ride with no shares row yet returns `shares[] = []` (does NOT 500); `co_riders` includes EVERY rider ever on the trip (matches iOS `CoRidersFetcher`); pre-097 backfilled rides return 404 silently with UI graceful-hide.

Folded in from shape critic: Slice 3 split into Slice 4 (Trip Earnings on `RideSummaryPage`) + Slice 5 (`DriverMultiSummaryFlow` redesign) — keeps each within ~800 LoC budget; shared `useShareDetails` hook lives in Slice 3 with `{ enabled }` option for Slice 5 reuse; open question about REPLACE-vs-LAYER for `DriverMultiSummaryFlow` was baked into Slice 5 scope as REPLACE (iOS-canonical, deep-link drill-in is the web-native upgrade) per CLAUDE.md "copy iOS UX first" rule; cross-cutting notes trimmed to sprint-specific contracts only (universal CLAUDE.md/MEMORY rules removed); Slice 1 DoD explicitly notes single-one-liner insertion to minimize merge surface with parallel sessions.

Did NOT fold in: shape critic's analytics-events slice (added a cross-cutting note + open question deferring iOS analytics audit to Sprint 10); completeness critic flag about `myOfferID` field added 2026-05-27 (out of Trips & Segments scope, belongs in a separate offer-mechanics sprint); completeness critic redundancy note about `iosReferenceFiles` files appearing in both Slice 3 and Slice 4 (different surfaces in the same `.swift` file — lines 982-1057 vs 1073-1155 — consolidating loses slice-by-slice traceability).

### Sprint 9 summary

| Status | Count |
|---|---|
| Not started | 5 slices |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

### Current focus

Awaiting Tarun's "go" on Slice 1 (`TodaysAnytimeBanner` — zero server dependency, smallest surface in the sprint). No code changes have shipped from this audit yet.

### Next action

If Tarun greenlights Slice 1: read [`src/components/ride/MyRidesPage.tsx`](src/components/ride/MyRidesPage.tsx) end-to-end + [`src/lib/tokens.ts`](src/lib/tokens.ts) for the warning palette + the iOS [`TodaysAnytimeBanner.swift`](ios/Tago/Features/Rides/TodaysAnytimeBanner.swift) end-to-end. Confirm `MyRidesPage` insertion point with `git status` (per parallel-admin lane rule) before any edits land.

### Plain English

iOS riders see two things web riders don't when they're on a shared ride (you and someone else in the same car going different places): a small badge on their drawer that says "Shared trip · 1 other on this route" so they know they're not alone, and after the ride a card called "Your share" that breaks down their fare into "Solo · 3 mi" / "With 1 other · 2 mi" / etc. so they understand exactly why they were charged what they were charged. iOS drivers see a different thing: a "Trip earnings" card that lists every rider, what each one paid them, and a "+caregiver $5" badge if a rider's caregiver came along. None of this exists on web. Also: iOS shows a "Today's the day!" banner on the rides tab when a rider has an anytime ride scheduled for today — web has nothing.

The web app also doesn't have a server endpoint that exposes any of this data — the iOS app reads it directly from the Supabase database using its own database connection. So Sprint 9 starts by building the endpoint (`GET /api/rides/:id/share-details`) and then four UI pieces consume it: rider's "Your share" card, driver's "Trip earnings" card with the caregiver badge, the rider-drawer "Shared trip" pill, and a redesign of the driver's multi-rider summary screen to match the iOS hero-then-list pattern instead of the current step-through.

Five slices, ordered so the first one ("Today's the day!" banner) has zero server dependency and ships immediately, then the server endpoint goes in, then the three UI consumers follow in order of payoff. **Awaiting your "go" on Slice 1.**

---

## Sprint 8 — Suggestions + rider routines v1.3 parity

**Audit-first mode.** Stage 4 of the multi-stage iOS-parity audit completed 2026-05-30 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Headline

As of 2026-05-30, iOS ships a full v1.3 Suggested Rides surface (rider home hero card + detail sheet + dismiss flow + lazy-routine action wiring) against six live server endpoints (`GET /api/suggestions/top`, `POST /api/suggestions/:id/dismiss`, `POST /api/suggestions/scan-routine/:id`, `POST /api/suggestions/purge-routine/:id`, `GET /api/suggestions/board` declared-but-unused, `POST /api/schedule/project-routine`, `GET /api/schedule/by-id/:id`), while web ships **ZERO** of it — riders on web cannot see, dismiss, or act on any suggestion the engine generates.

Secondary gaps: routine rows on web `ProfilePage` and `RideBoard` don't render the `mode` badge added by migrations 103/106, the `Add Routine` CTA hard-codes driver-mode pre-selection (rider-only users land on the wrong segment), and the `push_suggestions` notification pref toggle (migration 101 column already SELECTed by the server) is not exposed in web settings UI.

Two reciprocal observations: web is reading the unified `driver_routines` table correctly post-103 (no schema break — confirmed at `src/components/schedule/SchedulePage.tsx:607`), and web's existing `src/components/ride/RideSuggestion.tsx` is the **driver-side push-notification accept/decline page** — a completely different feature from iOS Suggestions (rider-facing match feed) — and must not be conflated.

### Files read end-to-end during the audit

**iOS source-of-truth surface (14 files, ~6,087 lines):**

Suggestions feature:
- [`ios/Tago/Features/Suggestions/SuggestedRidesHero.swift`](ios/Tago/Features/Suggestions/SuggestedRidesHero.swift) (292 lines) — hero card mounted on RiderHomePage in `.embedded` mode and (planned) DriverHomePage in `.floating` mode; `openConfirmSheet` flow drives CTA action with 350ms single-presentation-host delay workaround.
- [`ios/Tago/Features/Suggestions/SuggestedRideCard.swift`](ios/Tago/Features/Suggestions/SuggestedRideCard.swift) (431 lines) — compact card with classification badge (Same route / Transit dropoff / Transit pickup), dismiss X, avatar+name fallback, destination first-comma extraction, date/time with 'Anytime' for time_flexible, rating with 'New' fallback, role-aware CTA color + copy, `.light`/`.medium` UIImpactFeedbackGenerator haptics.
- [`ios/Tago/Features/Suggestions/SuggestionDetailSheet.swift`](ios/Tago/Features/Suggestions/SuggestionDetailSheet.swift) (649 lines) — `.medium`/`.large` detents, six-section layout (tripDateBanner / classificationBanner / otherUserCard / two tripCards with SourceSubtitle variants / transitBreakdownCard / matchSignalsCard / bottom CTA). Bottom CTA uses brand-primary blue for BOTH sides (line 52).
- [`ios/Tago/Features/Suggestions/SuggestionsNotifications.swift`](ios/Tago/Features/Suggestions/SuggestionsNotifications.swift) (12 lines) — `NotificationCenter.Name.suggestionsRefreshRequested` cross-surface refresh signal.

Routines feature:
- [`ios/Tago/Features/Schedule/RoutinesSheet.swift`](ios/Tago/Features/Schedule/RoutinesSheet.swift) (488 lines) — modal sheet with per-day grouping + sync badge ("X routine(s) synced to the board") + edit / delete actions.
- [`ios/Tago/Features/Schedule/RoutinesViewModel.swift`](ios/Tago/Features/Schedule/RoutinesViewModel.swift) (169 lines)
- [`ios/Tago/Features/Schedule/AddRoutinePromptCover.swift`](ios/Tago/Features/Schedule/AddRoutinePromptCover.swift) (175 lines) — full-screen cover that opens SchedulePostPage with `initialMode` pre-selected from `auth.isDriver`.
- [`ios/Tago/Features/Schedule/SchedulePostRoutineSection.swift`](ios/Tago/Features/Schedule/SchedulePostRoutineSection.swift) (208 lines)
- [`ios/Tago/Features/Schedule/SchedulePostViewModel.swift`](ios/Tago/Features/Schedule/SchedulePostViewModel.swift) (582 lines)
- [`ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift`](ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift) (1058 lines) — routine submission paths (single-day, recurring, projected).
- [`ios/Tago/Features/Profile/ProfileRoutinesSection.swift`](ios/Tago/Features/Profile/ProfileRoutinesSection.swift) (604 lines) — list with 'Driver' (teal) / 'Rider' (blue) mode badge per group, edit button → SchedulePostPage prefill.
- [`ios/Tago/Core/Supabase/Repositories/RoutinesRepository.swift`](ios/Tago/Core/Supabase/Repositories/RoutinesRepository.swift) (153 lines) — direct Supabase SDK CRUD against unified `driver_routines` table.
- [`ios/Tago/Models/DriverRoutine.swift`](ios/Tago/Models/DriverRoutine.swift) — unified routine model with `mode` discriminator.

Endpoints:
- [`ios/Tago/Core/Networking/Endpoints/SuggestionEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/SuggestionEndpoints.swift) (345 lines) — defines `TopSuggestions`, `DismissSuggestion`, `BoardSuggestions` (declared, unused on iOS), `ScanForRoutine`, `PurgeForRoutine` endpoint structs with full request/response decode shapes.
- [`ios/Tago/Core/Networking/Endpoints/PurgeRoutineSuggestionsEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/PurgeRoutineSuggestionsEndpoint.swift) (22 lines)
- [`ios/Tago/Core/Networking/Endpoints/SyncRoutinesEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/SyncRoutinesEndpoint.swift) (31 lines)
- [`ios/Tago/Core/Networking/Endpoints/ProjectRoutineEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ProjectRoutineEndpoint.swift) (39 lines) — `{ routine_id, trip_date: 'YYYY-MM-DD' } → { schedule_id, created }`.
- [`ios/Tago/Core/Networking/Endpoints/ScanRoutineEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ScanRoutineEndpoint.swift) (22 lines)

**Server + migrations (11 files, ~7,244 lines):**

Migrations:
- [`supabase/migrations/099_rider_routines.sql`](supabase/migrations/099_rider_routines.sql) (90 lines) — initial rider_routines table (later dropped in 103).
- [`supabase/migrations/100_ride_suggestions.sql`](supabase/migrations/100_ride_suggestions.sql) (133 lines) — `ride_suggestions` table with `match_type`, `relevance_score`, `match_signals` JSONB, `side`, `status`, rider/driver source columns.
- [`supabase/migrations/101_notification_preferences_push_suggestions.sql`](supabase/migrations/101_notification_preferences_push_suggestions.sql) (18 lines) — `notification_preferences.push_suggestions BOOLEAN DEFAULT true`.
- [`supabase/migrations/102_routine_addresses.sql`](supabase/migrations/102_routine_addresses.sql) (55 lines) — `origin_address` + `dest_address` columns on routines (nullable for pre-102 rows).
- [`supabase/migrations/103_unify_routines.sql`](supabase/migrations/103_unify_routines.sql) (97 lines) — **drops rider_routines table**, adds `mode` discriminator column to `driver_routines`, copies rider rows over.
- [`supabase/migrations/104_routine_groups.sql`](supabase/migrations/104_routine_groups.sql) (40 lines) — `routine_groups` table for per-day groupings.
- [`supabase/migrations/105_polyline_source.sql`](supabase/migrations/105_polyline_source.sql) (34 lines)
- [`supabase/migrations/106_routines_mode_drop_default.sql`](supabase/migrations/106_routines_mode_drop_default.sql) (36 lines) — `mode` NOT NULL no default; writes must specify explicitly.

Server routes:
- [`server/routes/suggestions.ts`](server/routes/suggestions.ts) (496 lines) — `GET /top`, `POST /:id/dismiss`, `POST /scan-routine/:id` (fire-and-forget engine trigger), `POST /purge-routine/:id` (ownership-checked cleanup), `GET /board`.
- [`server/routes/riderRoutines.ts`](server/routes/riderRoutines.ts) (270 lines) — POST creates routine and triggers `scanForRoutine` fire-and-forget; DELETE path needs audit for `purge-routine` parity.
- [`server/routes/schedule.ts`](server/routes/schedule.ts) (5,975 lines — only `project-routine` + `by-id` handlers in scope; verified path is `/api/schedule/by-id/:id`, **NOT** `/api/schedule/:id`).

**Web user-facing surface (audit result):**

Routines (partial parity):
- [`src/components/schedule/SchedulePage.tsx`](src/components/schedule/SchedulePage.tsx) — INSERTs `mode` explicitly (line 607 — correct post-106 NOT NULL no-default). Accepts `initialMode` prop (line 84).
- [`src/components/ride/ProfilePage.tsx`](src/components/ride/ProfilePage.tsx) — SELECTs `driver_routines` rows. **Missing mode badge.**
- [`src/components/schedule/RideBoard.tsx`](src/components/schedule/RideBoard.tsx) — routines sheet SELECTs same table. **Missing mode badge.**

Suggestions (ZERO parity):
- ❌ **No rider-side suggestions surface anywhere.** Confirmed via `grep -rln` — no `useSuggestions`, no caller of `/api/suggestions/*`, no caller of `/api/schedule/project-routine`, no `SuggestedRide*` / `SuggestionDetail*` components.
- ⚠️ Existing [`src/components/ride/RideSuggestion.tsx`](src/components/ride/RideSuggestion.tsx) is the **driver-side push-notification accept/decline page** (completely different feature) — must NOT be conflated or refactored to share types.
- ⚠️ Existing [`src/components/ride/TransitSuggestionCard.tsx`](src/components/ride/TransitSuggestionCard.tsx) is the transit-dropoff suggestion (different feature again) — keep separate.

Settings (partial parity):
- [`src/components/ride/SettingsPage.tsx`](src/components/ride/SettingsPage.tsx) — notification prefs UI driven by `PrefServerKey` union. **Missing `push_suggestions` toggle.** Endpoint already SELECTs the column per `server/routes/users.ts:118,196`.

### Side-by-side parity matrix

| Surface | iOS | Web | Severity |
|---|---|---|---|
| **Rider home — Suggested Rides hero card** | Embedded on RiderHomePage, always visible (renders empty state when no rows), lists up to 3 via `GET /api/suggestions/top` (server slices), sparkles icon + 'Suggested for you' header | ❌ Does not exist on `src/components/ride/RiderHomePage.tsx` — no suggestions surface at all | 🚨 CRITICAL |
| **Suggested ride card (compact)** | Classification badge (Same route / Transit dropoff / Transit pickup), dismiss X, avatar+name with 'Driver'/'Rider' fallback, destination first-comma segment, date/time (Today/Tomorrow/weekday + time, or 'Anytime'), total-time, rating (star+decimal OR 'New'), role-aware CTA, light/medium haptic | ❌ No component exists. Cannot reuse `RideBoardCard` (no match-type badge, no dismiss, different action wiring). | 🚨 CRITICAL |
| **Suggestion detail sheet** | Modal sheet with navigationTitle 'Suggested ride' + Close, 6 sections (tripDateBanner / classificationBanner / otherUserCard / two tripCards with SourceSubtitle / transitBreakdownCard / matchSignalsCard); bottom CTA uses brand-primary blue for BOTH sides | ❌ Does not exist | 🚨 HIGH |
| **Dismiss suggestion** | Tap X → confirm dialog "Remove this suggestion?" / "This match won't show here anymore. You can still find the ride on the Ride board." → POST `/api/suggestions/:id/dismiss` → optimistic removal + NotificationCenter broadcast | ❌ No caller of dismiss endpoint exists | 🚨 HIGH |
| **Suggestion CTA → action flow** | resolveScheduleID (use other-side `schedule_id` if present; else POST `/api/schedule/project-routine` to project routine) → GET `/api/schedule/by-id/:id` → 350ms delay (presentation-host workaround) → present existing `RideBoardConfirmSheet` pre-filled | Web has `RideBoardConfirmSheet` already; missing the projection step + lookup + present glue | 🚨 HIGH |
| **Routine mode badge on routines lists** | `ProfileRoutinesSection` shows 'Driver' (teal) / 'Rider' (blue) pill per group | ❌ web `ProfilePage` + `RideBoard` routines sheet show no badge — rider routines created on iOS look identical to driver routines on web | ⚠️ MEDIUM |
| **Add Routine pre-select** | `AddRoutinePromptCover` opens `SchedulePostPage` with mode pre-selected from `auth.isDriver` (rider-only users land on rider; multi-role can flip) | Web hard-codes driver-mode pre-selected; non-drivers must manually flip via segmented control | ⚠️ MEDIUM |
| **Push notification opt-out for suggestions** | `notification_preferences.push_suggestions` (mig 101) — toggle on `NotificationPreferences.swift` | ❌ web `SettingsPage` `PrefServerKey` union excludes `push_suggestions`; endpoint already returns column value | ⚠️ MEDIUM |
| **Cross-surface refresh after dismiss/action** | NotificationCenter broadcast; SuggestedRidesHero refetches everywhere; also on `scenePhase .active` + on `suggested_match` FCM push | ❌ No equivalent event bus on web | ⚠️ MEDIUM |
| **Routine cleanup on delete (purge-routine)** | On routine delete iOS calls `POST /api/suggestions/purge-routine/:id` to clean stale suggestions | Server-side `scanForRoutine` already wired in `riderRoutines.ts` POST; DELETE path needs verification | ⚠️ MEDIUM |
| **Driver-side suggestions (floating hero)** | `SuggestedRidesHero` in `.floating` mode on driver home — hidden when empty | ❌ Does not exist on `src/components/ride/DriverHomePage.tsx` | LOW |
| **Routine inline edit from ProfilePage** | `ProfileRoutinesSection` edit button → `SchedulePostPage` prefilled | RideBoard has inline edit; ProfilePage has NO edit button — user must go to RideBoard to edit | LOW |
| **UserProfilePreviewSheet on profile-card tap** | Modal preview inside `SuggestionDetailSheet` | Web has no modal preview component; existing `/profile/:id` route is full page (web-native deferral OK) | LOW |
| **Suggested tab on RideBoard** | `GET /api/suggestions/board` endpoint exists + consumer declared, but iOS does NOT wire it yet | Web doesn't ship it either | ➖ PARITY (preserved) |
| **Routines table schema reads** | Reads unified `driver_routines` table with `mode` column (post-103); `origin_address`/`dest_address` (102); `routine_group_id` (104); `polyline_source` (105); `mode` NOT NULL no default (106). `rider_routines` table NO LONGER EXISTS. | Web INSERTs `mode` explicitly at `SchedulePage.tsx:607`; RideBoard + ProfilePage SELECT * without filter — works correctly post-103 | ➖ PARITY (no break) |

### Cross-cutting notes (apply to every slice)

- **Role gate.** Every suggestion is scoped to a single `side` (rider OR driver). The card's CTA copy + color depends on `suggestion.side`, NOT the viewer's tab context. Derive from the payload — same rule as the role-per-ride memory.
- **Migration 103 unified routines.** The `rider_routines` TABLE NO LONGER EXISTS. Any new code MUST read `driver_routines` with optional `mode` filter. Web's `SchedulePage` already INSERTs `mode` explicitly (correct post-106 NOT NULL no-default). Do NOT write `SELECT * FROM rider_routines` anywhere — it will `42P01`.
- **iOS planning markdowns off-limits.** Hard rule landed 2026-05-30. Only `.swift` files in `ios/Tago/Features/Suggestions/`, `Schedule/`, `Profile/`, `Settings/`, plus `Core/Networking/Endpoints/Suggestion*.swift` + `Routine*.swift` + `ProjectRoutineEndpoint.swift`. NEVER read `*_PLAN.md` / `*_PROGRESS.md`.
- **Copy strings VERBATIM from iOS.** Every label, button text, empty-state, confirm-dialog message, error toast must match the iOS source character-for-character (apostrophes `won't` / `isn't` / `Couldn't`, em-dash in `try again in a minute`, `Ride board` capitalization). Reviewer matrix MUST grep iOS source for each user-visible string and assert equality.
- **RideSuggestion.tsx is OFF LIMITS.** It is the DRIVER push-notification accept/decline page — a completely different feature from iOS Suggestions. Do NOT touch, refactor, or share types with it. New components live under `SuggestedRide*` / `SuggestionDetailSheet` naming.
- **Per-feature green-light cadence.** Every slice ends with lint + tests + build + tough self-review + parity matrix in the handoff. STOP and wait for Tarun's explicit "go" / "push" / "ship it" before starting the next slice.
- **Parallel admin session lane.** `src/components/admin/`, `server/routes/admin/`, marketing files are OFF LIMITS. Slice 2 touches `SettingsPage` (non-admin) but MUST git-status-check for in-flight edits first.
- **Tokens.ts only — no raw hex.** Driver-accent green + rider-accent blue must be sourced from `tokens.ts`; if missing, add in Slice 2 so later slices can reuse.
- **React Query queryKey convention.** `['suggestions', 'top', side]` so dismiss + action mutations can target-invalidate. Mirror iOS cross-surface refresh semantics — single source of truth, no manual array splicing. FCM `suggested_match` foreground handler (Slice 1) invalidates the same key.
- **Server contract is FROZEN.** iOS is in production against these endpoints. Do not change request/response shapes; if a discrepancy is found, web adapts. Verified endpoint paths: `GET /api/schedule/by-id/:id` (NOT `/api/schedule/:id`), `GET /api/suggestions/top` (server slices to 3), `POST /api/suggestions/:id/dismiss`, `POST /api/suggestions/purge-routine/:id` (ownership-checked), `POST /api/suggestions/scan-routine/:id` (fire-and-forget, already wired in `riderRoutines.ts` POST), `POST /api/schedule/project-routine`, `GET/PATCH /api/users/me/notification-preferences` (already SELECTs `push_suggestions`).
- **Reviewer parity matrix mandatory.** Hard rule from 2026-05-30 — every slice handoff includes a 3-column iOS element / web counterpart / ✅⚠️➖ matrix, NOT prose. Bundled-feature slices (Slice 2) have one section per bundled feature.
- **Haptics best-effort.** iOS uses `UIImpactFeedbackGenerator(.light/.medium)` on card tap + CTA tap + detail-sheet present. Web equivalent is `navigator.vibrate()` — implement as optional (no-op if unsupported, no fallback chrome).
- **SuggestedRideCard transit-symbol map.** iOS uses `matchSignals.transitSymbolName` (server-provided SF Symbol name like `tram.fill`, `bus.fill`). Web must enumerate the mapping to Lucide (or whatever icon lib `tokens.ts` already uses) and document a fallback for unknown values. Capture the enumeration in Slice 3.

### Sprint 8 slice plan

Per the per-feature green-light + tough-self-review-before-handoff + reviewer parity-check hard rules. Every slice ends with lint + tests + build green + reviewer parity matrix + commit + wait for Tarun's "go" before shipping the next.

#### Slice 1 — Suggestion types + API helpers + React Query hooks (schema-first foundation)

Stand up the type system and data layer for suggestions **without any UI**. Add `Suggestion` / `MatchSignals` / `SuggestionSource` TypeScript types to `src/types/database.ts` matching iOS `Suggestion.swift` field-for-field. Create `src/lib/api/suggestions.ts` with `fetchTopSuggestions(side?)`, `dismissSuggestion(id)`, `projectRoutine({ routine_id, trip_date })`, `fetchScheduleById(id)` — last two added here so Slice 5 can extend without re-creating the file. Add `useSuggestions()` React Query hook with `queryKey: ['suggestions', 'top', side]`, `useDismissSuggestion()` mutation with `onSuccess` invalidation. Verify server-side fire-and-forget in `riderRoutines.ts` POST (`scanForRoutine`) is wired (it is) — DOCUMENT in a code comment. Audit `riderRoutines.ts` DELETE handler — if it does NOT call `POST /api/suggestions/purge-routine/:id`, ADD the call. Wire `src/lib/fcm.ts` foreground handler for `suggested_match` notification type to invalidate `['suggestions']`. Vitest unit tests for hooks with mocked fetch. NO UI.

- **iOS reference:** [`SuggestionEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/SuggestionEndpoints.swift), [`SuggestedRidesHero.swift`](ios/Tago/Features/Suggestions/SuggestedRidesHero.swift), [`ios/Tago/Models/Suggestion.swift`](ios/Tago/Models/Suggestion.swift)
- **Web files to touch:** `src/types/database.ts`, `src/lib/api/suggestions.ts` (new), `src/hooks/useSuggestions.ts` (new), `src/lib/fcm.ts`, `server/routes/riderRoutines.ts` (audit DELETE), `src/test/hooks/useSuggestions.test.ts` (new)
- **Server contract:** `GET /api/suggestions/top?side=rider|driver → { results: SuggestionPayload[] }` (server slices to 3). `POST /api/suggestions/:id/dismiss → { ok: true }`. `POST /api/schedule/project-routine { routine_id, trip_date: 'YYYY-MM-DD' } → { schedule_id, created }`. `GET /api/schedule/by-id/:id → ScheduledRide`. `POST /api/suggestions/purge-routine/:id → { ok }` (ownership-checked).
- [ ] Types match iOS `Suggestion` + `MatchSignals` exactly (audit by reading `SuggestionEndpoints.swift` response decode block)
- [ ] `useSuggestions` returns React Query patterns matching the codebase
- [ ] `useDismissSuggestion` invalidates `['suggestions']` on success
- [ ] `src/lib/fcm.ts` handles `suggested_match` foreground push by invalidating `['suggestions']`
- [ ] `riderRoutines` DELETE either already calls `purge-routine` OR is wired in this slice
- [ ] Vitest covers success / 404 / 403 paths for top + dismiss
- [ ] `npm test --run` / `npm run lint` / `npm run build` all green

#### Slice 2 — Small parity corrections: mode badge + Add-Routine pre-select + push_suggestions toggle

Three independent, low-risk UI corrections bundled to avoid round-trip overhead — reviewer matrix has three explicit sections. **(1)** Add 'Driver' (teal) / 'Rider' (blue) mode pill to every routine row in `src/components/ride/ProfilePage.tsx` and `src/components/schedule/RideBoard.tsx` routines sheet — port iOS `ProfileRoutinesSection.swift` styling, sourced from `tokens.ts` (add `driverAccent` + `riderAccent` tokens if missing — no raw hex). **(2)** Change ProfilePage's 'Add Routine' button to pre-select `activeMode` based on `auth.profile.is_driver` — pass via React Router state OR prop to `SchedulePage` (which accepts `initialMode` prop, line 84 verified). **(3)** Add 'Suggested rides' toggle to `src/components/ride/SettingsPage.tsx`: widen `PrefServerKey` union to include `push_suggestions`, render toggle row, reuse existing GET/PATCH `/api/users/me/notification-preferences` endpoint (already SELECTs `push_suggestions` per `server/routes/users.ts:118,196`). Copy verbatim from iOS `NotificationPreferences.swift`. **Before touching SettingsPage, run `git status` to confirm no in-flight edits from parallel admin/marketing session** (parallel-admin-lane rule). Vitest snapshot or render tests for badge variants + toggle states.

- **iOS reference:** [`ProfileRoutinesSection.swift`](ios/Tago/Features/Profile/ProfileRoutinesSection.swift), [`AddRoutinePromptCover.swift`](ios/Tago/Features/Schedule/AddRoutinePromptCover.swift), `ios/Tago/Features/Settings/NotificationPreferences.swift`
- **Web files to touch:** `src/components/ride/ProfilePage.tsx`, `src/components/schedule/RideBoard.tsx`, `src/components/ride/SettingsPage.tsx`, `src/lib/tokens.ts` (add accents if missing), `src/test/profile/RoutinesModeBadge.test.tsx` (new), `src/test/settings/SettingsPageSuggestions.test.tsx` (extend or new)
- **Server contract:** No new endpoints. Reads `driver_routines.mode` (NOT NULL post-103/106). Reuses `GET/PATCH /api/users/me/notification-preferences`.
- [ ] Driver routine rows show teal 'Driver' pill; rider routine rows show blue 'Rider' pill on ProfilePage AND RideBoard sheet
- [ ] Add Routine on ProfilePage pre-selects mode by `is_driver` via SchedulePage `initialMode` prop / nav state
- [ ] SettingsPage 'Suggested rides' toggle reads + writes `push_suggestions` via `/api/users/me/notification-preferences`
- [ ] Toggle copy matches iOS `NotificationPreferences.swift` verbatim
- [ ] Tests cover both badge variants + toggle on/off
- [ ] `git status` checked for parallel-session contamination on SettingsPage before edit
- [ ] All three CI gates green
- [ ] Reviewer matrix has three sections: badge / pre-select / toggle, each with iOS element / web counterpart / verdict

#### Slice 3 — SuggestedRideCard component (presentational, foundation for slices 4–6)

Build the visual card — port iOS `SuggestedRideCard.swift` to TypeScript/JSX. **NOTE: this slice is foundation only — no user value until Slice 4 mounts it.** Reuses `MatchSignals.classification` enum from server schema (do not reimplement). Match: classification badge (Same route / Transit dropoff / Transit pickup with `matchSignals.transitSymbolName` mapped to web equivalent icons — enumerate the SF symbol map and document fallback), dismiss X (shown when `showDismissButton` prop true), avatar+name row with 'Driver' / 'Rider' fallback, destination first-comma extraction (per iOS line 266), date/time line (Today / Tomorrow / weekday + time OR 'Anytime' for `time_flexible`), total-time, rating (star + decimal OR 'New'), full-width CTA ('Request this ride' blue for rider side / 'Offer this ride' driverAccent green for driver side), light/medium haptic via web vibration API (best-effort). Button + body onClick are no-op stubs in this slice. Tests cover all classification variants, both role variants, 'New' rating, missing-name fallback, 'Anytime' time path.

- **iOS reference:** [`SuggestedRideCard.swift`](ios/Tago/Features/Suggestions/SuggestedRideCard.swift)
- **Web files to touch:** `src/components/ride/SuggestedRideCard.tsx` (new), `src/test/ride/SuggestedRideCard.test.tsx` (new)
- **Server contract:** N/A — consumes `Suggestion` type from Slice 1.
- [ ] Renders all 3 classification badges identically to iOS (color + icon, transit symbol map documented)
- [ ] Renders rider-side + driver-side CTA copy + color correctly
- [ ] Dismiss X visible when `showDismissButton` true
- [ ] Missing-name fallback ('Driver' / 'Rider') tested
- [ ] 'New' rating path tested
- [ ] 'Anytime' time-flexible path tested
- [ ] Destination first-comma extraction tested
- [ ] `data-testid` prop accepted on every interactive element
- [ ] `tokens.ts` used for all colors — no raw hex
- [ ] All three CI gates green
- **Dependencies:** Slice 1

#### Slice 4 — Rider home Suggested Rides card + dismiss flow (CRITICAL gap closure)

Mount the suggestions card on `src/components/ride/RiderHomePage.tsx` — wrapper card with header 'Suggested for you' (sparkles icon + brand-color label, copy VERBATIM from iOS `SuggestedRidesHero.swift`), embedding `SuggestedRideCard`s from `useSuggestions({ side: 'rider' })`. Empty state VERBATIM from iOS `embeddedEmptyState`: large sparkles, 'No suggestions yet', "When someone posts a ride that matches yours, you'll see it here." Wire the dismiss flow: tap X → confirm dialog (web BottomSheet/Modal) with copy VERBATIM "Remove this suggestion?" / "This match won't show here anymore. You can still find the ride on the Ride board." / "Remove" / "Cancel" → `useDismissSuggestion` mutation → optimistic removal + React Query invalidation. CTA button click still no-op (Slice 5 wires action). Reviewer matrix walks every iOS element in `SuggestedRidesHero.embedded` mode AND every iOS string in the dismiss alert grepped char-for-char.

- **iOS reference:** [`SuggestedRidesHero.swift`](ios/Tago/Features/Suggestions/SuggestedRidesHero.swift), [`RiderHomePage+Sections.swift`](ios/Tago/Features/RiderHome/RiderHomePage+Sections.swift)
- **Web files to touch:** `src/components/ride/RiderHomePage.tsx`, `src/components/ride/SuggestedRidesCard.tsx` (new — the wrapper hero), `src/test/ride/SuggestedRidesCard.test.tsx` (new)
- **Server contract:** `GET /api/suggestions/top?side=rider` + `POST /api/suggestions/:id/dismiss` via Slice 1 hooks.
- [ ] Rider home renders the card above-the-fold (placement matches `RiderHomePage+Sections.swift` ordering)
- [ ] Empty-state copy + icon match iOS verbatim (grep iOS source for each string)
- [ ] Dismiss confirm dialog copy matches iOS verbatim including apostrophes + 'Ride board' capitalization
- [ ] Optimistic removal + React Query invalidation on dismiss success
- [ ] Map-first UX preserved on DriverHomePage (no card on driver home in this slice)
- [ ] Vitest covers: loaded with rows, empty state, dismiss success, dismiss with 403/404
- [ ] Reviewer matrix: every iOS element in `SuggestedRidesHero` embedded mode walked
- [ ] All three CI gates green
- **Dependencies:** Slice 1, Slice 3

#### Slice 5 — Suggestion CTA → lazy projection → RideBoardConfirmSheet wire-through

Make the 'Request this ride' / 'Offer this ride' CTA functional on both `SuggestedRideCard` (Slice 3) and (later) `SuggestionDetailSheet` (Slice 6). Port iOS `SuggestedRidesHero.openConfirmSheet` flow: **(1)** resolveScheduleID — if other-side source has `schedule_id`, use it; if routine, call `projectRoutine({ routine_id, trip_date })` from Slice 1 api helper and use returned `schedule_id`; **(2)** fetch ride via `fetchScheduleById(id)` (Slice 1 helper, hits `/api/schedule/by-id/:id` — **verified path**); **(3)** present existing `src/components/schedule/RideBoardConfirmSheet.tsx` with the resolved ride. Error copy VERBATIM from iOS `SuggestedRidesHero.swift` lines 252/254: "This match isn't ready for an action yet — try again in a minute." (`noActionableSource`) and "Couldn't open this match. Try again." (generic). On `RideBoardConfirmSheet` success, invalidate `['suggestions']`. When invoked from `SuggestionDetailSheet` (Slice 6), implement the iOS 350ms single-presentation-host delay before opening `RideBoardConfirmSheet` — document the workaround clearly.

- **iOS reference:** [`SuggestedRidesHero.swift`](ios/Tago/Features/Suggestions/SuggestedRidesHero.swift), [`ProjectRoutineEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ProjectRoutineEndpoint.swift)
- **Web files to touch:** `src/components/ride/SuggestedRideCard.tsx` (extend), `src/components/ride/SuggestedRidesCard.tsx` (extend), `src/hooks/useSuggestionAction.ts` (new), `src/test/ride/SuggestedRideAction.test.tsx` (new)
- **Server contract:** Reuses Slice 1 helpers `projectRoutine` + `fetchScheduleById`. NO new endpoints. Paths: `POST /api/schedule/project-routine`, `GET /api/schedule/by-id/:id` (**NOT** `/api/schedule/:id` — verified `server/routes/schedule.ts:712-786`).
- [ ] Schedule-source suggestion: CTA opens `RideBoardConfirmSheet` immediately
- [ ] Routine-source suggestion: CTA projects routine then opens `RideBoardConfirmSheet` with projected ride
- [ ] Error toasts match iOS copy verbatim (apostrophes + em-dash)
- [ ] On `RideBoardConfirmSheet` success, suggestions list refetches
- [ ] 350ms presentation-host delay implemented when invoked from a modal (for Slice 6 reuse)
- [ ] Vitest covers: schedule path, routine projection path, `noActionableSource` error, generic error
- [ ] Reviewer matrix walks `openConfirmSheet` flow end-to-end against iOS lines 246-256
- [ ] All three CI gates green
- **Dependencies:** Slice 1, Slice 3, Slice 4

#### Slice 6 — SuggestionDetailSheet (sheet shell + 5-section layout + transit + match signals)

Port iOS `SuggestionDetailSheet.swift` (649 lines) to a web BottomSheet-based modal. Open on tap of card body (Slice 3 stub becomes live here). Navigation title 'Suggested ride' + Close button in top-right. **SIX sections** top-to-bottom: **(1)** `tripDateBanner` — pill 'Suggested for [Today/Tomorrow/weekday]'; **(2)** `classificationBanner` — SKIPPED on direct routes (iOS line 25-27 guard); for `transit_dropoff`: "Driver drops the rider at [station]; rider takes transit the rest of the way"; `transit_pickup`: "Rider takes transit to [station]; driver picks up there" (enumerate both verbatim from iOS); **(3)** `otherUserCard` — tappable, 56x56 avatar + name + rating + chevron, navigates to `/profile/:id` (web-native upgrade vs iOS `UserProfilePreviewSheet` modal — deferred per open question); **(4)** `tripCards` — TWO cards: `tripCard(side:.their)` + `tripCard(side:.yours)`, each with `SourceSubtitle` ('From your posted ride' / 'From their posted ride' / 'From your saved routine: [name]' falling back to 'From your saved routine' when `routeName` empty), From/To/date/time rows handling 'Anytime' for `time_flexible` and per-leg reverse-geocode-on-demand with silent fallback to '—' for legacy pre-102 rows with null `origin_address`/`dest_address`; **(5)** `transitBreakdownCard` — only when classification != direct, per-leg title/subtitle rows (e.g. title 'Driver' / subtitle 'X min in the car'); **(6)** `matchSignalsCard` 'Why this match' (origin dist, dest dist, bearing diff, time diff, relevance) — ship production-visible per iOS unless Tarun flags. Bottom CTA — uses `Tokens.color.primary` (brand blue) for **BOTH sides** per iOS line 52, NOT side-aware; calls `useSuggestionAction` from Slice 5. Light haptic on present (web vibration API best-effort).

- **iOS reference:** [`SuggestionDetailSheet.swift`](ios/Tago/Features/Suggestions/SuggestionDetailSheet.swift), [`SuggestedRideCard.swift`](ios/Tago/Features/Suggestions/SuggestedRideCard.swift)
- **Web files to touch:** `src/components/ride/SuggestionDetailSheet.tsx` (new), `src/components/ride/SuggestedRideCard.tsx` (wire body onClick), `src/test/ride/SuggestionDetailSheet.test.tsx` (new)
- **Server contract:** No new endpoints. Consumes `Suggestion` type from Slice 1; reuses Slice 5 action handler. Profile-card nav uses existing `/profile/:id` route.
- [ ] All 6 section types render correctly with fixtures for direct + transit_dropoff + transit_pickup
- [ ] Classification banner skipped on direct (matches iOS line 25-27 guard)
- [ ] Classification explainer copy verbatim from iOS for BOTH transit variants (grep iOS for each string)
- [ ] 'Anytime' time labels render correctly (`time_flexible` respected)
- [ ] Per-leg reverse-geocode-on-demand with silent '—' fallback for legacy pre-102 routine rows
- [ ] `SourceSubtitle` handles all 3 variants + empty-`routeName` fallback
- [ ] Profile card chevron navigates to `/profile/:id`
- [ ] Bottom CTA uses brand-primary blue regardless of side (NOT side-aware — matches iOS line 52)
- [ ] Bottom CTA shares Slice 5 `useSuggestionAction` handler
- [ ] 350ms delay applied when transitioning to `RideBoardConfirmSheet`
- [ ] Reviewer matrix walks every `SuggestionDetailSheet` section + every edge state + every user-visible string char-for-char
- [ ] All three CI gates green
- **Dependencies:** Slice 1, Slice 3, Slice 4, Slice 5
- **Contingency:** ~649 iOS source lines + 6 sections may push past the slice budget. Plan keeps it as one slice (per shape-critic feedback that splitting it costs more in test-surface duplication). If the slice grows past ~1,000 LoC during implementation, split into 6a (shell + banners + trip cards) and 6b (transit breakdown + match signals + profile card).

### Open questions (need Tarun's call before or during Sprint 8)

1. **Driver-side floating SuggestedRidesHero** (`.floating` mode on `DriverHomePage`) — ship in Sprint 8 or defer to Sprint 9? **Default plan: defer** since driver discovery already happens via push + ride board. Confirm OK.
2. **Suggested tab on RideBoard** — both iOS and web do NOT wire it (endpoint exists but is orphaned on iOS too). Should web ship it FIRST as a web-native upgrade, or wait for iOS per the 'iOS is canonical' rule? **Default: wait for iOS.**
3. **ProfilePage routine edit button** — iOS supports edit from both `ProfileRoutinesSection` AND `RoutinesSheet`; web only from RideBoard sheet. Slice 2 does NOT add ProfilePage edit. Confirm OK to defer to Sprint 9.
4. **`UserProfilePreviewSheet`** — iOS opens modal preview when tapping profile card in `SuggestionDetailSheet`. Slice 6 navigates to `/profile/:id` as web-native upgrade. Confirm OK, or want modal preview built first?
5. **Match signals 'Why this match' debug card** — iOS ships it production-visible to all users. **Default: match.** Want to hide behind `?debug=1` query flag instead?
6. **Feature flag** — ship Slices 1–6 behind `VITE_FEATURE_SUGGESTIONS=true` for staged rollout, or land directly? **Default: land directly** since iOS has been in production with these endpoints.
7. **Migration of in-flight rider users** — any rider whose iOS app dismissed/acted on suggestions will see consistent state on web after Slice 4 (server is source of truth). No backfill needed. Confirm understanding.
8. **RoutinesSheet sync badge** ("X routine(s) synced to the board") — completeness critic flagged it as iOS UI. Is this a parity gap I should add to Slice 2's matrix, or is it already shipping on web? Quick audit needed at Slice 2 start.
9. **Rider-home architecture drift** (raised by Tarun 2026-05-30, deferred per his call). iOS rider home was redesigned 2026-05-26 to a **Waymo-style scroll layout** (greeting → "Find your ride" hero → Instant Carpool + Ride board twin pills → suggestions card → promo placeholder; **no map**). Web `RiderHomePage.tsx` is still the pre-redesign **map-first** layout (full-screen Google Map + bottom-stacked search + Ride board cards). **Slice 4 of this sprint mounts the suggestions card on web rider home — but the iOS card was designed for a scroll feed, not above a map.** Two paths: (a) re-scope Slice 4 to slot the card BELOW the bottom stack in the current map-first layout (Frankenstein, ships fast, parity gap remains) — Tarun's current preference; (b) ship a Sprint 9 "rider home Waymo redesign" first, then Slice 4 drops cleanly into the new feed. Driver home matches iOS in concept (both full-screen map) so no drift there.

### Verifier deltas applied to the draft plan

Folded in: (1) Completeness critic's misses — navigationTitle + Close button, SourceSubtitle copy variants with empty-name fallback, transit row title/subtitle format, haptics, 'New' rating path, missing-name 'Driver'/'Rider' fallback, destination first-comma extraction, classification explainer verbatim for both transit variants, 350ms single-presentation-host workaround, transit-symbol map enumeration — all now in slice DoDs or cross-cutting notes. (2) Server-contract verifier's correction — endpoint is `/api/schedule/by-id/:id` NOT `/api/schedule/:id` (fixed in Slice 1 + 5 server contracts and added a verified-path note). (3) Server-contract verifier's misses — `scan-routine` wired via fire-and-forget in `riderRoutines.ts` POST (documented in Slice 1) and `purge-routine` call on routine DELETE (added to Slice 1 audit step). (4) Headline kept 'max 3' (server slices to 3 per source — iOS hero comment 'up to 10' is forward-looking). (5) `SettingsPage.tsx` is the correct target (not `NotificationsPage` which is the inbox feed). (6) `SchedulePage` accepts `initialMode` prop so navigation passes state not path. (7) Shape critic's bundle suggestion — merged the `push_suggestions` toggle INTO Slice 2 with the mode badge + Add-Routine pre-select, giving one 'small parity corrections' slice with a 3-section reviewer matrix. This brings the sprint to **6 slices** (under the 7 cap). (8) FCM foreground handler for `suggested_match` added to Slice 1 per shape critic's miss.

Did NOT fold in: shape critic's suggestion to merge Slices 3+4 — kept separate because Slice 3's test surface (presentational fixtures for all classification + role + rating + name + time variants) is heavyweight enough on its own that merging would balloon Slice 4 past the cap; Slice 3 is explicitly labeled 'foundation only — no user value until Slice 4'. Did NOT split Slice 6 yet — kept as one slice with a contingency note to split into 6a/6b if it exceeds ~1,000 LoC during implementation. Did NOT add a separate slice for the `ride_suggestions` table row type — read-path goes through enriched server payload only, so the row type is unneeded.

### Sprint 8 summary

| Status | Count |
|---|---|
| Not started | 6 slices |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

### Current focus

Awaiting Tarun's "go" on Slice 1 (Suggestion foundation: types + hooks + API helpers + FCM handler). No code changes have shipped from this audit yet.

### Next action

If Tarun greenlights Slice 1: read [`src/types/database.ts`](src/types/database.ts), [`src/hooks/useCaregivers.ts`](src/hooks/useCaregivers.ts) (as the React Query pattern reference), [`src/lib/fcm.ts`](src/lib/fcm.ts), and the full [`server/routes/suggestions.ts`](server/routes/suggestions.ts) + [`server/routes/riderRoutines.ts`](server/routes/riderRoutines.ts) end-to-end before writing any TypeScript. Confirm `riderRoutines.ts` DELETE handler's `purge-routine` parity at audit step before any UI work later.

### Plain English

iOS has had a "Suggested rides" feed on the rider home screen for a while now. When the matching engine finds a ride that fits the rider's saved routine or another rider's posted ride, iOS shows it in a card with a photo, name, time, distance, fare, and a button to "Request this ride" (or "Offer this ride" if it's a driver looking at it). The rider can tap an X to dismiss anything they don't want, or tap the card to see all the details before deciding. **The web app has none of this.** A web rider gets exactly zero suggestions, even when the engine is generating them server-side. They miss every match the engine surfaces unless they manually browse the Ride Board.

There are also three smaller things web should fix at the same time: (1) iOS shows a little "Driver" or "Rider" tag on each routine row so users know which kind of routine they're looking at — web doesn't. (2) When a rider taps "Add Routine" on web, it pre-selects "Driver" mode even for users who aren't drivers — iOS picks the right one. (3) iOS has a notification toggle "Suggested rides" in settings — web doesn't expose it (the database column exists, the server returns it, the UI just doesn't show it).

The plan is six slices. Slice 1 is foundation (types + hooks + helpers, no UI). Slice 2 bundles the three small fixes above. Slice 3 builds the visual card. Slice 4 mounts the card on the rider home with the dismiss flow — this is when the rider-facing gap closes. Slice 5 wires the "Request this ride" button so it actually opens the matched ride. Slice 6 builds the full detail sheet for the deeper-dive view. Each slice ships independently with a reviewer matrix and waits for the user's explicit "go" before the next one starts. The biggest single missing piece is **rider discovery** — Slice 4 closes it.

---

## Sprint 7 — Accessibility + user profile v1.2 parity

**Audit-first mode.** Stage 3 of the multi-stage iOS-parity audit completed 2026-05-30 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Headline

Three v1.2 migrations (087 + 088 + 090) added eight columns and one JSONB blob covering: user social profile (bio, gender, school, major, graduation_year), user accessibility (has_accessibility_needs top-level toggle + accessibility_profile JSONB), and vehicle accessibility (wheelchair_capable boolean + trunk_size enum). **Web is at 100% user-facing parity gap on every one of these surfaces.** Server already reads them (in `users/:id/public-profile`, `schedule/board`, `schedule/board/search`, `users.ts:GET /me/public-profile`), but the iOS-only writes mean web users can never set them, web RideBoard never filters or pills on them, and web ProfilePage / EditProfile / VehicleEdit screens render none of them.

This sprint unblocks Sprint 6 (caregivers) because the iOS caregiver picker visibility is gated on `hasAccessibilityNeeds && needsWheelchair && !caregivers.empty` — until web can set those two booleans, the caregiver picker would never appear.

### Files read end-to-end during the audit

**Migrations (3):**
- [`supabase/migrations/087_user_profile_expansion.sql`](supabase/migrations/087_user_profile_expansion.sql) — `users.bio`, `gender` (CHECK male/female/non_binary/prefer_not_to_say), `school`, `major`, `graduation_year` (CHECK 1980-2100). All optional; no backfill.
- [`supabase/migrations/088_user_accessibility_profile.sql`](supabase/migrations/088_user_accessibility_profile.sql) — `users.has_accessibility_needs BOOLEAN NOT NULL DEFAULT false` + `users.accessibility_profile JSONB NOT NULL DEFAULT '{}'` with shape `{ needs_wheelchair: bool, needs_caregiver: bool, other_notes: text? }`. Partial index on `has_accessibility_needs=true`.
- [`supabase/migrations/090_vehicle_accessibility.sql`](supabase/migrations/090_vehicle_accessibility.sql) — `vehicles.wheelchair_capable BOOLEAN NOT NULL DEFAULT false` + `vehicles.trunk_size TEXT CHECK ('small'|'medium'|'large')`. Partial index on `wheelchair_capable=true AND is_active=true`. Body-type → trunk-size derivation rule (sedan/coupe/hatchback → small, wagon/suv → medium, minivan/pickup/van → large).

**Server (3):**
- [`server/routes/users.ts`](server/routes/users.ts) — `GET /api/users/:id/public-profile` returns `bio`, `gender`, `school`, `major`, `graduation_year`, `has_accessibility_needs`, computed `needs_wheelchair` (= `has_accessibility_needs && accessibility_profile.needs_wheelchair`), `waive_caregiver_fee`, and `vehicle.wheelchair_capable` + `vehicle.trunk_size` when the subject is a driver. **No `PATCH /api/users/me` endpoint exists** — iOS writes via direct Supabase SDK (`AuthStore::updateProfileFields` calls `supabase.from("users").update(payload).eq("id", user.id).execute()`).
- [`server/routes/schedule.ts`](server/routes/schedule.ts) — `GET /api/schedule/board` (and board/search, board/upcoming siblings) all surface `has_accessibility_needs` + computed `needs_wheelchair` on the poster row so the iOS RideBoardCard can render the ♿ "Mobility aid access" pill. Same pattern repeated at lines 350, 735, 1328, 2174 of the file.
- [`server/routes/vehicle.ts`](server/routes/vehicle.ts) — ONLY a plate-lookup helper (`POST /api/vehicle/plate-lookup`). **No `/api/vehicles` CRUD route.** iOS uses `VehiclesRepository` direct against the Supabase table, same Supabase-SDK-only pattern as caregivers + user profile fields.

**iOS source-of-truth surface (10 files):**

Data model:
- [`ios/Tago/Models/UserProfile.swift`](ios/Tago/Models/UserProfile.swift) — Decodable mirror with `bio`, `gender: Gender?` (closed enum), `school`, `major`, `graduationYear`, `hasAccessibilityNeeds: Bool`, `accessibilityProfile: AccessibilityProfile` (nested struct with `needsWheelchair`/`needsCaregiver`/`otherNotes`), `waiveCaregiverFee: Bool`. All default-tolerant on missing columns so pre-migration clients don't crash.
- [`ios/Tago/Models/Vehicle.swift`](ios/Tago/Models/Vehicle.swift) — `wheelchairCapable: Bool`, `trunkSize: String?`, plus `defaultTrunkSize(forBodyType:)` static helper + `effectiveTrunkSize` computed (falls back to derivation when explicit nil).
- [`ios/Tago/Models/VehicleInsertPayload.swift`](ios/Tago/Models/VehicleInsertPayload.swift) — write-side payload with `wheelchair_capable` + `trunk_size`.
- [`ios/Tago/State/AuthStore.swift`](ios/Tago/State/AuthStore.swift) lines 322-394 — `ProfileFieldsUpdate` struct + `updateProfileFields(...)` writes the eight v1.2 fields direct via Supabase SDK.

Write surface — user-side:
- [`ios/Tago/Features/Profile/EditProfileSheet.swift`](ios/Tago/Features/Profile/EditProfileSheet.swift) — sections "About you" (bio + gender), "Education" (school via SchoolPickerSheet + major + graduation_year Menu), "Accessibility needs" (top-level toggle gates wheelchair + caregiver + other-notes), "Caregiver fees" (driver-only `waive_caregiver_fee` toggle). All saved in one `updateProfileFields` call.
- [`ios/Tago/Features/Auth/AboutYouPage.swift`](ios/Tago/Features/Auth/AboutYouPage.swift) — onboarding-time bio + gender + school + major + graduation + accessibility toggles. Drives `wantsCaregiverFlow` derivation that routes the user into `AddCaregiverOnboardingPage` (line 453).
- [`ios/Tago/Features/Auth/CreateProfilePage.swift`](ios/Tago/Features/Auth/CreateProfilePage.swift) — earlier signup step that preserves existing profile fields on partial-fill (lines 738-743).

Write surface — vehicle:
- [`ios/Tago/Features/Profile/VehicleEdit/VehicleEditPage.swift`](ios/Tago/Features/Profile/VehicleEdit/VehicleEditPage.swift) — wheelchair toggle + segmented trunk-size picker (only shown when wheelchair is ON). Smart auto-pick: flipping wheelchair ON without an explicit trunk-size auto-derives from body-type; flipping OFF clears trunk-size to NULL so we don't persist stale data.
- [`ios/Tago/Features/Auth/VehicleRegistrationPage.swift`](ios/Tago/Features/Auth/VehicleRegistrationPage.swift) — same wheelchair toggle + trunk picker at signup time, same auto-derivation.

Read surface — profile display + board:
- [`ios/Tago/Features/Profile/ProfilePage.swift`](ios/Tago/Features/Profile/ProfilePage.swift) — bio subtitle (line 364), education chip (`school · major · graduationYear`, line 489-525).
- [`ios/Tago/Features/RideBoard/RideBoardCard.swift`](ios/Tago/Features/RideBoard/RideBoardCard.swift) lines 258-270 — ♿ "Mobility aid access" pill when `poster.hasAccessibilityNeeds && poster.needsWheelchair`.
- [`ios/Tago/Features/RideBoard/RideBoardFilters.swift`](ios/Tago/Features/RideBoard/RideBoardFilters.swift) + [`RideBoardFilterSheet.swift`](ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift) + [`RideBoardViewModel.swift`](ios/Tago/Features/RideBoard/RideBoardViewModel.swift) — `AccessibilityFilter` enum (`.any` / `.accessibilityOnly`) with corresponding chip in the filter sheet + client-side filter pass at view-model line 229. F5.3 — the original spec sketched 4 options (vehicle wheelchair-capable / caregiver-aware / both); iOS shipped the 2-option v1 and parked the wider 4-option work.
- [`ios/Tago/DesignSystem/Components/UserProfilePreviewCard.swift`](ios/Tago/DesignSystem/Components/UserProfilePreviewCard.swift) — surfaces `needsWheelchair` (line 121) on the waiting-room / board-detail preview.

**Web user-facing surface (audit result):**
- ❌ **Zero references** to `bio`, `gender`, `school`, `major`, `graduation`, `accessibility`, `wheelchair`, or `trunk_size` outside `src/test/` and `src/components/admin/` — confirmed via `grep -rln`. The only stray match in user-facing code is an unrelated "graduation" icon name in `src/components/ui/AppIcon.tsx` and a "majority" comment in `AddFundsPage.tsx`. Both unrelated.
- `src/components/ride/ProfilePage.tsx` (1017 lines) has no `bio` / `gender` / `school` / `major` / `graduation` / `accessibility` references.
- `src/components/ride/VehicleEditPage.tsx` (275 lines) has no `wheelchair_capable` / `trunk_size` references.
- `src/components/auth/VehicleRegistrationPage.tsx` has no v1.2 vehicle accessibility fields.
- `src/components/auth/CreateProfilePage.tsx` has no v1.2 social/accessibility fields.
- `src/components/schedule/RideBoardCard.tsx`, `RideBoardFilterSheet.tsx`, `boardFilters.ts`, `boardTypes.ts` have no accessibility pill or filter.

### Side-by-side parity matrix

| Surface | iOS | Web | Verdict |
|---|---|---|---|
| **User profile fields (mig 087)** | EditProfileSheet "About you" + "Education" sections; AboutYouPage at onboarding | ❌ ProfilePage doesn't display, EditProfile (does this exist?) doesn't edit; onboarding `CreateProfilePage` skips them | 🚨 |
| **`users.bio`** | Multi-line TextField with 280-char counter; rendered as ProfilePage subtitle | ❌ no read or write | 🚨 |
| **`users.gender` (enum)** | Menu picker over `UserProfile.Gender` (4 cases incl. prefer-not-to-say); decoded with unknown-value tolerance | ❌ no read or write | 🚨 |
| **`users.school`** | Constrained to `Universities.californiaFourYear` via `SchoolPickerSheet`; legacy out-of-list values preserved on the "Currently selected" row | ❌ no read or write | 🚨 |
| **`users.major`** | Free-text TextField (Tarun: no list — too many to enumerate) | ❌ no read or write | 🚨 |
| **`users.graduation_year`** | Menu picker over 17-year window around current year (+ any out-of-window existing value) | ❌ no read or write | 🚨 |
| **`users.has_accessibility_needs` (top-level toggle)** | "I have accessibility needs" Toggle in EditProfile + AboutYouPage; gates sub-section visibility | ❌ no read or write | 🚨 (blocks Sprint 6 caregiver picker visibility) |
| **`users.accessibility_profile` JSONB (needs_wheelchair / needs_caregiver / other_notes)** | Sub-toggles + free-text "Other notes" when the top-level toggle is ON. Persisted as a struct via `AccessibilityProfile` Codable; default `{}` on missing | ❌ no read or write | 🚨 |
| **`vehicles.wheelchair_capable`** | VehicleEditPage + VehicleRegistrationPage Toggle; auto-derives trunk_size when flipped ON without explicit value | ❌ web VehicleEditPage + VehicleRegistrationPage have no toggle | 🚨 |
| **`vehicles.trunk_size`** | Segmented small/medium/large picker, only shown when wheelchair_capable is ON; auto-pick from body_type via `Vehicle.defaultTrunkSize(forBodyType:)`; nulled when wheelchair flips OFF | ❌ no read or write | 🚨 |
| **Profile read display — bio subtitle + education chip** | ProfilePage shows bio under name (3-line clamp) + chip `school · major · graduationYear` | ❌ web ProfilePage shows neither | 🚨 |
| **Public profile read (`/api/users/:id/public-profile`)** | Decoded by `PublicProfile` model; surfaced on `UserProfilePreviewCard` in waiting rooms + board-poster detail | ✅ server already returns all fields; web public-profile consumers (if any) need to decode them | ⚠️ pending consumer check |
| **RideBoard ♿ "Mobility aid access" pill** | `RideBoardCard` shows when `poster.hasAccessibilityNeeds && poster.needsWheelchair` | ❌ web `RideBoardCard.tsx` doesn't render it | 🚨 |
| **RideBoard accessibility filter chip** | `RideBoardFilterSheet` two-option filter (`.any` / `.accessibilityOnly`); ViewModel filters client-side | ❌ web `RideBoardFilterSheet.tsx` + `boardFilters.ts` don't expose it | 🚨 |
| **Onboarding routing for caregivers** | `AboutYouPage` ends → `AddCaregiverOnboardingPage` when `hasAccessibilityNeeds == true`; this is the F2 → F3 hand-off | ❌ no web onboarding gate exists; Sprint 6 Slice 6 (CG5) depends on it | 🚨 (Sprint 6 dependency) |
| **Write contract** | iOS writes ALL v1.2 user fields via direct Supabase SDK (`AuthStore::updateProfileFields`). Vehicles via `VehiclesRepository` direct SDK. RLS-scoped to `auth.uid() = id` / `vehicles.user_id` | Server has no PATCH `/api/users/me` or `/api/vehicles` route. Web needs to choose: (a) same direct-SDK pattern via supabase-js, or (b) add new REST endpoints | ⚠️ decision needed before Slice 1 starts |

### Actionable item list (W-T1-A\* — Accessibility/Profile v1.2)

| ID | Surface | What's missing on web | Severity |
|---|---|---|---|
| **W-T1-A1** | Write contract decision | Pick the write pattern: direct supabase-js writes against `users` + `vehicles` tables (RLS-scoped), or add `PATCH /api/users/me` + `PATCH /api/vehicles/:id` REST endpoints. **Recommendation: direct supabase-js writes** to match iOS exactly and avoid duplicating field-validation logic. Need user's call before any write code lands. | 🚨 |
| **W-T1-A2** | `src/hooks/useProfile.ts` (extend or create) | Decode the eight v1.2 user fields + the two vehicle fields on profile reads. Make sure `auth.profile` (or Zustand store equivalent) carries them so downstream UI can render. | 🚨 |
| **W-T1-A3** | `src/components/ride/ProfilePage.tsx` | Add bio subtitle (3-line clamp under name) + education chip (`school · major · class of YYYY`). Mirror iOS `ProfilePage.swift:364,489-525`. | 🚨 |
| **W-T1-A4** | New `src/components/profile/EditProfileSheet.tsx` (or extend an existing edit-profile flow) | Sections: "About you" (bio 280-char counter + gender picker), "Education" (school picker constrained to `Universities.californiaFourYear` + major free-text + graduation year picker over a 17-year window). On save, write `bio`, `gender`, `school`, `major`, `graduation_year` via the write pattern picked in A1. | 🚨 |
| **W-T1-A5** | Same edit-profile sheet | "Accessibility needs" section: top-level toggle, gates wheelchair / caregiver / other-notes sub-toggles + free-text. Write `has_accessibility_needs` + `accessibility_profile` JSONB. Mirror iOS EditProfileSheet section. | 🚨 |
| **W-T1-A6** | `src/components/ride/VehicleEditPage.tsx` + `src/components/auth/VehicleRegistrationPage.tsx` | Wheelchair toggle + segmented trunk-size picker (only when wheelchair ON). On toggle ON without explicit size, auto-derive from `body_type` via Web mirror of `Vehicle.defaultTrunkSize`. On toggle OFF, null the trunk-size. Same UX as iOS. | 🚨 |
| **W-T1-A7** | `src/lib/vehicle.ts` (new) | Port `defaultTrunkSize(bodyType)` helper from iOS `Vehicle.swift:91-104`. Vitest cases covering each body-type mapping. | ⚠️ |
| **W-T1-A8** | `src/components/auth/CreateProfilePage.tsx` + new onboarding step | Add the v1.2 profile collection step (bio + gender + school + major + grad-year). Optional, but at minimum collect `has_accessibility_needs` toggle since it gates the caregiver onboarding step (Sprint 6 CG5). | 🚨 |
| **W-T1-A9** | Web `WaitingRoomPage` / board-poster-detail surfaces (if they exist) | If any web counterpart to iOS `UserProfilePreviewCard` exists, surface `needs_wheelchair` indicator + new bio/education context. Sprint 4 doesn't seem to have introduced it. | ⚠️ |
| **W-T1-A10** | `src/components/schedule/RideBoardCard.tsx` | Add ♿ "Mobility aid access" pill when `poster.has_accessibility_needs && poster.needs_wheelchair`. Server already sends both fields on board posts. | 🚨 |
| **W-T1-A11** | `src/components/schedule/RideBoardFilterSheet.tsx` + `src/components/schedule/boardFilters.ts` | Add `AccessibilityFilter` (`'any' | 'accessibility_only'`) with chip + ViewModel-equivalent filter pass. Match iOS RideBoardViewModel filter logic line 229. | 🚨 |
| **W-T1-A12** | `src/components/schedule/boardTypes.ts` | Extend `BoardPoster` (or equivalent) type with `has_accessibility_needs` + `needs_wheelchair` fields. Server already returns them. | 🚨 |
| **W-T1-A13** | Vitest coverage | Tests for: profile fields write path, accessibility toggle gating sub-fields, vehicle wheelchair auto-derivation, board pill + filter behaviour. | ⚠️ |

### Cross-stage notes

- **Sprint 6 (Caregivers) depends on this sprint** — specifically W-T1-A5 (which writes `accessibility_profile.needs_wheelchair`) and W-T1-A11 (which exposes the gating predicate). Recommend bundling Sprint 7 Slice 2 (rider profile + accessibility section) into Sprint 6 Slice 2 if doing both at once, or shipping Sprint 7 first.
- **Caregivers iOS `RideConfirmCaregiverSection` visibility uses `needs_wheelchair`** — Sprint 6 W-T1-CG6 + W-T1-CG7 pickers can land but will only show after Sprint 7 ships the toggle. Acceptable to ship the pickers behind a feature-flag fallback (e.g. always visible until A5 ships) but the cleaner path is sequencing.

### iOS-side reciprocal gaps

None on the v1.2 profile/accessibility/vehicle surface — iOS is feature-complete here. One subtle constraint: iOS `Universities.californiaFourYear` school list is hardcoded; web needs the same list at parity. Source it from a single shared JSON if convenient (or just port the literal).

### Sprint 7 slice plan

- [x] **Slice 1 — Foundation + write contract** (W-T1-A1 + A2 + A7) — shipped `faef2b5`. Write pattern locked: direct supabase-js (mirrors iOS).
- [x] **Slice 2 — Edit profile + display** (W-T1-A3 + A4 + A5) — shipped `d65cd26`. EditProfileSheet + bio subtitle + education chip on ProfilePage.
- [x] **Slice 3 — Vehicle accessibility** (W-T1-A6) — shipped `3a03d63`. Wheelchair toggle + trunk-size picker on VehicleEditPage + VehicleRegistrationPage.
- [x] **Slice 4 — Board pill + filter** (W-T1-A10 + A11 + A12) — shipped `2b3913e`. ♿ pill on RideBoardCard + accessibility filter chip.
- [x] **Slice 5 — Onboarding step** (W-T1-A8) — shipped `ba27da5`. AboutYouPage between CreateProfile and Location.
- [ ] **Slice 6 — UserProfilePreviewCard parity** (W-T1-A9) — polish, deferred. If web surfaces a poster preview anywhere, add `needs_wheelchair` indicator + bio/education context.
- [x] **Slice 7 — Tests** (W-T1-A13) — Vitest coverage shipped per-slice (didn't ship as a separate slice).

### Sprint 7 summary

| Status | Count |
|---|---|
| Not started | 1 (Slice 6 polish) |
| In progress | 0 |
| Done (local commit, awaiting prod QA) | 5 slices, 12 of 13 actionable items |
| Done (verified + pushed) | 0 |

### Current focus

Sprint 7 substantively complete. Slice 6 polish parked unless surface emerges.

### Next action

User QA on local dev + push timing call.

### Plain English

Tago has added eight things to user profiles in v1.2 — a short bio, gender, school, major, graduation year, plus three accessibility-specific fields (whether the user needs help, whether they need a wheelchair, free-text notes for anything else). It also added two things to vehicles: whether a wheelchair fits in the trunk, and the trunk size (small / medium / large). **All of this exists on iOS today. None of it is anywhere on the web.**

The database has all the columns. The server reads them and sends them to anyone who asks. But the web app doesn't have a single place where a user can set their bio, declare an accessibility need, or mark their vehicle as wheelchair-capable. The web RideBoard doesn't show the ♿ pill that tells drivers a rider needs accessibility help, and the filter to show only accessibility-relevant rides doesn't exist either.

This also matters for Sprint 6 (Caregivers): the caregiver picker on iOS only appears for riders who have ticked "I need a wheelchair." Until web ships this sprint, web riders can't tick that box, so the caregiver picker would never appear. That's why **Sprint 7 needs to land before the caregiver work goes live on web**, or both need to ship in the same merge.

Thirteen specific items in seven slices. The first decision is whether the web should write these fields the same way iOS does (direct database writes through Supabase's library) or whether to add new server API routes. Both work — direct writes match iOS exactly and are faster; new routes add a layer for future validation but is more code. Recommend direct writes.

---

## Sprint 6 — Caregivers v1.2 parity

**Audit-first mode.** Stage 2 of the multi-stage iOS-parity audit completed 2026-05-30 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Headline

The entire caregiver feature is **iOS-only on user-facing surfaces**. Web has the full server contract in place — `/api/caregivers` CRUD shipped, `rides.caregiver_id` + `caregiver_fare_cents` columns shipped, `caregiverFareCentsFor` + `foldCaregiverFare` + `lookupDriverWaiveInfo` + `users.waive_caregiver_fee` all live in `server/routes/rides.ts` and `server/lib/segments.ts` — and the web admin RideDetailPage reads the columns for forensic display. **But every rider-side picker, driver-side context row, signup-time attach step, profile manager, fee waiver toggle, and chat waiver banner is missing on web.**

If a rider with a caregiver attached on iOS posts to the board or requests a ride, the matched web driver currently sees zero caregiver context — no name, no phone, no photo, no "Riding with caregiver" badge. If a web driver wants to waive the seat fee, there is no toggle. Both are real production gaps that affect real revenue and real disability-accessibility UX.

### Files read end-to-end during the audit

**Source-of-truth iOS surface (15 files):**

Data layer:
- [`ios/Tago/Core/Supabase/Repositories/CaregiversRepository.swift`](ios/Tago/Core/Supabase/Repositories/CaregiversRepository.swift) — iOS does **not** call the `/api/caregivers/*` REST routes; it talks directly to the `caregivers` table via the Supabase SDK, relying on RLS for ownership.
- [`ios/Tago/Models/Caregiver.swift`](ios/Tago/Models/Caregiver.swift) (confirmed via grep — not opened in this stage but used everywhere)

UI — Add / Manage:
- [`ios/Tago/Features/Profile/ProfileCaregiversSection.swift`](ios/Tago/Features/Profile/ProfileCaregiversSection.swift) — Profile card with list + Edit + Remove + Add row
- [`ios/Tago/Features/Profile/AddCaregiverSheet.swift`](ios/Tago/Features/Profile/AddCaregiverSheet.swift) — Add/Edit sheet (PhotosPicker, mandatory photo per CTO, ADD inserts → uploads → patches `avatar_url`)
- [`ios/Tago/Features/Auth/AddCaregiverOnboardingPage.swift`](ios/Tago/Features/Auth/AddCaregiverOnboardingPage.swift) — signup-time caregiver attach (Save & continue / Skip for now)

UI — Rider attaches at request / board-post time:
- [`ios/Tago/Features/RiderHome/RideConfirmCaregiverSection.swift`](ios/Tago/Features/RiderHome/RideConfirmCaregiverSection.swift) — picker on RideConfirmPage (gated on `hasAccessibilityNeeds && !caregivers.isEmpty`)
- [`ios/Tago/Features/Schedule/SchedulePostPage.swift`](ios/Tago/Features/Schedule/SchedulePostPage.swift) — caregiver picker on rider-mode board posts (same gating, wheelchair check) + `RideConfirmCaregiverSection` reuse
- [`ios/Tago/Features/Schedule/SchedulePostViewModel.swift`](ios/Tago/Features/Schedule/SchedulePostViewModel.swift) + [`SchedulePostViewModel+Submit.swift`](ios/Tago/Features/Schedule/SchedulePostViewModel+Submit.swift) — `selectedCaregiverID` + `caregiverFareCents` plumbed through every submit path (single-day, recurring routine, etc.)
- [`ios/Tago/Features/RideBoard/RideBoardConfirmSheet.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmSheet.swift) + [`RideBoardConfirmViewModel.swift`](ios/Tago/Features/RideBoard/RideBoardConfirmViewModel.swift) — caregiver picker on rider-on-driver-post path
- [`ios/Tago/Features/RideBoard/RequestEnrichment.swift`](ios/Tago/Features/RideBoard/RequestEnrichment.swift) — wire shape carrying `caregiver_id` + `distance_km` into board-request submits

UI — Driver consumes:
- [`ios/Tago/Features/DriverHome/DriverPickupPage.swift`](ios/Tago/Features/DriverHome/DriverPickupPage.swift) — `CaregiverContextRow` under rider card (`liveState.caregiverName/Phone/AvatarURL`)
- [`ios/Tago/Features/DriverHome/DriverActiveRidePage.swift`](ios/Tago/Features/DriverHome/DriverActiveRidePage.swift) — fetches caregiver row via direct Supabase SDK after match (lines 1141-1152), surfaces same row through active-ride phase
- [`ios/Tago/Features/DriverHome/DriverActiveRideDrawer.swift`](ios/Tago/Features/DriverHome/DriverActiveRideDrawer.swift) — drawer with `CaregiverContextRow` mounted unconditionally
- [`ios/Tago/Features/DriverHome/DriverHomePage.swift`](ios/Tago/Features/DriverHome/DriverHomePage.swift) + [`DriverHomePage+Sections.swift`](ios/Tago/Features/DriverHome/DriverHomePage+Sections.swift) — Preferences card "Waive caregiver fee" toggle with optimistic local mirror
- [`ios/Tago/Features/DriverHome/RideSuggestionPage.swift`](ios/Tago/Features/DriverHome/RideSuggestionPage.swift) — driver's earnings preview applies own waiver to `+ $X caregiver seat fee` delta
- [`ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift`](ios/Tago/Features/RideBoard/BoardOfferAcceptPage.swift) — rider sees "X waives the $5 caregiver seat fee 💛" banner when matched driver opts in
- [`ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift`](ios/Tago/Features/RideBoard/RideBoardFilterSheet.swift) — filter chip referencing caregiver-aware vehicles (touchpoint only; full filter work in Stage 3 accessibility)

Shared DesignSystem (driver-facing context):
- [`ios/Tago/DesignSystem/Components/CaregiverContextRow.swift`](ios/Tago/DesignSystem/Components/CaregiverContextRow.swift) — "Riding with caregiver" pill with avatar / name / chevron / phone-badge that opens `CaregiverInfoSheet`
- [`ios/Tago/DesignSystem/Components/CaregiverInfoSheet.swift`](ios/Tago/DesignSystem/Components/CaregiverInfoSheet.swift) — medium-detent sheet with hero avatar + Call / Message / Copy buttons + DJC "who is a caregiver?" blurb

iOS endpoints touched (caregiver fields only):
- [`ios/Tago/Core/Networking/Endpoints/RequestRideEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/RequestRideEndpoint.swift) — sends `caregiver_id` on instant ride request
- [`ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ScheduleRequestEndpoint.swift) — sends `caregiver_id` on rider-on-driver-post path
- [`ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/BoardOfferEndpoints.swift) — `has_caregiver`, `caregiver_fare_cents`, `driver.waive_caregiver_fee` on board-offer decode

**Server + migrations (4 files):**
- [`supabase/migrations/089_caregivers.sql`](supabase/migrations/089_caregivers.sql) — table + hard-delete RLS
- [`supabase/migrations/091_rides_caregivers.sql`](supabase/migrations/091_rides_caregivers.sql) — `rides.caregiver_id` + `caregiver_fare_cents`, same on `ride_schedules`, partial indexes, `ON DELETE SET NULL`
- [`supabase/migrations/092_users_waive_caregiver_fee.sql`](supabase/migrations/092_users_waive_caregiver_fee.sql) — driver-side goodwill opt-out boolean
- [`supabase/migrations/093_caregivers_avatar_url.sql`](supabase/migrations/093_caregivers_avatar_url.sql) — photo URL column (mandatory at iOS UI; nullable at DB for back-compat)
- [`server/routes/caregivers.ts`](server/routes/caregivers.ts) — `/api/caregivers` POST / GET / PATCH / DELETE (validators, hard delete, ownership 404)
- [`server/routes/rides.ts`](server/routes/rides.ts) — `caregiverFareCentsFor` (tiers revised 2026-05-22 per DJC to **< 10 mi $3 / 10–50 mi $5 / > 50 mi $8**), `foldCaregiverFare`, `lookupDriverWaivesCaregiverFee`, `lookupDriverWaiveInfo`, FCM-payload caregiver context surfaced to drivers (lines 852-868), `caregiver_fee_waived` chat-message insert post-match (lines 2500-2548)
- [`server/lib/segments.ts`](server/lib/segments.ts) — `computeRiderTotals` folds `caregiver_share_cents` into the per-rider settlement total for multi-rider trips
- [`server/routes/users.ts`](server/routes/users.ts) — `waive_caregiver_fee` exposed on user profile reads

**Web user-facing surface (audit result):**
- ❌ **No web user-facing UI exists.** Confirmed via `grep -rln caregiver src/` — only matches are admin (`src/components/admin/RideDetailPage.tsx` displays `ride.caregiver_id` + `ride.caregiver_fare_cents` for forensic context) and test files (`src/test/server/caregivers.test.ts`, `rides.contact.test.ts`, `segments.test.ts`, `userPublicProfile.test.ts`). Zero hooks, zero components, zero call sites.

### Side-by-side parity matrix

| Surface | iOS | Web | Verdict |
|---|---|---|---|
| **Data model (mig 089/091/092/093)** | Reads `caregivers` directly via Supabase SDK; RLS-scoped to `user_id = auth.uid()` | Same schema; web admin reads via service-role; user-facing reads would also need RLS-scoped Supabase client OR the existing `/api/caregivers` REST routes | ✅ schema parity; web client doesn't read yet |
| **Caregivers CRUD endpoints** | iOS uses Supabase SDK (`CaregiversRepository`) — does NOT call `/api/caregivers/*` | `/api/caregivers` POST / GET / PATCH / DELETE shipped; no web client calls them | ⚠️ web has a usable REST surface that web hasn't connected to UI; iOS bypasses it. Either is fine — pick one and stick to it on web. |
| **Onboarding caregiver attach** | `AddCaregiverOnboardingPage` — photo (required) + name + phone + notes, Save & continue / Skip | ❌ no equivalent step in web onboarding | 🚨 user-facing gap |
| **Profile caregiver section** | `ProfileCaregiversSection` — list with avatars, Edit / Remove buttons, Add caregiver row, gated on `hasAccessibilityNeeds` | ❌ no equivalent on web Profile/Settings | 🚨 user-facing gap |
| **Add/Edit caregiver sheet** | `AddCaregiverSheet` — PhotosPicker (mandatory photo), name (1-100), phone (≤32 E.164), notes (≤500, 500-char counter), 1024px JPEG compression, ADD inserts → uploads → patches `avatar_url` | ❌ no equivalent | 🚨 user-facing gap |
| **Caregiver picker on RideConfirm (instant ride)** | `RideConfirmCaregiverSection` — toggle starts OFF, auto-selects first; `Menu` picker with multiple; +$3/$5/$8 fee preview from `Fare.caregiverFareCents(distanceKM:)` | ❌ web instant-ride request does not even accept `caregiver_id`; the server route validates it but no UI sends it | 🚨 user-facing gap + missing client-side fare math helper |
| **Caregiver picker on board post (rider mode)** | Same `RideConfirmCaregiverSection` reused inside `SchedulePostPage` + `RideBoardConfirmSheet`; gating `hasAccessibilityNeeds && needsWheelchair && !caregivers.isEmpty` | ❌ web board-post UI has no caregiver section | 🚨 user-facing gap |
| **Caregiver context on driver pickup** | `DriverPickupPage` mounts `CaregiverContextRow` under rider card; tap → `CaregiverInfoSheet` (avatar hero + Call / Message / Copy + DJC blurb) | ❌ web driver pickup screens show nothing about the caregiver | 🚨 driver UX gap — driver doesn't know who's coming with the rider |
| **Caregiver context on driver active ride** | `DriverActiveRideDrawer` keeps `CaregiverContextRow` mounted through the active phase; supabase fetch fills `caregiverName/Phone/AvatarURL` on accept | ❌ web active-ride drawer drops the caregiver context entirely | 🚨 same as above, persists through ride |
| **FCM ride_request push payload** | Server already ships `has_caregiver`, `caregiver_name`, `caregiver_fare_cents` in [`server/routes/rides.ts:866-868`](server/routes/rides.ts#L866-L868); iOS foreground handler renders the "Riding with caregiver" badge + fare delta | Web foreground FCM handler — needs verification it doesn't choke on the new fields, AND should render the same badge + fee delta on the ride-request alert | ⚠️ likely already-silent (extra payload fields are ignored) but the badge is missing |
| **Driver "Waive caregiver fee" toggle** | `DriverHomePage+Sections` — Preferences card toggle with optimistic local mirror; PATCH `/api/users/me` `{ waive_caregiver_fee }` | ❌ web Settings has no equivalent; `waive_caregiver_fee` boolean is hidden from any UI | 🚨 revenue/UX gap — a web-only driver can never opt into the goodwill flow |
| **Driver earnings preview applies waiver** | `RideSuggestionPage.visibleCaregiverFareCents` zeros when own waiver is on; shows "+$X caregiver seat fee waived" copy | ❌ web has no driver suggestion / earnings preview that surfaces caregiver context | 🚨 same surface gap as above |
| **Rider sees waiver banner on board offer** | `BoardOfferAcceptPage::caregiverWaiverBanner` — "Sarah waives the $5 caregiver seat fee 💛" when `posted.hasCaregiver && offer.driver.waiveCaregiverFee` | ❌ web board-offer-accept doesn't read `driver.waive_caregiver_fee` or render the banner | 🚨 rider doesn't know they're getting the waiver |
| **Chat `caregiver_fee_waived` system message** | Server inserts the message on `/select-driver` (rides.ts:2500-2548); iOS chat renders it | Web chat — verify it renders the `type: 'caregiver_fee_waived'` row with the proper styling (not a raw text bubble) | ⚠️ likely renders as generic system row; needs purpose-built rendering |
| **Caregiver photo (mig 093)** | Mandatory on add/edit per CTO call 2026-05-23; stored at `avatars/<rider>/caregivers/<id>.jpg`; rendered in ProfileCaregivers, AddCaregiverSheet, AddCaregiverOnboardingPage, CaregiverContextRow, CaregiverInfoSheet | ❌ web has no surfaces that would render it; pre-migration rows would also need the "Add photo" affordance | 🚨 same gap chain; per-feature mandatory upload UX needed |
| **Caregiver tier fee math** | iOS `Fare.caregiverFareCents(distanceKM:)` mirrors server `caregiverFareCentsFor` (DJC 2026-05-22 breakpoints) for client-side preview | Web has no `caregiverFareCents` helper in `src/lib/fare.ts` (verify) — needed for the rider's RideConfirm/board-post live preview | ⚠️ needed for UI work; server is the canonical source |
| **DJC explainer ("who is a caregiver?")** | `CaregiverInfoSheet::definitionBlock` ships the DJC-approved copy | ❌ web has no equivalent | ⚠️ ship copy verbatim when porting `CaregiverInfoSheet`-equivalent |
| **Hard-delete semantics** | iOS `ProfileCaregiversSection` shows confirm dialog: "Past rides keep their record but the caregiver tag will be cleared" | Needs the same copy when porting Delete | ⚠️ port copy verbatim |
| **Admin RideDetailPage caregiver line** | n/a | Web admin already reads `ride.caregiver_id` + `caregiver_fare_cents` in [src/components/admin/RideDetailPage.tsx#L417-L451](src/components/admin/RideDetailPage.tsx#L417-L451) | ✅ admin parity OK |

### Actionable item list (W-T1-CG\* — Caregivers)

Severity: 🚨 user-facing functional gap, ⚠️ polish / contract verification, 🧹 cleanup.

| ID | Surface | What's missing on web | Severity |
|---|---|---|---|
| **W-T1-CG1** | `src/lib/caregiversApi.ts` (new) or a `src/hooks/useCaregivers.ts` | Thin client over `/api/caregivers` (GET/POST/PATCH/DELETE) with React Query hooks. Foundation for everything below. | 🚨 |
| **W-T1-CG2** | `src/lib/fare.ts` | Add `caregiverFareCents(distanceKm)` mirroring server `caregiverFareCentsFor` (DJC 2026-05-22 breakpoints: < 10 mi → 300¢, 10–50 mi → 500¢, > 50 mi → 800¢). Plus Vitest cases pulled from server's existing tests if any. | 🚨 |
| **W-T1-CG3** | `src/components/profile/CaregiversSection.tsx` (new), mounted on `SettingsPage` for users with `hasAccessibilityNeeds` | Profile section: list with avatar + name + phone + notes + Edit / Remove buttons + "Add caregiver" row. Confirm-dialog copy "Past rides keep their record but the caregiver tag will be cleared." Mirrors iOS `ProfileCaregiversSection`. | 🚨 |
| **W-T1-CG4** | `src/components/profile/AddCaregiverSheet.tsx` (new) | Add/Edit modal with mandatory photo picker, name (1-100), phone (≤32), notes (≤500 with counter). ADD: POST `/api/caregivers` → upload to `avatars/<rider>/caregivers/<id>.jpg` via supabase-js storage → PATCH `avatar_url`. EDIT: re-upload only if user re-picks. 1024px / 0.8-quality JPEG compression. Same UX as iOS sheet. | 🚨 |
| **W-T1-CG5** | Onboarding flow (locate web equivalent of iOS `AddCaregiverOnboardingPage`) | Optional onboarding step: "Add a caregiver" with same Save & continue / Skip CTAs. Gate behind `hasAccessibilityNeeds` from Stage 3. | 🚨 |
| **W-T1-CG6** | `src/components/ride/RideRequestPage.tsx` (or wherever the rider confirms an instant ride) | Add caregiver section: toggle + picker (auto-select first caregiver; `<select>` dropdown when multiple) + live fare preview (`+ $X caregiver seat fee`). On submit, pass `caregiver_id` to `POST /api/rides` — server already validates + recomputes fare. | 🚨 |
| **W-T1-CG7** | `src/components/schedule/SchedulePostPage.tsx` (board post) | Same caregiver picker on rider-mode posts; nothing on driver-mode. Mirrors `RideBoardConfirmSheet` gating: `hasAccessibilityNeeds && needsWheelchair && !caregivers.empty`. | 🚨 |
| **W-T1-CG8** | `src/components/ride/DriverPickupPage.tsx` (or web equivalent) | Add `CaregiverContextRow`-equivalent: avatar + "Riding with caregiver" header + name + Call/Message/Copy badge. Tap opens detail sheet with hero avatar + 3-action grid + DJC blurb. Fetch caregiver row via supabase-js after `caregiver_id` arrives from `/api/rides/active` join. | 🚨 |
| **W-T1-CG9** | `src/components/ride/ActiveRidePage.tsx` (driver-side variant) | Persist the same caregiver context through the active phase. iOS does this via `DriverActiveRideDrawer`. | 🚨 |
| **W-T1-CG10** | `src/components/ride/SettingsPage.tsx` (driver-only section) | Add "Waive caregiver fee" toggle gated on `auth.profile.is_driver`. Optimistic local state + PATCH `/api/users/me`. Description copy: "Don't charge the extra caregiver fare on accessibility rides." | 🚨 |
| **W-T1-CG11** | Web board-offer-accept (rider sees driver offers) | Render "X waives the $5 caregiver seat fee 💛" banner when `posted.hasCaregiver && offer.driver.waive_caregiver_fee`. Mirror iOS `BoardOfferAcceptPage::caregiverWaiverBanner` color/copy. | 🚨 |
| **W-T1-CG12** | Web chat (`src/components/ride/MessagingPage.tsx` or equivalent) | Custom render for `messages.type === 'caregiver_fee_waived'`. iOS renders a system-style row; verify web doesn't print the raw `content` as a normal text bubble. | ⚠️ |
| **W-T1-CG13** | Web foreground FCM handler (`src/lib/firebase.ts` or `RideRequestNotification.tsx`) | When the incoming `ride_request` push carries `has_caregiver === 'true'`, render the rider notification card with a "+ caregiver" badge and the `+$caregiver_fare_cents` fare delta. iOS already does this. | ⚠️ |
| **W-T1-CG14** | `src/test/server/caregivers.test.ts` + new web component tests | Vitest coverage for new client + components. Validate POST payload shape (name required, ≤100 chars), DELETE confirmation copy, fare preview tiers. | ⚠️ |

### Dependencies on other stages

- **Stage 3 (Vehicle + user accessibility)** ships `hasAccessibilityNeeds` + `needsWheelchair` user-profile fields. Sprint 6 picker visibility depends on these. Recommendation: do Stage 3 audit **before** starting Sprint 6 implementation so the gate predicate is already in place. The two sprints could even bundle into one PR per area.
- **Migration 040 (`avatars` storage bucket RLS)** must allow the `avatars/<rider>/caregivers/<id>.jpg` path. iOS confirms this works (line 14 of `AddCaregiverSheet.swift`). Web upload uses the same supabase-js storage client so it should work identically — but verify with a live upload during Slice 1 QA.

### iOS-side reciprocal gaps

None on the caregiver feature itself — iOS is the source of truth and is feature-complete (CTO call on mandatory photo + DJC fee tier revisions all landed). The only iOS-side concern is that `CaregiversRepository` bypasses `/api/caregivers/*` and goes direct to the table — fine today, but future server-side enrichments (audit logging, soft-delete revival, etc.) would land in the route and iOS would miss them. Not in web parity scope.

### Sprint 6 slice plan

Twelve user-facing items + two foundations. Slicing by user journey so each slice ships a complete user-visible chunk and doesn't strand half-built infrastructure.

#### Slice 1 — Foundation (W-T1-CG1 + W-T1-CG2)
React Query hooks + caregiver fare math helper. No user-visible change yet, but lint + tests + build green on this slice unblocks every later slice. Includes Vitest for the fare math against server's existing cases.

#### Slice 2 — Rider can manage caregivers (W-T1-CG3 + W-T1-CG4 + W-T1-CG14)
Profile section + Add/Edit sheet with mandatory-photo upload. After this slice, a web rider with accessibility needs can fully manage their caregivers — the foundation for everything downstream.

#### Slice 3 — Rider attaches caregiver to a ride (W-T1-CG6 + W-T1-CG7)
Picker on RideRequestPage + SchedulePostPage. Server already accepts and validates `caregiver_id` + recomputes the fare. After this slice, web riders can ship caregiver-attached rides to iOS drivers (where the driver sees them via existing iOS UI) — even before Slice 4 closes the driver-side web view.

#### Slice 4 — Web driver sees the caregiver (W-T1-CG8 + W-T1-CG9 + W-T1-CG12 + W-T1-CG13)
`CaregiverContextRow` equivalent on DriverPickupPage + active drawer + ride_request push badge + chat `caregiver_fee_waived` rendering. Closes the driver-side blind spot.

#### Slice 5 — Driver waives + rider sees waiver (W-T1-CG10 + W-T1-CG11)
Settings toggle + board-offer waiver banner. Smaller surface, can ship after Slice 4 once the chat type renders.

#### Slice 6 — Onboarding step (W-T1-CG5)
Lower priority — users can add caregivers from Profile any time. Ship after Stage 3 lands the `hasAccessibilityNeeds` predicate.

### Sprint 6 summary

| Status | Count |
|---|---|
| Not started | 14 |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

### Current focus

Awaiting Tarun's call on whether to ship Sprint 5 first (notifications drift) or interleave Sprint 6. The two sprints touch independent surfaces — no merge conflict if both run in parallel.

### Next action

Tarun decides:
1. Sprint 5 Slice 1 first (notifications drift — small, fast, fixes a broken UX today)
2. Sprint 6 Slice 1 + 2 first (caregivers foundation — high value but multi-slice path)
3. Run Stage 3 audit (accessibility profile) before Sprint 6 implementation so the gate predicate lands together

### Plain English

The audit found that the **caregivers feature is essentially missing on the web app**. iOS lets a rider with a disability save up to N caregivers in their profile with name, photo, phone, and notes; attach one to any specific ride; and pay a $3/$5/$8 seat fee that goes to the driver. Drivers see the caregiver's name and photo on their pickup screen so they recognize who's coming with the rider. Drivers can also opt into waiving the fee as a goodwill gesture.

On web, the database is set up, the server routes are written, and the admin dashboard can already read caregiver info on rides — but **no rider on the web can add a caregiver, attach one to a ride, or see a fee preview**, and **no driver on the web can see who the rider's caregiver is or opt into waiving the fee**. Stripe still charges the right amount (the iOS rider's attachment carries through), but the web app is invisible to that whole workflow.

There are 14 specific things to build. They group into six slices, each of which leaves the app in a shippable state. The biggest single missing piece is the driver-side caregiver context row — without it, web drivers don't know who's getting in the car with the rider, which matters for accessibility/dignity reasons (the whole point of the feature).

---

## Sprint 5 — Reports v2 parity

**Audit-first mode.** Stage 1 of the multi-stage iOS-parity audit completed 2026-05-30 with no code changes. This section is the side-by-side findings + slice plan. Nothing here is shipped on the web app yet.

### Files read end-to-end during the audit

**iOS surface (4 feature files + 2 endpoint files + 2 models):**
- [`ios/Tago/Features/Reports/MyReportsPage.swift`](ios/Tago/Features/Reports/MyReportsPage.swift) — list page, pull-to-refresh, offset pagination
- [`ios/Tago/Features/Reports/MyReportDetailPage.swift`](ios/Tago/Features/Reports/MyReportDetailPage.swift) — header card + thread + reply compose
- [`ios/Tago/Features/Reports/ReportDeepLinkPage.swift`](ios/Tago/Features/Reports/ReportDeepLinkPage.swift) — push-tap landing page with glass loading state
- [`ios/Tago/Features/Reports/ReportPills.swift`](ios/Tago/Features/Reports/ReportPills.swift) — SeverityPill (hides .normal/.low) + StatusPill
- [`ios/Tago/Core/Networking/Endpoints/ReportEndpoints.swift`](ios/Tago/Core/Networking/Endpoints/ReportEndpoints.swift) — CreateReport, MyReports, ReportDetail, PostReportMessage
- [`ios/Tago/Core/Networking/Endpoints/ReportSafetyEndpoint.swift`](ios/Tago/Core/Networking/Endpoints/ReportSafetyEndpoint.swift) — legacy safety report (Phase 2c rewired metadata only)
- [`ios/Tago/Features/RiderHome/ReportIssuePage.swift`](ios/Tago/Features/RiderHome/ReportIssuePage.swift) — generic in-app report form (6-pill categories, Phase 2b rewired to POST /api/report)
- [`ios/REPORTS_IOS_PLAN.md`](ios/REPORTS_IOS_PLAN.md) — iOS port plan (Phase 2a/2b/2c/2d)

**Web surface (5 components + 1 hook + 1 lib + 4 admin pieces):**
- [`src/components/reports/MyReportsPage.tsx`](src/components/reports/MyReportsPage.tsx) — list page, page-based pagination, "+ New" CTA opens ReportFlowSheet
- [`src/components/reports/MyReportDetailPage.tsx`](src/components/reports/MyReportDetailPage.tsx) — header + thread + reply compose + closed-state banner
- [`src/components/reports/ReportFlowSheet.tsx`](src/components/reports/ReportFlowSheet.tsx) — 4-step bottom sheet (category → form → review → submitted) reused across post_ride / wallet / settings / general
- [`src/components/reports/categoryConfig.ts`](src/components/reports/categoryConfig.ts) — 14 categories × 5 contexts taxonomy, severity/status tone maps
- [`src/hooks/useReports.ts`](src/hooks/useReports.ts) — useMyReports / useReportDetail / useCreateReport / usePostReportMessage
- [`src/lib/reportsApi.ts`](src/lib/reportsApi.ts) — fetch wrapper + ReportsApiException
- [`src/components/admin/ReportsInboxPage.tsx`](src/components/admin/ReportsInboxPage.tsx) — admin inbox with filter chips + sort + counter
- [`src/components/admin/ReportDetailPage.tsx`](src/components/admin/ReportDetailPage.tsx) — 3-column admin view + reply-channel toggle + status/severity actions + audit log
- [`src/components/ride/ReportIssuePage.tsx`](src/components/ride/ReportIssuePage.tsx) — **legacy** standalone route still mounted at `/report-issue`
- [`src/components/ride/RideReportPage.tsx`](src/components/ride/RideReportPage.tsx) — **legacy** standalone route still mounted at `/report/:rideId`

**Server + alerts:**
- [`server/routes/report.ts`](server/routes/report.ts) — user-facing endpoints (POST /, GET /me, GET /:id, POST /:id/messages, POST /:id/attachments)
- [`server/routes/admin/reports.ts`](server/routes/admin/reports.ts) — admin endpoints + notifyReporter (FCM push + notifications row insert)
- [`server/lib/adminAlerts.ts`](server/lib/adminAlerts.ts) — Slack + email + Phase 6a outbound support reply via Resend
- [`supabase/migrations/086_reports_v2.sql`](supabase/migrations/086_reports_v2.sql) — schema, RLS, storage bucket

### Side-by-side parity matrix

| Surface | iOS | Web | Verdict |
|---|---|---|---|
| **Schema (mig 086)** | Reads `reports` (reporter_id/body), `report_messages`, `report_attachments`, `report_audit_log`, `report-attachments` storage bucket | Same | ✅ parity |
| **14-category taxonomy** | `ReportCategory.swift` enum (14 cases) | `categoryConfig.ts::CATEGORIES` (14 entries) + 5 contexts | ✅ parity |
| **4-severity ladder** | `ReportSeverity.swift` (emergency/urgent/normal/low) | `useReports.ts::ReportSeverity` (same 4) | ✅ parity |
| **5-status lifecycle** | `ReportStatus.swift` (open/in_progress/awaiting_user/resolved/closed) | `categoryConfig.ts::ReportStatus` (same 5) | ✅ parity |
| **POST /api/report** | `CreateReportEndpoint` — new shape (category/title/body/ride_id/subject_user_id/schedule_id/requested_refund_cents/metadata); also `ReportSafetyEndpoint` (legacy `description` field, Phase 2c metadata rewire) | `useCreateReport` via `reportsPost('/')` — new shape | ✅ parity (both clients use new shape; server's `LEGACY_CATEGORY_MAP` + `description`-alias keeps old iOS build 7 working) |
| **GET /api/report/me** | `MyReportsEndpoint(limit, offset)` | `useMyReports({limit, offset})` | ✅ parity |
| **GET /api/report/:id** | `ReportDetailEndpoint` (lowercased UUID in path) | `useReportDetail(id)` | ✅ parity (both produce lowercase IDs in practice) |
| **POST /api/report/:id/messages** | `PostReportMessageEndpoint` | `usePostReportMessage(id)` | ✅ parity |
| **POST /api/report/:id/attachments** | ❌ no endpoint shipped on iOS yet — no attachment-picker UI | ❌ no upload UI on web user-side either (admin sees attachments via signed URLs only) | ➖ both sides defer; parked for Phase 5 (per `docs/REPORTS_PLAN.md`) |
| **My Reports list page** | Pull-to-refresh ✓, offset pagination, SF Symbol per category, hides Normal/Low severity pill, empty state directs to Settings | No pull-to-refresh, page pagination, no category icon, shows all severities, empty state has direct "Report something" CTA opening ReportFlowSheet | ⚠️ **drift** — empty-state CTA is the highest gap; icons + pull-to-refresh are polish |
| **Detail page header** | Renders instantly from `seed: Report` while detail loads (no flash) | Top-of-page "Loading…" until query resolves (flash) | ⚠️ web-side polish gap |
| **Detail page thread** | MessageBubble with `isMine` alignment, closed-state banner with "Settings → Support" CTA | MessageBubble with `isMine`, closed-state banner with direct "Start a new report" CTA opening ReportFlowSheet | ✅ behaviour parity; iOS empty-state copy is the drift |
| **Generic-report entry point** | `ReportIssuePage` (6 pill categories, full-screen cover from Settings + ride history + summary) — still in use, NOT the new ReportFlowSheet UX | `ReportFlowSheet` (4-step bottom sheet, 14 categories filtered by context, GPS opt-in, refund amount, prefillCategory hint) used from RideSummaryPage/TransactionDetailPage/SettingsPage | ⚠️ **drift** — iOS lacks the unified bottom-sheet flow; will land in iOS Phase 2d per `REPORTS_IOS_PLAN.md` |
| **Per-context entry points** | RideSummary → ReportIssuePage (rideID), Settings → ReportIssuePage (rideID=nil), EmergencySheet → ReportSafetyView (safety only) | RideSummaryPage → ReportFlowSheet(context='post_ride'), TransactionDetailPage → ReportFlowSheet(context='wallet'), SettingsPage → ReportFlowSheet(context='general') | ⚠️ **drift** — web has wallet-context entry-point (issue with this charge?); iOS TransactionDetail has none |
| **GPS opt-in on submit** | Always nil (UI doesn't ask) | Checkbox in form step; uses `navigator.geolocation` | ⚠️ iOS drift (parked for Phase 2d) |
| **Push deep-link from report_* notifications** | `PushManager.handleNotificationTap` routes `report_reply`/`resolved`/`closed`/`awaiting_user` → `ReportDeepLinkPage` (glass loading + retry) → `MyReportDetailPage` | ❌ **`NotificationsPage` does NOT match any `report_*` type** — server inserts the notifications row + sends FCM with `type: 'report_reply'`/etc., but the web list shows the row with default icon and the tap is a no-op | 🚨 **HIGH priority** — broken UX on web for any admin reply / resolution |
| **In-app NotificationsPage row → detail** | `onOpenReport` callback presents `ReportDeepLinkPage` fullScreenCover | No handler — row renders but does nothing on tap | 🚨 same as above |
| **Admin inbox (`/admin/reports`)** | n/a (admin is web-only) | `ReportsInboxPage` — counter header, 5 filter chips, sort, severity-first default | ✅ web-only, no parity needed |
| **Admin detail (`/admin/reports/:id`)** | n/a | `ReportDetailPage` — 3-column (Context/Thread/Actions), Reply-via toggle (in_app/email/both), internal note checkbox, status flip with resolution-note confirm, severity override, audit log merged into thread | ✅ web-only, no parity needed |
| **Admin Slack/email alerts** | n/a | Phase 4 fan-out: emergency → Slack+email, urgent → Slack+email; user-reply Slack ping on emergency/urgent | ✅ web-only, no parity needed |
| **Phase 6a outbound admin reply email** | iOS has push notification path for reply (in-app); the email itself goes to reporter's email inbox separately via Resend | Same; admin picks "Reply via: email" or "both" in `ReportDetailPage::ReplyChannelToggle` | ✅ parity (server-side feature; both clients honour the resulting push + email) |
| **Closed report handling** | 409 REPORT_CLOSED → banner + hide compose | 409 REPORT_CLOSED → banner with "Start a new report" CTA + hide compose | ✅ parity |
| **awaiting_user → in_progress flip** | Server-side; iOS observes via refreshed status pill after refetch | Same | ✅ parity |
| **Internal admin notes** | Server filters `is_internal_note=true` from `/api/report/:id`; iOS never sees them | Same on user-facing GET; admin `ReportDetailPage::InternalNoteBubble` renders them yellow | ✅ parity |
| **Legacy `/report/:rideId` + `/report-issue` web routes** | n/a | Still mounted in [src/main.tsx#L223-L224](src/main.tsx#L223-L224); `RideReportPage.tsx` POSTs to `/api/report` directly (no ReportFlowSheet); `ReportIssuePage.tsx` is older form | ⚠️ **web-side cleanup** — pre-Phase-2 ReportFlowSheet routes; either remove or fold them into ReportFlowSheet for consistency |

### Actionable item list (W-T1-R\* — Reports v2)

Numbered for slice planning. Severity ranked by user impact: 🚨 broken UX, ⚠️ drift / polish, 🧹 cleanup.

| ID | Surface | What's missing on web | Severity |
|---|---|---|---|
| **W-T1-R1** | [`src/components/ride/NotificationsPage.tsx`](src/components/ride/NotificationsPage.tsx) | Recognise `report_reply` / `report_resolved` / `report_closed` / `report_awaiting_user` notification types: render with a report-style icon + tap navigates to `/reports/<n.data.report_id>`. Mirrors iOS `PushManager.handleNotificationTap` + `NotificationsPage::onOpenReport`. | 🚨 |
| **W-T1-R2** | Service worker / FCM push handler | When a push arrives with `data.type === 'report_*'`, focus or navigate the existing tab to `/reports/<report_id>`. Verify the web FCM payload from `server/routes/admin/reports.ts::notifyReporter` actually carries `data.report_id` (it does — line 87). | 🚨 |
| **W-T1-R3** | [`src/components/reports/MyReportsPage.tsx`](src/components/reports/MyReportsPage.tsx) | Pull-to-refresh affordance for mobile web (use `useSWR`-style refetch on swipe-down or a manual "Refresh" button at the top). iOS has `.refreshable` for free; web needs to add it explicitly so users on the PWA don't have to leave + return to see admin replies. | ⚠️ |
| **W-T1-R4** | [`src/components/reports/MyReportDetailPage.tsx`](src/components/reports/MyReportDetailPage.tsx) | Optimistic header render — pass a `seed` prop from `MyReportsPage` when navigating, render the header (severity + status pills, title, body, created_at) from the seed while the React Query hook re-validates. Mirrors iOS `MyReportDetailPage(seed:)`. | ⚠️ |
| **W-T1-R5** | [`src/components/reports/categoryConfig.ts`](src/components/reports/categoryConfig.ts) + [`src/components/reports/MyReportsPage.tsx`](src/components/reports/MyReportsPage.tsx) | Add a SF-Symbol-equivalent icon per category (Heroicon or Lucide), render in the list card on the left. Aligns visual scan with iOS list. | ⚠️ |
| **W-T1-R6** | [`src/components/reports/MyReportsPage.tsx`](src/components/reports/MyReportsPage.tsx) | Hide severity pill for Normal + Low rows (only colour-emphasize Emergency + Urgent). Matches iOS `SeverityPill::shouldRender`. Keeps the list "calm" when there are no high-priority reports. | ⚠️ |
| **W-T1-R7** | [`src/main.tsx`](src/main.tsx#L223-L224) | Decide on the legacy `/report-issue` + `/report/:rideId` routes. Either (a) delete them and update internal links to open `ReportFlowSheet` with the right context+prefillCategory, or (b) make them shim into ReportFlowSheet for backwards-compatibility with any old deep-links. Recommendation: delete and audit `git log` for cross-references. | 🧹 |
| **W-T1-R8** | [`src/components/reports/MyReportsPage.tsx`](src/components/reports/MyReportsPage.tsx) | Realtime subscription on `reports` + `report_messages` for the signed-in user so the inbox updates live when admin sends a reply (matches iOS push-driven refresh). Optional polish — current 5min staleTime + push-handler refetch is acceptable as Slice-2 polish. | ⚠️ |

### iOS-side reciprocal gaps (NOT in scope for web sprint — captured for Tarun)

These are things web has that iOS will need to close on its side (per `REPORTS_IOS_PLAN.md::Phase 2d`):

- iOS lacks the unified `ReportFlowSheet` (4-step bottom-sheet, GPS opt-in, refund amount, prefillCategory). Web has the better UX here.
- iOS has no wallet-context entry-point in `TransactionDetailPage`-equivalent (the iOS wallet detail row doesn't expose "Issue with this charge?").
- iOS still ships the legacy `ReportSafetyView` + `ReportIssuePage` instead of folding both into a single flow.

Not a web concern — flagged for the next iOS sprint.

### Sprint 5 slice plan

Per the per-feature green-light + tough-self-review-before-handoff rules. Every slice ends with lint + test + build green + reviewer pass + commit + wait for Tarun's "go" before shipping the next.

#### Slice 1 — Notifications drift (W-T1-R1 + W-T1-R2)
**Highest blast radius — every admin reply currently fails to open the report on web.** Add report-type recognition to `NotificationsPage`, route to `/reports/:id` on tap; verify the FCM service worker payload focuses an existing tab on the correct route. Includes one Vitest covering the icon-rendering + tap-navigation paths and a manual QA checklist (send a test report on prod → admin replies → confirm the in-app row + push open the report).

#### Slice 2 — List polish (W-T1-R3 + W-T1-R5 + W-T1-R6)
Pull-to-refresh on mobile web, category icon in the list card, hide Normal/Low severity pill. Closes three visual drift items in one PR since they all touch the same component.

#### Slice 3 — Detail polish (W-T1-R4)
Seed-based header rendering. Pass the list row into navigation state so the detail page doesn't flash. Mirrors iOS `MyReportDetailPage(seed:)`.

#### Slice 4 — Cleanup (W-T1-R7)
Delete legacy `/report-issue` + `/report/:rideId` routes after `git log -S` confirms nothing in production links to them; update any internal callers to open `ReportFlowSheet` with the right `context` + `prefillCategory`.

#### Slice 5 (deferred) — Realtime live thread (W-T1-R8)
Polish. Park unless the user explicitly asks for it; the existing push-driven refetch covers the load-bearing case.

### Sprint 5 summary

| Status | Count |
|---|---|
| Not started | 8 |
| In progress | 0 |
| Done (awaiting QA) | 0 |
| Done (verified + pushed) | 0 |

### Current focus

Awaiting Tarun's "go" on Slice 1 (notifications drift). No code changes have shipped from this audit yet.

### Next action

If Tarun greenlights Slice 1: read [`src/components/ride/NotificationsPage.tsx`](src/components/ride/NotificationsPage.tsx) end-to-end + the web FCM service worker, then plan the icon + tap-handler changes.

### Plain English

The audit found the Reports system works the same on iOS and web for the most important pieces — same database, same endpoints, same admin tools, same Slack/email alerts when something urgent comes in. But there's one **real bug on the web side**: when the admin replies to your report, iOS pops the conversation open right when you tap the notification, but on the web the notification just sits there and tap does nothing. That's the top thing to fix. The other gaps are smaller polish (better loading state, pull-to-refresh, hide low-priority pills) and one cleanup (two old report URLs that should be removed). The new iOS bottom-sheet for filing a report from the wallet or after a ride is actually a place where **web is ahead of iOS** — iOS has to catch up there in its own sprint.

---

## Sprint 4 — Messaging / Chat + Emergency parity

**Goal:** close every remaining Tier-1 chat gap vs iOS plus the Emergency Sheet trusted-contacts row. Ride Board work is being driven by the parallel admin session (migration 072 + `BoardOfferAcceptPage`) — Sprint 4 deliberately stays out of that namespace.

**Scope:** W-T1-M1, M2, M3, M4 + W-T1-E1 (5 items). M5 is already shipped on web (flagged as an iOS gap in the report).

**Status:** ⏳ In progress — Slice 1 shipped 2026-05-17.

### Sprint 4 slice plan

#### Slice 1 — Chat rendering polish (M1 + M3) ✅ shipped 2026-05-17
- [x] **M1** Optimistic outgoing bubbles render at 55% opacity with `Sending…` label on send; swap to authoritative row on POST success; mark `_failed` + show inline Retry CTA on error. Realtime echo handler de-dupes via `findOptimisticMatch` (same sender + content + 30s window) so the bubble doesn't render twice. Polling fallback preserves optimistic rows during refresh.
- [x] **M3** Day-divider headers (Today / Yesterday / long-form date) inserted whenever the calendar day changes between consecutive messages; sender-run grouping shows the timestamp only on the LAST message of a run (Messages.app pattern). Special-type messages (pickup_suggestion / dropoff_suggestion / etc.) always render standalone.

#### Slice 2 — Phase machine (M2) ✅ shipped 2026-05-17
- [x] **M2** Negotiation-phase machine derived in `MessagingWindow.tsx` from `(dropoff_confirmed, pickup_confirmed, ride.status)`. Three states: `dropoff` (dropoff not yet confirmed), `pickup` (dropoff done, pickup outstanding), `complete` (both confirmed OR ride active/cancelled/completed). Gates the pickup proposal Accept banner + inline Accept button + dropoff proposal banner + inline Accept + transit-dropoff Accept on the phase — a stale `pickup_suggestion` left from before dropoff confirmed no longer shows Accept during the dropoff phase. Mirrors iOS `MessagesViewModel+Phase.swift::derivePhase`.

#### Slice 3 — Keyboard dismiss + Emergency Sheet trusted contacts (M4 + E1) ✅ shipped 2026-05-17
- [x] **M4** Chat scroll container has an `onPointerDown` handler that blurs the active element when the pointer lands on a non-interactive area. `closest('input, textarea, button, label, a, [contenteditable], [role="button"]')` filters out actual controls so taps on them still focus normally. Closes the mobile-web keyboard trap (iOS Safari has no Done bar).
- [x] **E1** EmergencySheet now loads `/api/safety/trusted-contacts` on open. When at least one contact is on file, a new "Text my N trusted contacts" CTA opens the device SMS composer (`sms:<recipients>?&body=<encoded>`) pre-filled with the share-location link (when one exists in the session) or a generic check-in message. Added a "Stop sharing location" row that surfaces only while a share link is active and DELETEs `/api/safety/share-location/:token` to revoke immediately. Mirrors iOS `EmergencySheet+TrustedContacts.swift`. Adds the missing pieces beyond the current Call 911 / Share location / Report unsafe buttons.

### Sprint 4 summary

| Status | Count |
|---|---|
| Not started | 0 |
| In progress | 0 |
| Done (awaiting QA) | 5 |
| Done (verified + pushed) | 0 |

### Current focus
All Sprint 4 messaging + emergency items shipped. Awaiting prod QA.

### Next action
User QA on prod, then pick the next sprint area (Auth/Onboarding has 1 remaining item — W-T1-A2 photo gate decision).

---

## Sprint 3 — Wallet / Payments / Profile parity

**Goal:** close every remaining Tier-1 wallet/payment/profile gap vs iOS so the money side of the web app feels identical to iOS. Tago is a live production project — every drift gets closed, no "polish later" framing.

**Scope:** W-T1-P1, P2, P3, P4, P5, P6, P9 (7 items). P7 + P8 are already shipped on web (flagged as iOS gaps in the report).

**Status:** ⏳ In progress — Slice 1 starting 2026-05-16.

### Sprint 3 slice plan

#### Slice 1 — Driver-facing payment UX (W-T1-P9 + W-T1-P5) ✅ shipped 2026-05-16
- [x] **P9** RideSummaryPage role-aware payment badge + Settling reassurance card (driver never sees "Payment failed"); same neutral copy on WalletPage pending-earnings rows.
- [x] **P5** WalletPage nudge button honours 429 `retry_after_seconds` with a live `setInterval` countdown that self-stops when every per-ride deadline clears.

#### Slice 2 — Withdraw flow (W-T1-P3 + W-T1-P4) ✅ shipped 2026-05-16
- [x] **P3** WithdrawSheet editable amount + Half/All quick pills + $1 minimum + max = current balance, live validation messaging.
- [x] **P4** Confirm dialog with iOS copy ("Withdraw $X? Funds go to Chase •••• 4242. This action is irreversible from Tago.") loaded from `/api/connect/status`.

#### Slice 3 — Top-up flow (W-T1-P2 + W-T1-P1) ✅ shipped 2026-05-16
- [x] **P2** AddFundsPage loads default saved card via `/api/payment/methods`, renders "Use saved card · Visa •••• 4242" one-tap row + "Use a different card" toggle for the CardElement. Saved-card mode charges with `{ payment_method: pmId }` — no retype.
- [x] **P1** Stripe Payment Request Button (Apple Pay on Safari iOS, Google Pay on Chrome Android) above the card form, gated by `canMakePayment()` so it stays hidden where unsupported. Wallet sheet `paymentmethod` handler POSTs `/topup` → confirms with the wallet's PM → completes the sheet → fires `/confirm-topup`.

#### Slice 4 — Transaction visibility (W-T1-P6) ✅ shipped 2026-05-16
- [x] **P6** New `/wallet/transaction/:id` route + `TransactionDetailPage.tsx`. Signed-amount hero (sign + danger/success colour), status pill, withdrawal-failure banner stripping the server's `Refund — withdrawal declined: ` prefix, counterparty card (ride-linked rows fetch the other party + role), funding-source card for top-ups with `pm_brand` / `pm_wallet`, copyable references (Transaction ID, Stripe PaymentIntent, Stripe Transfer, Linked ride), description, "View ride details" deep-link, posted-at, settled-at (withdrawals), wallet-balance-after. Every WalletPage row is now tappable (previously only ride-linked).

### Sprint 3 summary

| Status | Count |
|---|---|
| Not started | 0 |
| In progress | 0 |
| Done (awaiting QA) | 7 |
| Done (verified + pushed) | 0 |

### Current focus
All Sprint 3 wallet / payment / profile items shipped. Awaiting prod QA.

### Next action
User QA on prod, then pick the next sprint area (Ride Board / Scheduling, Messaging, or Auth).

---

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
