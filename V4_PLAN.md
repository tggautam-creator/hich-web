# TAGO — Version 4 Plan

**Owner:** Tarun
**CTO / planning lead:** Claude (this session)
**Created:** 2026-06-04
**Status:** 🟡 Planning — feature list pending. Tarun will dictate the V4 feature set; this doc captures the operating contract NOW so implementation never re-negotiates the rules. Feature + slice breakdown gets filled in *after* we discuss and agree on scope.

> **How V4 runs:** We discuss features → I (as CTO) read the relevant code end-to-end → I propose a plan → we review it together → we break each feature into small slices in this file → Claude implements one slice at a time, updating [V4_PROGRESS.md](V4_PROGRESS.md) after every slice. No slice ships without Tarun's explicit "go".

---

## 1. What V4 is

_To be defined with Tarun._ This section will hold the V4 north star and the full feature list once we've discussed it. Until then it is intentionally blank — I will not invent scope.

**Platform(s):** TBD (iOS / web / both — decided per feature once Tarun lists them).

---

## 2. The operating contract (read before touching any code in V4)

Every rule below is distilled from `CLAUDE.md`, `ios/CLAUDE.md`, and the durable memory files. These are not suggestions. If a rule blocks the work, raise it with Tarun before deviating — never silently ignore it.

### 2.1 Reading order before ANY code on a slice (hard rule, no skim)

This is how features ship missing buttons/banners/endpoints — by skipping the read. Before writing a single line for a slice:

**iOS slices** (per `ios/CLAUDE.md` Reading Order):
1. [V4_PROGRESS.md](V4_PROGRESS.md) — current slice, last decisions, blockers.
2. This file — the feature's slice list and any locked decisions.
3. The matching **web component** `src/components/**/<Name>.tsx` — end to end, top to bottom. Enumerate every button, conditional render, section.
4. Vitest tests `src/**/<Name>.test.tsx`.
5. Server route(s) the feature calls `server/routes/<name>.ts`.
6. Supabase migrations touching the tables `supabase/migrations/*.sql`.

**Web parity slices** (per `CLAUDE.md` iOS-parity rules — iOS is source of truth for features ≥ migration 086):
1. [V4_PROGRESS.md](V4_PROGRESS.md) → this file.
2. The iOS **source** `ios/Tago/Features/<Area>/*.swift` — end to end.
3. iOS endpoint defs `ios/Tago/Core/Networking/Endpoints/<Area>*Endpoint.swift` and models `ios/Tago/Models/`.
4. The web counterpart `src/components/**` / `src/lib/*`.
5. Web Vitest tests.
6. Server route(s) + migrations (≥ 086).

**Hard rule — iOS planning markdowns are off-limits during parity audits.** Only `.swift` + migrations + `server/routes/`. Never read `*_PLAN.md` / `*_PROGRESS.md` under `ios/` or `docs/` for scope — they lag the shipped code and produce findings about what was *planned*, not what *ships*. Whitelisted markdowns: `CLAUDE.md`, `ios/CLAUDE.md`, this file, `V4_PROGRESS.md`.

Before writing code, list every user-visible element + every endpoint the slice touches, and mark each "shipping this slice" or "deferring because X" so Tarun can veto.

### 2.2 Source-of-truth map (which platform is canonical)

- **New features (migration ≥ 086):** iOS is canonical. Web copies iOS UX (sheet vs page, copy, button order, empty/error states) before any web-native upgrade.
- **Older flows (web shipped first):** auth + onboarding, fare formula (`src/lib/fare.ts`), historical payment server contract, matching stages 1–4 → **web stays canonical**.
- **When in doubt:** check the migration number. ≥ 086 → iOS canonical. Older → web canonical / parity-locked.

### 2.3 Audit before creating (hard rule)

Before adding ANY new table / endpoint / page / component / Codable struct, run a structured audit pass for existing functionality that could be *extended* instead of paralleled. The default mistake is building parallel infra when an existing system already covers ~80%. Grep lateral terms (not just the new feature name), read the schema of any similarly-shaped table, read the largest existing UI page in that area. Surface the audit finding in the plan ("X exists at Y; extend = Z lines vs parallel = W lines; recommend ___") and let Tarun decide. Banned phrase: "I'll build a new [thing] for [feature]."

### 2.4 Definition of Done — gates (per slice, all green before `[x]`)

**iOS slice:**
1. **Tests pass** — XCTest at `ios/HichTests/Features/<Flow>/`, port every matching Vitest case, plus a UI test (happy + 1 sad + 1 impatient-user path).
2. **Lint clean** — `swiftlint --strict ios/` → zero warnings/errors on changed files. (Pre-existing file/line-length warnings in untouched files are out of scope but must be called out.)
3. **Builds on sim AND device** — both end in `** BUILD SUCCEEDED **`. Verify the `.app` bundle has real contents (xcodebuild can exit 0 with an empty bundle — see §3).
4. **Post-build web/iOS diff** — re-read the counterpart end-to-end with fresh eyes; walk every state (empty/loading/error/success/sad); Dark + Light pass; confirm same endpoints + payload shape.
5. **Reviewer parity matrix** — see §2.6.
6. Device-first install + Tarun visually verifies before `[x]`.

**Web slice:**
1. `npm test -- --run` — all pass, including new tests for the feature.
2. `npm run lint` — zero errors.
3. `npm run build` — full build (NOT just `tsc -b` — that misses Vite/Vercel failures).
4. Reviewer parity matrix (§2.6) + plain-English summary (§2.7).

### 2.5 Per-feature green light (hard rule)

Stop after EACH feature (not each phase). Run gates → tough self-review → handoff with the parity matrix + plain-English summary → **wait for Tarun's explicit "go" / "push" / "ship it"** before starting the next. The audit advances one slice at a time.

### 2.6 Reviewer parity-check before every slice handoff (hard rule)

After every slice — even when lint/tests/build are green — a separate, structured reviewer pass MUST run and the handoff MUST contain a 3-column parity matrix: `iOS element / web counterpart / verdict` using ✅ matches / ⚠️ drifted (say exactly how) / ➖ deferred (cite the slice). Verify the **wire shape** (write payload keys + types match on both platforms — read the actual call sites, not comments) and the **read shape** (every surfaced field decoded + rendered the same). The only acceptable verdicts are full match, explicit drift, or explicit deferral — never "kind of similar". Silent omission of an iOS element = failure. Pure docs/tests slices may skip the matrix but must state "N/A — no user-visible parity surface".

### 2.7 Handoff message structure (mandatory, every slice)

1. One-paragraph summary of what shipped.
2. The parity verdict matrix (§2.6).
3. Outstanding gaps the reviewer flagged.
4. Test + lint + build gate status.
5. **Plain English** section — non-technical description of what shipped + what's next. (Separate from the technical detail.)
6. "What's next" pointer to the next slice.
7. The "awaiting your go" line.

### 2.8 Progress file is the scoreboard — keep it LIVE (HARD RULE for V4)

