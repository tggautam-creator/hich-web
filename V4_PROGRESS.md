# TAGO — Version 4 Progress

> **How this file works:** Single source of truth for V4 build state. Every Claude session reads this at the start and updates it after EVERY slice (hard rule — see [V4_PLAN.md](V4_PLAN.md) §2.8). The plan is [V4_PLAN.md](V4_PLAN.md); this file is the *state*. Don't edit the plan to reflect what got built — only this file changes per slice.
>
> **Legend:** `[ ]` / ⬜ not started · `[~]` / 🟡 in progress · `[x]` / ✅ done (all gates green + Tarun verified) · 🔴 blocked
>
> **Gates** (a slice is `[x]` only when all are green — see [V4_PLAN.md](V4_PLAN.md) §2.4):
> - iOS: XCTest pass · `swiftlint --strict` clean on changed files · builds on sim AND device · post-build diff · parity matrix · Tarun verified on device
> - Web: `npm test -- --run` · `npm run lint` · `npm run build` · parity matrix · plain-English summary
>
> **Per-slice discipline (hard rule):** flip `[ ]`→`[~]` at slice start (don't batch) · append every non-obvious decision, every bug-and-fix, every plan change, every new requirement to the Decisions Log immediately · on completion flip `[x]` + update the Summary counts + Current focus / Next action + append a Recent Sessions row.

---

## Summary

| Metric | Count |
|---|---|
| Total slices | 90 (Features 1–7; F4 grew +2 for the board-detail fare) |
| Done (verified by Tarun) | 4 — F4 A.1, A.2, A.3, A.4 |
| In progress | 0 |
| Not started | 86 |
| Blocked | 0 |

**⚠️ Sprint scope (2026-06-05, §2.15):** iOS app + required server only. **Web frontend (`src/`) parity is DEFERRED** — Tarun does the webapp pass later. Skip all web blocks for now.

**Current focus:** **F5 System A (App Gate) DONE + verified by Tarun ("Its working", 2026-06-05) + committed locally.** Force-update + maintenance, fail-open, launch/foreground/5-min checks. Mig 118 applied to dev. Admin UI (A.3) + web (A.5) + soft-update nudge deferred to the web pass. Next iOS: F5 System B (Announcements) or F1 (Companion) — Tarun's call. Previously: **F4 done + verified + committed.** Post-success confirmation (incl. caregiver add-on) + the "My Rides → home" fix + **fare on the ride-board detail** (estimated fare/earnings + caregiver add-on + tappable caregiver profile, no phone pre-accept). All automated gates green (sim+device build, installed both, 29 FareTests, server typecheck, new files lint-clean; pre-existing length warnings on SchedulePostPage/RideBoardDetailSheet logged). Web deferred per §2.15. **Awaiting Tarun's visual verification.** ⚠️ **Dev server must be running** for the caregiver block on the board (tsx watch hot-reloads). Next iOS after go: **F5 System A (App Gate)** or **F1 (Companion)**.

**Recommended build order (§6.3):** Phase 0 = **F4** (warm-up, client-only) + **F5 System A** (App Gate — release safety) → Phase 1 **F1** → Phase 2 **F2** → Phase 3 **F3** → Phase 4 **F6** → Phase 5 **F7**; F5 Announcements interleaved with F6 launch.

**Next action:** On Tarun's "go", begin **first slice = F4 → iOS A.1** (FareAcknowledgment view + driver earnings-range calc; §6.8). One slice at a time: flip `[ ]`→`[~]` here on start, run full gates + parity matrix + handoff, wait for green-light before the next.

**⚠️ Convergence zone (§6.2):** `/api/rides/end` + `chargeRideViaWallet` + settlement is touched by F1, F2, F3, F6 — single owner, strict F1→F2→F3→F6 order, full regression each step. Do NOT parallelize.

---

## Slice tracker

> One table per feature. Mirrors [V4_PLAN.md](V4_PLAN.md) §5. Flip status the moment a slice starts/finishes (hard rule).

### Feature 1 — Companion option

**Block A — Backend (server + DB)**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: companions table + ride/schedule FK columns + users.waive_companion_fee + RLS | ⬜ |
| A.2 | companions CRUD route + validators + tests | ⬜ |
| A.3 | companionFareCentsFor + fold + waive lookup; wire request + FCM payload + tests | ⬜ |
| A.4 | End-of-ride recompute (caregiver + companion from real distance) + tests | ⬜ |
| A.5 | Schedule/board path + /rides/active companion identity post-accept + tests | ⬜ |
| A.6 | /users/profile waive_companion_fee read/write + tests | ⬜ |

**Block B — iOS**
| # | Slice | Status |
|---|---|---|
| B.1 | Companion model + repository + CRUD endpoints | ⬜ |
| B.2 | Profile Companions section + add/edit sheet (photo required) + contacts picker + Info.plist perm | ⬜ |
| B.3 | Instant RideConfirm companion toggle + up-to-2 multi-select + fee preview | ⬜ |
| B.4 | Board request companion toggle (rider-only) | ⬜ |
| B.5 | Driver waive companion toggle (DriverHome + EditProfile) + help box | ⬜ |
| B.6 | Driver request surfacing (FCM badge + request-review rows + earnings) | ⬜ |
| B.7 | Companion context rows on pickup + active-ride drawers | ⬜ |
| B.8 | Chat thread caregiver + companion identity (closes gap) | ⬜ |
| B.9 | Ride summary companion fee line + rows | ⬜ |
| B.10 | Board card "with companions"/"with caregiver" badge | ⬜ |

**Block C — Web parity** (defer-able)
| # | Slice | Status |
|---|---|---|
| C.1 | companions type + hooks + API | ⬜ |
| C.2 | Profile Companions section + add/edit sheet | ⬜ |
| C.3 | Companion toggle on RideConfirm + board confirm (rider-only) | ⬜ |
| C.4 | Driver waive companion toggle + help box | ⬜ |
| C.5 | Driver surfacing (notification badge + request review) | ⬜ |
| C.6 | Pickup + active-ride companion context rows | ⬜ |
| C.7 | Chat caregiver + companion identity (closes gap) | ⬜ |
| C.8 | Ride summary companion fee line | ⬜ |
| C.9 | Board card badges | ⬜ |

### Feature 2 — Wallet rewards (credits) · ⚠️ real money — reviewer monitors every step

**Block A — Backend foundation (server + DB)**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: reward tables + types(seed signup/car) + policy(seed bank+$20) + distributions + users.reward_credit_balance + reward_claim tx type + RLS | ⬜ |
| A.2 | RPCs: reward_grant / reward_credit_apply / reward_claim_to_wallet / reward_spend_for_ride + guards + tests | ⬜ |
| A.3 | GET /api/wallet/rewards (balance+grants+policy+progress) + POST /claim + tests | ⬜ |
| A.4 | Ride-end waterfall: credits→wallet→card + tests (delicate money path) | ⬜ |
| A.5 | Auto-grant hooks (signup + car-registration, idempotent) + tests | ⬜ |
| A.6 | expireRewardCredits daily sweep in runAllSweeps + tests | ⬜ |

**Block B — Admin panel (web)** ⚠️ coordinate w/ parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Credit-types CRUD endpoint + UI | ⬜ |
| B.2 | Global eligibility policy editor + UI | ⬜ |
| B.3 | Distribute composer (audience + Stripe warn + audit) + UI | ⬜ |
| B.4 | Per-user grant/clawback + per-user rewards view | ⬜ |
| B.5 | Monitor dashboard (Stripe balance vs eligible-to-withdraw + warning) | ⬜ |

**Block C — iOS wallet UI**
| # | Slice | Status |
|---|---|---|
| C.1 | Rewards models + GET rewards client | ⬜ |
| C.2 | Rewards section on WalletHubPage (balance + grants + expiry) | ⬜ |
| C.3 | Driver eligibility progress (live threshold) + Claim flow | ⬜ |
| C.4 | Rider credit-applied surfacing | ⬜ |

**Block D — Web wallet UI (parity)**
| # | Slice | Status |
|---|---|---|
| D.1 | Rewards section on WalletPage + claim flow + progress | ⬜ |
| D.2 | Rider credit-applied surfacing | ⬜ |

### Feature 3 — Refer a friend · depends on Feature 2 · ⚠️ real money

**Block A — Backend**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: users.referral_code(unique+backfill) + referred_by + referrals table + referral credit type + referral config + RLS | ⬜ |
| A.2 | Code generation + GET /referrals/validate + signup capture (referred_by, referrals row, self/fraud checks) + tests | ⬜ |
| A.3 | Qualifying hook at /rides/end (first ride → grant both referral credits, idempotent + cap-aware) + tests | ⬜ |
| A.4 | GET /api/referrals/me (code + funnel stats) + tests | ⬜ |

**Block B — Admin (web)** ⚠️ coordinate w/ parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Referrals dashboard endpoint + UI (funnel + abuse flags) | ⬜ |
| B.2 | Per-user referrals on UserDetailPage + referral config editor | ⬜ |

**Block C — iOS**
| # | Slice | Status |
|---|---|---|
| C.1 | Refer-a-friend screen (code + ShareLink + stats) + entry points | ⬜ |
| C.2 | Signup "Have a referral code?" field + inline validation | ⬜ |

**Block D — Web parity**
| # | Slice | Status |
|---|---|---|
| D.1 | Refer-a-friend page (code + share + stats) + entry points | ⬜ |
| D.2 | Signup referral code field + validation | ⬜ |

### Feature 4 — Fare Acknowledgment · client-only (no migrations/server)

**Block A — iOS**
| # | Slice | Status |
|---|---|---|
| A.1 | FareAcknowledgment confirmation view (fare/earnings + folded education + 2 CTAs) + driver earnings-range calc | ✅ verified by Tarun (2026-06-05) |
| A.2 | Wire into handlePostSuccess() all entry points; remove first-time educator gate; CTA routing + tests | ✅ verified by Tarun (2026-06-05) |
| A.3 | Server: board endpoint returns caregiver profile for rider posts (no phone) | ✅ verified by Tarun (2026-06-05) |
| A.4 | iOS: ride-board detail fare/earnings + caregiver add-on + tappable caregiver profile | ✅ verified by Tarun (2026-06-05) |

**Block B — Web** ⏸ DEFERRED — web pass is Tarun's later (per §2.15, 2026-06-05)
| # | Slice | Status |
|---|---|---|
| B.1 | Evolve SchedulePage confirmation (fare/earnings + education + CTAs My Rides / Ride Board browse) + tests | ⏸ deferred (web later) |

### Feature 5 — Remote popups (App Gate + Announcements)

**System A — App Gate (force-update + maintenance)** — started 2026-06-05 (iOS sprint: A.1+A.2+server-setter+A.4; admin UI A.3 + web A.5 deferred per §2.15)
| # | Slice | Status |
|---|---|---|
| A.1 | Migration 118 `app_gate_config` singleton (+seed no-op gate, store_url) + RLS-locked | ✅ verified by Tarun (2026-06-05; mig 118 applied to dev) |
| A.2 | GET /api/app/gate (public, semver compare, maintenance, **fail-open**) + register in app.ts | ✅ verified by Tarun (2026-06-05); admin bypass deferred |
| A.3 | Admin gate endpoints + UI (maintenance toggle, versions, copy) + audit ⚠️ admin lane | ⏸ deferred — admin UI is web (web pass later). Config settable via SQL meanwhile. |
| A.4 | iOS gate: launch+foreground+periodic; force-update + maintenance covers (RootView overlay) + 5 XCTests | ✅ verified by Tarun (2026-06-05). Soft-update nudge UI deferred. |
| A.5 | Web maintenance gate in AuthGuard (blocking cover + re-check) | ⏸ deferred (web later) |

**System B — Announcements**
| # | Slice | Status |
|---|---|---|
| B.1 | Migration: announcements + announcement_views + RLS + indexes | ⬜ |
| B.2 | GET /api/app/announcements (audience+schedule+frequency) + seen/dismissed/clicked + tests | ⬜ |
| B.3 | Admin announcements CRUD + audience preview + stats + compose UI + audit ⚠️ admin lane | ⬜ |
| B.4 | iOS announcement modal (title/body/image/CTA) on open + tracking + CTA routing | ⬜ |
| B.5 | Web announcement modal in AuthGuard on open + tracking + CTA routing | ⬜ |

### Feature 6 — Explore (headline) · depends on Feature 1 · internal name `destinations` · new bottom tab

**Block A — Backend**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: featured_destinations + destination_requests + driver_plans + waitlist + offers + RLS | ⬜ |
| A.2 | Destinations read endpoints (list by kind + detail w/ plans+waitlist) + tests | ⬜ |
| A.3 | Request endpoint + demand aggregation + auto-promote at 5 + tests | ⬜ |
| A.4 | Driver-plan endpoint → plan + auto-create ride_schedules board post (roundtrip) + notify + tests | ⬜ |
| A.5 | Waitlist endpoint (date/time/return/mode/group+companions) + notify + tests | ⬜ |
| A.6 | Offers: create both-directions + accept → outbound+return rides (same driver, seats, siblings, chat) + tests | ⬜ |

**Block B — Admin (web)** ⚠️ coordinate w/ parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Curate featured_destinations (CRUD + image + dates + activate/archive) + UI | ⬜ |
| B.2 | Requests review (demand + merge + manual promote) + participation view | ⬜ |

**Block C — iOS**
| # | Slice | Status |
|---|---|---|
| C.1 | Tab-bar restructure: fold Payment→Account, add Explore tab + credits badge (SignedInTabs) | ⬜ |
| C.2 | Explore page: Events/Places sub-tabs + cards + detail | ⬜ |
| C.3 | Rider Join-waitlist sheet (date/time/return/mode/group+companions) | ⬜ |
| C.4 | Driver "I'm going" sheet (seats/dates/return) → plan + board post | ⬜ |
| C.5 | Driver waitlist browser + offer; rider request-a-driver; accept→ride(s); notifications | ⬜ |
| C.6 | Request a place/event sheet | ⬜ |

**Block D — Web parity**
| # | Slice | Status |
|---|---|---|
| D.1 | Tab-bar restructure: fold Payment→Account, add Explore tab + credits badge (BottomNav.tsx) | ⬜ |
| D.2 | Explore section + Events/Places sub-tabs + detail | ⬜ |
| D.3 | Rider waitlist + driver "I'm going" sheets | ⬜ |
| D.4 | Offer/request/accept flows + request-a-place | ⬜ |

### Feature 7 — Sharing (rides + Explore) · Explore-share depends on Feature 6 · likely no migration

**Block A — Server**
| # | Slice | Status |
|---|---|---|
| A.1 | Public GET /api/public/schedule/:id + /api/public/destination/:id (supabaseAdmin, stripped fields, availability) + tests | ⬜ |

**Block B — iOS**
| # | Slice | Status |
|---|---|---|
| B.1 | Deep-link routing for /ride/:id + /explore/:id → public detail screen (preview + sign-in CTA + unavailable state) | ⬜ |
| B.2 | Share buttons (ShareLink) on ride-board cards/detail + Explore detail | ⬜ |

**Block C — Web**
| # | Slice | Status |
|---|---|---|
| C.1 | Public routes /ride/:id + /explore/:id (preview + sign-in CTA + unavailable state) | ⬜ |
| C.2 | Share buttons (navigator.share / copy-link) on ride-board cards + Explore detail | ⬜ |

---

## Decisions Log

> Every non-obvious decision, bug-and-fix, plan change, and new requirement — one line each, dated. Future-Claude reads this so nothing is re-debugged or re-decided.

- **2026-06-04** — V4 planning kicked off. Read `ios/CLAUDE.md` (hard requirement) + `CLAUDE.md` + durable memory files end-to-end. Created `V4_PLAN.md` (operating contract + past-bug catalogue) and this scoreboard before defining any features, per Tarun's instruction to "make the v4 plan file right now with all the rules." Feature set + slice breakdown deferred until the planning discussion. Observed working-tree state: iOS repo clean; web repo has uncommitted `src/components/ride/ProfilePage.tsx` + its test (likely the parallel webapp session — left untouched).
- **2026-06-05** — **F5 System A (App Gate) built** (next feature after F4, per Tarun "Next start it"). **Migration 118** `app_gate_config` (single global row, seeded no-op: maintenance off, no version floor; RLS-locked, served via admin client). **Server:** public `GET /api/app/gate?platform=ios&version=` (`server/routes/appGate.ts`, mounted `/api/app` in app.ts) — maintenance (per-platform) > force_update (iOS min version) > soft_update (recommended version) > ok; **FAILS OPEN** on any error/missing row (never blocks). **iOS:** `AppGateController` (@Observable, fail-open) + `AppGateEndpoint` + `AppGateCover` (full-screen blocking cover: maintenance "Try again" / force-update "Update Tago" → App Store via openURL) wired into `RootView` as a top-zIndex overlay + checked on `.task` launch + 5-min periodic `.task` + `scenePhase .active`. 5 XCTests (maintenance/force_update/ok mapping + **unknown-status → ok fail-safe** + soft-update clear). **Deferred:** A.3 admin UI (web pass), A.5 web maintenance gate (web), soft-update nudge UI, admin-bypass (endpoint public; flip flag to test the block). **Tarun must apply mig 118 + flip via SQL to test.** Gates: sim+device build, installed both, server typecheck + lint clean. Awaiting verify.
- **2026-06-05** — **F4 fare on the ride-board DETAIL (Tarun feedback, A.3 server + A.4 iOS).** Tarun: tapping a board ride showed no fare; should show fare + caregiver/companion add-on + a tappable profile. CTO design point: caregiver/companion only attaches to a **rider's post** (the request carries it) — a driver's post has none. So: rider post → "Estimated earnings" + caregiver add-on + tappable caregiver profile; driver post → "Estimated fare" (base only). **Server (A.3):** `/api/schedule/board` now joins + returns a `caregiver {name, relationship, avatar_url}` block for rider posts (admin client, RLS bypass; **NO phone** pre-accept per F18.5); `caregiver_fare_cents` already rode along via `...s`. Typecheck clean (`tsc -p tsconfig.server.json`). **iOS (A.4):** `ScheduledRide` decodes `caregiverFareCents` + `caregiver` (new `CaregiverInfo`); new `RideBoardDetailSheet+Fare.swift` (extension, like `+Actions`) renders the fare/earnings section (role-based, all posts) + "Includes $X caregiver seat fee" + a tappable caregiver profile sheet (name/relationship/photo, no phone). Base fare reuses `Fare.scheduleEstimateRange` (A.1). **Companion deferred (F1)** — same pattern plugs in later. **Dev server must be running** for the caregiver block (tsx watch hot-reloads schedule.ts). Gates: sim+device build, installed both, server typecheck + new-file lint clean (RideBoardDetailSheet pre-existing length warnings logged). Awaiting Tarun verify.
- **2026-06-05** — **F4 caregiver-fare in the confirmation (Tarun feedback).** Tarun: the confirmation didn't include the caregiver fee and should explain it only when attached. Generalized `FareAcknowledgmentSheet` to take `addOns: [FareAddOn]` (label/cents/symbol/info) — the estimate headline now shows the **total incl. add-ons**, with an "Includes a $X caregiver seat fee" line + a caregiver explanation in the disclosure, **shown only when a caregiver is attached**. Caregiver fee read from `viewModel.caregiverFareCents` (already computed by `bindCaregiverStateToViewModel` pre-submit — no new fare math, just surfacing it). **Companion is deferred (F1 not built)** — `fareAckAttachedAddOns()` has the hook + a comment so F1 appends a companion `FareAddOn` (tiered $4/$6/$10) the same way. Caregiver is rider-mode-only, so driver posts show no add-on. Gates: sim+device build, installed both, fareAck files lint-clean. Awaiting Tarun re-verify (post as rider with a caregiver → confirmation shows total incl. the seat fee + the explanation).
- **2026-06-05** — **F4 (Fare Acknowledgment) iOS A.1 + A.2 implemented.** A.1: new `Fare.scheduleEstimateRange(fromLat:fromLng:toLat:toLng:)` (haversine ×1.3, 60mph → `Fare.range`; nil on same-point; driver earnings == fare since platform fee 0%) + new view `FareAcknowledgmentSheet.swift` (success icon + headline from `FareEducatorContent` + estimate card "Estimated fare/earnings $X–$Y" + collapsed "How is this estimated?" disclosure folding the educator paragraphs + PrimaryButton "Go to My Rides" / SecondaryButton "Browse Ride Board"; success haptic; a11y ids; dark/light via tokens) + 4 XCTests (29 FareTests total, all green). A.2: wired into `SchedulePostPage.handlePostSuccess()` — now shows the confirmation on EVERY post (was first-time-only educator; "?" toolbar still opens educator). Added `onPostedBrowseBoard` callback; CTAs route via the sheet's `onDismiss` (My Rides = `onPosted` → routeToRidesTab; Browse Board = pop + `drivePath.append(.rideBoardBrowse)`), wired at the 3 drive-stack call sites in `SignedInTabs+DriveRoutes.swift`. **Decision:** to respect `type_body_length`, split the fareAck logic (estimate, handlePostSuccess, sheet content, dismiss) into `SchedulePostPage+FareAck.swift` (repo's +Extension convention); required loosening 3 new @State + `viewModel` + `currentEducatorSurface` from `private`→internal so the extension can manage them (no behavior change). **Deferred:** RiderFlow/AddRoutinePromptCover call sites left `onPostedBrowseBoard: nil` (board CTA falls back to My Rides there) — driver/rider board posting via the Drive stack is fully wired; note for B.x/future. Gates: sim+device build SUCCEEDED, installed on sim + Tarun's iPhone, 29 tests green, new files lint-clean. Awaiting Tarun visual verify. Web (B.1) is the next slice.
- **2026-06-05** — **Consolidated CTO review done (planning complete).** All 7 features specced. Added [V4_PLAN.md](V4_PLAN.md) §6: dep graph (F3→F2, F6→F1, F7-Explore→F6), the `/api/rides/end` convergence zone (F1+F2+F3+F6 — single owner, strict order, no parallelize), phased build order (P0 F4+F5-Gate → P1 F1 → P2 F2 → P3 F3 → P4 F6 → P5 F7; F5-Announcements w/ F6 launch), indicative migration sequencing (re-check `ls|tail` per the rule; admin session also creates migrations), build-once shared foundations (deep-link router, reward RPCs, companion settlement), 11-admin-slice coordination plan, risk register (F2 money = 🔴, convergence + admin lane = 🟠), recommended first slice = **F4 iOS A.1**. Plan declared coding-ready; no blocking unknowns. Awaiting Tarun's "go".
- **2026-06-05** — **Feature 7 (Sharing) spec finalized.** Codebase map (Explore agent): iOS deep-link router (`DeepLink.classify`) handles only /auth/callback + /connect/onboard/return — extend for /ride/:id + /explore/:id; assoc-domain www.tagorides.com claimed. Web has public-route precedent (/c/:slug, /track/:token) outside AuthGuard. `GET /api/schedule/by-id/:id` exists (JWT); need a public variant via supabaseAdmin (campaign-public-endpoint pattern) to avoid ride_schedules owner-only RLS. Expiry: `isSchedulePast()` (server) / `isExpired()` (iOS) reusable. Share pattern exists (ShareLink iOS, navigator.share web — emergency + ride summary). Tarun's decisions: **public read-only preview** (sensitive fields stripped, sign-in to act); **any board post + any Explore item, shareable by anyone** (instant rides excluded); **no referral tie-in** (navigation only); unavailable → "no longer available" + Browse board CTA; universal links → in-app if installed else web, no SDK. **Likely no migration.** Ride-share independent; **Explore-share depends on F6.** Full spec → [V4_PLAN.md](V4_PLAN.md) §5.7. NO code written.
- **2026-06-05** — **Feature 6 named + placed.** User-facing name = **"Explore"** (sub-tabs Events / Places); internal entity stays `destinations`. Placement = **dedicated bottom tab**, freed by **folding Payment/Wallet into Profile → renamed "Account"** (both platforms already run a full 5-tab bar: iOS home/drive/rides/payment/profile; web BottomNav identical). New bar: Home · Drive · Rides · Explore · Account; Wallet becomes a row under Account with a credits badge. ⚠️ Cross-feature: this relocates the Wallet, so F2 Rewards + F3 referral entry now live under Account — their wallet-UI slices must target that location. Added tab-restructure slices C.1 (iOS, SignedInTabs) + D.1 (web, BottomNav.tsx); slice total 81→83. Plan §5.6 updated.
- **2026-06-04** — **Feature 6 (Events & Trips → renamed Explore — headline) spec finalized.** Audit (2 Explore agents) surfaced CRITICAL naming collisions: `trips` table = multi-rider cost-settlement (mig 097); `marketing_events` = admin marketing calendar (already has travel-trigger concerts); `BoardEvents` = ride-board notifications; `ride_suggestions` = rider↔driver matching. No destination/waitlist/voting infra exists. Ride-board reuse confirmed: `ride_schedules` posts + `ride_offers` (schedule-attached pre-ride) + offer→`rides` conversion (`/board/offers/:id/accept`) + `notifyMatchedDrivers`. RESOLUTION: UI label "Events & Trips" but internal entity `destinations` (kind event/place), tables `destination_*` — never `trips`/`events` at DB layer. Tarun's decisions (2 rounds): Events fixed-date / Trips evergreen; **round-trip in v1, same driver both legs**; travel mode = tag-only (mechanic round-trip vs one-way); **two-way matching** (driver offers from waitlist + rider requests driver); **auto-publish at 5 requests** (admin-editable + merge); **group size reuses Companions (F1)**; driver "I'm going" auto-creates a ride_schedules board post. **Depends on Feature 1.** Full spec → [V4_PLAN.md](V4_PLAN.md) §5.6. NO code written.
- **2026-06-04** — **Feature 5 (Remote popups) spec finalized.** Codebase map (Explore agent): no version-gate/maintenance/remote-config exists. Injection points: iOS `RootView` launch `.task` + scenePhase `.active` (in SignedInTabs) for the gate; web `AuthGuard` before `<Outlet/>`. App version via `CFBundleShortVersionString`; App Store id `6763382426` (from Landing.tsx). Reusable: `AdminBroadcastBannerPresenter`/`AdminBroadcastBannerOverlay` (iOS in-app banner), `ForegroundPushToast` (web), campaigns `resolveAudience` + `writeAuditLog`. Tarun's decisions: **two systems** (A blocking App Gate config + B dismissible Announcements content); update modes **Required + Optional per release** (min_required + recommended versions, maintenance in same gate); announcements **targeted + scheduled + frequency-capped** w/ view/click tracking; **force-update iOS-only, maintenance + announcements both**; admins bypass; gate checked launch+foreground+periodic. Admin UIs (A.3, B.3) are the **parallel-admin-session lane**. Full spec → [V4_PLAN.md](V4_PLAN.md) §5.5. NO code written.
- **2026-06-04** — **Feature 4 (Fare Acknowledgment) spec finalized.** Codebase map (2 Explore agents): iOS posting funnels through `SchedulePostViewModel.submit()` → `handlePostSuccess()`, which today gates a first-time-only `FareEducatorSheet` (educational, no CTAs) then silently auto-navigates; rider est. fare computed on the post page, driver posts "blind." Web `SchedulePage.handleSubmitSchedule()` already shows a confirmation screen but with CTAs "Done→home" / "Browse rides" and no fare; no first-time educator on web. Tarun's decisions: one always-on confirmation every post that **folds in the educator content**; show **driver estimated earnings range** (compute client-side); CTAs **My Rides** + **Ride Board browse list**; **posting/requesting only** (offer flow keeps its toast). **Client-only — no migrations/server.** Both platforms converge. Full spec → [V4_PLAN.md](V4_PLAN.md) §5.4. NO code written.
- **2026-06-04** — **Feature 3 (Refer a friend) spec finalized.** Codebase map (Explore agent): no referral infra exists; signup creates the user row server-side at `POST /api/users/me/profile` (email = .edu unique identity); universal links to www.tagorides.com work but the iOS router only handles /auth/callback + /connect/onboard/return; first-completed-ride is easily detectable. Web research (referral best practices, mobile attribution, Uber/Lyft): reward-after-qualifying-action is the top fraud guard; store-credit beats cash; code-based attribution is the no-SDK path (true iOS install-attribution needs paid Branch/AppsFlyer — out of scope). Tarun's decisions: **two-sided** ($5 referrer + $5 friend, admin-editable); **both referral credits grant on the friend's first completed trip** (any role) — friend's upfront incentive is their normal $5 signup bonus; **code-only attribution** (no deep links / no SDK), code typed at signup → `referred_by`; referral credits are **Feature-2 reward credits of kind `referral`**, follow F2 rules once granted; **uncapped, admin-configurable**; fraud guards = new-.edu-only + self-referral block + one-reward-per-referred + 1-trip gate + admin funnel view. **Depends on Feature 2.** Full spec → [V4_PLAN.md](V4_PLAN.md) §5.3. NO code written.
- **2026-06-04** — **Feature 2 (Wallet rewards/credits) spec finalized.** Investigated the existing money system via 3 parallel read-only agents (wallet/payments backend, wallet UI iOS+web, admin panel). Key facts: ledger-based wallet (`users.wallet_balance` cached + `transactions` append-only + `wallet_apply_delta` RPC w/ negative guard mig 053); withdrawal `POST /api/wallet/withdraw` only touches `wallet_balance`, requires Stripe Connect Express (`stripe_account_id`+`stripe_onboarding_complete`), uses `stripe.transfers.create` w/ idempotency + credit-back on failure; rider pay is wallet-first then card; admin already has audience targeting (`resolveAudience`), campaigns distribution pattern, audit log (`writeAuditLog`), Stripe balance API (`getAvailableStripeBalanceCents`), per-user $50 grant-credit action. No rewards/promo system exists. Tarun's decisions: **separate restricted bucket + convert-on-claim** (credits never in wallet_balance — withdraw path can't touch them = core safety); unlock basis = **earnings + rides given only** (top-ups excluded, lifetime earnings); **one global** eligibility policy, admin-editable, default **bank linked AND ≥$20 earned** — and the **user UX must reflect the live admin threshold dynamically** (fetch policy + progress, never hardcode); rider pay waterfall **credits→wallet→card** (riders never withdraw); **auto-grant** signup+car-registration on event (idempotent hooks), custom awards manual by audience; expiry **signup 3mo/car 6mo/custom on-create**, daily cron sweep; distribution **warn-but-allow** past Stripe balance. Admin portion is the **parallel-admin-session lane** — must coordinate before Block B. Full spec → [V4_PLAN.md](V4_PLAN.md) §5.2. NO code written.
- **2026-06-04** — **Feature 1 (Companion option) spec finalized.** Investigated the full Caregiver implementation (server/iOS/web) via 3 parallel read-only agents + verified the fare-timing claim by reading `server/routes/rides.ts` directly. Key findings: (1) companion infra is only partially scaffolded — `ride_rider_shares.companion_share_cents` (mig 097) + `computeRiderTotals({companionFareCents})` exist, but NO companions table / ride columns / waive pref / CRUD / UI. Highest migration = 117. (2) Caregiver fee is **frozen at request-time** (estimated distance) today — `caregiverFareCentsFor(distanceKm)` at `/api/rides/request` ([rides.ts:635](server/routes/rides.ts#L635),[:667](server/routes/rides.ts#L667)); end-of-ride settlement reads the persisted value, not real distance. (3) Caregivers ARE shown on drive-to-pickup + active-ride drawers (contrary to Tarun's worry) but NOT in the chat thread (identity gap) and NOT badged on board cards. Tarun's AskUserQuestion answers: max **2** companions, **per-companion** fee; tiers **<10mi $4 / 10–50mi $6 / >50mi $10**; **end-of-ride recompute from real distance for BOTH caregiver + companion** (changes existing caregiver behavior); **ungated** (all riders); photo **required**; **separate** waive_companion_fee toggle; seat capacity **informational only** for v1; gap-fill scope **full parity** (caregiver + companion identity in chat, board badges). Schema decision (CTO call, veto open): two FK columns on rides/ride_schedules (not a join table) since cap is a fixed 2. Full spec → [V4_PLAN.md](V4_PLAN.md) §5.1. NO code written — planning only.

---

## Blockers & Pending Questions

- None blocking. All 7 features specced; F4 in progress.

## Known issues & irregularities

- **INCIDENT — parallel session swept F5 root files into its commit (2026-06-05):** while staging F5's root files, the parallel **webapp** session ran `git add -A && git commit` and absorbed my `server/app.ts`, `server/routes/appGate.ts`, `supabase/migrations/118_app_gate_config.sql`, and `V4_PROGRESS.md` into **its** commit **`35c355d`** ("fix(ci): clear three sources of failure / warning emails"). My work is **committed (not lost) + local-only (not pushed)** — just mislabeled + mixed with their `ci.yml` + `src/test` changes. **NOT** rewritten (active parallel session + force-push ban; rewriting a shared commit they may be building on is unsafe). So F5's server + migration live in `35c355d`, not a dedicated F5 commit. The iOS half committed cleanly in `ios/`. **Lesson (reinforces §2.10):** a parallel session that runs `git add -A` will sweep ANY uncommitted work — checking the staged diff doesn't help if they commit the index between your check and your commit. Mitigation: **stage + commit in ONE atomic shell line** (`git add <explicit files> && git commit -m …`) and commit the instant gates pass to shrink the window. iOS half was committed atomically for this reason.

> Hard rule (§2.13): every bug / env quirk / confusing-but-non-fatal warning / pre-existing lint / tooling gotcha gets logged here the moment it's hit, with symptom + resolution, so the next (cold-start) session doesn't re-debug it.

- **Device id (2026-06-05):** the id `7DF8B11F-E8B8-595F-96CD-7A0DE923D769` from the original session brief is **NOT** the phone — the real paired device is **`00008140-0012688A3A10801C` ("Tarun's iPhone" = Tarun's personal phone, confirmed)**. Use that id for all device builds/installs.
- **Device "busy (Preparing)" (2026-06-05):** `xcodebuild` device builds can fail with `Device is busy (Preparing Tarun's iPhone)` right after a reconnect. Fix: add `-destination-timeout 240` so the build waits for prepare to finish. It cleared on retry.
- **`devicectl` provisioning warning (2026-06-05):** `xcrun devicectl device install/launch` prints `Failed to load provisioning paramter list … "No provider was found." Code=1002` — this is **NON-FATAL noise**; the output still shows `App installed:` and `Launched application…`. Don't chase it; verify the `installed`/`launched` lines instead.
- **`SchedulePostPage.swift` pre-existing length lints (2026-06-05):** the committed file is **833 lines (>800)**, so `file_length` (error) + `type_body_length` (~606 >600) + a `multiple_closures_with_trailing_closure` (the educator/topup `.sheet(item:onDismiss:){}`) **already fail swiftlint before any V4 work** — these are the pre-existing length lints the carve-out excludes. F4 used the `SchedulePostPage+FareAck.swift` extension split to *minimize* growth (type body 651→616 vs the inline version). A future cleanup could split the whole view, but that's out of F4 scope.
- **`SignedInTabs+DriveRoutes.swift:25` pre-existing `line_length` (2026-06-05):** a 194-char `.schedulePost(...)` enum-case line — pre-existing, not introduced by F4.
- **Build/install efficiency note (2026-06-05):** sim + device need separate builds (different arch/SDK) — one build can't serve both. See §2.14: batch to one-per-surface at slice end.
- **`RideBoardDetailSheet.swift` pre-existing length WARNINGS (2026-06-05):** committed file was **510 lines** (>500 file_length warning) + body ~411 (>400 type_body_length warning) before any V4 work. F4 A.4 added ~9 body lines (519/420) — within the pre-existing-length carve-out; the bulk went to the new clean `RideBoardDetailSheet+Fare.swift`. These are WARNINGS (not errors). A future cleanup could split the main sheet further; out of scope.
- **BUG + FIX — F4 "Go to My Rides" landed on home (2026-06-05):** Tarun reported the confirmation's "Go to My Rides" CTA went to the drive-home tab, not the Rides tab. Cause: the CTA ran the call-site `onPosted` (which pops the drive stack + `routeToRidesTab()`) from inside the sheet's `onDismiss`, so the tab switch raced the sheet teardown and didn't stick. Fix: `onFareAckDismiss` now defers the navigation ~350ms (`Task.sleep`) until after teardown — the app's established dismiss-then-navigate pattern. Applies to both CTAs. (`SchedulePostPage+FareAck.swift`.) **Lesson for future slices:** any "dismiss a sheet then switch tab / pop nav stack" must defer the nav, never run it synchronously in `onDismiss`/the CTA.

---

## Recent Sessions

| Date | Slices worked | Result |
|---|---|---|
| 2026-06-04 | Planning setup | Created `V4_PLAN.md` + `V4_PROGRESS.md` scaffolds; captured all rules + past-bug catalogue. Awaiting feature list. |
</content>
