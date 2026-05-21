import { Router } from 'express'
import type { Request, Response } from 'express'
import { validateJwt } from '../middleware/auth.ts'
import { supabaseAdmin } from '../lib/supabaseAdmin.ts'

/**
 * 2026-05-20 — Phase 1 of the reports & issue-tracking system
 * (docs/REPORTS_PLAN.md).
 *
 * Routes:
 *   POST /api/report                       — create a report
 *   GET  /api/report/me                    — paginated list of caller's reports
 *   GET  /api/report/:id                   — caller's single report + thread + attachments
 *   POST /api/report/:id/messages          — caller posts a reply
 *   POST /api/report/:id/attachments       — record a previously-uploaded attachment
 *
 * Backwards compatibility: the deployed iOS build (build 7) and the
 * web RideReportPage / EmergencySheet all POST `{ category,
 * description, ride_id }`. Migration 086 renamed `description` →
 * `body`, but this route accepts EITHER field name so existing
 * clients keep working without an App Store update. Legacy category
 * strings are mapped to the new taxonomy here as well.
 *
 * Severity is auto-assigned from category. `safety_during_ride`
 * always becomes `emergency` regardless of what the client sends —
 * the in-ride emergency path can't be downgraded by an honest
 * mistake or by a bad-actor client.
 */
export const reportRouter = Router()

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * Pulls the `:id` param and returns it as a validated UUID string, or
 * sends a 400 response and returns null. Express v5 types the param
 * as `string | string[]`; this collapses that to plain `string`.
 */
function parseReportIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'report id must be a UUID' } })
    return null
  }
  return id
}

const ALLOWED_CATEGORIES = [
  'driver_conduct',
  'rider_conduct',
  'vehicle_condition',
  'route_issue',
  'fare_dispute',
  'payment_issue',
  'pickup_dropoff',
  'lost_item',
  'cancellation_dispute',
  'safety_during_ride',
  'bug_report',
  'account_issue',
  'harassment_messages',
  'feedback_feature',
] as const
type Category = (typeof ALLOWED_CATEGORIES)[number]

/**
 * Maps legacy category strings (web pre-2026-05-20, iOS build 7) to
 * the canonical taxonomy. Anything that isn't a recognised legacy
 * value falls through to the caller's string; the
 * isAllowedCategory() check then 400s if it's still not valid.
 */
const LEGACY_CATEGORY_MAP: Record<string, Category> = {
  driver_behavior: 'driver_conduct',
  rider_behavior: 'rider_conduct',
  payment: 'payment_issue',
  safety: 'safety_during_ride',
  unsafe_driving: 'safety_during_ride',
  inappropriate_behavior: 'safety_during_ride',
  wrong_route: 'route_issue',
  no_show: 'cancellation_dispute',
  bug: 'bug_report',
  other: 'feedback_feature',
}

function normaliseCategory(raw: string): Category | null {
  const trimmed = raw.trim()
  if (trimmed in LEGACY_CATEGORY_MAP) return LEGACY_CATEGORY_MAP[trimmed] as Category
  if ((ALLOWED_CATEGORIES as readonly string[]).includes(trimmed)) {
    return trimmed as Category
  }
  return null
}

/**
 * Default severity per category. `safety_during_ride` is hard-coded
 * to `emergency` in the insert path so a buggy client can't downgrade
 * it; the value here is for completeness.
 */
const DEFAULT_SEVERITY: Record<Category, 'emergency' | 'urgent' | 'normal' | 'low'> = {
  driver_conduct: 'normal',
  rider_conduct: 'normal',
  vehicle_condition: 'normal',
  route_issue: 'normal',
  fare_dispute: 'urgent',
  payment_issue: 'urgent',
  pickup_dropoff: 'normal',
  lost_item: 'normal',
  cancellation_dispute: 'normal',
  safety_during_ride: 'emergency',
  bug_report: 'low',
  account_issue: 'normal',
  harassment_messages: 'urgent',
  feedback_feature: 'low',
}

const TITLE_FALLBACK: Record<Category, string> = {
  driver_conduct: 'Driver conduct report',
  rider_conduct: 'Rider conduct report',
  vehicle_condition: 'Vehicle condition report',
  route_issue: 'Route issue',
  fare_dispute: 'Fare dispute',
  payment_issue: 'Payment issue',
  pickup_dropoff: 'Pickup / dropoff issue',
  lost_item: 'Lost item',
  cancellation_dispute: 'Cancellation dispute',
  safety_during_ride: 'Safety concern during ride',
  bug_report: 'Bug report',
  account_issue: 'Account issue',
  harassment_messages: 'Harassment via messages',
  feedback_feature: 'Feedback / feature request',
}

