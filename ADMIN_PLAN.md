# TAGO Admin — Strategic Plan

**Owner:** Tarun
**Created:** 2026-05-16
**Status:** Planning — awaiting Phase 0 kickoff approval

---

## Why this exists

Tago is post-launch with users actively signing up, drivers registering vehicles, riders requesting rides. The data is there in Supabase — but right now there's no single place to look at it, segment it, or act on it. Three concrete pain points:

1. **No visibility:** Tarun doesn't know if a new signup completed onboarding, if a driver registered a car, if a rider added a payment method. He has to query Supabase by hand.
2. **No outreach tool:** Marketing wants to nudge "registered but no first ride yet" users, drivers "without Stripe set up," etc. — but there's no way to send a targeted push or email without writing code.
3. **No live ops:** Tarun can't watch what's happening on the platform right now (active rides, driver status, signups in real-time).

The Admin panel solves all three. Built on the existing stack (React + Vite + Supabase + Express) so there's nothing new to learn or pay for.

---

## North Star

**A single signed-in page where the Tago team can see exactly what's happening on the platform and reach out to the right users without ever opening a code editor.**

What "exactly what's happening" means in practice:

- How many users signed up today? This week? Where are they stuck in the funnel?
- Which of them have installed the iOS app? Which only the web? Which neither?
- Which drivers have registered a car? Which have done Stripe onboarding? Which have given a ride?
- Which riders have added a payment method? Which have requested a ride?
- How many rides happened today? What's the avg fare? Cancellation rate?
- Which rides right now are stuck (requested > 10 min with no driver)?
- A live map of active drivers and ongoing rides
- A live event feed: "Sarah signed up," "Mike accepted ride," "Alex completed pickup" — flowing in real-time
- A user-search box: paste any name/email/phone and see the full user profile + ride history + wallet
- A campaign composer: pick an audience, write a message, send via push + email + in-app banner. See delivery stats afterwards.
- An audit log: who in the team did what when

That's the North Star. We're going to build it in slices.

---

## Decisions already made (locked 2026-05-16)

| Decision | Choice | Rationale |
|---|---|---|
| **Admin team structure** | Simple allowlist now, RBAC later | Tarun is alone now; will add roles once 3+ people on the team |
| **Admin identity** | `@tagorides.com` emails, distinct from `.edu` student users | Clear visual separation. Same Supabase auth system — admins log in like any user. Bypass the `.edu` signup gate via domain allowlist. |
| **First admin account** | One shared `admin@tagorides.com` account, password shared inside the team | Fastest path to ship. **Trade-off:** the audit log will show "admin@tagorides.com" for every action — you can't tell which team member did what without out-of-band records. Acceptable while the team is 1–3 people and everyone trusts each other; upgrade to per-person accounts (`tarun@`, `hitesh@`, etc.) the moment ≥4 people have access or you need per-person accountability for compliance. |
| **Channels in Phase 1** | Push + email + in-app banner | One campaign form, three delivery surfaces. Email via Resend (cheapest, has React Email template support). |
| **Live ops in Phase 1** | Yes — real-time map + event feed | Most exciting feature for a CEO; uses existing Supabase Realtime infra. |
| **In-app banner behaviour** | Uber-style hybrid: push if backgrounded, in-app banner if foregrounded | Best UX, reuses existing `ForegroundPushToast` plumbing on web; iOS needs small extension to `PushManager`. |

---

## How admin accounts work (Phase 0)

One shared `admin@tagorides.com` login for now; the team shares the password via 1Password / Bitwarden / Apple Passwords.

### Email setup — two separate things

Email has two unrelated sides, and they confuse everyone the first time:

| Side | What it does | Who handles it for Tago |
|---|---|---|
| **Receiving** | Someone emails `admin@tagorides.com` → message lands in an inbox | ✅ **GoDaddy** (already set up by Tarun — `admin@tagorides.com` is a working alias) |
| **Sending** | The Tago server sends email *as* `marketing@tagorides.com` → recipient sees it in Gmail | ❌ **Resend** (Slice 0.1 wires this up) |

