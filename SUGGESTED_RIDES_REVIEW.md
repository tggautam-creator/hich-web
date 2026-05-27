# Suggested Rides — End-to-End Review (CTO + Team)

**Date:** 2026-05-25
**Reviewer:** CTO + 4-person specialist team (entry-point auditor, anytime-trip auditor, sync/cascade auditor, commit-history auditor)
**Scope:** Every code path from "user posts a trip/routine" → "user sees a suggested match" → "user dismisses or acts on it" — across web + iOS, every entry point, every UI surface.

---

## TL;DR — Reviewer Verdict

The Suggested Rides feature is **structurally sound** (single canonical posting path, FK cascades wired right, hero/tab share a single server contract) but has **3 high-impact UX gaps** that need closing before it can be considered shippable to all users:

1. **Anytime trips silently lose discovery.** They match but score 0.5 (neutral), almost never push, and render with blank time in the UI — making the match look broken.
2. **Dismiss on hero doesn't propagate to the Suggested tab.** The dismissed card stays visible on the other surface until next pull-to-refresh / push.
3. **Routine deactivation + delete take up to 5 minutes** to clear from the user's screen (cron-driven, not event-driven).

Lower-impact but still open: Phase D (reverse-trip matching), Phase E (7am digest), Phase B.8 (push dedup vs legacy /notify), Phase C (web UI).

---

## How the team reviewed it

**4 parallel research agents** were dispatched to audit independently:

| Specialist | Scope |
|---|---|
| **Entry-point auditor** | Every web + iOS path that creates a routine or one-off trip |
| **Anytime-trip auditor** | How the engine handles `trip_time IS NULL` end-to-end |
| **Sync + cascade auditor** | Hero/tab consistency, dismiss propagation, delete cascades |
| **Commit-history auditor** | Chronological reconstruction of what shipped and what's deferred |

Findings are merged below.

---

## 1. Posting Entry Points — Where users create trips/routines

### Web (`src/`)

| Path | Inserts | Fires engine? | Status |
|---|---|---|---|
| `SchedulePage.tsx:617` (one-time trip) | `ride_schedules` + `POST /api/schedule/notify` | Yes (notify only; engine via separate compute-route fire-and-forget) | ✅ Canonical |
| `SchedulePage.tsx:563-637` (routine) | `driver_routines` (per time-group) + projected `ride_schedules` for 7 days | Yes | ✅ Canonical |

### iOS (`ios/Tago/`)

| Path | Inserts | Fires engine? | Status |
|---|---|---|---|
| `SchedulePostPage` (one-time) → `+Submit.swift:52-150` | `ride_schedules` via Supabase | Yes — `ComputeScheduleRouteEndpoint` fire-and-forget (which calls scanForPost) | ✅ Canonical |
| `SchedulePostPage` (routine) → `+Submit.swift:175+` | `driver_routines` (per time-group) | Yes — new `ScanRoutineEndpoint` fire-and-forget per routine | ✅ Canonical |

### Server-side write endpoints

| Endpoint | Purpose | Engine trigger |
|---|---|---|
| `POST /api/schedule/:id/compute-route` | Server-side polyline + geo enrichment after insert | ✅ Calls `scanForPost()` after enrichment |
| `POST /api/schedule/sync-routines` | App-start projection of routine → 7-day `ride_schedules` | ❌ Intentionally not — would spam on every app launch |
| `POST /api/schedule/board/offers` | Driver offers on rider request | ❌ Intentionally not — it's a direct offer, not a match |
| `POST /api/suggestions/scan-routine/:id` | New: client-triggered scan after routine insert | ✅ Calls `scanForRoutine()` |

### Discrepancies / legacy code

- **`rider_routines` table no longer exists** (dropped in migration 103) but `backfillRoutineAddresses.ts` still references it. Dead script — should be removed or guarded.
- **Asymmetric notification timing**: web posts → explicit `/api/schedule/notify`; iOS posts → `compute-route` fire-and-forget. Both work, but web hits drivers sooner. Not a bug; worth normalizing eventually.
- **No parallel UI for posting** — `SchedulePostPage` is the only routine/trip creator on iOS, `SchedulePage` is the only one on web. The "audit before creating" feedback rule (3x repeated) is being respected here.

**Verdict: No critical drift between web + iOS or between routine + schedule paths.** The unification commit (`7625652`) closed the only pre-existing structural debt.

---

## 2. Anytime trips — THE biggest open issue

### What anytime means

A user posts a routine or trip with **"anytime"** instead of a specific time → DB stores `time_flexible=true` and `trip_time='12:00'` (placeholder) on `ride_schedules`, OR NULL on `departure_time` / `arrival_time` for routines.

