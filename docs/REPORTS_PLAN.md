# Reporting & issue tracking — in-app reports → admin panel triage

**Owner:** Tarun · **Started:** 2026-05-20 · **Status:** planning

## Why

Today every "something is wrong" path in Tago either dead-ends in the
user's head, gets sent to Tarun as an email, or surfaces in a Slack DM
from a friend. There's no durable record, no SLA, no audit log, no
way to link "this refund happened" to "this ride felt unsafe", and
no way to alert ops in real time when a rider hits the panic button
mid-ride.

Goal: every channel of user feedback (bug → refund → safety) lands in
one `reports` table, surfaced through `/admin/reports` with thread,
attachments, actions (refund / suspend / reply), and a real-time
alert pipeline (Slack + email) for `safety_during_ride`.

## Strategic decisions (confirmed by Tarun via AskUserQuestion 2026-05-20)

| Topic | Decision |
|---|---|
| Alert channels for `safety_during_ride` | Slack incoming webhook + email via Resend. No Twilio SMS or Twilio Voice in v1. Can layer SMS in later if we find ourselves missing alerts. |
| Notify the reported user? | **No.** Reported user stays silent until admin takes a user-visible action (refund / suspend / reply). Avoids retaliation, lets admin triage without escalation. |
| Refund flow from a report | **Reuse** the existing admin refund endpoint (`useAdminRefundRide` + `POST /api/admin/rides/:id/refund`). Issuing a refund from a report links the resulting `transactions` row back to `reports.id` for audit. One source of truth. |
| Anonymity | Identity is always attached server-side. Reported user can't see the reporter in-app. Admin always sees both. |
| Storage of attachments | Private Supabase Storage bucket `report-attachments`, signed URLs only. Same model as license photos (CLAUDE.md). |

## Email is NOT a primary inbox anymore

> "I don't want app to actually mail me anything, now that I have an
> admin panel I can just use it as to see and resolve the issue"

So:

- The user-facing in-app flow lands a row in `reports`.
- Admin triages and replies through `/admin/reports/:id`.
- Email-out is a CHANNEL the admin can choose ("reply via email", goes
  out through Resend), not the inbox itself.
- Slack + email-to-admin are RESERVED for `severity='emergency'` —
  used as paging mechanisms only, not as the conversation thread.

The `/admin/reports` inbox is the source of truth.

## Report taxonomy

12 categories cover the surface area. Server auto-assigns severity;
admin can override.

### Ride-tied (`ride_id` required)
| Category | Reporter | When | Default severity |
|---|---|---|---|
| `driver_conduct` | Rider | post-ride | normal |
| `rider_conduct` | Driver | post-ride | normal |
| `vehicle_condition` | Rider | post-ride | normal |
| `route_issue` | Either | post-ride | normal |
| `fare_dispute` | Rider | anytime | urgent |
| `payment_issue` | Rider | anytime | urgent |
| `pickup_dropoff` | Either | post-ride | normal |
| `lost_item` | Rider | post-ride | normal |
| `cancellation_dispute` | Either | post-ride | normal |
| **`safety_during_ride`** | Either | DURING `rides.status='active'` | **emergency** |

### Account / app (no `ride_id`)
| Category | Reporter | Default severity |
|---|---|---|
| `bug_report` | Anyone | low |
| `account_issue` | Anyone | normal |
| `harassment_messages` | Anyone | urgent |
| `feedback_feature` | Anyone | low |

Severity ladder = `emergency` → `urgent` → `normal` → `low`. Only
`emergency` triggers the Slack/email page-out; the rest just sit in
the admin inbox with the SLA badge.

## Where the in-app entry points live

| Surface | Entry point | Categories shown |
|---|---|---|
| Active ride | Existing **portal Emergency button stays unchanged for instant SOS**. A second "Report an issue" link below it routes to the report flow with in-ride category preselected. | `safety_during_ride`, `route_issue`, `pickup_dropoff` |
| Ride summary (post-ride) | "Report a problem" tile under rating widget | All ride-tied except `safety_during_ride` |
| My Rides → ride detail | Overflow menu → "Report this ride" | Same as ride summary |
| Wallet → transaction row | "Issue with this charge?" | `fare_dispute`, `payment_issue` |
| Messaging window | Overflow → "Report this user" | `harassment_messages` |
| Settings → Help | "Report a bug" / "Contact support" / "Suggest a feature" | `bug_report`, `account_issue`, `feedback_feature` |
| Settings → **My Reports** (new) | List of user's own reports with status badge | read-only list + thread view |
| Notifications page | Admin replied → tap → opens report thread | — |