[V4_PROGRESS.md](V4_PROGRESS.md) is the single source of truth for V4 state. **After EVERY slice, Claude MUST update it** — this is non-negotiable for V4:
- At slice start: flip `[ ]` → `[~]` immediately (don't batch).
- During: append to the **Decisions Log** the moment a non-obvious decision is made (library choice, workaround, deviation, deferral) with today's date.
- On a blocker: add it to **Blockers & Pending Questions** with one line of context.
- **Record every bug hit + how it was solved** in the Decisions Log so it's never re-debugged. Record any plan change and any new requirement Tarun adds mid-flight.
- On completion (all gates green + Tarun verified): flip to `[x]` with a one-line note + date, update the Summary counts, update Current focus / Next action, append a Recent Sessions row.

A slice that ships but leaves the progress file stale is a half-done slice.

### 2.9 Asking questions — use `AskUserQuestion`, not prose (hard rule)

Any question about scope, behaviour, UX choice, trade-off, which-of-N, or bundle-vs-split → use the `AskUserQuestion` tool with sensible multi-choice options. Never a numbered list in prose, never "let me know which you prefer". Batch independent questions into one call. Exception: a single immediate yes/no follow-on ("want me to commit this?").

### 2.10 Git / commit / push discipline (hard rules from memory)

- **Repo split:** `~/Desktop/Hich/` = hich-web (server + web). `~/Desktop/Hich/ios/` = tago-ios (its own repo, gitignored by hich-web). Commits route by cwd — state the target before any push. Cross-stack changes ship server-first.
- **Commit only on "commit"**, push only on explicit **"push" / "ship it"**. "commit" means git commit ONLY; report unpushed count back.
- **Never push before Tarun tests locally.**
- **Pre-commit gates STRICT:** lint + full build (`npm run build`, not just `tsc -b`) + tests, AND inspect the staged diff for parallel-session contamination before every commit. Run `git diff --cached` AFTER `git add` in the SAME shell line (a parallel session can stage files between status and commit).
- **No `Co-Authored-By: Claude` trailer** in any commit message. Keep the git log free of AI attribution.
- **Never force-push to main. Ever.** No PRs / publishing without explicit request.

### 2.11 Parallel-session awareness (hard rule)

Tarun runs 2+ Claude sessions concurrently. Lanes:
- **Admin session:** `src/components/admin/`, `server/routes/admin/`, marketing files. Don't read their files for non-admin work, don't stage them, flag their lint warnings without fixing.
- **Webapp session:** caregivers / onboarding / ride / profile web work is often theirs. (Note: `src/components/ride/ProfilePage.tsx` + its test are currently uncommitted in the working tree — likely theirs. Leave them.)
- **iOS session:** if an iOS file I didn't touch won't compile, it's their WIP — **flag and wait, never patch it.**
- **Never run `pkill -f xcodebuild` / tsx / node** — it breaks the other session's build.

### 2.12 No MVP framing (hard rule)

Tago is live production. Never "MVP-acceptable" / "ship now, polish later". Close every drift before declaring done. Strip MVP language from docs.

### 2.13 Log every bug & irregularity for the next session (HARD RULE, added 2026-06-05 by Tarun)

Any bug, environment quirk, non-fatal-but-confusing warning, pre-existing lint, tooling gotcha, or deviation hit during implementation MUST be written into **[V4_PROGRESS.md](V4_PROGRESS.md) → "Known issues & irregularities"** (and/or the Decisions Log) the moment it's encountered — not just mentioned in chat. The chat is ephemeral; a new session starts cold and only has the docs. If it isn't in the doc, it didn't happen as far as the next session is concerned. Quote the exact symptom + the resolution/workaround so it's never re-debugged. This is the durable memory across session boundaries.

### 2.14 Build/install efficiency (hard rule, added 2026-06-05 by Tarun)

Do NOT rebuild + reinstall after every sub-edit. Make ALL code edits for a slice first, then at slice end do **one** simulator build+install and **one** device build+install. A single build canNOT serve both surfaces — simulator (`Debug-iphonesimulator`, sim arch) and device (`Debug-iphoneos`, signed arm64) are separate bundles, so two builds is the unavoidable minimum — but it IS the minimum: one per surface, once, at the end (plus a fast compile-only check mid-way only if a risky edit needs it). Install on Tarun's iPhone (`00008140-0012688A3A10801C`) as well as the sim before handoff.

### 2.15 iOS-only for now — web parity DEFERRED (hard rule, added 2026-06-05 by Tarun)

Build the **iOS app** (and any **server backend** the iOS feature requires) only. Do **NOT** implement the **web frontend (`src/`) parity** slices — Tarun will do the webapp pass himself later. This means, for every feature: build Block(s) for server + iOS; **skip the web-frontend block** (F1 Block C, F2 Block D, F3 Block D, F4 B.1, F5 Block A.5/B web, F6 Block D, F7 Block C) until Tarun says to start the web pass. The "web parity — copy from iOS" rules still apply *when* that web pass happens, but it is out of scope for the current iOS sprint. **Consequence for handoffs:** the iOS↔web parity matrix's web column is "➖ deferred per Tarun (web later)" for all slices in this sprint — don't treat missing web as drift.

---

## 3. Past bugs & gotchas to NEVER repeat (the catalogue)

Each of these cost real debugging time. Re-read before working in the relevant area.

### Backend / data
- **Money is always cents (integers).** `fare_cents`, `wallet_balance`, `amount_cents`. Display as dollars only. Never floats.
- **Wallet debit + credit in ONE DB transaction** (`BEGIN/COMMIT`). Never separate queries.
- **Migration numbering:** `ls supabase/migrations/ | sort | tail -3` before naming a new one; pick highest+1. Collided twice (074, 077). If a number's taken by an in-flight stream, just bump to the next slot — don't renumber theirs.
- **Prod env values on prod (HARD RULE):** EC2 + Vercel must use prod Stripe/Supabase/Firebase exclusively. Boot guards in `server/index.ts` + `assertProdEnv()` in `vite.config.ts` enforce it — don't disable them.
- **Webhooks point at `www`, not apex** — Vercel apex 307→www and Stripe/Twilio don't follow redirects.
- **Twilio Verify is NOT live** — every user has `phone_verified=false`. Never gate UX on it; never present `PhoneVerificationPage` outside the signup flow; no server 403 `PHONE_NOT_VERIFIED`.

### iOS — Supabase / Realtime
- **Lowercase the UUID in Storage paths** — RLS compares case-sensitively against lowercase `auth.uid()::text`; Swift `UUID.uuidString` is UPPERCASE → upload bounces with "new row violates row-level security policy". Use `.uuidString.lowercased()`.
- **Lowercase the UUID in Realtime channel names** — same trap; uppercase channel names silently never match server-emitted (lowercase) topics, so events drop with no error. Burned on `rider-pickup:`, `driver-pickup:`, `rider-signal:`, `ride-location:`.
- **Swift Realtime SDK envelope shape differs by sender:** web-sent broadcasts arrive as `{type,event,payload:{...}}` (unwrap the nested `payload`); iOS-sent arrive flat. Handle both or every payload access returns nil.
- **Realtime is NOT buffered for late subscribers** — bootstrap "latest known" state from the source-of-truth table on mount; the realtime listener takes over.
- **Role on a ride is per-ride, decided by IDs** — compare `auth.profile.id` to `rides.rider_id`/`driver_id` (or read server `my_role`). Never infer from tab/screen/sub-app. A driver can be the rider on another ride simultaneously.

### iOS — MapKit / annotations
- **Set the polyline/overlay style BEFORE `addOverlay`** — MapKit calls `rendererFor` synchronously inside `addOverlay` and caches the renderer per-overlay forever. Style written after = default sticks permanently.
- **Tilted nav camera = manual `MKMapCamera`, not `followWithHeading`** — the two animators fight per GPS tick and shake. `followWithHeading` is fine only for the flat rider-walk screen.
- **Bearing from prior GPS tick spins when points are sub-metre apart** — filter with a haversine `≥ 1.0 m` guard; first tick has no prior, default heading gracefully.

### iOS — build / tooling
- **Run `xcodegen generate` after creating ANY new `.swift` file** — `project.yml`'s `path: Tago` does NOT auto-include new files; incremental builds mask the gap, a `clean` build exposes "not in scope" everywhere. Verify: `grep -l NewFile ios/Tago.xcodeproj/project.pbxproj`.
- **`xcodebuild` can exit 0 with an empty `.app`** — don't trust the exit code; verify the bundle has the binary + Info.plist + Assets.car. If it only has `embedded.mobileprovision`, the build silently failed — grep output for `error:`.
- **OSLog dynamic values need `privacy: .public`** to be readable in Console.app on a real device (sim shows them, device redacts to `<private>`). Use `.public` for non-PII diagnostics.
- **Don't `pkill -f xcodebuild`** — parallel sessions.
- **Put `.xcarchive` on `~/Desktop`, not `/tmp`** — Organizer doesn't scan `/tmp`; also copy into `~/Library/Developer/Xcode/Archives/<date>`.
- **Use the already-booted simulator** — `simctl list devices booted` first; the `available` filter hides booted sims and spawns a wasteful Pro variant.

### iOS — networking / device
- **Local Network Privacy gate** — any bundle talking to a LAN host needs `NSLocalNetworkUsageDescription` in Info.plist (separate from ATS `NSAllowsLocalNetworking`). Without it iOS silently denies LAN HTTP (60s TCP hang). Grant is per-bundle. Symptom: spinning UI on LAN screens while public HTTPS works.
- **Dev server LAN IP rotates between sessions** — `ipconfig getifaddr en0` vs `ios/Tago.local.xcconfig` `TAGO_API_HOST` before debugging "can't reach server". CGNAT (100.64.0.0/10) needs an explicit `NSExceptionDomains` entry.
- **`tsx watch` ignores `.env` edits** — server hot-reloads `.ts` only; `.env.dev/.prod` changes need a manual restart (`.ts` edits don't).

### iOS — UX papercuts
- **`.dismissKeyboardOnTap()` on every screen with a `TextField`** — iOS gives no free tap-outside dismiss; multi-line fields also need a keyboard-toolbar Done button. User has been trapped twice.
- **Dark + Light both, always** — no `Color.white`/`Color.black`/raw-hex fills on surfaces or text; use adaptive `Tokens.color.*` / system backgrounds / materials. Verify the text+surface *combination* in both modes.
- **Emergency button** — always in a React portal at DOM top (web). Never inside conditional renders / menus.
- **End-ride gate** — the secondary "End ride without QR" stays hidden until the ride is BOTH > 5 min active AND > 1 km GPS distance. Both surfaces. QR is the primary path. Without the gate the rider could end at 100m and pay only the $5 min.

### Known deferred issue (don't re-debug from scratch)
- **Find-new-driver stale-state tail** — after driver-cancel + "Find another driver", the rider's WaitingRoom can occasionally still show the cancelled driver as "DRIVER ACCEPTED". Partial fixes shipped 2026-05-07 (see memory `project_find_new_driver_known_issue`); residual case parked. Diagnostic OSLog is in place — debug with iOS Console.app + dev-server logs side-by-side; don't strip the instrumentation.

### Fare formula (re-derive, never guess)
```
gas_cost_cents  = round((distance_km * 0.621371 / mpg) * gas_price_per_gallon * 100)
time_cost_cents = round(duration_min * 5)            // 5¢/min (was 8 before 2026-05-01)
raw             = gas_cost_cents + time_cost_cents    // base fare removed 2026-05-01
fare_cents      = max(500, raw)                       // $5 min, no cap (removed 2026-04-24)
platform_fee_cents = 0; driver_earns_cents = fare_cents
```
Default mpg=25. `gas_price_per_gallon` from EIA via `GET /api/gas-price?state=CA` (server 6h cache, iOS 30min); falls back to $3.50.

---

## 4. Features index

> One row per V4 feature. Each finalized feature gets a full spec + slice breakdown in §5. More features are still being discussed — this table grows as Tarun dictates them.

| # | Feature | Platform(s) | Source of truth | Status |
|---|---------|-------------|-----------------|--------|
| 1 | **Companion option** — riders bring up to 2 friends/family for a per-companion fee, mirroring Caregivers | Server + iOS + Web | iOS-canonical (new; migrations ≥ 118) | 🟢 Spec finalized 2026-06-04 — see §5.1 |
| 2 | **Wallet rewards (credits)** — real-money promo credits with eligibility-gated withdrawal, expiry, rider ride-use, and an admin distribution + monitoring panel | Server + Admin(web) + iOS + Web | new (migrations ≥ 118) | 🟢 Spec finalized 2026-06-04 — see §5.2 |
| 3 | **Refer a friend** — code-based two-sided referral; both sides earn a $5 credit after the friend's first trip; full funnel tracking + admin view | Server + Admin(web) + iOS + Web | new (migrations ≥ 118) · **depends on Feature 2** | 🟢 Spec finalized 2026-06-04 — see §5.3 |
| 4 | **Fare Acknowledgment** — always-on post-success confirmation on the ride board (estimated fare/earnings + My Rides / Ride Board CTAs) | iOS + Web (**client-only**) | the unified UX described by Tarun | 🟢 Spec finalized 2026-06-04 — see §5.4 |
| 5 | **Remote popups** — (A) blocking App Gate (force-update + maintenance) + (B) dismissible admin-managed Announcements | Server + Admin(web) + iOS + Web | new (migrations ≥ 118) | 🟢 Spec finalized 2026-06-04 — see §5.5 |
| 6 | **Explore** (the headline) — admin-curated Events + Places where students find travel partners; waitlist + driver plans + round-trip matching. New bottom tab (Payment folds into Account). | Server + Admin(web) + iOS + Web | new (migrations ≥ 118) · **depends on Feature 1** | 🟢 Spec finalized 2026-06-04 — see §5.6 |
| 7 | **Sharing** — share button → deep link that opens an exact ride-board post or Explore item; public preview; "no longer available" fallback | Server + iOS + Web (likely no migration) | extends deep-link routing · Explore-share **depends on Feature 6** | 🟢 Spec finalized 2026-06-05 — see §5.7 |
| _ | _more pending discussion_ | _ | _ | _ |

---

## 5. Feature specs + slice breakdown

Each slice = one focused, independently-shippable change that passes all gates (§2.4) and gets one green light (§2.5). Status legend mirrors [V4_PROGRESS.md](V4_PROGRESS.md): ⬜ not started · 🟡 in progress · ✅ done.

---

### 5.1 — Companion option

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion).

**What it is:** A rider traveling with friends/family picked up from the same place can attach **up to 2 companions** to a ride for a **per-companion** seat fee. It mirrors the existing Caregiver feature surface-for-surface (registration, rider toggle, driver waive preference, driver notification, pickup/active-ride/summary surfacing) and additionally closes two gaps that also affect caregivers (chat identity + board badge).

#### Locked decisions
| Decision | Choice |
|---|---|
| Max companions per ride | **2** |
| Fee model | **Per companion** — total = (companion count) × tier |
| Fee tiers (per companion) | `< 10 mi → $4 (400¢)` · `10–50 mi → $6 (600¢)` · `> 50 mi → $10 (1000¢)` |
| Fee timing | **End-of-ride, from REAL distance — for BOTH companion AND caregiver.** Pre-ride preview + driver notification are *estimates*; the charge uses distance actually driven. (Changes existing caregiver settlement, which is frozen at request-time today.) |
| Gating | **Ungated** — all riders get the toggle + a Companions profile section. Not an accessibility feature. |
| Companion photo | **Required** (like caregivers) — driver recognizes the party at pickup |
| Phone entry | **Pickable from phone directory** (iOS `ContactsUI`/`CNContactPickerViewController` → needs `NSContactsUsageDescription`). Web: manual entry. |
| Relationship field | Kept + displayed (caregivers deprecated it; companions keep it), optional |
| Driver waive | **Separate** `waive_companion_fee` toggle (parallel to caregiver), with its own help box, on DriverHome live toggle + EditProfile |
| Seat capacity | **Informational only for v1** — show party size; don't filter matching by seats yet (caregivers don't either). Revisit if it causes problems. |
| Gap-fill scope | **Full parity** — add caregiver + companion identity to the chat thread; add "with companion"/"with caregiver" badges to board cards |
| Toggle placement | Rider-needs-a-ride paths ONLY (instant RideConfirm + board *request*). NOT the driver post-a-ride path. |
| Money | Per-companion fee folds into BOTH rider charge and driver earnings (platform fee 0%, driver keeps 100%); waive zeroes both. Cents only. |
| Privacy | Companion **phone NOT in the pre-accept FCM fan-out** (mirrors caregiver F18.5); released only to the matched driver post-accept via authenticated `/api/rides/active`. |

