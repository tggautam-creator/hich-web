-- 086_reports_v2.sql (2026-05-20)
--
-- Phase 1 of the reporting & issue-tracking redesign — see
-- docs/REPORTS_PLAN.md. Extends the minimal `reports` table from
-- migration 039 into a full-featured triage system, and adds three
-- companion tables (`report_messages`, `report_attachments`,
-- `report_audit_log`) plus a private storage bucket for screenshots
-- / photos.
--
-- Backwards compatibility:
--   * The existing iOS build (ReportSafetyEndpoint) and the web
--     RideReportPage / EmergencySheet all POST to /api/report with
--     `{ category, description, ride_id }`. The server route
--     (server/routes/report.ts) is updated in the same change-set
--     to keep accepting that shape; this migration renames the
--     underlying columns (`user_id` → `reporter_id`,
--     `description` → `body`) but the API contract stays
--     permissive so deployed iOS keeps working.
--   * Existing category strings are remapped to the new taxonomy
--     via UPDATEs below BEFORE the new CHECK constraint is added,
--     so live rows don't violate the constraint.

-- ── 1. reports table — column rename + new columns ───────────────────
ALTER TABLE public.reports RENAME COLUMN user_id    TO reporter_id;
ALTER TABLE public.reports RENAME COLUMN description TO body;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS title                  text,
  ADD COLUMN IF NOT EXISTS severity               text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('emergency','urgent','normal','low')),
  ADD COLUMN IF NOT EXISTS status                 text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','awaiting_user','resolved','closed')),
  ADD COLUMN IF NOT EXISTS subject_user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_id            uuid REFERENCES public.ride_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_refund_cents integer,
  ADD COLUMN IF NOT EXISTS ride_state_at_report   text,
  ADD COLUMN IF NOT EXISTS metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_admin_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note        text,
  ADD COLUMN IF NOT EXISTS resolved_at            timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();

-- ── 2. Backfill `title` for existing rows ─────────────────────────────
-- The old schema had no title; derive one from category + first 40
-- chars of body so the column can be made NOT NULL safely.
UPDATE public.reports
   SET title = INITCAP(REPLACE(COALESCE(category, 'report'), '_', ' '))
 WHERE title IS NULL;

ALTER TABLE public.reports ALTER COLUMN title SET NOT NULL;

-- ── 3. Remap legacy category strings into the new taxonomy ────────────
-- Web RideReportPage shipped: driver_behavior / rider_behavior /
-- payment / safety / bug.
-- Web EmergencySheet shipped: unsafe_driving / inappropriate_behavior /
-- wrong_route / no_show / other.
-- iOS SafetyReportCategory shipped: free-form strings matching whatever
-- the iOS enum raw value was at build time. We collapse all of these
-- into the canonical Phase-1 taxonomy.
UPDATE public.reports SET category = 'driver_conduct'      WHERE category = 'driver_behavior';
UPDATE public.reports SET category = 'rider_conduct'       WHERE category = 'rider_behavior';
UPDATE public.reports SET category = 'payment_issue'       WHERE category = 'payment';
UPDATE public.reports SET category = 'safety_during_ride'  WHERE category IN (
  'safety','unsafe_driving','inappropriate_behavior'
);
UPDATE public.reports SET category = 'route_issue'         WHERE category IN (
  'wrong_route'
);
UPDATE public.reports SET category = 'cancellation_dispute' WHERE category IN (
  'no_show'
);
UPDATE public.reports SET category = 'bug_report'          WHERE category = 'bug';
UPDATE public.reports SET category = 'feedback_feature'    WHERE category = 'other';

-- Anything left over (future iOS categories we haven't enumerated, or
-- ad-hoc strings) gets bucketed as feedback_feature so the CHECK
-- doesn't fail. Adjust later if we discover specific stragglers.
UPDATE public.reports SET category = 'feedback_feature'
 WHERE category NOT IN (
   'driver_conduct','rider_conduct','vehicle_condition','route_issue',
   'fare_dispute','payment_issue','pickup_dropoff','lost_item',
   'cancellation_dispute','safety_during_ride',
   'bug_report','account_issue','harassment_messages','feedback_feature'
 );

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_category_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_category_check CHECK (category IN (
    'driver_conduct','rider_conduct','vehicle_condition','route_issue',
    'fare_dispute','payment_issue','pickup_dropoff','lost_item',
    'cancellation_dispute','safety_during_ride',
    'bug_report','account_issue','harassment_messages','feedback_feature'
  ));

-- ── 4. Indexes ───────────────────────────────────────────────────────
-- Inbox: filter by status+severity, ordered by recency.
CREATE INDEX IF NOT EXISTS idx_reports_status_severity
  ON public.reports (status, severity, created_at DESC);

-- "My reports" page for end-users.
CREATE INDEX IF NOT EXISTS idx_reports_reporter
  ON public.reports (reporter_id, created_at DESC);

-- Cross-link: every report attached to a particular subject user
-- (e.g. how many open complaints does this driver have?). Partial
-- because the column is nullable for non-interpersonal reports.
CREATE INDEX IF NOT EXISTS idx_reports_subject
  ON public.reports (subject_user_id)
  WHERE subject_user_id IS NOT NULL;