/**
 * Best-effort platform guess from User-Agent when the client doesn't
 * supply one in the body. Not security-critical (clients can spoof
 * it) — used only for ops triage colour-coding.
 */
function inferPlatform(ua: string | undefined): 'ios' | 'android' | 'web' | 'unknown' {
  if (!ua) return 'unknown'
  if (/Tago-iOS|CFNetwork.*Darwin/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Mozilla|Chrome|Safari|Edge/.test(ua)) return 'web'
  return 'unknown'
}

interface IncomingMetadata {
  app_version?: string
  platform?: 'ios' | 'android' | 'web'
  gps_lat?: number
  gps_lng?: number
}

interface RideSnapshot {
  status?: string
  fare_cents?: number | null
  rider_id?: string
  driver_id?: string | null
  plate?: string | null
}

/**
 * Pulls the snapshot we want to freeze on every ride-tied report.
 * Returns an empty object if the ride doesn't exist or isn't
 * accessible — we still let the report through; metadata is best-
 * effort, not load-bearing.
 */
async function loadRideSnapshot(rideId: string): Promise<{
  state: string | null
  metadata: RideSnapshot
}> {
  try {
    const { data, error } = await supabaseAdmin
      .from('rides')
      .select('status, fare_cents, rider_id, driver_id, vehicle_id')
      .eq('id', rideId)
      .maybeSingle()
    if (error || !data) return { state: null, metadata: {} }
    let plate: string | null = null
    if (data.vehicle_id) {
      const { data: vehicleRow } = await supabaseAdmin
        .from('vehicles')
        .select('plate')
        .eq('id', data.vehicle_id)
        .maybeSingle()
      plate = vehicleRow?.plate ?? null
    }
    return {
      state: data.status ?? null,
      metadata: {
        status: data.status,
        fare_cents: data.fare_cents,
        rider_id: data.rider_id,
        driver_id: data.driver_id,
        plate,
      },
    }
  } catch {
    return { state: null, metadata: {} }
  }
}

// ── POST / — create a report ────────────────────────────────────────
reportRouter.post('/', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string | undefined
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'User session missing' } })
    return
  }

  const raw = req.body as {
    category?: unknown
    title?: unknown
    body?: unknown
    description?: unknown // legacy alias, see header doc
    ride_id?: unknown
    subject_user_id?: unknown
    schedule_id?: unknown
    requested_refund_cents?: unknown
    metadata?: unknown
  }

  if (typeof raw.category !== 'string' || raw.category.trim() === '') {
    res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'category is required' } })
    return
  }
  const category = normaliseCategory(raw.category)
  if (!category) {
    res.status(400).json({
      error: { code: 'INVALID_CATEGORY', message: `unknown category "${raw.category}"` },
    })
    return
  }

  // Accept either `body` (new) or `description` (legacy) — favour body.
  const bodyText = (typeof raw.body === 'string' && raw.body.trim()) ||
                    (typeof raw.description === 'string' && raw.description.trim()) || ''
  if (bodyText.length < 10) {
    res.status(400).json({
      error: { code: 'MISSING_FIELD', message: 'body must be at least 10 characters' },
    })
    return
  }

  const titleText = (typeof raw.title === 'string' && raw.title.trim())
    || TITLE_FALLBACK[category]
  if (titleText.length > 200) {
    res.status(400).json({
      error: { code: 'INVALID_FIELD', message: 'title must be at most 200 characters' },
    })
    return
  }

  const rideId = typeof raw.ride_id === 'string' && UUID_RE.test(raw.ride_id) ? raw.ride_id : null
  const subjectUserId = typeof raw.subject_user_id === 'string' && UUID_RE.test(raw.subject_user_id)
    ? raw.subject_user_id : null
  const scheduleId = typeof raw.schedule_id === 'string' && UUID_RE.test(raw.schedule_id)
    ? raw.schedule_id : null

  let refundCents: number | null = null
  if (raw.requested_refund_cents !== undefined && raw.requested_refund_cents !== null) {
    const n = Number(raw.requested_refund_cents)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_00) {
      res.status(400).json({
        error: {
          code: 'INVALID_REFUND_AMOUNT',
          message: 'requested_refund_cents must be an integer between 0 and 100000',
        },
      })
      return
    }
    refundCents = n
  }

  const incomingMeta: IncomingMetadata = (raw.metadata && typeof raw.metadata === 'object')
    ? raw.metadata as IncomingMetadata
    : {}

  // Always upgrade safety_during_ride to emergency severity — clients
  // can't downgrade it. Other categories use the default ladder.
  const severity = category === 'safety_during_ride'
    ? 'emergency' as const
    : DEFAULT_SEVERITY[category]

  // Snapshot the ride state when a ride is attached so the report
  // captures the moment-in-time view, not the live ride. Best-effort.
  let rideState: string | null = null
  let rideMetadata: RideSnapshot = {}
  if (rideId) {
    const snap = await loadRideSnapshot(rideId)
    rideState = snap.state
    rideMetadata = snap.metadata
  }

  const metadata = {
    app_version: typeof incomingMeta.app_version === 'string' ? incomingMeta.app_version : null,
    platform: incomingMeta.platform ?? inferPlatform(req.get('user-agent') ?? undefined),
    gps_lat: typeof incomingMeta.gps_lat === 'number' ? incomingMeta.gps_lat : null,
    gps_lng: typeof incomingMeta.gps_lng === 'number' ? incomingMeta.gps_lng : null,
    ...rideMetadata,
  }

  const { data, error } = await supabaseAdmin.from('reports').insert({
    reporter_id: userId,
    subject_user_id: subjectUserId,
    ride_id: rideId,
    schedule_id: scheduleId,
    category,
    severity,
    status: 'open',
    title: titleText,
    body: bodyText,
    requested_refund_cents: refundCents,
    ride_state_at_report: rideState,
    metadata,
  }).select('id, severity, status').single()

  if (error || !data) {
    console.error('[report] insert error:', error?.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to save report' } })
    return
  }

  res.status(201).json({
    ok: true,
    id: data.id,
    severity: data.severity,
    status: data.status,
  })
})