#### Data model (new migrations — verify next number with `ls supabase/migrations/ | tail` at build time; current highest = 117)
- **`companions` table** (mirror `caregivers`, migration 089): `id`, `user_id` FK→users ON DELETE CASCADE, `name` (1–100), `relationship` (≤50, optional), `phone` (E.164, optional), `avatar_url` (required at UI layer), `notes` (≤500, optional), `created_at`, `updated_at`. RLS: `auth.uid() = user_id` for all ops. Hard-delete model.
- **`rides`:** add `companion_a_id`, `companion_b_id` (UUID FK→companions ON DELETE SET NULL) + `companion_fare_cents` (INT, the settled aggregate). Partial indexes on non-null companion FKs.
- **`ride_schedules`:** same two FK columns + `companion_fare_cents`.
- **`users`:** add `waive_companion_fee` BOOLEAN NOT NULL DEFAULT false.
- **Already exists** (reuse, don't recreate): `ride_rider_shares.companion_share_cents` (migration 097) and `computeRiderTotals({ companionFareCents })` — settlement already accepts a companion fee; today it's hardcoded `companionShareCents = 0` ([rides.ts:4121](server/routes/rides.ts#L4121)), replaced by this feature.
- **Schema note:** two FK columns (not a join table) chosen because the cap is a fixed 2 and it matches the caregiver single-column pattern. Revisit if the cap ever changes.

#### Fare logic
```
companionFareCentsFor(distanceKm):           // per companion
  mi = distanceKm * 0.621371
  if mi < 10  return 400     // $4
  if mi <= 50 return 600     // $6
  return 1000                // $10
companionTotal = companionCount * companionFareCentsFor(distanceKm)
```
- **End-of-ride recompute (both fees):** at `/api/rides/end`, after the real settled distance is known, recompute `caregiverFareCentsFor(realDist)` and `companionFareCentsFor(realDist) × count`, fold into the final charge + driver earnings, and write the FINAL values to the ride row + `ride_rider_shares`. The request-time values become preview estimates only. Handle single-rider AND multi-rider (F17) paths. Decide the multi-rider distance basis (per-rider segment vs trip) during the slice — flag to Tarun.

#### Surfacing map (mirror caregiver + close gaps)
| Surface | Caregiver today | Companion plan |
|---|---|---|
| Registration | onboarding + profile sheet | **Profile Companions section (ungated)** + add/edit sheet w/ contacts picker |
| Rider toggle | RideConfirm + board confirm (accessibility-gated) | Same screens, **ungated**, multi-select up to 2 |
| Driver waive pref | EditProfile + DriverHome toggle | **Separate** companion toggle, both places, help box |
| Driver notification | badge + name + fee (no phone) | same (companion count + names + est. fee, no phone) |
| Request review | BoardRequestRiderContextCard row | companion rows (names/photos/relationship + tap-call post-accept) |
| Drive-to-pickup | ✅ DriverJourneyDrawer CaregiverContextRow | + CompanionContextRow(s) |
| Active ride | ✅ DriverActiveRideDrawer CaregiverContextRow | + CompanionContextRow(s) |
| Ride summary | ✅ fee line + context row | + companion fee line + rows |
| **Chat thread** | ❌ identity NOT shown (gap) | **add caregiver + companion identity** |
| **Board card** | ❌ no badge (gap) | **add "with companion" + "with caregiver" badge** |

#### Platform scope + ordering (CTO assumption — veto if wrong)
Cross-stack ships **server-first** (memory rule). Plan: **Block A (server + DB) → Block B (iOS, primary) → Block C (web parity)**. iOS is canonical for the new UX. Web parity (Block C) can be deferred to a later green-light if Tarun wants iOS shipped first.

#### Slices

**Block A — Backend foundation (server + DB)**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: `companions` table + `rides`/`ride_schedules` companion FK columns + `users.waive_companion_fee` + RLS + indexes | ⬜ |
| A.2 | `server/routes/companions.ts` CRUD (POST/GET/PATCH/DELETE) + validators + route registration + tests | ⬜ |
| A.3 | `companionFareCentsFor` + fold helper + `waive_companion_fee` lookup; wire into `/api/rides/request` (validate ≤2 companion ownership, persist estimate) + FCM payload (count/names/est fee, NO phones) + tests | ⬜ |
| A.4 | **End-of-ride recompute** — refactor `/api/rides/end` (single + multi-rider) to recompute caregiver + companion tiers from REAL distance; replace `companionShareCents = 0`; write finals to ride row + `ride_rider_shares`; tests (delicate fare change) | ⬜ |
| A.5 | Schedule/board path: thread companions through `/api/schedule/request` + board offer accept + driver waive; `/api/rides/active` returns companion identity (incl. phone) post-accept; tests | ⬜ |
| A.6 | `/api/users/profile` GET/PATCH read/write `waive_companion_fee` + tests | ⬜ |

**Block B — iOS**
| # | Slice | Status |
|---|---|---|
| B.1 | `Companion` model + `CompanionsRepository` + CRUD endpoints (mirror Caregiver) | ⬜ |
| B.2 | Profile **Companions section** (ungated) + add/edit sheet (name, photo REQUIRED, relationship, phone) + **contacts picker** (`CNContactPickerViewController`) + `NSContactsUsageDescription` | ⬜ |
| B.3 | "Traveling with companions?" toggle + up-to-2 multi-select on instant RideConfirm + per-companion×count fee preview; wire companion ids into RequestRideEndpoint | ⬜ |
| B.4 | Same toggle on board *request* (RideBoardConfirmSheet/SchedulePostPage) — rider-needs-ride only; wire ScheduleRequestEndpoint | ⬜ |
| B.5 | Driver **Waive companion fees** toggle on DriverHome live toggle + EditProfile + help box; wire `waive_companion_fee` into UserProfileEndpoint | ⬜ |
| B.6 | Driver request surfacing: foreground FCM companion badge + BoardRequestRiderContextCard companion rows (names/photos/relationship + tap-call post-accept) + earnings line | ⬜ |
| B.7 | `CompanionContextRow`(s) in DriverJourneyDrawer (pickup) + DriverActiveRideDrawer (active ride) | ⬜ |
| B.8 | **Chat thread:** caregiver + companion identity context (closes caregiver gap) | ⬜ |
| B.9 | Ride summary: companion fee line + identity rows + waive note | ⬜ |
| B.10 | Board card "with companions" / "with caregiver" badge | ⬜ |

**Block C — Web parity** (defer-able to a later green-light)
| # | Slice | Status |
|---|---|---|
| C.1 | companions type + React Query hooks + API (mirror useCaregivers/caregiversApi) | ⬜ |
| C.2 | Profile Companions section + add/edit sheet (photo required, relationship, phone) | ⬜ |
| C.3 | Companion toggle on RideConfirm + RideBoardConfirmSheet (rider-only) | ⬜ |
| C.4 | Driver waive companion toggle in EditProfileSheet + help box | ⬜ |
| C.5 | Driver surfacing: RideRequestNotification companion badge + request review | ⬜ |
| C.6 | DriverPickupPage + DriverActiveRidePage companion context rows | ⬜ |
| C.7 | Chat: caregiver + companion identity in MessagingWindow (closes gap) | ⬜ |
| C.8 | Ride summary companion fee line | ⬜ |
| C.9 | Board card badges | ⬜ |

#### Open follow-ups to confirm before coding this feature
- Platform scope: web (Block C) is **deferred** per §2.15 (Tarun does the web pass later) — build server + iOS only.
- Multi-rider end-of-ride distance basis for the recompute (per-rider segment vs whole trip).
- Whether companions also need an onboarding entry point or profile-only is enough for v1 (assumed profile-only).
- **F4 confirmation hook (already in place):** when a companion attaches to a board post, append a companion `FareAddOn` (tiered $4/$6/$10) in `SchedulePostPage+FareAck.fareAckAttachedAddOns()` — the hook + comment are already there from F4, so the post-success confirmation will include the companion fee + its explanation automatically.

---

### 5.2 — Wallet rewards (credits)

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion).

**What it is:** A real-money credit/rewards system. Tago grants credits (signup bonus, car-registration bonus, or custom admin awards) to riders/drivers. Credits are **real money but restricted**: drivers can withdraw them only after meeting an admin-configured eligibility rule (and only by *converting* them into withdrawable balance); riders can't withdraw at all — their credits auto-apply to ride fares. Credits **expire** per type. An admin panel creates credit types, distributes credits to targeted audiences, configures eligibility, and monitors Tago's Stripe balance against outstanding liability. **Real money → security is the top priority; a reviewer monitors every step.**

#### Why this is safe-by-construction
The #1 protection: **credits live in a completely separate bucket from `wallet_balance`.** The existing withdraw path (`POST /api/wallet/withdraw`) only ever touches `wallet_balance`, so it is *physically incapable* of paying out a credit. Credits enter withdrawable money through exactly ONE audited, server-eligibility-gated path: convert-on-claim.

#### Locked decisions
| Decision | Choice |
|---|---|
| Credit vs balance | **Separate restricted bucket**, never counted in `wallet_balance`. Driver unlocks via **convert-on-claim** (explicit "Claim" tap → atomic move into `wallet_balance`). |
| What unlocks a claim | **Earnings + rides given only** — top-ups do NOT count (anti-gaming). Basis = **lifetime ride earnings** (so withdrawing earnings doesn't re-lock credits). |
| Eligibility rule | **ONE global policy**, admin-editable. Default: **bank linked AND lifetime ride earnings ≥ $20**. Policy also supports min-rides + single-ride-value primitives for admin to enable. |
| **Dynamic UX** | The client **fetches the live policy + the user's progress** and renders against it ("$12 / $20 earned — give rides to unlock $10"). If admin changes the threshold to $25, the UX reflects it immediately. **Never hardcode the threshold.** |
| Rider use | Credits **never withdraw**; auto-apply to fares. Payment waterfall: **credits → wallet → card**. Driver still earns full fare; Tago funds the credit portion from its Stripe balance. |
| Bonus triggers | **Auto-grant on event** (signup-complete, car-registration-approved) via idempotent server hooks; **custom awards distributed manually** by audience from admin. |
| Expiry | Per type, admin-editable. Defaults: **signup 3mo · car-registration 6mo · custom set-on-create**. Daily cron sweep expires past-due grants. |
| Distribution safety | **Warn but allow** if a distribution pushes outstanding credits beyond Tago's Stripe balance; the monitor dashboard keeps flagging while eligible-total > balance. |
| Money | Cents only. Every credit movement atomic via dedicated RPCs with no-negative guards; append-only event log; idempotent grants/claims/spends. |

#### Data model (new migrations — verify next number with `ls supabase/migrations/ | tail`; current highest = 117. Reuse, don't recreate: `transactions`, `wallet_apply_delta`, `getAvailableStripeBalanceCents`, `writeAuditLog`, `resolveAudience`)
- **`reward_credits`** (grants — source of truth + per-grant expiry): `id`, `user_id` FK, `kind` (signup/car_registration/custom), `campaign_id`/`distribution_id` (nullable), `original_cents`, `remaining_cents`, `status` (active/spent/claimed/expired/clawed_back), `expires_at`, `granted_by` (admin id, null for auto), `source_description`, `created_at`, `updated_at`. Idempotency key for grants. Indexes on (user_id,status), partial (expires_at) where active.
- **`reward_credit_events`** (append-only audit): `id`, `credit_id` FK, `user_id`, `event_type` (grant/spend/claim_convert/expire/clawback), `amount_cents`, `ride_id` (nullable), `meta` jsonb, `created_at`.
- **`reward_credit_types`** (admin config): `id`, `key`, `display_name`, `default_amount_cents`, `default_expiry_days`, `applies_to` (rider/driver/both), `auto_grant_event` (nullable: signup/car_registration), `active`. Seed signup + car_registration.
- **`reward_policy`** (singleton config, admin-editable): `require_bank` (default true), `min_earnings_cents` (default 2000), `min_rides_completed` (default 0/off), `min_single_ride_cents` (default 0/off), `combinator`. Surfaced to client.
- **`reward_distributions`** (track bulk grants): `id`, `type_id`, `audience` jsonb, `amount_cents`, `expiry_days`, `recipient_count`, `total_cents`, `stripe_balance_at_send`, `created_by`, `created_at`.
- **`users.reward_credit_balance`** INT NOT NULL DEFAULT 0 (cached sum of active remaining, for fast display).
- **New `transactions` type:** `reward_claim` (positive `wallet_balance` delta when credits convert to cash — shows in withdrawable history).
- **RLS:** users see only their own reward rows. Admin reads via service role.

#### RPCs / atomicity (mirror `wallet_apply_delta` safety: single-transaction, guarded, idempotent)
- `reward_grant(user, type, amount, expiry, dist_id, idempotency_key)` — atomic grant; idempotent (no double signup bonus).
- `reward_credit_apply(credit_id, delta, event_type, …)` — atomic remaining update + event insert + cached-balance update + status transition + no-negative guard.
- `reward_claim_to_wallet(user)` — **the only credit→cash path.** Re-checks eligibility server-side, locks rows, drains claimable credits (earliest-expiry first), `status=claimed`, inserts `wallet_apply_delta('reward_claim', +sum)`, logs events — all in one transaction.
- `reward_spend_for_ride(user, ride_id, amount)` — at ride-end, spend credits earliest-expiry-first toward fare; logs spend events.

#### Server endpoints
**User-facing**
- `GET /api/wallet/rewards` — `reward_credit_balance`, active grants (amount/kind/expiry), the resolved **policy + user progress** (lifetime earnings, rides given, claimable amount, eligible bool). Drives the dynamic UX.
- `POST /api/wallet/rewards/claim` — driver convert eligible credits → wallet (server re-verifies; atomic).
- **Ride-end waterfall:** extend `chargeRideViaWallet`/`rides/end` to spend rider credits FIRST.
- **Auto-grant hooks:** signup-complete + car-registration-approved → idempotent `reward_grant`.

**Admin** (web — ⚠️ parallel-admin-session lane, coordinate)
- `GET/POST/PATCH /api/admin/rewards/types` — credit-type CRUD.
- `GET/PUT /api/admin/rewards/policy` — global eligibility policy.
- `POST /api/admin/rewards/distribute` — audience-targeted bulk grant (reuse `resolveAudience`; preview + confirm-count + Stripe-balance warn + audit).
- `POST /api/admin/users/:id/rewards/grant` + clawback — per-user grant/revoke.
- `GET /api/admin/rewards/monitor` — Stripe balance (available+pending) vs total outstanding credits vs **total eligible-to-withdraw + eligible-user count + warning flag**.
- `GET /api/admin/users/:id/rewards` — per-user credits + rides given + eligibility status.

**Cron:** `expireRewardCredits` sweep in `runAllSweeps` (daily) — atomically expire past-due active grants.

#### Wallet UX (combine vs separate — the answer)
**One wallet, visually separated.** The withdrawable hero number stays **real money only**. A distinct **Rewards** card sits below it (iOS: between bank prompt and recent activity; web: between action buttons and pending earnings):
- **Driver:** reward balance + grant list with expiry + an **eligibility progress bar against the LIVE admin threshold** + a **"Claim $X"** button when eligible. Claimed credits then appear as `reward_claim` in withdrawable history.
- **Rider:** reward balance + expiry + "credits auto-apply to your next rides." Ride summary/payment shows a "−$5 Tago credit" line.
- Credits are **never blended** into the withdrawable figure.

#### Platform scope + ordering
Server-first: **Block A (server/DB) → Block B (admin web) → Block C (iOS) → Block D (web parity).** ⚠️ Block B touches `src/components/admin/` + `server/routes/admin/` (parallel admin session's lane) — sequence with that session before building.

#### Security checklist (reviewer enforces every slice)
Separate bucket (withdraw path untouched) · all movements atomic + guarded + idempotent · append-only events · eligibility verified server-side at claim (lifetime-earnings basis, top-ups excluded) · row locks on claim/spend (no double-claim races) · admin actions audited · distribution Stripe-balance warning · no-negative + atomic expiry · RLS on reward tables · clawback path for fraud · cents only.

#### Slices

**Block A — Backend foundation (server + DB)**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: reward_credits + reward_credit_events + reward_credit_types (seed signup/car) + reward_policy (seed bank+$20) + reward_distributions + users.reward_credit_balance + `reward_claim` tx type + RLS + indexes | ⬜ |
| A.2 | RPCs: reward_grant (idempotent) · reward_credit_apply · reward_claim_to_wallet · reward_spend_for_ride + guards + tests | ⬜ |
| A.3 | `GET /api/wallet/rewards` (balance + grants + policy + progress) + `POST /claim` + tests | ⬜ |
| A.4 | Ride-end waterfall: spend rider credits first (credits→wallet→card) in chargeRideViaWallet/rides/end + tests (delicate money path) | ⬜ |
| A.5 | Auto-grant hooks: signup-complete + car-registration-approved idempotent grants + tests | ⬜ |
| A.6 | `expireRewardCredits` daily sweep in runAllSweeps + tests | ⬜ |

**Block B — Admin panel (web)** ⚠️ coordinate with parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Credit-types CRUD endpoint + admin UI | ⬜ |
| B.2 | Global eligibility policy editor endpoint + admin UI | ⬜ |
| B.3 | Distribute composer (audience preview + confirm-count + Stripe-balance warn + audit) endpoint + UI | ⬜ |
| B.4 | Per-user grant/clawback + per-user rewards view on UserDetailPage | ⬜ |
| B.5 | Monitor dashboard (Stripe balance vs eligible-to-withdraw + eligible-user count + warning) | ⬜ |

**Block C — iOS wallet UI**
| # | Slice | Status |
|---|---|---|
| C.1 | Rewards models + GET rewards endpoint client | ⬜ |
| C.2 | Rewards section on WalletHubPage (balance + grants + expiry) | ⬜ |
| C.3 | Driver eligibility progress (live admin threshold) + Claim flow | ⬜ |
| C.4 | Rider credit-applied surfacing (ride summary / payment) | ⬜ |

**Block D — Web wallet UI (parity)**
| # | Slice | Status |
|---|---|---|
| D.1 | Rewards section on WalletPage + claim flow + progress (live threshold) | ⬜ |
| D.2 | Rider credit-applied surfacing | ⬜ |

#### Open follow-ups to confirm before coding this feature
- Default seed amounts for signup + car-registration bonuses (e.g. $5 / $10?) — and which user type each applies to.
- Edge case: ride cancelled/refunded after credits were spent — restore spent credits vs forfeit (lean: restore the grant if not expired).
- Whether riders need a claim concept at all (assumed no — auto-apply only).
- Exact admin-session sequencing for Block B.

---

### 5.3 — Refer a friend

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion + web research on referral best practices).

**What it is:** A code-based, two-sided referral program. Every user has a shareable referral code. A new friend types it at signup; once that friend completes their **first trip**, **both** the referrer and the friend earn a $5 credit. The full funnel (referred → signed up → rode → rewarded) is tracked and visible in admin. The $5 rewards are Feature-2 reward credits, so **Feature 2 must ship first.**

**Grounded in research:** reward-after-qualifying-action is the top fraud guard (rewarding on signup alone attracts abuse); store-credit (our restricted credit) is more fraud-resistant than cash; code-based attribution is the simple no-SDK path (true iOS install-attribution needs a paid SDK like Branch/AppsFlyer — explicitly out of scope). See Sources in the session.

#### Locked decisions
| Decision | Choice |
|---|---|
| Sided | **Two-sided** — referrer **$5** + friend **$5** referral credit (both amounts admin-editable). |
| Reward timing | **Both referral credits grant on ONE event: the friend's first completed trip.** The friend's upfront incentive is their normal **$5 signup bonus** (Feature 2), which can discount that first ride. |
| Qualifying trip | Friend's **first completed ride, any role** (rider or driver). |
| Attribution | **Code only** — unique per-user code typed at signup → stored as `referred_by`. Shareable as text (ShareLink). **No deep links, no universal-link routing, no paid SDK.** |
| Credit rules | Referral credits are Feature-2 `reward_credits` of kind `referral` → **follow the same rules once granted** (rider spends on rides; driver withdraws per the global bank + $20-earned policy). Amount + expiry admin-configurable. |
| Cap | **Uncapped by default, admin-configurable** (per-user/month limit settable later). |
| Fraud guards | New-`.edu`-only (already enforced) · self-referral block (own code / email match / best-effort device push-token overlap) · **one referral reward per referred user** (idempotent) · 1-trip gate · admin funnel view to spot "many signups, few rides." |
| Money | $5 amounts in cents; grants atomic + idempotent via Feature-2 `reward_grant`. |

#### Data model (new migrations — after Features 1 & 2; verify number with `ls supabase/migrations/ | tail`)
- **`users.referral_code`** TEXT UNIQUE (auto-generated, e.g. 6-char base32; backfill existing users) + **`users.referred_by`** UUID FK→users (nullable) + **`users.referred_by_code`** TEXT (raw code entered, audit).
- **`referrals`** table (funnel tracker): `id`, `referrer_id` FK, `referred_id` FK (nullable until signup resolves), `referred_by_code`, `status` (signed_up/qualified/rewarded/void), `signed_up_at`, `first_ride_id` (nullable), `qualified_at`, `rewarded_at`, `referrer_credit_id` + `referred_credit_id` (nullable FK→reward_credits), `created_at`, `updated_at`. **UNIQUE(referred_id)** — one referral per referred user. Index on referrer_id.
- **Referral credit type:** a Feature-2 `reward_credit_types` row `kind='referral'` (default $5, default expiry, applies_to both). Amounts + cap + expiry editable in admin.
- **Referral config:** per-user/month cap (nullable=uncapped) + referrer/friend amounts — stored alongside the reward config.

#### Server
- **Code generation** on user creation + a one-time backfill for existing users.
- **`GET /api/referrals/validate?code=`** — inline signup validation (exists, not self, referrer in good standing).
- **Signup capture** — extend user-row creation (`POST /api/users/me/profile`) to accept a referral code → set `referred_by` + create `referrals` row (status `signed_up`) with self/fraud checks.
- **Qualifying hook** — at `/rides/end` first-completed-ride for that user: if they were referred and the referral isn't rewarded yet → atomically grant referrer $5 + friend $5 via `reward_grant` (kind `referral`, idempotent, cap-aware), flip `referrals` → `rewarded`.
- **`GET /api/referrals/me`** — my code + stats (invited / signed-up / rode / $ earned) for the Refer-a-friend screen.
- **Admin:** `GET /api/admin/referrals` (funnel list + filters + abuse flags), `GET /api/admin/users/:id/referrals`, referral config editor (amounts/cap/expiry).

#### UX (iOS + web)
- **Refer-a-friend screen** (entry from Wallet → Rewards section + Profile): your code, a **Share** button (ShareLink text: "Join Tago with code XYZ — get $5"), and your stats (X invited · Y rode · $Z earned).
- **Signup:** optional **"Have a referral code?"** field with inline validation (web + iOS).
- **Wallet/Rewards:** referral credits show in the rewards list (kind `referral`) with expiry — already handled by Feature 2's rendering.
- **Admin:** Referrals dashboard — exactly the "which user referred which user, did they sign up, did they ride, were they rewarded" view, plus abuse flags.

#### Platform scope + ordering
**Depends on Feature 2** (referral rewards are reward credits). Server-first: **Block A (server/DB) → Block B (admin web) → Block C (iOS) → Block D (web parity).** ⚠️ Block B is the parallel-admin-session lane — coordinate.

#### Slices

**Block A — Backend**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: users.referral_code (unique+backfill) + referred_by + referrals table + referral credit type + referral config (amounts/cap/expiry) + RLS | ⬜ |
| A.2 | Code generation (signup + backfill) + GET /referrals/validate + signup capture (set referred_by, create referrals row, self/fraud checks) + tests | ⬜ |
| A.3 | Qualifying hook at /rides/end (first completed ride → grant both referral credits via reward_grant, idempotent + cap-aware, flip referrals→rewarded) + tests | ⬜ |
| A.4 | GET /api/referrals/me (code + funnel stats) + tests | ⬜ |

**Block B — Admin (web)** ⚠️ coordinate w/ parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Referrals dashboard endpoint + UI (funnel: referrer→referred, signed up/rode/rewarded, abuse flags) | ⬜ |
| B.2 | Per-user referrals on UserDetailPage + referral config editor (amounts/cap/expiry) | ⬜ |

**Block C — iOS**
| # | Slice | Status |
|---|---|---|
| C.1 | Refer-a-friend screen (code + ShareLink + stats) + entry points (Wallet/Rewards + Profile) | ⬜ |
| C.2 | Signup "Have a referral code?" field + inline validation | ⬜ |

**Block D — Web parity**
| # | Slice | Status |
|---|---|---|
| D.1 | Refer-a-friend page (code + share + stats) + entry points | ⬜ |
| D.2 | Signup referral code field + validation | ⬜ |

#### Open follow-ups to confirm before coding this feature
- Default referral credit expiry (assume same as a generic custom credit, e.g. 3mo — confirm at build).
- Edge case: friend's first ride later refunded/cancelled — claw back the referral rewards or leave (lean: claw back if the ride is voided before settle).
- Referral-code format/length (assume 6-char unambiguous base32).

---

### 5.4 — Fare Acknowledgment (post-success confirmation)

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion).

**What it is:** After a rider posts a request OR a driver posts a route on the ride board, **always** show a confirmation popup: "Your ride/request is on the board" + the **estimated fare (rider) / estimated earnings range (driver)** + a folded-in fare-explanation, with two CTAs — **Go to My Rides** and **Go to Ride Board**. Today iOS shows a *first-time-only* educator with no CTAs and then silently auto-navigates; web shows a confirmation screen with the wrong CTAs ("Done → home") and no fare. This unifies both platforms to one always-on, fare-showing confirmation.

**Client-only:** no migrations, no server routes. The fare estimate is already computed client-side; the CTAs are navigation. Lower-risk than F1–F3.

#### Locked decisions
| Decision | Choice |
|---|---|
| When shown | **Every successful post**, both rider request + driver route-post (not first-time-only). |
| iOS educator | **Folded in** — the new always-on confirmation absorbs the first-time `FareEducatorSheet` content; the first-time-only gate for this surface is removed. |
| Content | Headline + **estimated fare (rider)** / **estimated earnings range (driver, newly computed)** + condensed fare-education (reuse `FareEducatorContent`, expandable to full). |
| CTAs | **Go to My Rides** (Rides tab / `/rides`) + **Go to Ride Board** (browse list of all posts — iOS board list; web `/rides/board/browse`). |
| Driver number | **Show estimated earnings range** — compute client-side from distance (haversine × 1.3 → `Fare.range`), same math as the rider estimate. Driver keeps 100%, so earnings ≈ fare range. |
| Scope | **Posting/requesting only** — the offer-on-existing-post / book-a-post flow keeps its existing "Offer sent" toast. |
| Entry points | All entry points already funnel through ONE submit path per platform (iOS `SchedulePostViewModel.submit()` → `handlePostSuccess()`; web `SchedulePage.handleSubmitSchedule()` success) — wire the confirmation there so every entry point gets it. |
| Platforms | iOS + Web, converged to the same behavior. |

#### Implementation notes
- **iOS:** `SchedulePostPage.handlePostSuccess()` currently gates on `FareEducatorTracker.hasSeen` then calls `onPosted()` (silent nav). Change to: always present the confirmation (fold `FareEducatorContent` + add fare/earnings + 2 CTAs); navigation now happens via the chosen CTA (My Rides = `routeToRidesTab()`; Ride Board = push board list). Driver earnings range = new computed value mirroring `estimatedMaxFareCents` (`Fare.range`). Covers driver one-time / rider one-time / driver routine surfaces.
- **Web:** evolve the existing `SchedulePage` confirmation screen (lines ~832–865) — add the estimated fare/earnings + education, change the two buttons to "Go to My Rides" (`navigate('/rides')`) + "Go to Ride Board" (`navigate('/rides/board/browse')`). It already renders on every successful post.

#### Slices
**Block A — iOS**
| # | Slice | Status |
|---|---|---|
| A.1 | FareAcknowledgment confirmation view (headline + fare/earnings + folded education + 2 CTAs) + driver earnings-range computation | ⬜ |
| A.2 | Wire into `handlePostSuccess()` across all entry points; remove first-time educator gate; CTA routing (My Rides tab / push board list) + tests (XCTest + UI test happy/sad) | ⬜ |

**Block B — Web**
| # | Slice | Status |
|---|---|---|
| B.1 | Evolve SchedulePage confirmation: add estimated fare/earnings + education; change CTAs to My Rides (`/rides`) + Ride Board (`/rides/board/browse`); shown every post + tests | ⬜ |

#### Addendum — fare on the ride-board DETAIL (added 2026-06-05, Tarun)

Tapping a board card opens `RideBoardDetailSheet` (route, date, seats, note) but shows **no fare**. Add fare visibility + add-on transparency + a tappable caregiver/companion profile. **Rider-post vs driver-post differ** (the CTO design point Tarun asked me to think through):

| | Rider's post (a request) | Driver's post (an offer) |
|---|---|---|
| Viewer acts as | Driver → "Offer to Drive" | Rider → "Request This Ride" |
| Fare label | **Estimated earnings** | **Estimated fare** |
| Add-on | **Yes** — the request CARRIES the rider's caregiver/companion → show "+$X caregiver/companion" folded into the total + a **tappable profile** | **None** — the post has no caregiver/companion; the requesting rider adds theirs later at confirm time |

- **Base fare:** client-side via `Fare.scheduleEstimateRange` (coords already on `ScheduledRide`) — reuse A.1.
- **Caregiver data:** on the poster's `ride_schedules` row (`caregiver_id`/`caregiver_fare_cents`, mig 091) but NOT returned by the board endpoint, and `caregivers` is RLS-user-scoped → **server must join + return** `caregiver_fare_cents` + a caregiver profile block for rider posts.
- **Privacy (RESOLVED 2026-06-05, Tarun):** pre-accept (browsing the board) the profile shows **name + relationship + photo, NO phone**. The **phone appears only after accepting/offering** the ride (the existing post-accept paths — `/api/rides/active` etc. — already return phone). Mirrors F18.5.
- **Companion:** deferred (F1 not built) — reuse the same add-on + profile pattern via the hook when F1 lands.
- Reuse the `FareAddOn` pattern + role-based label from A.1/A.2.

**New slices (iOS sprint — server in scope per §2.15, web deferred):**
| # | Slice | Status |
|---|---|---|
| A.3 | **Server:** `/api/schedule/board` returns, for rider posts, a `caregiver { name, relationship, avatar_url }` block (**NO phone**); `caregiver_fare_cents` already rode along via `...s`. Server typecheck clean. | ✅ gates green (2026-06-05) — awaiting Tarun verify. (by-id deferred to F7.) |
| A.4 | **iOS:** `ScheduledRide` decodes `caregiverFareCents` + `caregiver`; `RideBoardDetailSheet+Fare.swift` adds an estimated **fare/earnings** section (role-based, all posts) + caregiver add-on line in the total + a **tappable caregiver profile** sheet (name/relationship/photo, no phone). Reuses `Fare.scheduleEstimateRange`. Companion hook noted. | ✅ gates green (2026-06-05) — sim+device build, installed both, lint-clean (new files); awaiting Tarun verify |

#### Open follow-ups to confirm before coding this feature
- ~~Caregiver/companion profile visibility on the public board~~ → RESOLVED 2026-06-05: pre-accept = name + relationship + photo, NO phone; phone only post-accept.
- How much education to show every time vs behind an expander (assume: fare/earnings + CTAs always prominent; full education collapsed/expandable after first view).
- Routine posts (driver weekly routine) — confirm same confirmation applies (assume yes, with routine-appropriate copy).

---

### 5.5 — Remote popups (App Gate + Announcements)

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion).

**What it is:** Two server-controlled popup systems, both managed in admin. **System A — App Gate:** blocking, non-dismissible covers for **force-update** (iOS) and **maintenance mode** (both platforms), driven by remote config and evaluated on launch/foreground/periodically. **System B — Announcements:** dismissible, admin-composed marketing/event popups shown on app open, audience-targeted + scheduled + frequency-capped, with a CTA. No system like this exists today (verified). Also unlocks: feature kill-switch (future extension of A), rating prompts, "what's new" spotlight, targeted nudges (all just System B content).

#### Locked decisions
| Decision | Choice |
|---|---|
| Architecture | **Two systems** — A (blocking gate, config) + B (dismissible announcements, content). |
| Update modes | **Required + Optional per release** — a `min_required_version` (hard block, must update) AND a `recommended_version` (soft, dismissible nudge). Maintenance lives in the same gate. |
| Announcements | **Targeted** (reuse campaign audience) + **scheduled** (start/end) + **frequency-capped** (once / per-session / daily / until-dismissed) + view/click tracking. |
| Platforms | **Force-update iOS-only** (web auto-updates via Vercel). **Maintenance + announcements on both** iOS + web. |
| Admin bypass | Admins bypass the gate (so maintenance/force-update can be tested while live). |
| Check cadence | Gate checked on launch + foreground + periodic poll while open (so maintenance can kick in mid-session). |
| CTA actions | Announcement CTA = in-app route (e.g. post-a-trip, ride board, a screen) · external URL · or none (dismiss-only). |
| Admin lane | Both admin UIs live in `src/components/admin/` + `server/routes/admin/` (⚠️ parallel admin session — coordinate). Reuse `resolveAudience` + `writeAuditLog`. |

#### Data model (new migrations — verify number with `ls supabase/migrations/ | tail`)
**System A:**
- **`app_gate_config`** (singleton): `min_required_version_ios`, `recommended_version_ios`, `maintenance_ios` (bool), `maintenance_web` (bool), `maintenance_title`, `maintenance_message`, `maintenance_eta` (nullable), `update_title`, `update_message`, `recommended_update_message`, `store_url` (default App Store id `6763382426`), `updated_by`, `updated_at`. Admin-only writes (RLS / service role).

**System B:**
- **`announcements`**: `id`, `title`, `body`, `image_url`, `cta_label`, `cta_action_type` (none/route/url), `cta_value`, `audience` (jsonb — reuse `Audience`), `platform` (ios/web/both), `starts_at`, `ends_at`, `frequency` (once/session/daily/until_dismissed), `priority`, `dismissible` (default true), `active`, `created_by`, `created_at`.
- **`announcement_views`**: `id`, `announcement_id` FK, `user_id`, `first_seen_at`, `last_seen_at`, `seen_count`, `dismissed_at`, `cta_clicked_at`. UNIQUE(announcement_id, user_id) — powers frequency caps + analytics.

#### Server endpoints
- **`GET /api/app/gate?platform=&version=`** — semver-compare version vs min/recommended + maintenance flags; admin bypass → returns `{ status: ok|force_update|maintenance, mode?: required|recommended, title, message, eta?, store_url? }`. (Web only checks maintenance.)
- **`GET /api/app/announcements?platform=`** — resolve active + in-schedule + audience-match + frequency-not-exhausted → top-priority announcement(s).
- **`POST /api/app/announcements/:id/{seen|dismissed|clicked}`** — record for frequency + analytics.
- **Admin:** `GET/PUT /api/admin/app-gate` (gate config); `GET/POST/PATCH/DELETE /api/admin/announcements` (+ audience preview reuse + `GET /:id/stats`). All audited.

#### Client behavior
- **iOS gate:** inject a check in `RootView` (launch task) + on scenePhase `.active` + periodic timer. `force_update` → blocking full-screen cover + "Update" → App Store. `maintenance` → blocking "We'll be right back" + Retry (re-checks). `recommended` → dismissible "Update available" sheet (once per version). APIClient sends app version.
- **Web gate:** in `AuthGuard`, before rendering `<Outlet/>`, check maintenance on load + periodic re-check → blocking maintenance cover. (No force-update on web.)
- **Announcements (both):** on open + foreground fetch announcements; show top one as a modal (title/body/image/CTA + dismiss) — iOS can extend `AdminBroadcastBannerPresenter` or use a richer modal; web mounts alongside `ForegroundPushToast` in AuthGuard. Fire seen/dismissed/clicked; CTA routes per action type.

#### Platform scope + ordering
Server-first per system. ⚠️ Admin slices (A.3, B.3) are the parallel-admin-session lane — coordinate.

#### Slices

**System A — App Gate**
| # | Slice | Status |
|---|---|---|
| A.1 | Migration: `app_gate_config` singleton (+seed, store_url default) + admin-only RLS | ⬜ |
| A.2 | `GET /api/app/gate` (semver compare, maintenance, admin bypass) + tests | ⬜ |
| A.3 | Admin gate endpoints (GET/PUT) + admin UI (toggle maintenance, set versions, edit copy) + audit ⚠️ admin lane | ⬜ |
| A.4 | iOS gate: launch + foreground + periodic check; force-update (App Store) + maintenance (retry) covers + recommended-update nudge | ⬜ |
| A.5 | Web maintenance gate in AuthGuard (blocking cover + periodic re-check) | ⬜ |

**System B — Announcements**
| # | Slice | Status |
|---|---|---|
| B.1 | Migration: `announcements` + `announcement_views` + RLS + indexes | ⬜ |
| B.2 | `GET /api/app/announcements` (audience+schedule+frequency resolve) + seen/dismissed/clicked endpoints + tests | ⬜ |
| B.3 | Admin announcements CRUD + audience preview + stats endpoint + compose UI + audit ⚠️ admin lane | ⬜ |
| B.4 | iOS announcement modal (title/body/image/CTA + dismiss) on open/foreground + tracking + CTA routing | ⬜ |
| B.5 | Web announcement modal in AuthGuard on open + tracking + CTA routing | ⬜ |

#### Open follow-ups to confirm before coding this feature
- Periodic gate-poll interval (assume ~5 min while foregrounded).
- Whether the soft "recommended update" nudge repeats per session or once per version (assume once per version).
- Announcement CTA route catalogue (which in-app destinations are linkable) — define when building B.4/B.5.

---

### 5.6 — Explore (the headline feature)

**Finalized:** 2026-06-04 (decided with Tarun via AskUserQuestion, 3 rounds incl. name + placement).

**Name:** User-facing **"Explore"** with two sub-tabs — **Events** (famous California concerts/events, fixed-date) and **Places** (famous spots students explore: Yosemite, Tahoe, SF, LA — evergreen). (Was working-titled "Events & Trips"; renamed to avoid the `trips` collision and to read as a discovery section.) Internal DB entity stays `destinations`.

**What it is:** A discovery + group-travel-matching section. Students find travel partners to go together (and come back together). Destinations are admin-curated, seeded from user requests. Riders join a waitlist; drivers say "I'm going"; they connect both directions; a driver registering also posts to the ride board.

#### ✅ HOW IT WORKS — canonical functional spec (confirmed with Tarun 2026-06-06)

> This subsection is the single source of truth for F6 behaviour. The schema + slice tables below remain valid; where older prose disagrees, this wins.

**Two kinds of destination**
- **Event** — has a real-world `event_date` (required). The date is a strong default but **outbound is NOT locked** — a rider/driver may go early or leave before.
- **Place** — evergreen, no date. Every trip's dates are chosen by whoever creates it.

**5 building blocks:** (1) **Destination** = the card; (2) **Driver Trip** = a driver's concrete "I'm driving" with out/back dates + open seats — **the joinable unit**; (3) **Interest/waitlist** = a rider's "I want to go" demand signal (not a booking); (4) **Offer** = the handshake connecting a rider to a driver trip (either side initiates); (5) **Trip Thread** = a persistent group chat per driver trip spanning BOTH legs.

**Rider journey:** open destination → see driver trips (+ who's going) → either **"Join this trip"** (party = self + ≤2 companions = seats needed) when one fits, OR **"I want to go"** (waitlist demand signal) when none fits → driver accepts → outbound (+return) ride created, seats held, **Trip Thread opens** → ride out (pickup→QR→drive→QR→pay) → coordinate return in the Trip Thread → ride back.

**Driver journey:** open destination → **"I'm driving"** → set out/back dates+times + seats (default to event_date for events) → trip posts under the destination **AND cross-posts to the ride board** → see interest → **accept join-requests** and/or **offer seats** to waitlisted riders → each accept creates the rides + adds rider to the Trip Thread → drive out → **launch the return from the Trip Thread** when the group's ready.

**The connection (two-way):** rider "Join this trip" OR driver "Offer a seat" → `destination_offer` (pending) → other side accepts → **outbound ride (+ return ride), SAME driver**, seats held, interest→matched, Trip Thread opens → per-leg normal ride flow.

**Trip Thread (the "coming back" hub):** one group chat per driver trip (driver + joined riders; companions on roster). Opens on first join → lives across both legs → archives after the return completes. Tools: pinned trip card + roster/seats, **return coordinator** (driver proposes return time + meet spot, riders confirm), per-person ready status (going/arrived/ready-to-return), temporary live location near departure. **Return launch:** driver taps "Start return" → the pre-created return ride goes active → leg-2 flow. Handles stay-longer / leave-early / overnight.

**Money:** standard distance fare **per leg** (existing engine) + companion fees per leg (F1); round trip = two rides each settled at its own QR-end; platform fee 0%.

**Cancellation / no-show (confirmed):**
- **Driver cancels a trip with matched riders** → cancel both legs + refund holds + push all riders ("your driver cancelled") + **auto re-open them to the destination's interest list** so another driver can pick them up (mirrors the instant-ride "finding a new driver" feel).
- **Rider backs out after matching (pre-outbound)** → free their seat(s) back to the driver's open count, **notify the driver**, rider leaves the Trip Thread.

**Chat reuse:** before building the Trip Thread, audit `DriverGroupChatPage`/`DriverGroupChatViewModel` (F17 multi-rider) end-to-end; extend if it fits, else build fresh — report the call before coding.

**Build order:** A.4+C.4 (driver posts trip + board cross-post) → A.6+C.5 (join/offer → accept → 2 rides + open Trip Thread) → Trip Thread chat → return-leg execution → A.3+C.6 (request new destination + auto-promote at 5).

**Placement (decided):** **A dedicated bottom tab "Explore"**, freed by **folding Payment/Wallet into Profile → renamed "Account"**. New tab bar (both platforms): **Home · Drive · Rides · Explore · Account**. Wallet/Payment becomes a row under Account **with a credits badge** so the V4 wallet rewards (F2) stay discoverable. Secondary surfaces: a chip on the **Ride Board**, plus **Announcement (F5)** + **push** deep-links straight into a destination.
> ⚠️ **Cross-feature interaction:** this moves the Wallet under "Account", so Feature 2's Rewards section + Feature 3's referral entry now live under Account, and the credits badge surfaces new rewards. The F2/F3 wallet-UI slices must target the Account location. Both tab bars change: iOS `SignedInTabs` (Tab enum currently home/drive/rides/payment/profile) + web `src/components/ui/BottomNav.tsx` (5-tab).

#### ⚠️ Naming collision — resolved
- `trips` table already = the **multi-rider cost-settlement** container (mig 097). `marketing_events` already = the admin **marketing calendar**. So: **UI label stays "Events & Trips"; the internal entity is `destinations`** (kind `event`|`place`). New tables are prefixed `destination_*`. Do NOT name anything `trips`/`events` at the DB layer.

#### Dependencies
- **Requires Feature 1 (Companion)** — group size on the waitlist = rider + companions (Tarun confirmed). Build order: F1 → this.
- Reuses ride-board infra (`ride_schedules` posts, `ride_offers`/offer→`rides` conversion, `notifyMatchedDrivers`), Supabase Storage (images), admin curation + audit.

#### Locked decisions
| Decision | Choice |
|---|---|
| UI vs internal name | UI **"Explore"** · internal `destinations` (kind event/place). |
| Placement | **Dedicated bottom tab "Explore"**, freed by folding **Payment → Account** (renamed Profile). Bar: Home · Drive · Rides · Explore · Account. Wallet under Account + credits badge. |
| Sub-tabs | **Events** = fixed `event_date`; **Places** = evergreen, each user picks their own go-date. |
| Trip direction | **Round-trip in v1** (there + back), **same driver for both legs** (booked as a pair). |
| Travel modes | Capture 3 (together / own-thing-return-together / one-way); **mechanic = round-trip vs one-way**; "together vs own thing" is an **informational tag** shown to the driver. |
| Matching | **Two-way** — drivers browse the waitlist + offer seats AND riders request a driver who's going (within the tab + via the driver's auto-created board post). |
| Request → feature | User "Request a place/event" → demand aggregates → **auto-publish at 5 requests** (admin-editable threshold + can merge near-duplicates + manual promote/archive). |
| Group size | **Reuse Feature 1 Companions** — seats needed = rider + up to 2 companions; companion profiles carry through to the driver. |
| Driver registers | Driver "I'm going" → creates a `destination_driver_plan` AND **auto-creates a `ride_schedules` board post** (roundtrip). |
| Fare | Standard distance fare **per leg** (reuse); companion fees apply (F1); round-trip = two `rides`, each settled at end. |

#### Data model (new migrations — after F1; verify number with `ls supabase/migrations/ | tail`)
- **`featured_destinations`**: id, `kind` (event/place), name, slug, description, image_url, location geography(Point), city/region, `event_date` + `event_end_date` (nullable; events), status (active/coming_soon/archived), source (admin/auto_promoted), sort_priority, created_by, timestamps.
- **`destination_requests`**: id, user_id, kind, requested_name, normalized_name (dedup/demand counting), note, target_date (nullable), created_at. Demand aggregated by normalized_name; **≥5 distinct users → auto-create a `featured_destinations` row** (trigger or sweep). Anti-spam: one request per (user, normalized_name).
- **`destination_driver_plans`**: id, destination_id FK, driver_id FK, departure_date, departure_time, is_round_trip, return_date/return_time (nullable), seats_total, seats_filled, note, status (open/full/cancelled/completed), `outbound_schedule_id` + `return_schedule_id` FK→ride_schedules (auto-created posts), created_at.
- **`destination_waitlist`**: id, destination_id FK, rider_id FK, desired_date, desired_time, wants_return, return_date/return_time (nullable), travel_mode (together/own_thing/one_way), group_size, companion_a_id/companion_b_id FK→companions (reuse F1), note, status (waiting/offered/matched/cancelled), created_at.
- **`destination_offers`** (the unified connection): id, destination_id FK, driver_plan_id FK, waitlist_id FK, driver_id, rider_id, `initiated_by` (driver/rider), proposed terms (per leg), status (pending/accepted/declined/released), `outbound_ride_id` + `return_ride_id` FK→rides (nullable until accept), created_at. **On accept → create outbound (+ return) `rides` rows (same driver), reuse the existing conversion, decrement seats, mark waitlist `matched`, release siblings, seed chat.**
- RLS on all; indexes on destination_id, driver_id, rider_id, status.

#### Server endpoints
- `GET /api/destinations?kind=` (list active + counts) · `GET /api/destinations/:id` (detail + plans + waitlist).
- `POST /api/destinations/request` (submit; aggregate demand; auto-promote at 5).
- `POST /api/destinations/:id/driver-plan` (create plan + auto-create ride_schedules board post(s) + notify waitlist).
- `POST /api/destinations/:id/waitlist` (join; date/time/return/mode/group+companions + notify drivers going).
- `GET /api/destinations/:id/waitlist` (driver views).
- `POST /api/destinations/offers` (driver→rider offer OR rider→driver request) · `POST /api/destinations/offers/:id/{accept|decline}` (accept → create outbound+return rides, same driver, reuse conversion, seats, release siblings, chat seed).
- Admin: `GET/POST/PATCH /api/admin/destinations` (curate + image), `GET /api/admin/destination-requests` (demand review + merge + manual promote/archive), participation views. All audited.
- Cron/trigger: auto-promote at threshold; mark plans completed after return; expire stale.

#### UX (iOS + web)
- **Events & Trips** entry → two sub-tabs (Events / Trips) → destination cards (image, name, date for events, "N going · M waiting").
- **Detail:** hero image + info + "Drivers going" list + waitlist; CTAs — **Rider:** Join waitlist sheet (date/time, return toggle + return date/time, travel mode, group size + pick companions); **Driver:** "I'm going" sheet (seats, departure date/time, return date/time).
- **Driver:** waitlist browser → offer a seat to a rider. **Rider:** browse drivers going → request a seat. Accept → ride(s) created → existing chat/active-ride takes over.
- **Request a place/event** button → request sheet.
- Notifications wire waitlist ↔ drivers.

#### Platform scope + ordering
**Depends on F1.** Server-first: **Block A (server/DB) → Block B (admin curation — so there's content) → Block C (iOS) → Block D (web parity).** ⚠️ Block B is the parallel-admin-session lane — coordinate.

#### Slices

**Block A — Backend**
| # | Slice | Status |
|---|---|---|
| A.1 | Migrations: featured_destinations + destination_requests + driver_plans + waitlist + offers + RLS + indexes | ⬜ |
| A.2 | Destinations read endpoints (list by kind + detail w/ plans+waitlist) + tests | ⬜ |
| A.3 | Request endpoint + demand aggregation + auto-promote at 5 (trigger/sweep) + tests | ⬜ |
| A.4 | Driver-plan endpoint → create plan + auto-create ride_schedules board post(s) (roundtrip) + notify + tests | ⬜ |
| A.5 | Waitlist endpoint (date/time/return/mode/group+companions) + notify drivers + tests | ⬜ |
| A.6 | Offers: create (driver→rider + rider→driver) + accept → outbound+return rides (same driver, reuse conversion, seats, release siblings, chat seed) + decline + tests (most complex) | ⬜ |

**Block B — Admin (web)** ⚠️ coordinate w/ parallel admin session
| # | Slice | Status |
|---|---|---|
| B.1 | Curate featured_destinations (CRUD + image upload + dates + activate/archive) endpoint + UI | ⬜ |
| B.2 | Requests review (demand list + merge dupes + manual promote) + participation view per destination | ⬜ |

**Block C — iOS**
| # | Slice | Status |
|---|---|---|
| C.1 | **Tab-bar restructure:** fold Payment→Account (rename Profile), add **Explore** tab → Home·Drive·Rides·Explore·Account; Wallet row + credits badge under Account (`SignedInTabs`) | ⬜ |
| C.2 | Explore page: Events/Places sub-tabs + destination cards + detail (image/info/counts/lists) | ⬜ |
| C.3 | Rider Join-waitlist sheet (date/time/return/mode/group + pick companions) + waitlist state | ⬜ |
| C.4 | Driver "I'm going" sheet (seats/dates/return) → create plan + board post | ⬜ |
| C.5 | Driver waitlist browser + offer flow; rider request-a-driver flow; accept → ride(s); notifications | ⬜ |
| C.6 | Request a place/event sheet | ⬜ |

**Block D — Web parity**
| # | Slice | Status |
|---|---|---|
| D.1 | **Tab-bar restructure:** fold Payment→Account, add **Explore** tab + credits badge (`BottomNav.tsx`) | ⬜ |
| D.2 | Explore section + Events/Places sub-tabs + detail | ⬜ |
| D.3 | Rider waitlist + driver "I'm going" sheets | ⬜ |
| D.4 | Offer/request/accept flows + request-a-place | ⬜ |

#### Open follow-ups to confirm before coding this feature
- **Account-tab scope** — confirm exactly what folds under "Account" (Wallet/Payment + existing Profile rows) and where the credits badge sits.
- **Seed content** — admin seeds the initial Places (Yosemite/Tahoe/SF/LA) + any launch Events before go-live.
- **Round-trip board post** — one `direction_type='roundtrip'` post vs two linked posts (lean: one roundtrip post).
- **Return-leg settlement** — two independent `rides` each settled at end; confirm no special round-trip discount.
- **Multi-day trips** (Yosemite weekend) — return date can be a different day; confirm date pickers allow it.

### 5.6.1 — Shared multi-rider event trip + Trip Timeline (planned 2026-06-09, supersedes "Money" + return-leg-settlement rows above for event trips)

> Decided with Tarun 2026-06-09 (option 2: board-parity cost split) + refined live from his 3-account device QA the same day. This subsection is the canonical plan for how event carpools group, price, and explain themselves over time. State lives in `V4_PROGRESS.md`.

**The model:** one driver plan + leg = ONE shared `trips` row; every accepted rider's ride links to it (`getOrCreatePlanLegTrip`, mig 127), so the F17 segment engine splits gas+time per leg-aboard at each rider's own QR-end. Riders pay a SHARE (not N full fares); driver keeps 100% (reimbursement framing, not profit). Seat fees (companion/caregiver, F1) stay per-rider on top, un-split. Because both the price *and* the timeline are new concepts, **every stage must say: where are we, what happens next, and when.**

**The timeline (phases, server-computed):** `scheduled` (matched, trip day ahead — calm plan card, QR + nav hidden AND server-gated 409 TRIP_NOT_TODAY) → `day_of` (driver "starts the run", riders see "driver on the way", QR appears) → active legs (scan-in → segments) → arrived + per-rider pay (split settle) → at-event free chat → return mirror (Stage-4 composition, `return_trip_id`).

**Slices (1–4 + 5A SHIPPED 2026-06-09 — see progress doc; remaining below):**
| # | Slice | Scope |
|---|---|---|
| 5A.2 | **Surfaces tell the truth** (Rides tab + banners + chat coherence + pickup control) | (a) Fix `MyRidesFormat.date` UTC-parse day-shift bug (hard rule in memory). (b) `/api/rides/active` returns `trip_id`; Rides tab folds a driver's N event rides into ONE event-trip group card (event name + date + rider avatars, tap → multi-rider trip screen) — `MultiRiderGroup` keyed by `MultiRideKey` (.schedule \| .trip). (c) Scheduled-future rides (trip_date > today-PT) read as **Upcoming · {date}** (badge + section split "Happening now" / "Upcoming"), never "Coordinating"/"En Route". (d) Home `ActiveRideBanner`: date-aware copy for scheduled trips; driver-multi tap → trip screen; rider tap → chat (chat-first, NEVER auto-nav). Audit every entry point that can auto-present `DriverPickupPage` for a destination ride. (e) Chat chrome flash fix: gate instant-vs-event chrome on tripContext arrival (one clean render, no "transforming" swap). (f) Pickup control: TripPlanCard gains **"View pickup on map"** (both roles) + rider **"Change pickup"** (OriginPickerSheet → new `POST /api/destinations/ride/:rideID/pickup` → updates ride + waitlist, seeds chat card, dual-notifies driver); driver multi-ride rider cards gain per-rider **Navigate** (Apple Maps to pickup coords). |
| 5A.3 | **Dedicated event chat + proposal-flow pickup change** (supersedes 5A.2's (f) change-pickup approach, per Tarun's QA: reuse the counter/proposal cards; separate the chat surfaces) | New `EventTripChatPage` (+Rows/+Covers) — event trips dispatch to their OWN chat (MessagingPage = thin dispatcher once trip-context resolves; instant/board chat untouched). Pickup change = the EXISTING proposal flow: `MapPickerPage` pin-drop (real map) → `pickup_suggestion` card in chat → counterpart Accepts → accept-location hook syncs rides.origin + the waitlist row. All lifecycle covers (walk-to-pickup/QR for BOTH roles, active, summary, return) behind explicit buttons — zero auto-navigation. The 5A.2 silent `POST /ride/:id/pickup` endpoint is REMOVED. |
| 5B | **Day-of run mode** | Driver "Start the run" CTA (day-of only) on the trip screen → riders dual-notified "driver is on the way" + chat stage flips; per-stop guidance (nav → QR at stop → next stop); trip reminders (day-before + morning-of cron sweep, bell+push, both roles); one-way riders tagged "won't ride back" on the roster. |
| 5C | **Split receipts + money QA** | Post-ride: rider "your share of X mi, split across legs you rode" (reads `ride_rider_shares`); driver "reimbursed across N riders, covered gas+time". Then the scripted 2-rider end-to-end money QA on dev (real charges verified) — gate before any push. |
| 6 | **Cancellation integrity** | Driver plan-cancel with matches: cancel legs + release holds + notify + re-open riders to interest + cancel shared trip. Rider backs out: free seats, notify driver, co-riders "share went up" notify, detach from trip. Completes §5.6 Cancellation spec. |

**Standing rules for this feature:** estimates always labeled (real fare = GPS segments); preview math mirrored iOS↔server with paired tests (`fareSplit.test.ts` ↔ `FareTests`); education via `SharedFareInfoSheet` (ⓘ everywhere a fare shows, once-per-persona first-run); calendar dates never UTC-parsed for local display; QR/nav affordances are phase-gated AND server-gated; ship slices 1→6 as ONE release batch — never push the split active without its explanation surfaces.

---

### 5.6.3 — Shared RETURN-run redesign (planned 2026-06-11, Tarun device-QA + 4 design decisions)

> Driven by Tarun's drop-off device QA: after dropping both riders the unified "manage riders" card fragmented into two per-rider banners, and the return was still the old per-rider chat flow. He asked to mirror the outbound run for the return: driver-led, on the manage-riders screen, with a broadcast meetup proposal then an auto drop-off proposal. **Design decisions locked via AskUserQuestion (2026-06-11):** (1) riders can **Accept OR counter** the meetup (full proposal-card parity with outbound); (2) the run screen shows a **per-rider checklist + count** ("meetup — 1 of 2 confirmed"); (3) the return run (scan-in) unlocks only **after every drop-off is accepted too** (full plan locked first); (4) for multi-rider events the return is driven **only from the run/manage-riders screen** — the per-rider chat "Start return trip" is hidden for multi-rider (solo events keep it).

**The bug (root cause, must fix first):** `/api/rides/active` filters out `completed` rides (`rides.ts` status-in gate), so the unified group card (built from it) vanishes at drop-off. The fallback `myTrips` list (`/api/destinations/my-trips/list`) returns **one row per offer** (not consolidated by trip) and only surfaces a trip once it has no active leg — hence two "with {rider}" banners. The outbound `trip_id` is stable on the completed rides, so we consolidate on it.

**The return model (inverse of outbound):** outbound = navigate to each pickup (scan-in per stop) → drive to event (scan-out all at event). Return = **one shared meetup at the event** (scan-in all there) → navigate to each drop-off (scan-out per stop). Drop-off defaults to each rider's **outbound `rides.origin`** (exactly where they were picked up). The shared return `trips` row already exists (`getOrCreatePlanLegTrip(plan,'return')`, mig 127) so the F17 segment split still works.

**The 5-phase return run (on the run/manage-riders screen):**
1. **At the event (outbound done+paid):** run screen shows riders "Dropped at {event}" + bottom CTA **"Start the ride home."**
2. **Propose meetup:** map sheet (default pin = event location; driver can nudge) → broadcasts ONE `return_pickup_suggestion` into every return ride's chat (loop like Start-the-run's `seedChatMessage`).
3. **Watch confirmations (per-rider checklist + count):** each rider row shows Pending → Accepted (or "suggested a new spot" if countered → driver reviews/accepts the counter).
4. **Auto drop-off proposals:** when ALL meetup pickups are confirmed → server auto-broadcasts a `return_dropoff_suggestion` per rider (default = their outbound `origin`) with **Accept / Change drop-off**.
5. **Return run (gated on all drop-offs accepted):** run screen flips to the drop-off stop list (optimal order) → scan everyone in at the meetup → navigate + scan-out each at home. Reuses the outbound run chrome (DriverPickupPage QR, MKDirections ETAs, drag reorder).

**Data model / state machine:**
- Return rides are created **unconfirmed** (`status='accepted'`, `pickup_confirmed=false`, `dropoff_confirmed=false`) — NOT the old pre-confirmed `coordinating`. They flip to `coordinating` only when both the meetup pickup AND the home drop-off are accepted (reuses the existing accept-location CAS → `coordinating` transition).
- `origin` = event (shared meetup, updated if the driver's proposed spot differs); `destination` = rider's outbound `origin` (home) by default, overrideable via "Change drop-off."
- All return rides share `return_trip_id`; the run unlocks when **every** return ride on the trip is `coordinating`.

**Slices (R-series, build in order; each gated + locally committed; comprehensive whole-workflow review before handoff):**
| # | Slice | Scope |
|---|---|---|
| R0 | **Fragmentation fix** (the visible bug) | Server: add outbound `trip_id` to each `my-trips/list` row. iOS: group the DRIVER's `myTrips` rows by `trip_id` → ONE poster card ("You're driving N riders · {event} · manage your trip") under "Event trips"; tap → `DriverEventTripCover(tripID)` (run screen, which already includes `completed` rides). Riders unchanged (one offer/trip). New `onOpenEventTripRun(tripID)` callback wired through SignedInTabs → `pendingEventTrip`. |
| R1 | **"Start the ride home" + broadcast meetup proposal** (server + driver UI) | Server `POST /api/destinations/run/:tripID/start-return` (driver-gated; validates outbound done+paid for all riders; mints/gets return trip; creates unconfirmed return rides; broadcasts `return_pickup_suggestion` to each, default = event or driver-chosen meetup). Run screen: "Start the ride home" CTA (shown when outbound all-completed) → meetup map sheet → POST; then the per-rider **confirmation checklist** ("meetup — 0 of N"). |
| R2 | **Rider meetup accept/counter** (rider UI + server) | Return meetup proposal card in the rider's `EventTripChatPage` (reuse `PickupProposalCard`) with **Accept** (`POST /return/:rideID/accept-pickup` — flips `pickup_confirmed`; when all siblings confirmed, auto-broadcasts the drop-off proposals) + **Suggest another spot** (reuse `ProposePickupPoint` on the return ride → driver accepts via the existing card). Run-screen checklist reflects each state. |
| R3 | **Auto drop-off proposals + accept/change** (rider + server) | `return_dropoff_suggestion` card (default = outbound `origin`, "Home — {addr}") with **Accept** (`POST /return/:rideID/accept-dropoff` — flips `dropoff_confirmed`; both confirmed → ride `coordinating`) + **Change drop-off** (MapPickerPage → proposal). Run-screen checklist row advances "meetup ✓ · drop-off ✓". |
| R4 | **Return run (driver drive)** | When all return rides are `coordinating`: run screen flips to the **drop-off stop list** (greedy-shortest order, drag) — scan-in all at the meetup, then per-stop Navigate + scan-out at each home. Reuse outbound `DriverPickupPage`/`DriverActiveRidePage` chrome + ETAs. Hide the per-rider chat "Start return trip" for multi-rider events (decision 4). |
| R5 | **Comprehensive review + whole-workflow QA** | UI/UX reviewer pass over the ENTIRE event workflow (request → match → outbound run → drop-off → return meetup → drop-off proposal → return run → done), both roles, every empty/loading/error/counter state; 2-rider scripted money QA across both legs; parity matrix; then hand off. |

**Standing rules (additional, this redesign):** the meetup/drop-off proposals reuse the EXISTING proposal-card + `accept-location` machinery (no parallel silent paths — the reuse-proposal-flow memory rule); broadcasts loop `seedChatMessage` per return ride (riders see only their own thread; driver's merged All-tab dedups); the "all confirmed" triggers live in **destinations.ts** (my lane) via dedicated return endpoints, NOT in `rides.ts` accept-location (parallel-session lane); auto-advance only at the two server-computed gates (all-pickups → drop-off broadcast; all-drop-offs → run unlock), never client-guessed.

---

### 5.7 — Sharing (rides + Explore)

**Finalized:** 2026-06-05 (decided with Tarun via AskUserQuestion).

**What it is:** A share button on a ride-board post (and on Explore events/places) that produces a link opening that **exact** item when tapped. Anyone can view a public read-only preview without signing in; signing in is required to act. If the shared item is no longer available, the recipient sees a friendly "no longer available — browse the ride board / Explore" fallback.

#### Locked decisions
| Decision | Choice |
|---|---|
| View gate | **Public read-only preview** — anyone (logged-out / non-user) sees the details; "Sign in to request/offer" gates the action. **Sensitive fields stripped** (no exact pickup, no note, no contact). |
| Shareable scope | **Any ride-board post** (rider request OR driver offer) **+ any Explore event/place**, shareable **by any user** (not just the owner). **Private instant rides are NOT shareable.** |
| Referral tie-in | **None** — sharing is navigation only (referral attribution stays manual-code per F3). |
| Unavailable UX | Expired / filled / cancelled / deleted → "This is no longer available" + **Browse ride board** (or Explore for a destination). |
| Links | `https://www.tagorides.com/ride/:id` (board post) · `/explore/:id` (destination). Universal links: **app installed → opens in-app to that item; not installed → opens the web page.** No paid SDK. |
| Share UI | Reuse `ShareLink` (iOS — already used for emergency + ride summary) / `navigator.share` + copy-link (web). |

#### How it works (verified plumbing)
- **iOS deep-link:** extend `DeepLink.classify` (+ `DeepLink` enum + `RootView.handleIncoming` + `PendingDeepLink`) to recognize `/ride/:id` and `/explore/:id` and route to a public detail screen (renders signed-in or out; out → preview + sign-in CTA). Associated domain `applinks:www.tagorides.com` already claimed.
- **Web:** add public routes `/ride/:id` + `/explore/:id` **outside `AuthGuard`** (precedent: `/c/:slug`, `/track/:token`).
- **Data:** add a **public** `GET /api/public/schedule/:id` (no JWT, `supabaseAdmin`, stripped fields + availability status) mirroring the public-campaign endpoint — avoids touching `ride_schedules` owner-only RLS. Explore uses F6's destination read. **Likely no migration** (only add a public-SELECT RLS policy if we ever do client-direct reads; default = server endpoint only).
- **Availability:** reuse `isSchedulePast()` (server) / `isExpired()` (iOS) + filled/cancelled/deleted → one "unavailable" status the detail screen renders.

#### Dependencies
- Ride-sharing half is **independent** (ride board exists). **Explore-sharing half depends on Feature 6** (destination detail + data must exist).

#### Platform scope + ordering
Server-first: **Block A (public endpoints) → Block B (iOS) → Block C (web).** No admin work.

#### Slices
**Block A — Server**
| # | Slice | Status |
|---|---|---|
| A.1 | Public `GET /api/public/schedule/:id` + `GET /api/public/destination/:id` (supabaseAdmin, stripped fields, availability status) + tests | ⬜ |

**Block B — iOS**
| # | Slice | Status |
|---|---|---|
| B.1 | Deep-link routing: extend DeepLink/`RootView` for `/ride/:id` + `/explore/:id` → public detail screen (preview + sign-in CTA + unavailable state) | ⬜ |
| B.2 | Share buttons (ShareLink) on ride-board cards/detail + Explore destination detail | ⬜ |

**Block C — Web**
| # | Slice | Status |
|---|---|---|
| C.1 | Public routes `/ride/:id` + `/explore/:id` (public detail pages: preview + sign-in CTA + unavailable state) | ⬜ |
| C.2 | Share buttons (navigator.share / copy-link) on ride-board cards + Explore detail | ⬜ |

#### Open follow-ups to confirm before coding this feature
- Exact set of "sensitive fields" to strip from the public preview (lean: hide precise pickup coords, the free-text note, and any contact info; show route name, general area, date/time, seats, poster first name + rating).
- Whether a logged-out web preview shows a small map (general area only) or text-only.

---

> **Next features:** to be discussed. This section grows one finalized feature at a time.

---

## 6. Consolidated build plan & cross-feature review

_Written 2026-06-05 after all 7 features were specced. This is the runway: dependency graph, build order, migration sequencing, the danger zones, admin coordination, and the recommended first slice._

### 6.1 Dependency graph
```
F4 Fare Acknowledgment ───────────────── independent (client-only, no DB)
F5 Remote popups ─────────────────────── independent
     ├─ System A (App Gate) ............. release-safety infra → build EARLY
     └─ System B (Announcements) ........ pair with F6 launch (marketing)

F1 Companion ──┬──────────────────────── F6 Explore ──── F7 (Explore-share)
               │  (group size)              (headline)
               └─ shares ride-end settlement code ↓

F2 Wallet rewards ───────────────────── F3 Referral (referral $ = reward credit)

F7 Sharing: ride-share = independent · Explore-share depends on F6
```
**Hard dependencies:** F3 → F2 · F6 → F1 · F7(Explore-share) → F6.
**Soft tie-ins:** F5 Announcements can deep-link into F6 destinations · F7/F6/F5 all extend the same deep-link router (build once) · F6's tab restructure relocates the Wallet, so F2/F3 wallet UI lands under "Account."

### 6.2 ⚠️ The convergence zone — `/api/rides/end` + `chargeRideViaWallet` + settlement
**Four features modify the ride-end / payment path:**
- **F1** — fold companion fee + recompute caregiver+companion tiers from REAL distance at end-of-ride (changes existing caregiver settlement).
- **F2** — rider credit spend in the payment waterfall (credits → wallet → card); driver `reward_claim`.
- **F3** — first-completed-ride hook → grant referral credits (idempotent).
- **F6** — round-trip = two `rides`, each settled at end.

**Rule:** this code is a single owner / single sequence — **do NOT parallelize it.** Build F1 → F2 → F3 → F6 touching it in that order, with a full ride-end regression test run at each step. This is the #1 place a money bug hides.

### 6.3 Recommended build order (phased)
| Phase | Feature(s) | Why here | Slices |
|---|---|---|---|
| **0 — warm-up + safety** | **F4** (all) then **F5 System A — App Gate** | F4 is client-only/no-money → validates the slice pipeline (gates, parity matrix, progress discipline). F5 Gate gives you **maintenance + force-update BEFORE** shipping risky features — so you can pull the cord if a later release misbehaves. | 3 + 5 |
| **1 — Companion** | **F1** | Foundational; unblocks F6; first touch of the ride-end settlement zone. | 25 |
| **2 — Wallet rewards** | **F2** | Real money; unblocks F3; second touch of ride-end (credit waterfall). Highest-risk feature. | 17 |
| **3 — Referral** | **F3** | Needs F2; ride-end grant hook. | 10 |
| **4 — Explore** | **F6** | The headline; needs F1; includes the tab restructure; round-trip settlement. The long pole. | 18 |
| **5 — Sharing** | **F7** | Ride-share can land anytime; Explore-share needs F6. | 5 |
| **interleave** | **F5 System B — Announcements** | Best timed with F6 launch to market Explore/events. | (part of F5's 10) |

### 6.4 Migration sequencing (chronological by build order; current highest = 117)
**Hard rule (memory):** run `ls supabase/migrations/ | sort | tail -3` immediately before writing EACH migration and take the next free number — the parallel admin session also creates migrations, so these are indicative, not reserved:
1. F5 App Gate — `app_gate_config` (1 file)
2. F5 Announcements — `announcements` + `announcement_views` (1)
3. F1 — `companions` + `rides`/`ride_schedules` companion cols + `users.waive_companion_fee` (1–3)
4. F2 — reward tables (`reward_credits`, `_events`, `_types`, `reward_policy`, `reward_distributions`) + `users.reward_credit_balance` + `reward_claim` tx type (1–2)
5. F3 — `users.referral_code`/`referred_by` + `referrals` + referral type/config (1)
6. F6 — `featured_destinations` + `destination_*` (1–2)
7. F4 — none · F7 — none (public read via `supabaseAdmin`)

### 6.5 Build-once shared foundations
- **Deep-link router** (iOS `DeepLink.classify` + `RootView.handleIncoming`; web public routes) — extended by F5 (announcement CTA), F6 (`/explore/:id`), F7 (`/ride/:id`). Build a registry-style classifier ONCE (first landed of F6/F7) and register routes; don't make three ad-hoc edits.
- **Reward-credit machinery** (F2 RPCs `reward_grant`/`reward_credit_apply`) — the foundation F3 reuses. Make it bulletproot + idempotent first.
- **Companion settlement** (F1) — F6 round-trip reuses it.

### 6.6 Parallel-admin-session coordination (11 admin slices)
Admin-lane slices: **F2 B.1–B.5, F3 B.1–B.2, F5 A.3 + B.3, F6 B.1–B.2** — all in `src/components/admin/` + `server/routes/admin/`.
- **Before editing any admin file:** `git status` for files modified in the last hour; if the admin session is active there → **flag + wait, never patch their WIP** (memory rule).
- **Assign each admin sub-feature wholesale to ONE session** — don't split a single admin screen across sessions. The feature owner builds the server admin endpoint server-first; the admin-lane session builds the matching UI; sync via this doc.
- Don't stage their files; flag (don't fix) their lint warnings.

### 6.7 Risk register
| Risk | Level | Mitigation |
|---|---|---|
| F2 real-money correctness (RPCs, claim, credit waterfall) | 🔴 | Separate-bucket design + atomic/idempotent RPCs + **adversarial reviewer pass** on A.2/A.3/A.4 |
| Ride-end convergence (F1/F2/F3/F6) | 🟠 | One owner, strict F1→F2→F3→F6 order, full regression each step (§6.2) |
| Parallel admin lane collisions | 🟠 | §6.6 coordination; `git diff --cached` after add |
| F6 schedule slip (18-slice long pole) | 🟡 | Everything except F7 Explore-share is independent of F6 — ship around it |
| Deep-link router triple-edit | 🟡 | Build once, registry pattern (§6.5) |
| Tab restructure relocates Wallet | 🟢 | F2/F3 wallet screens unchanged; only the entry point moves (low rework) |

### 6.8 Recommended first slice
**F4 → iOS A.1** (FareAcknowledgment confirmation view + driver earnings-range calc) — small, client-only, no money, no migration, and it produces the **first iOS↔web parity matrix** (with A.2 + web B.1) to validate the whole slice → gates → handoff → progress-update loop before anything risky. Then F4 A.2, F4 B.1, then jump to **F5 System A** for release safety.

### 6.9 Coding-readiness
All 7 features are specced with locked decisions; each carries only minor build-time follow-ups (noted per feature). **No blocking unknowns.** The plan is ready to execute on Tarun's "go" — one slice at a time, per the per-feature green-light rule (§2.5). Nothing gets built until Tarun greenlights the first slice.

---

## 7. Companion file

- [V4_PROGRESS.md](V4_PROGRESS.md) — the live scoreboard. Created alongside this plan. Updated after every slice (hard rule §2.8).
</content>
</invoke>