**Critical:** the portal Emergency button does NOT move or change
behavior. It still hits the existing emergency endpoint immediately.
What changes: that endpoint ALSO writes a `reports` row with
`category='safety_during_ride'`, `severity='emergency'`, and captures
GPS + ride snapshot atomically.

## Data model (migration 086)

```sql
-- reports — one row per issue raised by a user
CREATE TABLE reports (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  ride_id                     uuid REFERENCES rides(id) ON DELETE SET NULL,
  schedule_id                 uuid REFERENCES ride_schedules(id) ON DELETE SET NULL,
  category                    text NOT NULL CHECK (category IN (
    'driver_conduct','rider_conduct','vehicle_condition','route_issue',
    'fare_dispute','payment_issue','pickup_dropoff','lost_item',
    'cancellation_dispute','safety_during_ride',
    'bug_report','account_issue','harassment_messages','feedback_feature'
  )),
  severity                    text NOT NULL DEFAULT 'normal'
                                CHECK (severity IN ('emergency','urgent','normal','low')),
  status                      text NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','in_progress','awaiting_user','resolved','closed')),
  title                       text NOT NULL,
  body                        text NOT NULL,
  requested_refund_cents      integer,
  ride_state_at_report        text,  -- snapshot: 'requested'|'accepted'|'active'|'completed'
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- metadata.app_version, .platform ('ios'|'web'|'android'), .gps_lat, .gps_lng,
  -- .plate, .fare_cents_at_report, .driver_id, .rider_id
  assigned_admin_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_note             text,
  resolved_at                 timestamptz,
  resolved_by                 uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status_severity ON reports (status, severity, created_at DESC);
CREATE INDEX idx_reports_reporter ON reports (reporter_id, created_at DESC);
CREATE INDEX idx_reports_subject ON reports (subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX idx_reports_ride ON reports (ride_id) WHERE ride_id IS NOT NULL;
CREATE INDEX idx_reports_emergency_open ON reports (created_at DESC)
  WHERE severity='emergency' AND status='open';  -- powers realtime banner

-- report_messages — thread (admin↔user, in-app + email replies, internal admin notes)
CREATE TABLE report_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id          uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  author_id          uuid NOT NULL REFERENCES users(id),
  author_role        text NOT NULL CHECK (author_role IN ('admin','user')),
  body               text NOT NULL,
  channel            text NOT NULL CHECK (channel IN (
    'admin_panel','email_inbound','email_outbound','in_app'
  )),
  is_internal_note   boolean NOT NULL DEFAULT false,  -- admin-only, hidden from user
  email_message_id   text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_messages_report ON report_messages (report_id, created_at);

-- report_attachments — screenshots, photos
CREATE TABLE report_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,  -- inside private bucket 'report-attachments'
  mime_type     text,
  file_size     integer,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_attachments_report ON report_attachments (report_id);

-- report_audit_log — state transitions (parallel to admin_audit_log)
CREATE TABLE report_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  admin_id    uuid NOT NULL REFERENCES users(id),
  action      text NOT NULL,  -- 'status_change','severity_change','assigned','refund_issued','user_suspended','note_added','closed_duplicate'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_audit_report ON report_audit_log (report_id, created_at);
```

### RLS

- `reports`: user SELECT/INSERT only their own (`auth.uid()=reporter_id`).
  No UPDATE/DELETE from user (admin uses service-role like every other
  admin surface).
- `report_messages`: user SELECT messages on their own report AND
  `is_internal_note=false`. INSERT only on their own report,
  `author_id=auth.uid()`, `author_role='user'`.
- `report_attachments`: user SELECT/INSERT for their own report only.
- `report_audit_log`: NO user SELECT. Service-role only.
- Storage bucket `report-attachments`: private, RLS by path prefix
  `{report_id}/...`. Server validates report ownership before issuing
  signed URLs (same model as license photos).

## Admin panel — `/admin/reports`

### Inbox `/admin/reports`

- Filter chips: **status** (open/in_progress/awaiting/resolved/closed),
  **category** (multi-select), **severity** (multi-select), **has_refund_request**,
  **my_queue**, **university**.
- Sort: newest / oldest / severity-then-newest.
- Header counter: "12 open · 3 urgent · **1 emergency**" — emergency
  count goes red and pulses when > 0.
- Row: severity dot, category badge, reporter name, subject-user name,
  ride link, time-ago, "Awaiting user" pill if status is that.

### Detail `/admin/reports/:id` (3-column layout)

**Left — Context (read-only)**
- Reporter card → links to `/admin/users/:reporter_id`
- Subject user card (if any)
- Ride snapshot: origin, dest, status, fare, payment_status, both
  party names, plate, current GPS pin on small map if `metadata.gps_lat`
- App version / platform
- Attachments grid (thumbnails → expand)