### How the engine treats anytime

| Stage | Behavior | Status |
|---|---|---|
| Candidate fetch | No time filter — anytime trips coexist with scheduled ones in the candidate pool | ✅ |
| Time scoring (`suggestionEngine.ts:361-362`) | `timeDiffMin` stays `null` when either side is anytime → scoreDirect uses 0.5 as the neutral default | ⚠️ **Treats anytime as "moderately bad", not "ideal"** |
| Suggestion insert | Row created with `match_signals.time_diff_min = null` | ✅ |
| Push dispatch (`suggestionEngine.ts:1058`) | Only pushes if `relevance_score ≥ 0.7` OR `trip_date = today` | ⚠️ **Anytime pairs rarely reach the 0.7 threshold because of the 0.5 time score** |
| Expiry | Same as scheduled (date-based) | ✅ |

### How the UI shows anytime

`SuggestedRideCard.swift:224-231` + `SuggestionDetailSheet.swift:198-207`:

```
From: Home
To: Work
(blank time area)
Today
```

vs. what it SHOULD show:

```
From: Home
To: Work
Anytime
Today
```

The blank looks like loading or a data bug. Users can't tell the routine deliberately has no time.

### Why this matters

A **rider who's flexible on time is the ideal carpool customer** — they can flex around any driver's schedule. The current scoring penalizes them. The UI gives them no indication their flex was registered. Both must change.

---

## 3. Sync between Hero and Suggested tab + delete/dismiss handling

### Pass / fail matrix

| Concern | Status | Detail |
|---|---|---|
| Routine hard delete → suggestion gone | ✅ | Migration 103 `ON DELETE CASCADE` fires DB-side instantly |
| Routine `is_active=false` toggle | ⚠️ | `expireStaleSuggestions()` purges, but only on the 5-min cron tick |
| Schedule hard delete → suggestion gone | ✅ | Migration 100 `ON DELETE CASCADE` |
| Schedule trip_date passed | ✅ | Engine skips `trip_date < today`, expiry purges via `expires_at` |
| Schedule cancelled (user soft-deletes) | ❌ | `ride_schedules` has no `cancelled_at` / `status` column visible; cleanup only via past `trip_date` |
| Dismiss on hero → board reflects | ❌ | `SuggestedRidesHero.swift:135` removes locally only; doesn't `post(.suggestionsRefreshRequested)`. Board shows the dismissed card until pull-to-refresh / push / scenePhase change |
| Dismiss on board → hero reflects | ❌ | Same direction, same gap |
| Hero/tab use same dismissed filter | ✅ | Both `/top` and `/board` apply `status !== 'dismissed'` server-side |
| Hero/tab use same role filter | ⚠️ | `/top?side=` is per-mode; `/board` shows both sides. Intentional but worth a re-read |

### Specific repro for the dismiss-sync bug

1. User on rider home, sees suggestion in hero
2. Taps X → `POST /api/suggestions/:id/dismiss` (rider_status='dismissed'); hero array removes card
3. User switches to Suggested tab → `GET /api/suggestions/board` returns the row (already excludes dismissed server-side)
4. **However**: if the user dismisses on the board THEN switches back to home, the hero won't refetch automatically; same issue mirrored.

The cleanest fix is for `handleDismiss` on both surfaces to post `.suggestionsRefreshRequested` after the server confirms; both surfaces already subscribe.

---

## 4. Commit timeline (compressed)

| Commit | Date | What |
|---|---|---|
| `26aab35` | 05-25 01:54 | Phase A: 6-layer engine + cron + endpoints |
| `5e5b0b5` | 05-25 02:04 | Match signals expanded (transit breakdown for cards) |
| `a306fb2` | 05-25 02:13 | `push_suggestions` opt-out wired |
| `d1078c4` | 05-25 05:32 | **Fix**: bearing demoted from hard filter → scoring (was killing valid matches) |
| `24bdc41` | 05-25 05:40 | **Fix**: time-window demoted from hard filter → scoring decay |
| `63ad0a8` | 05-25 13:13 | Routine origin/dest addresses surfaced |
| `a04136e` | 05-25 13:37 | **Fix**: purge suggestions for inactive/past-end routines |
| `03748c6` | 05-25 13:51 | Rider-routine POST accepts addresses |
| `7625652` | 05-25 14:36 | **Architecture**: unified driver_routines + rider_routines |
| `84d766c` | 05-25 16:11 | **Fix**: push spam (1/24h dedup) + per-mode hero filter |
| `8cd9f38` | 05-25 16:43 | MapKit-first polyline + server validate (Google fallback) |