// ── GET /me — caller's own reports, paginated ───────────────────────
interface ReportRow {
  id: string
  category: string
  severity: string
  status: string
  title: string
  body: string
  ride_id: string | null
  schedule_id: string | null
  subject_user_id: string | null
  requested_refund_cents: number | null
  ride_state_at_report: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

reportRouter.get('/me', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string

  const limit = Math.min(
    Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
    100,
  )
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

  const { data, count, error } = await supabaseAdmin
    .from('reports')
    .select(
      'id, category, severity, status, title, body, ride_id, schedule_id, subject_user_id, requested_refund_cents, ride_state_at_report, created_at, updated_at, resolved_at',
      { count: 'exact' },
    )
    .eq('reporter_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) {
    console.error('[report] /me fetch:', error.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load reports' } })
    return
  }

  res.status(200).json({
    ok: true,
    reports: (data ?? []) as ReportRow[],
    total: count ?? 0,
    limit,
    offset,
  })
})

// ── GET /:id — caller's single report + thread + attachments ────────
reportRouter.get('/:id', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const id = parseReportIdParam(req, res)
  if (!id) return

  // Ownership check + report fetch in one round-trip.
  const { data: report, error: reportErr } = await supabaseAdmin
    .from('reports')
    .select(
      'id, category, severity, status, title, body, ride_id, schedule_id, subject_user_id, requested_refund_cents, ride_state_at_report, metadata, created_at, updated_at, resolved_at, reporter_id',
    )
    .eq('id', id)
    .maybeSingle()
  if (reportErr) {
    console.error('[report] /:id fetch:', reportErr.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load report' } })
    return
  }
  if (!report || report.reporter_id !== userId) {
    // 404 instead of 403 so we don't leak the existence of someone
    // else's report id.
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
    return
  }

  const [messagesRes, attachmentsRes] = await Promise.all([
    supabaseAdmin
      .from('report_messages')
      .select('id, author_id, author_role, body, channel, created_at')
      .eq('report_id', id)
      .eq('is_internal_note', false)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('report_attachments')
      .select('id, storage_path, mime_type, file_size, uploaded_by, created_at')
      .eq('report_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (messagesRes.error) {
    console.error('[report] messages fetch:', messagesRes.error.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load thread' } })
    return
  }
  if (attachmentsRes.error) {
    console.error('[report] attachments fetch:', attachmentsRes.error.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to load attachments' } })
    return
  }

  // Strip reporter_id from the response — we already verified it
  // matches and exposing it adds no value to a self-view.
  const { reporter_id: _ignored, ...reportPublic } = report
  void _ignored

  res.status(200).json({
    ok: true,
    report: reportPublic,
    messages: messagesRes.data ?? [],
    attachments: attachmentsRes.data ?? [],
  })
})

// ── POST /:id/messages — caller replies to admin ────────────────────
reportRouter.post('/:id/messages', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const id = parseReportIdParam(req, res)
  if (!id) return

  const { body: replyBody } = req.body as { body?: unknown }
  if (typeof replyBody !== 'string' || replyBody.trim().length < 1) {
    res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'body is required' } })
    return
  }
  if (replyBody.length > 5000) {
    res.status(400).json({
      error: { code: 'INVALID_FIELD', message: 'body must be at most 5000 characters' },
    })
    return
  }

  const { data: report, error: ownErr } = await supabaseAdmin
    .from('reports')
    .select('id, reporter_id, status')
    .eq('id', id)
    .maybeSingle()
  if (ownErr) {
    console.error('[report] /messages own check:', ownErr.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to verify report' } })
    return
  }
  if (!report || report.reporter_id !== userId) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
    return
  }
  if (report.status === 'closed') {
    res.status(409).json({
      error: { code: 'REPORT_CLOSED', message: 'This report is closed and cannot accept new messages' },
    })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('report_messages')
    .insert({
      report_id: id,
      author_id: userId,
      author_role: 'user',
      channel: 'in_app',
      is_internal_note: false,
      body: replyBody.trim(),
    })
    .select('id, created_at')
    .single()
  if (error || !data) {
    console.error('[report] message insert:', error?.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to post reply' } })
    return
  }

  // Bump the parent report so admin inbox sort-by-recent reflects
  // the user reply. updated_at trigger handles this on any UPDATE,
  // so an empty UPDATE is the cheapest way to fire it. If the
  // report was awaiting_user, flip it back to in_progress so admin
  // sees a fresh row.
  await supabaseAdmin
    .from('reports')
    .update({
      status: report.status === 'awaiting_user' ? 'in_progress' : report.status,
    })
    .eq('id', id)

  res.status(201).json({ ok: true, id: data.id, created_at: data.created_at })
})

// ── POST /:id/attachments — record a previously-uploaded file ───────
//
// Phase-1 upload flow: the client uploads directly to Supabase
// Storage at `report-attachments/{report_id}/{uuid}.{ext}` using
// their own auth session (storage RLS enforces ownership). This
// endpoint then records the file in `report_attachments` so the
// admin panel can list it. We deliberately don't generate signed
// URLs server-side in v1 — the storage-bucket RLS is sufficient and
// keeps the path simpler.
reportRouter.post('/:id/attachments', validateJwt, async (req: Request, res: Response) => {
  const userId = res.locals['userId'] as string
  const id = parseReportIdParam(req, res)
  if (!id) return

  const { storage_path, mime_type, file_size } = req.body as {
    storage_path?: unknown
    mime_type?: unknown
    file_size?: unknown
  }
  if (typeof storage_path !== 'string' || storage_path.trim().length === 0) {
    res.status(400).json({ error: { code: 'MISSING_FIELD', message: 'storage_path is required' } })
    return
  }
  // Enforce path convention `{report_id}/...` so the storage RLS and
  // this server check stay in sync.
  if (!storage_path.startsWith(`${id}/`)) {
    res.status(400).json({
      error: { code: 'INVALID_PATH', message: 'storage_path must start with the report id followed by /' },
    })
    return
  }

  const { data: report, error: ownErr } = await supabaseAdmin
    .from('reports')
    .select('id, reporter_id')
    .eq('id', id)
    .maybeSingle()
  if (ownErr) {
    console.error('[report] /attachments own check:', ownErr.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to verify report' } })
    return
  }
  if (!report || report.reporter_id !== userId) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found' } })
    return
  }

  const { data, error } = await supabaseAdmin
    .from('report_attachments')
    .insert({
      report_id: id,
      uploaded_by: userId,
      storage_path,
      mime_type: typeof mime_type === 'string' ? mime_type : null,
      file_size: typeof file_size === 'number' && Number.isFinite(file_size) ? file_size : null,
    })
    .select('id, created_at')
    .single()
  if (error || !data) {
    console.error('[report] attachment insert:', error?.message)
    res.status(500).json({ error: { code: 'DB_ERROR', message: 'Failed to save attachment' } })
    return
  }

  res.status(201).json({ ok: true, id: data.id, created_at: data.created_at })
})
