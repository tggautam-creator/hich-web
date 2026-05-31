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
| 5 | **Trips & segments (split fare)** | mig 097, 098, trips endpoints, `Features/Rides/` | ⏳ pending |
| 6 | **Board redesign + Smart geo-match** | `docs/BOARD_REDESIGN_PLAN.md`, `SMART_SEARCH_PLAN.md`, `Features/RideBoard/`, board endpoints | ⏳ pending (coordinate with parallel session) |
| 7 | **Ride safety + forensics (admin)** | mig 094, 095, 096, `Features/Safety/`, `Features/AdminCampaign/` | ⏳ pending |
| 8 | **Endpoint coverage audit** | all 72 endpoints in `ios/Core/Networking/Endpoints/` | ⏳ pending |
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

- **Stages 1–4 audits landed**. Stages 5–9 still queued.
- **Sprint 8 (Suggestions + rider routines v1.3)** — ✅ Audit complete 2026-05-30. 6-slice plan landed below; no code yet. Headline: chasm-sized rider-side gap — iOS ships full Suggested Rides home hero + detail sheet + dismiss + lazy-routine action flow, web ships ZERO of it. Sprint 8 also bundles small parity corrections (mode badge on routine rows, Add-Routine pre-select, push_suggestions toggle).
- **Sprint 7 (accessibility / user profile)** — ✅ Slices 1–5 shipped + pushed (CI green 2026-05-30). Slice 6 (UserProfilePreviewCard polish) is the only remaining piece; parked unless surface emerges.
- **Sprint 6 (caregivers)** — ✅ Slices 1–6 shipped + pushed (CI green 2026-05-30). Slice 5's server response will light up on web + iOS once Vercel auto-deploy + EC2 PM2 pick up the new build.
- **Sprint 5 (Reports v2 polish)** — ⏳ Not started. Notifications-drift slice is highest blast radius; awaiting "go".

### Current focus

Stage 4 audit just landed. All Sprint 6 + Sprint 7 (except Slice 6 polish) are on `origin/main`.

### Next action

Tarun decides:
1. **Sprint 8 Slice 1** (Suggestions foundation: types + hooks + API helpers + FCM handler) — unblocks every later slice in Sprint 8.
2. **Sprint 5 Slice 1** (Reports v2 notifications drift — bounded slice, fixes a broken UX today).
3. Run **Stage 5 audit** (Trips & segments / split fare) — next in the audit pipeline.
4. Resolve any **open questions** in Sprint 8 (driver-side floating hero, Suggested tab on RideBoard, match-signals debug card visibility, feature-flag rollout).

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