### Phases — status

| Phase | What it covers | State |
|---|---|---|
| A — Server foundation | Engine + endpoints + cron + opt-out | ✅ Shipped |
| B.1-B.6 | iOS UI (hero, tab, detail sheet, addresses, polyline upload) | ✅ Shipped (B.7 done today as MapKit-first) |
| B.7 (re-do) | MapKit-first polyline + server validate | ✅ Shipped today |
| **B.8** | Dedup new push vs legacy `/notify` | ❌ `notified_via_instant` column never gets set by the legacy path |
| **C** | Web UI parity | ❌ Web has no Suggested Rides surface yet |
| **D** | True reverse-trip matching | ❌ Rejected by `originProj.fractionAlong < destProj.fractionAlong` check |
| **E** | 7am daily digest cron for deferred rows | ❌ Rows marked `deferred` but nothing picks them up; they expire instead of pushing |

---

## 5. Recommendations (CTO synthesis)

### Tier 1 — Ship next slice

**R1. Treat anytime as a virtue, not a penalty.**
- Engine: when either side has no time, set timeScore to `0.85` (between "perfect time match 1.0" and "30-min apart 0.83"). Anytime↔anytime should score the highest (1.0). This lifts those pairs above the 0.7 push threshold.
- UI: when both departure + arrival times are null, surface a prominent **"Anytime"** label in both the card and the detail sheet's time row.
- Why: today's behavior actively discourages the most flexible users. ~4 line engine change + ~10 line UI change.

**R2. Make dismiss propagate across surfaces.**
- iOS: after a successful dismiss, post `.suggestionsRefreshRequested` on both `SuggestedRidesHero.handleDismiss` and `SuggestedRidesPanel.handleDismiss`.
- Why: the bug is visible to any user with both surfaces open. ~2 line fix.

**R3. Event-trigger cleanup on routine delete/deactivate.**
- iOS: after `RoutinesRepository.delete()` or `setPaused(true)`, immediately purge ride_suggestions rows for that routine via a small server endpoint OR post `.suggestionsRefreshRequested` (the row is gone after CASCADE; refetch will reflect that).
- Server: add `POST /api/suggestions/purge-routine/:id` (calls `scanForRoutine` with a "now-inactive" branch OR just DELETE WHERE rider_routine_id=$ OR driver_routine_id=$).
- Why: today users wait up to 5 minutes for the cron tick. Bad first impression.

### Tier 2 — Close phase gaps

**R4. Phase B.8 — dedup vs legacy `/notify`.**
- When `/api/schedule/notify` pushes to a driver about a rider's post, mark the corresponding `ride_suggestions` row's `notified_via_instant = true` so the suggestion engine doesn't push the same person about the same suggestion 5 minutes later.

**R5. Phase E — 7am digest cron.**
- A daily cron firing at 7am local (or 7am UTC for v1) picks up every `ride_suggestions` row with `relevance_score < 0.7` AND `trip_date > today` AND `*_notified_at IS NULL` and sends one consolidated push per user: "You have N new ride matches for the week."

### Tier 3 — Strategic backlog

**R6. Phase D — true reverse-trip matching** for opposite-direction round-trips. Bigger lift; defer unless user demand surfaces.

**R7. Phase C — web Suggested Rides surface.** Mirror iOS hero + Suggested tab on `tagorides.com`.

**R8. Schedule cancellation column** — add `cancelled_at` to `ride_schedules` + cleanup logic. Currently no way to soft-delete a one-off post.

**R9. Remove dead `backfillRoutineAddresses.ts` references to dropped `rider_routines` table.**

---

## 6. What's working well

- **Single canonical posting path** on web + iOS (no parallel/legacy code creating routines or schedules — the "audit before creating" rule held).
- **ON DELETE CASCADE wired everywhere** in migrations 100 + 103. Hard deletes are instant.
- **Hero and tab share the same server contract** (`/top` and `/board` both filter dismissed identically).
- **Same-day high-relevance matches always push** (the dispatch threshold + new 24h dedup combine well).
- **MapKit-first polyline path** removes recurring Google charges for routine creation (shipped today).
- **Architectural unification** of driver_routines + rider_routines reduces FK + query branching across the whole stack.

## 7. What's NOT working

- Anytime trips: matched but anti-discoverable (3-layer issue: scoring, push threshold, UI label)
- Dismiss propagation: no cross-surface signal
- Routine deactivation latency: ~5 min cron tick
- Schedule soft-delete: not modeled
- Phase B.8 / C / D / E: open
- One dead script (`backfillRoutineAddresses.ts`)