You already handled receiving. The Cloudflare path mentioned in earlier drafts of this plan was an alternative for someone who didn't have email set up — **you do, so skip it entirely.** The remaining setup is purely the *sending* side.

### Phase 0 admin-account flow

1. **Wire up Resend for outbound email** (Slice 0.1 — Tarun, GoDaddy DNS panel, ~10 min):
   - Sign up at resend.com (free tier: 3k emails/month)
   - Add `tagorides.com` as a domain
   - Resend shows 3 DNS records (1 MX + 2 TXT for DKIM/SPF)
   - Open GoDaddy → My Products → DNS for `tagorides.com` → Add Record × 3 — paste each from Resend
   - Resend's MX record is *separate* from GoDaddy's existing MX records and won't break your incoming email (it's for Resend's bounce-handling subdomain, e.g. `send.tagorides.com`)
   - Back in Resend → click **Verify** → green check appears within 5–30 min
   - Test: from Resend's dashboard, send a test email "as `admin@tagorides.com`" to your Gmail → confirm it arrives in inbox (not spam)
2. **Sign up the admin account** through the regular Tago signup flow at `admin@tagorides.com`:
   - Email validation tweak (Slice 0.2) lets `@tagorides.com` through alongside `.edu`
   - Onboarding gate (Slice 0.2) auto-skips for `users.is_admin = true` — admin doesn't need to provide name/phone/DOB/photo just to log in
3. **Add to allowlist:** Phase 0 (Slice 0.3) ships an `admin_users` table. Once `admin@tagorides.com` is signed up and has a `user_id`, you (Tarun) run a one-time SQL insert in the Supabase dashboard adding that user_id to `admin_users` with role `'admin'`. After that, admin middleware reads from this table on every `/api/admin/*` request.

No special "admin login" page — admins log in via the regular Tago app at `tagorides.com` with the shared password, then navigate to `/admin`. The route is gated by the same JWT used by every other API call; the only extra check is "is this user in `admin_users`?"

This means the team can:
- Log in to the consumer-facing Tago app with the shared admin credentials (admin won't have rider/driver state — it's a "tools account")
- Click "Admin" in the profile menu to jump to the admin dashboard
- Get locked out of admin instantly if the row is removed from `admin_users` (no code deploy needed to revoke)

**Sending aliases** (`marketing@`, `support@`, `tarun@`, etc.) don't require any extra registration in Resend — once `tagorides.com` is verified, you can send AS any address at that domain just by passing it in the API call's `from` field. The admin composer (Slice 1.5) will have a dropdown of "approved send-as" aliases for marketing to pick from. The set of aliases is controlled server-side via a config list (so rogue admins can't send as `ceo@tagorides.com` if it's not in the allowed list).

**Replies:** if a recipient hits Reply on a marketing email, that reply goes to wherever GoDaddy is configured to deliver `marketing@tagorides.com`. To make replies usable: in GoDaddy, set the alias to forward to a real inbox you check (or to `admin@tagorides.com` which already forwards). The send happens via Resend; the receive happens via GoDaddy. Two separate plumbing paths.

**When to graduate beyond one shared account:**
- The team reaches 4 people, OR
- You need per-person audit trail for compliance, OR
- Different team members need different permissions (Phase 3 RBAC)

When that happens, sign each person up at `their-name@tagorides.com` (since the GoDaddy domain already accepts mail to any of these, just add the alias) and add each user_id to `admin_users`. The shared `admin@tagorides.com` row can stay or retire.

---

## Phase 0 — Prerequisites (must complete before Phase 1 starts)

Each slice is a self-contained 1–3 hour chunk.

### Slice 0.1 — Resend wired to send AS `*@tagorides.com`
**Owner:** Tarun (Resend dashboard + GoDaddy DNS panel, no code). **Est: 10–15 min.**

> Receiving email at `admin@tagorides.com` is already handled by GoDaddy (Tarun set up the alias). This slice is the OUTGOING side only — the Tago server needs to be authorized to send email AS the domain so marketing campaigns land in Gmail inboxes, not spam.