-- Per-ride: list every report tied to a specific ride.
CREATE INDEX IF NOT EXISTS idx_reports_ride
  ON public.reports (ride_id)
  WHERE ride_id IS NOT NULL;

-- Phase 4 realtime banner: cheap polling on "any open emergencies?"
CREATE INDEX IF NOT EXISTS idx_reports_emergency_open
  ON public.reports (created_at DESC)
  WHERE severity = 'emergency' AND status = 'open';

-- ── 5. updated_at trigger ────────────────────────────────────────────
-- Bumps automatically on any UPDATE so admin inbox sort-by-recent
-- reflects the most recent activity (status change, internal note,
-- thread message).
CREATE OR REPLACE FUNCTION public.reports_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reports_updated_at ON public.reports;
CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.reports_set_updated_at();

-- ── 6. Refresh RLS to use the new column name ────────────────────────
DROP POLICY IF EXISTS "users can view own reports" ON public.reports;

CREATE POLICY reports_select_own ON public.reports
  FOR SELECT
  TO authenticated
  USING (auth.uid() = reporter_id);

-- Inserts continue to go through the server route (service-role),
-- which is the only path that can populate `metadata` / `severity`
-- correctly. No INSERT policy exposed to end-users.

-- ── 7. report_messages — admin↔user thread + internal notes ──────────
CREATE TABLE IF NOT EXISTS public.report_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  author_id         uuid NOT NULL REFERENCES public.users(id),
  author_role       text NOT NULL CHECK (author_role IN ('admin','user')),
  body              text NOT NULL,
  channel           text NOT NULL CHECK (channel IN (
    'admin_panel','email_inbound','email_outbound','in_app'
  )),
  is_internal_note  boolean NOT NULL DEFAULT false,
  email_message_id  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_messages_report
  ON public.report_messages (report_id, created_at);

ALTER TABLE public.report_messages ENABLE ROW LEVEL SECURITY;

-- Users see non-internal messages on their own reports. Internal
-- notes are hidden from the user even when joined to their report.
CREATE POLICY report_messages_select_own ON public.report_messages
  FOR SELECT
  TO authenticated
  USING (
    is_internal_note = false
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = report_id AND r.reporter_id = auth.uid()
    )
  );

-- Users can post their own replies on their own reports. The server
-- route enforces author_role='user' + is_internal_note=false too.
CREATE POLICY report_messages_insert_own ON public.report_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND author_role = 'user'
    AND is_internal_note = false
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = report_id AND r.reporter_id = auth.uid()
    )
  );

-- ── 8. report_attachments — screenshots / photos ─────────────────────
CREATE TABLE IF NOT EXISTS public.report_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  mime_type     text,
  file_size     integer,
  uploaded_by   uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_attachments_report
  ON public.report_attachments (report_id);

ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_attachments_select_own ON public.report_attachments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = report_id AND r.reporter_id = auth.uid()
    )
  );

CREATE POLICY report_attachments_insert_own ON public.report_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id = report_id AND r.reporter_id = auth.uid()
    )
  );

-- ── 9. report_audit_log — admin-only forensic record ─────────────────
CREATE TABLE IF NOT EXISTS public.report_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  admin_id    uuid NOT NULL REFERENCES public.users(id),
  action      text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_audit_report
  ON public.report_audit_log (report_id, created_at);

ALTER TABLE public.report_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies — service-role-only access. End users never see this.

-- ── 10. Storage bucket for attachments ───────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('report-attachments', 'report-attachments', false)
  ON CONFLICT (id) DO NOTHING;

-- Path convention: `{report_id}/{uuid}.{ext}`. RLS verifies the
-- folder matches a report owned by the requester.
DROP POLICY IF EXISTS "report attachments select own" ON storage.objects;
CREATE POLICY "report attachments select own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'report-attachments'
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id::text = split_part(name, '/', 1)
         AND r.reporter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "report attachments insert own" ON storage.objects;
CREATE POLICY "report attachments insert own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'report-attachments'
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id::text = split_part(name, '/', 1)
         AND r.reporter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "report attachments delete own" ON storage.objects;
CREATE POLICY "report attachments delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'report-attachments'
    AND EXISTS (
      SELECT 1 FROM public.reports r
       WHERE r.id::text = split_part(name, '/', 1)
         AND r.reporter_id = auth.uid()
    )
  );

-- ── 11. Column comments — searchable documentation ───────────────────
COMMENT ON COLUMN public.reports.severity IS
  'Auto-assigned at insert based on category; admin can override. ''emergency'' triggers Slack + email alert pipeline (Phase 4).';

COMMENT ON COLUMN public.reports.metadata IS
  'Server-captured context at report time: app_version, platform, gps_lat, gps_lng, plate, fare_cents_at_report, rider_id, driver_id. Frozen after insert.';

COMMENT ON COLUMN public.report_messages.is_internal_note IS
  'TRUE = admin-only note, hidden from the reporter even on their own report. Used for ops triage notes (e.g. "linked to refund tx_xyz").';

COMMENT ON COLUMN public.report_audit_log.action IS
  'One of: status_change, severity_change, assigned, refund_issued, user_suspended, note_added, closed_duplicate, ack_emergency.';
