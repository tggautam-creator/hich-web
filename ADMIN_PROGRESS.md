# TAGO Admin — Progress Tracker

**Source plan:** [ADMIN_PLAN.md](ADMIN_PLAN.md)
**Last updated:** 2026-05-16

---

## Summary

| Status | Slices |
|---|---|
| ✅ Done | 4 (Phase 0 complete) |
| 🟡 In progress | 0 |
| ⚪ Not started | 24 |
| 🔴 Blocked | 0 |

**Current focus:** Phase 0 wrap-up — pending Tarun's prod-side dance.
**Next action (Tarun):** apply migration 069 to prod Supabase + configure Resend SMTP on prod project (mirror dev setup) + bootstrap `admin@tagorides.com` in prod via the same flow. Once Phase 0 is verified end-to-end on prod, Phase 1 starts with Slice 1.1 (Overview dashboard — KPI cards + charts).
**Phase 1 ETA:** ~2–3 dev sessions across slices 1.1 → 1.10. First server slice (`/api/admin/metrics/overview`) lands within a few hours of start.

---

## Phase 0 — Prerequisites

- [x] **0.1** Resend wired to send AS `*@tagorides.com` (GoDaddy DNS records added; domain verified 2026-05-16; first API key rotated after exposure; new key added to EC2 `~/hich-web/.env` as `RESEND_API_KEY`) — **Tarun, no code**
- [x] **0.2** Signup allows `@tagorides.com` in addition to `.edu` + `users.is_admin` boolean — **verified end-to-end in dev 2026-05-17**. Migration `069_users_is_admin.sql`, web `validation.ts` + `database.ts` + `AuthGuard.tsx`, iOS `Validation.swift` + `UserProfile.swift` + `RootView.swift`. Email-domain bypass added (checks `auth.user.email` even before `public.users` row exists, so fresh admin signups don't get trapped at CreateProfile). 17 new validation tests pass.
- [x] **0.3** `adminAuth` middleware (JWT + `users.is_admin = true` check) — shipped 2026-05-17. `server/middleware/adminAuth.ts`, `server/routes/admin/index.ts` with `GET /api/admin/ping` health probe. 6 middleware tests cover all permission paths (401 MISSING_TOKEN / 401 INVALID_TOKEN / 403 NOT_AN_ADMIN / 200 / 500 ADMIN_LOOKUP_FAILED). Old token-gated operator router `server/routes/admin.ts` renamed → `server/routes/ops.ts` mounted at `/api/ops/*`, freeing `/api/admin/*` for the team panel. The plan's reference to a separate `admin_users` table is deferred to Phase 3 (RBAC); for Phase 1 `users.is_admin` is sufficient source-of-truth.
- [x] **0.4** Admin app shell + routing — shipped 2026-05-17. `<AdminGuard>` (two-layer permission: `@tagorides.com` email OR `profile.is_admin === true`), `<AdminLayout>` (sidebar with 6 nav items + topbar with PROD/DEV env badge + sign out + admin email), `<AdminHomePage>` placeholder with `/api/admin/ping` probe + Phase 1 preview. `/admin/*` routes wired in `main.tsx` (nested under `AuthGuard` then `AdminGuard` then `AdminLayout`). "Open Admin Panel" button in ProfilePage (visible only for admins).

## Phase 1 — MVP Admin

- [ ] **1.1** Analytics: Overview dashboard (12 KPI cards + 3 charts)
- [ ] **1.2** User funnel breakdown (with drop-off lists)
- [ ] **1.3** User search + profile detail (Overview / Rides / Wallet / Notifications / Devices / Admin Actions)
- [ ] **1.4** Push notification composer
- [ ] **1.5** Email broadcast (Resend setup + React Email templates)
- [ ] **1.6** In-app banner integration (web + iOS)
- [ ] **1.7** Live ops view (map + event feed)
- [ ] **1.8** Campaign history + audit log
- [ ] **1.9** Operational alerts panel (stuck rides, failed payments)
- [ ] **1.10** Final QA + prod ship

## Phase 2 — Power features (post-Phase-1)

- [ ] **2.1** Custom audience builder (drag-drop query UI)
- [ ] **2.2** A/B testing for campaigns
- [ ] **2.3** Drip campaigns (event-triggered)
- [ ] **2.4** User cohort analysis (retention heatmaps)
- [ ] **2.5** Ride analytics deep dives (heatmap, wait times, cancellation reasons)
- [ ] **2.6** Financial reports (revenue, fees, Stripe Connect, refunds, CSV export)
- [ ] **2.7** Feature flags (per-user / segment / global)
- [ ] **2.8** Content management (FAQ, safety alerts, announcement banners)
- [ ] **2.9** Bulk operations (refund / credit / import via CSV)
- [ ] **2.10** Slack/Discord integration (real-time alerts)

## Phase 3 — Future

- [ ] **3.1** Role-based access control (admin / marketing / ops / finance / support)
- [ ] **3.2** SSO + 2FA for admins
- [ ] **3.3** Granular audit + compliance (SOC 2 prep)
- [ ] **3.4** Mobile admin app (iOS)
- [ ] **3.5** Data warehouse export
- [ ] **3.6** Multi-tenant admin (if Tago white-labels)

---

## Decisions log

Append-only. Newest entries at the top. Capture every non-obvious decision so future-you (or a teammate) doesn't have to re-derive them.

- **2026-05-16** — **Email split into two paths:**
  - **Receiving** (someone emails `admin@tagorides.com` → lands in an inbox) is already handled by **GoDaddy** — Tarun set up the alias before this conversation. No code or extra setup needed.
  - **Sending** (Tago server emails AS `marketing@tagorides.com`) needs **Resend** (Slice 0.1). DNS records (DKIM/SPF) go in GoDaddy's DNS panel — Resend gives the exact values. Once verified, any `*@tagorides.com` address can be used in the From field.
  - **Cloudflare path dropped** — was an alternative for someone without email set up; Tarun has GoDaddy, so it's redundant.
- **2026-05-16** — Email composer (Slice 1.5) gets Gmail-style polish: TipTap rich text editor, From-address dropdown (config-driven allowlist of aliases), drag-drop PNG/JPG/PDF attachments (≤10MB each, ≤5 per campaign), Resend's batch send + webhook for opens/clicks. Reason: Tarun explicitly asked for "interface like sending the email like a regular gmail" with poster upload.
- **2026-05-16** — **One shared `admin@tagorides.com` account** instead of per-person `tarun@` / `hitesh@`. Trade-off accepted: audit log shows the shared account for every action, can't tell who did what without out-of-band records. Acceptable for a 1–3 person team that trusts each other. Trigger to switch to per-person accounts: ≥4 people OR compliance audit need OR per-role permission split. Password stored in shared password manager (1Password / Bitwarden / Apple Passwords).
- **2026-05-16** — Admin emails on `@tagorides.com`, not `@gmail.com`, to visually separate from `.edu` student users.
- **2026-05-16** — Allowlist-only auth for Phase 1; RBAC deferred to Phase 3. Reasoning: 1-person team right now; over-engineering permissions before there are roles to assign is premature.
- **2026-05-16** — Push + email + in-app banner all in Phase 1 (one campaign, three surfaces). Reasoning: cheap to do at the same time since the audience query is shared; defers later UX work.
- **2026-05-16** — Live ops view in Phase 1 (not Phase 2). Reasoning: most exciting CEO feature, uses existing Supabase Realtime + `<MapView>` infra, no new tech. ~1 dev day cost.
- **2026-05-16** — Uber-style hybrid in-app banner + push (foreground → banner, background → push). Reasoning: best UX, web already has `ForegroundPushToast`; iOS gains a thin extension.
- **2026-05-16** — Email via Resend (not Mailgun / SendGrid / Postmark). Reasoning: cleanest API, React Email integration, generous free tier ($0 / 3k emails/mo), supports DKIM out of the box.
- **2026-05-16** — Admin routes at `/admin/*` on the same web app, not a separate subdomain. Reasoning: reuses existing auth, no new deploy infra. If admin grows huge, can extract later.

---

## Blockers / open questions

(empty)

---

## Recent sessions

| Date | Tasks worked | One-line result |
|---|---|---|
| 2026-05-16 | Drafted `ADMIN_PLAN.md` + this progress file | Plan + tracker ready for Tarun review |
| 2026-05-16 | Locked decision: single shared `admin@tagorides.com` account, updated plan + decisions log | Phase 0 ready to kick off; Slice 0.1 (Cloudflare) is Tarun's next step |
| 2026-05-16 | Pivot: GoDaddy already handles receiving; rewrote Slice 0.1 around Resend + GoDaddy DNS. Expanded Slice 1.5 with Gmail-style composer (From dropdown, rich text, attachments) | Plan now accurate for Tarun's actual GoDaddy setup; ready for him to run Slice 0.1 |
| 2026-05-16 | Slice 0.1 done by Tarun: Resend → tagorides.com → DNS via GoDaddy → domain Verified. First API key was exposed in chat → instructed rotation. New key lives in EC2 `~/hich-web/.env` as `RESEND_API_KEY`. Plan updated with credentials-boundary table. | Phase 0 unblocked for code work; Slice 0.2 starts next |
| 2026-05-16 | Slice 0.2 code: migration 069 (`users.is_admin`), web `isValidEduEmail` + `isAdminEmail` accept `@tagorides.com`, web `database.ts` type adds `is_admin`, web `AuthGuard` bypass for admins, iOS `Validation.isAdminEmail` + `UserProfile.isAdmin` + `RootView.isProfileIncomplete` bypass. 17 new validation tests pass; 1069/1069 web tests green; lint clean; build clean; iOS sim builds. Local `.env`/`.env.dev` get `RESEND_API_KEY=` placeholder (Tarun pastes the rotated key locally). | Code complete, awaiting Tarun's dev signup test |
| 2026-05-17 | Slice 0.2 finalized: hardened the admin bypass to check `auth.user.email` BEFORE the profile-nil guard (fresh signups no longer trap at CreateProfile despite `is_admin` not yet set). Resolved email-template OTP-vs-link mismatch by copying prod's templates to dev. Dev SQL UPDATE flipped `is_admin=true` on `admin@tagorides.com`. End-to-end verified: signup → OTP confirm → sign-in lands directly on Home tab. 1081 tests green; lint+build clean. Encountered + diagnosed: Supabase rate limit (resolved via Resend custom SMTP); 8-digit-code-vs-link email confusion (resolved via template clone); CreateProfile trap (resolved via auth.user.email bypass). | Slice 0.2 done; ready for Slice 0.3 |
| 2026-05-17 | Slice 0.3 + 0.4 in one push: `adminAuth` middleware + `/api/admin/ping` endpoint; renamed old `/api/admin/*` operator-token-gated endpoints → `/api/ops/*` (4 endpoints: health, ghost-refunds GET+POST, payment-dunning); web `<AdminGuard>`, `<AdminLayout>` (sidebar + env badge + sign out), `<AdminHomePage>` (placeholder + ping probe + Phase 1 preview); `/admin/*` routes in `main.tsx`; "Open Admin Panel" button in ProfilePage. 6 new adminAuth tests cover all permission paths. 1090 tests green; lint+build clean. Phase 0 fully done. | Phase 0 complete; Phase 1 starts whenever Tarun says go |

---

## How to use this file

1. **At the start of every admin-related work session:** read this file top-to-bottom. The summary table tells you what's next.
2. **The moment you start a slice:** flip its checkbox to `[~]` (in progress) and update the **Current focus** + **Next action** lines.
3. **The moment you finish a slice:** flip to `[x]` with a one-line note like `— shipped 2026-05-21, EC2 deployed`. Update the **Summary** counts.
4. **When you make a non-obvious decision:** prepend it to the Decisions log with today's date.
5. **If blocked:** add to Blockers section with one line of context. Move on to a parallel slice if possible.
6. **At session end:** append a row to Recent sessions table.

The point of all of this is: a teammate (or future-you, six weeks from now) should be able to open this file and immediately understand where the admin tool is, what's blocking it, and what to do next — without reading any code.