**Center — Thread**
- Chronological mix:
  - User messages (in-app or `email_inbound`)
  - Admin messages (`admin_panel`, `email_outbound`)
  - Internal admin notes (only visible to admin, yellow background)
  - Audit entries inline ("Tarun changed status to in_progress · 2m ago")
- Compose box at bottom with **Reply via:** segmented toggle
  → `in_app` (push notification + appears in user's My Reports)
  → `email` (Resend, `from: support@tagorides.com`, threaded via
     `In-Reply-To` so the user can keep replying via email and we
     ingest it via Resend's inbound webhook in Phase 6)
  → `both`

**Right — Actions**
- Status dropdown
- Severity dropdown (admin override)
- Assign to admin
- **Issue refund** → opens existing refund dialog from `UserDetailPage`,
  reuses `useAdminRefundRide`, and on success writes a `report_audit_log`
  row + creates an internal note linking the resulting transaction.
- **Suspend reported user** → reuses existing suspend flow
- **Add internal note** (yellow background, admin-only)
- **Close as duplicate** → links to another report id

### Realtime emergency banner

A top-level `/admin/*` layout component subscribes to Supabase
Realtime on `reports WHERE severity='emergency' AND status='open'`.
On a new row: a red banner pins above the page with reporter name,
ride link, and an **🚨 Acknowledge** button that flips status to
`in_progress` and writes an audit row.

## Alert pipeline — Slack + email

```
POST /api/reports  (severity='emergency')
  │
  ├─ INSERT into reports
  ├─ INSERT into report_audit_log
  │
  └─ fire-and-forget: server/lib/adminAlerts.ts
       │
       ├─ slackWebhook.send(blockKit) → #tago-alerts in Slack workspace
       │     payload: reporter, ride link, GPS link, severity, body, "Open in admin" deep link
       │
       └─ resend.sendEmailToMany({
              from: 'alerts@tagorides.com',
              to: ADMIN_ALERT_EMAILS,
              subject: '🚨 TAGO EMERGENCY: ride <id8>',
              html: <full report body + attachments + deep link>,
            })
```

Both channels are independent so one failure doesn't block the other.
Both are fire-and-forget (don't await in the request path — log
failures and move on).

### New env vars

```
SLACK_ALERTS_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxxxx
ADMIN_ALERT_EMAILS=tarungautam.us@gmail.com   # CSV
```

Both must be set on EC2 prod env. If `SLACK_ALERTS_WEBHOOK_URL` is
missing, the Slack call is silently skipped (logged warning, doesn't
crash the report-create endpoint). Same for `ADMIN_ALERT_EMAILS`.

### Slack setup (one-time)

See `## Slack incoming webhook setup` in the chat log of 2026-05-20.
Short version:
1. https://api.slack.com/apps → Create New App → From scratch.
2. Incoming Webhooks → Activate → Add New Webhook → pick `#tago-alerts`.
3. Copy URL → drop into EC2 `.env`.
4. On phone, long-press `#tago-alerts` → All new messages.
5. `pm2 restart all` so `tsx watch` re-reads env (per memory: env
   changes need explicit restart).

## Phased build plan

Every phase ships at production polish. No MVPs.

### Phase 1 — Schema + write path
- Migration 086 (4 tables + RLS + indexes).
- Private Supabase Storage bucket `report-attachments` with RLS by path.
- Server routes:
  - `POST /api/reports` (validate JWT, body, capture metadata)
  - `GET /api/reports/me` (paginated, user's own)
  - `GET /api/reports/:id` (user can see their own; thread + attachments)
  - `POST /api/reports/:id/messages` (user replies)
  - `POST /api/reports/:id/attachments` (signed-URL upload flow)
- Unit + integration tests for each route.

### Phase 2 — In-app reporting UI
- Shared `ReportFlowSheet` (category picker → form → review → submit).
  BottomSheet pattern (already in `components/ui/`).
- Wire entry points: Active Ride, Ride Summary, My Rides detail,
  Wallet row, Settings → Help, Messaging overflow.
- "My Reports" page in Settings:
  - List paginated, status badges
  - Detail view with thread + send-message box
  - Notification when admin replies
- Analytics events: `report_opened`, `report_submitted`,
  `report_message_sent`, `report_marked_resolved_by_user`.

### Phase 3 — Admin panel inbox + detail
- `/admin/reports` (filters / sort / counts).
- `/admin/reports/:id` 3-column detail.
- Thread compose with in_app vs email reply toggle.
- Refund / suspend actions reuse existing endpoints; on success,
  write `report_audit_log` and post an internal note.
- Add Reports as a top-level admin nav item.
- Tests at server-route layer (matching `adminUserBoardRoutines.test.ts`
  style).

### Phase 4 — Alert plumbing
- `server/lib/slackWebhook.ts` (Block Kit payload, fire-and-forget).
- `server/lib/adminAlerts.ts` (orchestrator: routes by severity).
- Hook into POST `/api/reports`.
- Realtime banner in `/admin/*` layout (Supabase Realtime subscription).
- Acknowledge endpoint `POST /api/admin/reports/:id/ack`.

### Phase 5 — Active-ride emergency wiring
- The existing portal Emergency button now ALSO writes a `reports`
  row pre-filled with `category='safety_during_ride'`, severity=
  `emergency`, GPS, ride snapshot, both party IDs. The existing
  emergency behavior (whatever else it does today) is preserved
  unchanged.
- iOS native port mirrors the web flow. Per iOS protocol
  (memory: `feedback_ios_rebuild_protocol.md`), built in a separate
  session against Tarun's paired iPhone, not the simulator.

### Phase 6 — Email reply ingestion

**Phase 6a (shipped 2026-05-22):** outbound admin email reply.
Compose box exposes `Reply via: in_app | email | both`. Email
sends via Resend with `Reply-To: reports+<reportId>@tagorides.com`
so the user's reply lands back on a tagged address we can route
without parsing email threading headers.

**Phase 6b (shipped 2026-05-22):** Resend inbound webhook handler
at `POST /api/webhooks/resend-inbound`. Steps:

1. **DNS** — set MX records on `tagorides.com` pointing at Resend's
   inbound MX hosts. Resend's dashboard generates the exact entries
   per region; we sit in `us-east-1` so it's typically
   `feedback-smtp.us-east-1.amazonses.com` priority 10 (Resend
   relays through SES). DKIM + SPF records also required for
   deliverability. **One-time manual step.**
2. **Resend dashboard** — under "Webhooks → Inbound", add a route:
   - Pattern: `reports+*@tagorides.com`
   - Destination: `https://www.tagorides.com/api/webhooks/resend-inbound`
   - Generate signing secret → copy into `RESEND_WEBHOOK_SECRET`
     env var on EC2 + restart `pm2 reload tago`.
3. **Endpoint behavior** (already shipped — `server/routes/webhooks/
   resendInbound.ts`):
   - Verifies Svix-style HMAC signature (`svix-signature` /
     `resend-signature` headers, base64-decoded secret, `<msgId>.<ts>.<body>`
     signing input).
   - Parses report id from `To: reports+<uuid>@tagorides.com`.
     Rejects mismatched domains as spoofing defense.
   - Verifies sender email matches the reporter's email on file
     (random outsider can't inject into someone else's thread).
   - Strips quoted reply text + mobile signatures so the thread
     row stores only the user's new content. Heuristic — handles
     `On <date>, ... wrote:`, `> `-prefixed lines, Outlook's
     `-----Original Message-----`, and `Sent from my iPhone` style
     footers.
   - Inserts `report_messages` with `channel='email_inbound'`,
     `author_role='user'`. Dedupes against `email_message_id` so
     a Resend retry can't double-insert.
   - Flips status `awaiting_user` → `in_progress` (mirrors the
     in-app reply path).
   - Slack-pings admin via the existing `notifyAdminOfUserReply`
     dispatcher on emergency/urgent severities.
4. **Local dev** — leave `RESEND_WEBHOOK_SECRET` empty; the
   endpoint skips signature checks and logs a warning. POST a
   simulated payload to `localhost:3001/api/webhooks/resend-inbound`
   with `Content-Type: application/json` to exercise the path.

Lets Tarun reply from his Gmail inbox and have it thread back into
the report.

Estimated cadence: Phases 1+2+3 each ~one focused session, Phase 4 =
half session, Phase 5 = half session, Phase 6 = follow-up after the
rest is stable.

## What stays unchanged

- Portal Emergency button position, behavior, and dom mounting.
- The QR-scan ride start/end pattern.
- Existing refund endpoint and `useAdminRefundRide` hook.
- Existing admin user-detail page (Phase 3 just adds a sibling
  `/admin/reports`).
- Existing `wallet_apply_delta` atomic primitive (refund-from-report
  reuses it).
- Stripe Connect flow, FCM push infrastructure, JWT middleware.

## Out of scope (v1)

- Twilio SMS / Voice. Slack + email cover the channel mix; can add
  later if we miss alerts.
- PagerDuty. Overkill at solo-admin scale.
- FCM push to admin device for alerts. Slack handles this — Slack push
  notifications are reliable enough on a single admin's phone.
- ML triage / auto-categorization.
- Per-category SLAs surfaced in the user app ("we respond in 24h").
- Public status page.
