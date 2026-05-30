# Web ↔ iOS Parity Report — 2026-05-22

> **Supersedes** [WEB_PARITY_REPORT_2026-05-12.md](WEB_PARITY_REPORT_2026-05-12.md). The 2026-05-12 report was scoped to a snapshot before the v1.2 schema explosion + Reports v2 + Suggestions / Trips / Routines work landed on iOS (migrations 086 → 107). It's kept on disk for historical reference but most of its Tier-1 items are either shipped (Sprints 1–4 on web) or rendered stale by the new feature surface.

## Read this first

The audit is happening **in stages**, not in one sitting. Each stage targets one feature cluster from the iOS app, reads every file end-to-end (no skimming), compares to the corresponding web surface, and produces a "what web is missing / what web needs" list that lands in [WEB_PARITY_PROGRESS.md](WEB_PARITY_PROGRESS.md) as scoped sprint work. This file is the **inventory + stage plan**; the live scoreboard is the progress doc.

This means:
- Don't expect a complete list of gaps in this file yet — each stage adds its findings as it completes.
- Each stage's findings get organized into a numbered sprint that ships through the normal review → push → QA cycle.
- iOS is now the **source of truth** for instant-ride UX, Reports v2, Caregivers, Accessibility, Suggestions, and Trips. Web should match iOS on these. (For older flows where web shipped first, web stays the source of truth — auth, fare math, payments-server contract, etc.)

## Why a re-audit was needed

Between 2026-05-12 and 2026-05-22, iOS added ~22 new migration files (numbers 086–107), 22 new networking endpoints, and entire new Feature directories (`Reports/`, `AdminCampaign/`, `LiveActivity/`, `MultiRider/`, `Suggestions/`, expanded `Profile/` and `RideBoard/`). Web shipped Sprints 1–4 in parallel (45+ items closed) plus the parallel admin/v1.2 session has been pushing schema and admin-side work. The 2026-05-12 report can no longer be used as a single source of truth for what's still missing — the surface shifted under it.

## What's in scope for this audit

Every iOS Features directory, every new endpoint, every migration ≥086. **iOS planning / spec markdowns (`docs/*_PLAN.md`, `ios/*_PLAN.md`, `ios/IOS_PROGRESS.md`, `ios/IOS_ROADMAP.md`) are explicitly OUT of scope** — Tarun's planning docs are not kept in sync with the shipped iOS code, so reading them produces audit findings that describe what was *planned* rather than what *ships*. The source of truth is the `.swift` files. (Hard rule landed in CLAUDE.md 2026-05-30; see "iOS planning markdowns are off-limits during audits".)

For each iOS file in scope:
1. Read it end-to-end (per the new web-side audit rule — see CLAUDE.md).
2. Find the corresponding web component / hook / endpoint.
3. Read THAT end-to-end too.
4. List the gaps as actionable items (component-level or endpoint-level).
5. Land items in `WEB_PARITY_PROGRESS.md` as a sprint.

## Stage plan

Stages are numbered by **proposed execution order**, not by feature area name. They are ordered by:
1. Risk to live-production users (highest first).
2. Server-contract drift (anything where web makes the wrong API call comes before pure UI gaps).
3. Whether the parallel admin/v1.2 session has already touched the area (avoid double-write conflicts).

| # | Stage | iOS scope | Why this priority |
|---|---|---|---|
| 1 | **Reports v2** | mig 086, `ios/Features/Reports/`, Reports endpoints in `ios/Core/Networking/Endpoints/` | Live users can already file reports on iOS. Web has the parallel session's `src/components/reports/` + `ReportFlowSheet` shipping into `RideSummaryPage`, `TransactionDetailPage`, `SettingsPage`. Need to verify both call the same triage model and the rider sees identical history/detail surfaces. |
| 2 | **Caregivers** | mig 089, 091, 092, 093, `ios/Features/Profile/CaregiverManagementSheet*`, `AttachCaregiverSheet*`, Caregivers endpoints in `ios/Core/Networking/Endpoints/` | New money flow — `caregiver_fare_cents` is real money charged to riders + paid to drivers. Any web ride that doesn't honour the same fee math would underbill / underpay. |
| 3 | **Vehicle + user accessibility** | mig 087, 088, 090, `ios/Features/Profile/UserAccessibility*`, `VehicleEdit/`, `UserProfileFields*` | Filter contract — riders set accessibility needs, drivers set vehicle accessibility, board filters use both. Server fan-out logic in `server/routes/rides.ts` already filters; web needs the user-facing toggles + display surfaces. |
| 4 | **Rider routines + Suggestions** | mig 099, 100, 101, 102, 103, 104, `ios/Features/Suggestions/`, `ios/Features/Profile/RoutineManagement*`, suggestion endpoints | The Suggestions push pref + grouped UI matter for daily-active users. Migration 103 unified driver+rider routines; web routine page may be reading the wrong shape now. |
| 5 | **Trips & segments (split fare foundation)** | mig 097, 098, trips endpoints, `ios/Features/Rides/` | Fundamental ride data model change. The `trips` table joins `rides` rows when a ride is part of a multi-segment shared trip. Web has to render trips correctly or the rider sees the wrong fare. |
| 6 | **Board redesign + Smart geo-match** | `ios/Features/RideBoard/`, `BoardOffer*`, `BoardConfirm*` endpoints, mig 072+ board schema | Parallel session is mid-flight here. Coordinate before changing anything web-side. |
| 7 | **Ride safety + forensics (admin-facing)** | mig 094, 095, 096, `ios/Features/Safety/`, `ios/Features/AdminCampaign/` | Mostly admin-side. Verify web admin panel + safety surfaces aren't drifting. |
| 8 | **Endpoint coverage audit** | All 72 endpoints in `ios/Core/Networking/Endpoints/` | Cross-reference every endpoint iOS hits with web call sites. Identify orphaned-on-web routes + identify web-only routes that need iOS counterparts. |
| 9 | **Re-walk Tier 2 polish from 2026-05-12** | Copy / sort / filter / banner items from the old report | Pure UI polish, lowest urgency. Some may already be closed by Sprints 1–4. |

## Standing rules (mirrored from `ios/CLAUDE.md`)

A new section `## iOS-parity audit — web-side rules` lands in `CLAUDE.md` this turn. Key adaptations:
- **Reading order at audit time**: iOS file end-to-end → web file end-to-end → server route → migrations. No skimming. Same hard rule as iOS.
- **iOS-source-of-truth flip**: For features added on iOS first (everything migrated ≥086), iOS is canonical. Don't invent web-only behaviour.
- **Tough self-review before handoff**: After every stage commit, re-walk the iOS source files with fresh eyes against the new web code.
- **No MVP framing** (already in memory): every drift gets closed in the same sprint.

## Status snapshot

- **Stage 0** (this audit plan + new rules) — ✅ shipped 2026-05-22.
- **Stages 1–9** — ⏳ not started. Awaiting user greenlight on Stage 1 priority.

See [WEB_PARITY_PROGRESS.md](WEB_PARITY_PROGRESS.md) for live tracking once stages begin.