1. Sign up at **resend.com** with your Gmail (it's free up to 3k emails/month)
2. Domains → **Add Domain** → enter `tagorides.com` → Add
3. Resend shows 3 DNS records to add (1 MX + 2 TXT). Copy each.
4. Open **GoDaddy** → Sign in → My Products → click **DNS** next to `tagorides.com`
5. **Add Record × 3:**
   - **MX:** Name = `send`, Type = MX, Priority = 10, Value = (paste Resend's `feedback-smtp.us-east-1.amazonses.com` or similar)
   - **TXT (DKIM):** Name = `resend._domainkey`, Type = TXT, Value = (paste long DKIM key from Resend, includes `v=DKIM1; k=rsa; p=…`)
   - **TXT (SPF):** Name = `send`, Type = TXT, Value = `v=spf1 include:amazonses.com ~all`
   - (Exact values come from Resend's dashboard — don't copy from here)
6. **Save** in GoDaddy. DNS propagation: usually 5–30 min, sometimes up to a few hours.
7. Back in Resend → next to the domain → click **Verify**. Wait for green checks on all three records (refresh after 5 min if still yellow).
8. **Test from Resend's dashboard:**
   - Resend → Emails → **Send Test Email**
   - From: `admin@tagorides.com`
   - To: your personal Gmail
   - Subject: "Tago Resend verification"
   - Body: "test"
   - Send → confirm it arrives in **Inbox**, not Spam
9. **Copy the Resend API key** (Dashboard → API Keys → Create) and save securely. We'll add it to the EC2 `.env` when Slice 1.5 ships.
10. Save the shared `admin@tagorides.com` Tago-login password in your password manager (this is a separate password from anything email-related — it's just the password the admin user will set when they sign up to the Tago app in Slice 0.2 testing).

### Slice 0.2 — Signup allows `@tagorides.com` in addition to `.edu`
**Code change:** small. ~30 min.
- iOS + web signup validation: accept `@tagorides.com` as a valid domain
- Confirm `.edu` still required for everyone else
- Add a `users.is_admin` boolean column (default false). Admins skip onboarding gate in `RootView` / `AuthGuard`.
- Migration: `069_admin_users.sql`
- Tests: signup with `@tagorides.com` succeeds, signup with `@gmail.com` still rejected, admin signup skips onboarding gate

### Slice 0.3 — `admin_users` table + middleware
**Code change:** ~1 hour.
- New migration `070_admin_users.sql`:
  ```sql
  CREATE TABLE admin_users (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'marketing', 'ops', 'finance', 'support')),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- `server/middleware/adminAuth.ts` — checks if `res.locals.userId` is in `admin_users`, returns 403 if not
- `server/routes/admin/*.ts` — new router file pattern, all routes gated by `adminAuth`
- Bootstrap: insert your `tarun@tagorides.com` user_id manually via Supabase SQL editor (one-time, before there's a UI for it)
- Tests: non-admin user gets 403; admin user passes; missing JWT gets 401

### Slice 0.4 — Admin app shell + routing
**Code change:** ~2 hours.
- New top-level route `/admin` in the web app (lazy-loaded)
- `<AdminLayout>` — sidebar (Dashboard / Users / Campaigns / Live / Settings) + top bar (env badge: PROD / DEV, current admin name, logout)
- `<AdminGuard>` — wraps the route, checks `useAuthStore().profile.is_admin`, redirects to `/` if false
- Empty placeholder pages for each sidebar item (so navigation works)
- "Admin" link in `ProfilePage` for admin users (hidden for non-admins)

---

## Phase 1 — MVP admin (the core deliverable)

**Goal:** by the end of Phase 1, you can open `/admin`, see your platform metrics at a glance, drill into any user, send a campaign, and watch live activity.

Each Phase 1 slice is roughly half a day of focused work.

### Slice 1.1 — Analytics: Overview dashboard
**The "front page" of admin.** Single screen, instantly useful.

- 12 KPI cards arranged in a 4×3 grid:
  1. **Total users** (all-time) — number + small sparkline of last 30 days
  2. **New signups today** (vs yesterday %)
  3. **DAU / WAU / MAU** — three numbers, the most important ratio
  4. **Active rides right now** — count + green dot if >0
  5. **Rides completed today** (vs yesterday %)
  6. **Total revenue this week** (cents → dollars, prod live mode aware)
  7. **iOS install rate** — % of users with `platform=ios` in `push_tokens`
  8. **Driver activation rate** — % of users with `is_driver=true` who completed Stripe onboarding
  9. **Rider activation rate** — % of users who have a saved payment method
  10. **7-day retention** — % of users from 7 days ago still active today
  11. **Avg ride fare** (this week)
  12. **Avg driver rating** (all-time)

- Below the cards: 3 charts
  - Daily signups (line chart, 30 days)
  - Daily completed rides (line chart, 30 days)
  - Top 10 universities by user count (bar chart, derived from email domain)

- All queries server-side; cached 5 min via React Query
- Each KPI card clickable → drills into a detailed view (Phase 2)

### Slice 1.2 — User funnel breakdown
Visualization of where users get stuck.

- Funnel chart: **Signed up → Verified email → Completed profile → Added payment method (if rider) OR Registered vehicle (if driver) → Completed first ride**
- Each step shows count + drop-off %
- Click any step to get the list of users WHO ARE STUCK there (for outreach)
- Filter by date range (last 7d / 30d / 90d / all)
- Filter by mode (rider / driver / both)

### Slice 1.3 — User search + profile detail
**The most-used feature.** Marketing team needs to find any user in seconds.

- Big search box at top of `/admin/users` page
  - Searches across: email, full_name, phone, user_id (partial UUID OK)
  - Debounced 250ms, server-side full-text search on `users` table
  - Returns rows with email, name, signup date, mode, last active
- Click any row → user detail page `/admin/users/:id`:
  - Header: avatar + name + email + signup date + university (derived from email)
  - Tabs: Overview / Rides / Wallet / Notifications / Devices / Admin Actions
    - **Overview**: profile fields, is_driver, onboarding_completed, payment_method_id, vehicle (if driver), routines count, ratings
    - **Rides**: paginated list of all rides this user was on (rider or driver), each clickable → ride detail
    - **Wallet**: balance, all transactions, pending Stripe transfers
    - **Notifications**: all FCM/email/in-app sent to this user with delivery + open status
    - **Devices**: list of push_tokens rows with platform, last_seen, app_version
    - **Admin Actions** (write surface, audit-logged):
      - Send custom push to this user (one-off)
      - Grant wallet credit (with reason field)
      - Refund a specific ride (with reason)
      - Suspend account (with reason, sets `users.suspended_at`)
      - Force-reset password (sends email)
      - Override onboarding_completed (rare — only for stuck users)
      - Promote to admin (Tarun-only)
- All read paths use React Query; mutations require typed confirmation modal

### Slice 1.4 — Push notification composer
**Marketing's first real tool.**

- Form on `/admin/campaigns/new`:
  - **Audience** dropdown:
    - All users
    - All iOS users
    - All web users
    - Users without iOS install
    - Drivers without registered vehicle
    - Drivers without Stripe onboarding
    - Riders without payment method
    - Users with no ride in 30 days
    - Custom segment (Phase 2 — drag-drop query builder)
  - **Channel** checkboxes: [✓] Push notification [✓] Email [✓] In-app banner
  - **Title** (push title or email subject)
  - **Body** (push body or email body — switches between plaintext and rich text editor based on channel)
  - **Emoji picker** (optional, prepended to title)
  - **Deep link** dropdown: Open app / Open ride board / Open profile / Open wallet / Custom URL
  - **Image attachment** (optional, for richer push and email)
  - **Schedule**: Send now / Send at... (datetime picker)
  - **Preview pane** showing iOS lock-screen banner mock + email subject preview as you type
  - **Audience count** auto-updates: "Will reach **127** users (43 iOS, 84 web)"
  - **Send** button → confirmation modal → fires
- Server endpoint `POST /api/admin/campaigns`:
  - Validates admin
  - Resolves audience → user_ids
  - For each user_id: enqueues push job + email job + in-app banner record
  - Returns campaign_id
  - Background worker processes the queue (cron-like, or direct fan-out if <1000 users)
- Audit row written to `notification_campaigns` table

### Slice 1.5 — Email broadcast (rich Gmail-style composer)
**The marketing team's most-used surface.** Looks and feels like writing a Gmail email, plus audience picker.

- **Prerequisite:** Slice 0.1 (Resend wired to `tagorides.com` via GoDaddy DNS) is done.
- **From-address dropdown** — populated from a server-side config list of approved aliases. Phase 1 ships with: `admin@tagorides.com`, `marketing@tagorides.com`, `support@tagorides.com`, `tarun@tagorides.com`. Adding more aliases later is a one-line config change (no DNS work, since the whole domain is already verified). The default selection persists per-admin in `localStorage`.
- **Subject line** — single-line input, char counter shown (recommend keeping under 60 chars for mobile Gmail)
- **Rich text body editor** — TipTap library (React-friendly, used by Linear / Notion). Toolbar matches Gmail closely:
  - Bold / Italic / Underline / Strikethrough
  - Headings (H1, H2)
  - Bulleted + numbered lists
  - Link (insert URL + display text)
  - Inline image (uploaded to Supabase Storage, embedded in HTML body via CID)
  - Horizontal rule
  - Blockquote
  - Code (inline + block)
  - Undo / redo
  - "Clear formatting" button
- **Attachments** — drag-and-drop zone below the editor OR click "Add attachment" button. PNG, JPG, PDF accepted up to 10 MB each, max 5 attachments per campaign. Each upload goes to a new `email_attachments` Supabase Storage bucket; the server includes them as base64 in the Resend send call.
- **Preview pane** — toggle between a desktop Gmail mock and a mobile Gmail mock. Shows From / Subject / Body / Attachments exactly as the recipient will see them.
- **Audience picker** — shared with the push composer in Slice 1.4 (same dropdown, same segments)
- **Schedule** — same as push: Send now / Send at...
- **Channel checkboxes** — campaign can fire BOTH email AND push from one form. Each channel uses the same Subject (push title) and Body (push body, stripped to plain text and truncated to 160 chars). Audience is shared. Attachments are email-only.
- **Send button** — confirmation modal: "You are sending this email to **N** recipients from `marketing@tagorides.com`. Type SEND to confirm." Rate-limited to 1 campaign per 5 min per admin.
- **Server endpoint:** `POST /api/admin/campaigns/email` — validates admin, resolves audience, fetches attachments from Storage, calls Resend's batch send API, writes campaign row + per-recipient delivery rows
- **Resend webhook handler** — `POST /api/webhooks/resend` listens for `email.delivered`, `email.opened`, `email.clicked`, `email.bounced` events; updates `notification_campaigns_recipients` accordingly
- **Bounce / unsubscribe handling** — Resend auto-adds an unsubscribe link to every marketing email (legal requirement under CAN-SPAM / GDPR). Unsubscribed addresses are flagged in `users.email_opt_out=true` and excluded from future marketing audiences. Transactional email (password reset, etc.) ignores opt-out.

### Slice 1.6 — In-app banner integration (sub-slice of 1.4)
**Reuses the existing `ForegroundPushToast` infra on web.**

- Server: when a push fires with `data.type = 'marketing_campaign'`, FCM payload includes title/body/cta/image
- iOS `PushManager.handleForegroundNotification` already returns `[.banner, .sound]` — extend to also enqueue a SwiftUI `MarketingBannerStore` overlay if `data.type == 'marketing_campaign'`
- Web: extend `ForegroundPushToast` to handle marketing_campaign type
- Banner UX: large title + body + image + CTA button + dismiss X
- Tapping CTA → deep link routing
- Auto-dismiss after 8s

### Slice 1.7 — Live ops view
**The CEO eye-candy.**

- `/admin/live` page, split into two halves:
  - **Left: live map** (uses existing `<MapView>` component from Core/Maps)
    - All `driver_locations` rows with `is_online=true` plotted as small pins, color-coded by mode (rider/driver)
    - All active rides (`status IN (accepted, coordinating, pickup, active)`) plotted as connected pickup→dropoff lines
    - Cluster pins when zoomed out
    - Hover any pin → tooltip with user name + last_seen
    - Auto-updates via Supabase Realtime subscriptions on `driver_locations` and `rides`
  - **Right: event feed**
    - Scrolling list of recent events, newest at top:
      - 🟢 "Sarah Chen signed up" (2 sec ago)
      - 🚗 "Mike Patel accepted ride from Davis → Sacramento" (8 sec ago)
      - 💰 "$12.40 paid by Alex Wong" (12 sec ago)
      - ❌ "Driver cancelled (TestUser1)" (30 sec ago)
    - Each event clickable → jumps to relevant user/ride detail
    - Filter chips at top: All / Signups / Rides / Payments / Issues
    - 50 most-recent events; older drop off
- Realtime subscriptions: `users` (INSERT), `rides` (UPDATE on status), `wallet_transactions` (INSERT)
- Sound chime toggle (off by default — too noisy to leave on)

### Slice 1.8 — Campaign history + audit log
- `/admin/campaigns` lists all past campaigns:
  - Date, sender (admin), title, audience size, channels used, delivery stats (sent / delivered / opened / clicked)
  - Click any row → detail view with per-user delivery status
- `/admin/audit-log` shows every admin action (refunds, suspensions, manual credits, etc.):
  - Who did what to whom, when, with reason
  - Filterable by admin / target user / action type / date
  - Immutable — entries never deleted (compliance trail)

### Slice 1.9 — Operational alerts panel
**The "is anything broken right now" widget.**

- Small card on Overview dashboard, always visible:
  - 🟡 N rides stuck in `requested` > 10 min (clickable → list)
  - 🔴 N rides stuck in `coordinating` > 30 min (clickable → list)
  - 🟡 N failed payments in last 24h (clickable → list)
  - 🔴 N unresolved safety reports (clickable → list)
  - 🟢 All clear (when none of the above)
- Each item links to the relevant admin page with the filter pre-applied
- Refreshes every 60s

### Slice 1.10 — Phase 1 final QA + ship
- Full test pass (admin auth, campaign send, audit log, audience counts match actual recipients)
- Performance check: dashboard loads <2s on a typical Tago user base
- Hardening: rate-limit campaign sends (max 1 per 5 min per admin)
- Add `admin@tagorides.com` to the allowlist as a "team account" (shared password OK for now)
- Document in this file as **Phase 1 Done**

**End of Phase 1.** You should be looking at a polished, useful admin tool by this point.

---

## Phase 2 — Power features (after Phase 1 is in your hands and shaken down)

### Slice 2.1 — Custom audience builder (drag-drop query UI)
- Visual filter builder: pick fields, comparators, values. Save reusable segments.
- e.g. "users where mode=driver AND last_ride_at < 7 days ago AND wallet_balance > 1000"
- Stores as JSON; server compiles to SQL safely

### Slice 2.2 — A/B testing for campaigns
- Variant A and Variant B for any campaign
- 50/50 split, segment-aware
- Reports open/click rate per variant
- Auto-pick winner after N hours

### Slice 2.3 — Drip campaigns
- Triggered campaigns: "Send X 48h after signup if user hasn't done Y"
- e.g. "48h after signup, if no payment method, send 'Add your card' email"
- Configure via a small workflow editor (no-code)

### Slice 2.4 — User cohort analysis
- D1 / D7 / D14 / D30 retention by signup week
- Funnel comparison: this week's users vs last week's
- Cohort heatmap

### Slice 2.5 — Ride analytics deep dives
- Ride heatmap (PostGIS): where pickups happen most
- Avg pickup wait time by hour of day
- Cancellation breakdown by reason
- Driver acceptance rate by time of day

### Slice 2.6 — Financial reports
- Daily revenue + platform fees
- Stripe Connect balance per driver
- Pending withdrawals queue (action: approve / pause)
- Refund history with reasons
- Export CSV for accountant

### Slice 2.7 — Feature flags
- Turn on/off features per user / segment / globally
- e.g. "Enable beta routine UI for users in this list"
- Persisted in `feature_flags` table; client reads via `/api/feature-flags/me`

### Slice 2.8 — Content management
- Edit FAQ entries from admin (no code deploys)
- Edit safety alerts copy
- Schedule announcement banners ("Maintenance tomorrow 2am-4am")

### Slice 2.9 — Bulk operations
- Bulk refund (paste CSV of ride_ids)
- Bulk grant wallet credit (paste CSV of user_ids + amounts)
- Bulk import allowlisted users (e.g. partner universities)

### Slice 2.10 — Slack/Discord integration
- Post real-time alerts to a #ops Slack channel
- "🚨 5 rides stuck > 10 min" / "🎉 New driver signup: Jane Doe (UC Berkeley)"
- Configurable per event type

---

## Phase 3 — Future (when team grows or scale demands)

### Slice 3.1 — Role-based access control (RBAC)
- Roles: admin / marketing / ops / finance / support
- Per-role permission matrix:
  - Marketing: campaigns + analytics, NO refunds / suspensions
  - Ops: live view + ride overrides, NO campaigns
  - Finance: financial reports + refunds, NO user profile detail
  - Support: user search + send-individual-message, NO bulk actions
- UI gates: hide tabs the user can't access
- Server: every endpoint checks `admin_users.role` against allowed roles

### Slice 3.2 — SSO + 2FA for admins
- Google Workspace SSO (since admins are on `@tagorides.com`)
- 2FA required for admin login (Supabase Auth supports TOTP)
- Session timeout: 8 hours

### Slice 3.3 — Granular audit + compliance
- Every admin action exported nightly to S3 (immutable)
- SOC 2 prep: who accessed what user data, when, why
- Required for any future enterprise / B2B sales

### Slice 3.4 — Mobile admin app
- iOS-only admin app for on-call ops
- Push alerts when stuck rides spike
- Approve refunds from phone
- Built as a separate Swift target, reuses same `/api/admin/*` endpoints

### Slice 3.5 — Data warehouse export
- Hourly export of all tables to Snowflake / BigQuery / DuckDB
- Lets you run heavy analytical queries without hitting prod DB
- Powers Phase 2 retention / cohort analysis at scale

### Slice 3.6 — Multi-tenant admin (if you white-label Tago)
- Different admin views per university or partner
- Branding per tenant
- Out of scope until Tago expands beyond a single platform

---

## Stack additions

Things this plan adds to your tech stack (beyond what's already there):

| Addition | Purpose | Cost |
|---|---|---|
| **Resend** | Transactional + marketing email API (Slice 0.1 verified `tagorides.com` via GoDaddy DNS records 2026-05-16) | $0 (3k/mo) → $20/mo (50k/mo) |
| **TipTap** | React rich text editor for the email composer | Free open-source |
| **React Email** | Email template components (for reusable HTML email layouts) | Free open-source |
| **TanStack Table** (optional, for admin tables) | Sortable / filterable / paginated tables | Free open-source |
| **Recharts** | Line / bar / area charts on dashboard | Free open-source |

Nothing else. No new database, no new auth provider, no new hosting.

### Where credentials live (security boundary)

| Credential | Lives in | NEVER in |
|---|---|---|
| `RESEND_API_KEY` (Slice 0.1 — created in Resend dashboard, rotated when exposed) | EC2 `~/hich-web/.env` only | Vercel, iOS xcconfig, git, Slack, chat logs |
| `STRIPE_SECRET_KEY` | EC2 `~/hich-web/.env` only | Vercel, iOS xcconfig, git |
| `SUPABASE_SERVICE_ROLE_KEY` | EC2 `~/hich-web/.env` only | Vercel, iOS xcconfig, git |
| `FIREBASE_SERVICE_ACCOUNT_PATH` → JSON file | EC2 disk only (referenced from `.env`) | Vercel, iOS xcconfig, git |
| Public/client keys (Supabase anon, Stripe publishable, Firebase API key) | Vercel + iOS xcconfig | (these are fine in the client bundle by design) |

**Rule of thumb:** if a credential authorizes the server to do something powerful (send mail, charge cards, bypass RLS, push notifications), it lives ONLY on EC2. If it's a public identifier the client app needs to talk to a public API, it can live in client builds.

---

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Marketing accidentally sends a campaign to ALL users | Medium | High (annoys users, possible Apple App Store complaint) | Confirmation modal with "you are sending to **N** users — type SEND to confirm." Rate limit: 1 campaign per 5 min per admin. Audit log shows who. |
| Admin sees private user data they shouldn't | Low (single-team trust) | Medium (compliance) | Phase 3 RBAC adds per-role gates. For now, audit log + small team. |
| Performance: dashboard queries hammer prod DB | Medium | High (could slow down user-facing requests) | All admin queries use a separate `supabaseAdmin` client with read-replicas (if/when you provision one) or cached aggregates. Phase 1 starts with React Query 5-min cache. |
| Real-time map subscriptions exhaust Supabase connection pool | Low | Medium | One Supabase Realtime channel per admin session; close on tab close. Cap admin sessions at 10 concurrent (free tier limit is 200, so plenty of headroom). |
| `tagorides.com` email DNS misconfig | Low | Medium (bounced emails, missed admin signups) | Slice 0.1 includes test-by-sending step before moving on. |
| Resend bounce rate goes high → account suspended | Low | High (can't send email) | Honor unsubscribes immediately. Use double opt-in for marketing list. Resend's free tier is forgiving. |

---

## Definition of Done — Phase 1

Following CLAUDE.md's Definition of Done rule, Phase 1 is shippable when:

1. ✅ All tests pass (`npm test --run`)
2. ✅ Lint clean (`npm run lint`)
3. ✅ Build clean (`npm run build`)
4. ✅ Manual smoke test on prod:
   - Tarun signs up at `tarun@tagorides.com`, gets bumped past onboarding
   - Tarun added to `admin_users` via Supabase SQL editor (one-time)
   - Tarun opens `/admin`, sees the dashboard, all 12 KPI cards populate within 2s
   - Tarun searches "test", finds a test user, opens their profile
   - Tarun composes a push notification to "All web users", sends to himself + 1 other test account, both receive it within 30s
   - Tarun composes an email to the same audience, both receive it within 60s
   - Tarun opens `/admin/live`, sees himself on the map, drives somewhere (sim), sees pin move
   - Tarun views campaign history, sees the campaign he just sent
   - Tarun views audit log, sees the campaign creation entry
5. ✅ Phase 1 deployed to prod + EC2 redeployed
6. ✅ This file's status flipped from "Planning" to "Phase 1 Done"

---

## Process notes (for whoever picks this up — including future-Tarun)

- Each slice is one focused work session (1–4 hours typically). Don't bundle slices.
- Update `ADMIN_PROGRESS.md` as you work — flip checkboxes, log decisions, capture blockers.
- When in doubt, prefer "minimal but shippable" over "polished but incomplete." Phase 2 has the polish.
- Test in dev (Supabase dev project + local server) before flipping to prod.
- Admin endpoints go in `server/routes/admin/*.ts` and route through `server/middleware/adminAuth.ts`. Don't sprinkle admin logic in user-facing routes.
- Admin React components go in `src/components/admin/*.tsx`. Reuse shared UI (`PrimaryButton`, etc.) — don't fork.
- Every admin write action MUST write an entry to `admin_audit_log`. No exceptions.
