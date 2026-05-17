/**
 * Slice 1.2 — User funnel breakdown.
 *
 * The marketing team wants to see where new users drop off between
 * "signed up" and "completed first ride" so we can target re-engagement.
 *
 * Funnel steps (in order):
 *   1. signed_up           — public.users row exists
 *   2. verified_email      — auth.users.email_confirmed_at IS NOT NULL
 *   3. completed_profile   — users.onboarding_completed = true
 *   4. payment_or_vehicle  — riders: default_payment_method_id present
 *                            drivers: at least one non-deleted vehicle
 *                            both:    whichever applies based on is_driver
 *   5. completed_first_ride — at least one ride with status='completed'
 *                             in the user's role (rider/driver) — or
 *                             in either role when mode='both'.
 *
 * A user is "stuck at step X" iff they reached every prior step but
 * not step X. The drill-down list (`/users/stuck`) returns these
 * users sorted newest-first so outreach can prioritise warm leads.
 *
 * Filters:
 *   - range: 7d | 30d | 90d | all   (cohort = users.created_at within range)
 *   - mode:  rider | driver | both  (filters cohort by is_driver, also
 *                                    decides whether step 4 looks at
 *                                    payment_method vs vehicle)
 *
 * Data fetched per request (cheap while user/ride counts are small,
 * same TS-aggregate pattern as Slice 1.1's /overview):
 *   - public.users for the cohort
 *   - auth.users via supabase auth admin API for email_confirmed_at
 *   - vehicles (id, user_id) where deleted_at IS NULL
 *   - rides (id, status, rider_id, driver_id) where status='completed'
 *     and at least one party is in the cohort
 *
 * When the dataset grows past ~10k users we'll swap the in-memory
 * aggregate for a Postgres function. Until then, single file.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminFunnelRouter = Router()

// ── public types (mirror these in src/hooks/useAdminFunnel.ts) ───────────────

export type FunnelStep =
  | 'signed_up'
  | 'verified_email'
  | 'completed_profile'
  | 'payment_or_vehicle'
  | 'completed_first_ride'

export type FunnelRange = '7d' | '30d' | '90d' | 'all'
export type FunnelMode = 'rider' | 'driver' | 'both'

interface FunnelStepResult {
  key: FunnelStep
  label: string
  count: number
  drop_off_from_previous_pct: number | null // null for the first step
  drop_off_from_top_pct: number | null      // null for the first step
}

interface FunnelResponse {
  ok: true
  range: FunnelRange
  mode: FunnelMode
  steps: FunnelStepResult[]
  total_in_cohort: number
  generated_at: string
}

interface StuckUser {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  created_at: string
  days_since_signup: number
}

interface StuckUsersResponse {
  ok: true
  step: FunnelStep
  range: FunnelRange
  mode: FunnelMode
  total: number
  users: StuckUser[]
  limit: number
  offset: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function parseRange(raw: unknown): FunnelRange {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === 'all') return raw
  return '30d' // sensible default — what marketing usually wants
}

function parseMode(raw: unknown): FunnelMode {
  if (raw === 'rider' || raw === 'driver' || raw === 'both') return raw
  return 'both'
}

function cohortCutoff(range: FunnelRange, now: Date): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

const STEP_LABELS: Record<FunnelStep, string> = {
  signed_up: 'Signed up',
  verified_email: 'Verified email',
  completed_profile: 'Completed profile',
  payment_or_vehicle: 'Added payment method / vehicle',
  completed_first_ride: 'Completed first ride',
}

const STEP_ORDER: FunnelStep[] = [
  'signed_up',
  'verified_email',
  'completed_profile',
  'payment_or_vehicle',
  'completed_first_ride',
]

/**
 * Computes the maximum step each user in the cohort reached.
 * Returns a Map<userId, maxStepIndex>. Index 0 = signed_up (everyone
 * in the cohort), index 4 = completed_first_ride.
 *
 * Shared between /funnel (counts the histogram) and /users/stuck
 * (filters to users whose max-step is one less than the queried step).
 */
async function computeFunnelData(
  range: FunnelRange,
  mode: FunnelMode,
): Promise<{
  cohort: Array<{
    id: string
    email: string
    full_name: string | null
    is_driver: boolean
    onboarding_completed: boolean
    default_payment_method_id: string | null
    created_at: string
  }>
  maxStepByUserId: Map<string, number>
}> {
  const cutoff = cohortCutoff(range, new Date())

  // 1. Cohort = public.users filtered by created_at + (optionally) is_driver
  let cohortQuery = supabaseAdmin
    .from('users')
    .select(
      'id, email, full_name, is_driver, onboarding_completed, default_payment_method_id, created_at',
    )
  if (cutoff) cohortQuery = cohortQuery.gte('created_at', cutoff)
  if (mode === 'rider') cohortQuery = cohortQuery.eq('is_driver', false)
  if (mode === 'driver') cohortQuery = cohortQuery.eq('is_driver', true)

  const { data: cohortRaw, error: cohortErr } = await cohortQuery
  if (cohortErr) throw cohortErr
  const cohort = cohortRaw ?? []
  const cohortIds = new Set(cohort.map((u) => u.id))

  if (cohort.length === 0) {
    return { cohort, maxStepByUserId: new Map() }
  }

  // 2. Email verification status. Use the supabase auth admin API
  // because supabase-js doesn't let us SELECT from the auth schema
  // directly. Paginates at 1000/page; loop until empty for safety
  // but cap at 20 pages (20k users) — anything beyond that means we
  // should switch to a SQL function with a JOIN to auth.users.
  const verifiedIds = new Set<string>()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw error
    const users = data?.users ?? []
    if (users.length === 0) break
    for (const u of users) {
      if (u.email_confirmed_at && cohortIds.has(u.id)) verifiedIds.add(u.id)
    }
    if (users.length < 1000) break
  }

  // 3. Vehicles (drivers only). One row per (user, vehicle); we just
  // need "does the user have at least one non-deleted vehicle?".
  const driversWithVehicle = new Set<string>()
  if (mode !== 'rider') {
    const { data: vehicles, error: vehErr } = await supabaseAdmin
      .from('vehicles')
      .select('user_id, deleted_at')
      .is('deleted_at', null)
    if (vehErr) throw vehErr
    for (const v of vehicles ?? []) {
      if (cohortIds.has(v.user_id)) driversWithVehicle.add(v.user_id)
    }
  }

  // 4. Completed rides. For each cohort user, track whether they
  // completed at least one ride in their role.
  const completedAsRider = new Set<string>()
  const completedAsDriver = new Set<string>()
  if (cohort.length > 0) {
    const { data: rides, error: rideErr } = await supabaseAdmin
      .from('rides')
      .select('rider_id, driver_id, status')
      .eq('status', 'completed')
    if (rideErr) throw rideErr
    for (const r of rides ?? []) {
      if (r.rider_id && cohortIds.has(r.rider_id)) completedAsRider.add(r.rider_id)
      if (r.driver_id && cohortIds.has(r.driver_id)) completedAsDriver.add(r.driver_id)
    }
  }

  // 5. Per-user max-step index. We walk steps in order; a user's
  // max-step is the highest contiguous step they satisfy. Stopping
  // at the first failure preserves funnel semantics (no skipping).
  const maxStepByUserId = new Map<string, number>()
  for (const u of cohort) {
    let max = 0 // everyone in cohort is at least signed_up
    if (verifiedIds.has(u.id)) {
      max = 1
      if (u.onboarding_completed) {
        max = 2
        const passedStep3 = userPassedPaymentOrVehicle(u, driversWithVehicle, mode)
        if (passedStep3) {
          max = 3
          const passedStep4 = userPassedCompletedRide(
            u,
            completedAsRider,
            completedAsDriver,
            mode,
          )
          if (passedStep4) max = 4
        }
      }
    }
    maxStepByUserId.set(u.id, max)
  }

  return { cohort, maxStepByUserId }
}

function userPassedPaymentOrVehicle(
  u: { id: string; is_driver: boolean; default_payment_method_id: string | null },
  driversWithVehicle: Set<string>,
  mode: FunnelMode,
): boolean {
  if (mode === 'rider') return u.default_payment_method_id !== null
  if (mode === 'driver') return driversWithVehicle.has(u.id)
  // both: which thing the user needed depends on their role
  return u.is_driver
    ? driversWithVehicle.has(u.id)
    : u.default_payment_method_id !== null
}

function userPassedCompletedRide(
  u: { id: string; is_driver: boolean },
  completedAsRider: Set<string>,
  completedAsDriver: Set<string>,
  mode: FunnelMode,
): boolean {
  if (mode === 'rider') return completedAsRider.has(u.id)
  if (mode === 'driver') return completedAsDriver.has(u.id)
  return u.is_driver
    ? completedAsDriver.has(u.id)
    : completedAsRider.has(u.id)
}

// ── routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/metrics/funnel?range=30d&mode=both
 *
 * Returns step counts + drop-off % between consecutive steps + drop-off %
 * from the top of the funnel. Single round trip.
 */
adminFunnelRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const range = parseRange(req.query['range'])
      const mode = parseMode(req.query['mode'])
      const { cohort, maxStepByUserId } = await computeFunnelData(range, mode)

      // Step counts: how many users reached AT LEAST this step
      const stepCounts = STEP_ORDER.map((_step, idx) =>
        Array.from(maxStepByUserId.values()).filter((max) => max >= idx).length,
      )

      const topCount = stepCounts[0] ?? 0
      const steps: FunnelStepResult[] = STEP_ORDER.map((key, idx) => {
        const count = stepCounts[idx] ?? 0
        const prev = idx === 0 ? null : stepCounts[idx - 1] ?? 0
        const dropPrev =
          prev === null || prev === 0
            ? null
            : ((prev - count) / prev) * 100
        const dropTop =
          idx === 0 || topCount === 0
            ? null
            : ((topCount - count) / topCount) * 100
        return {
          key,
          label: STEP_LABELS[key],
          count,
          drop_off_from_previous_pct: dropPrev,
          drop_off_from_top_pct: dropTop,
        }
      })

      const response: FunnelResponse = {
        ok: true,
        range,
        mode,
        steps,
        total_in_cohort: cohort.length,
        generated_at: new Date().toISOString(),
      }
      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

// ── /users/stuck (mounted under adminUsersRouter, but the logic lives ──────
//    here because it shares the funnel computation. Exported for the
//    users sub-router to wire up.)

export async function handleStuckUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const range = parseRange(req.query['range'])
    const mode = parseMode(req.query['mode'])
    const stepRaw = req.query['step']
    if (!STEP_ORDER.includes(stepRaw as FunnelStep)) {
      res.status(400).json({
        error: {
          code: 'INVALID_STEP',
          message: `step must be one of: ${STEP_ORDER.join(', ')}`,
        },
      })
      return
    }
    const step = stepRaw as FunnelStep
    const stepIdx = STEP_ORDER.indexOf(step)

    const limit = Math.min(
      Math.max(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 1),
      200,
    )
    const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

    const { cohort, maxStepByUserId } = await computeFunnelData(range, mode)

    // "Stuck at step X" = reached step X-1 but NOT step X.
    // For step 'signed_up' (idx 0) there's nothing prior — return empty
    // (signed_up isn't a stuck-able step, everyone in cohort reached it).
    const stuckUsers = cohort.filter((u) => {
      const max = maxStepByUserId.get(u.id) ?? 0
      if (stepIdx === 0) return false
      return max === stepIdx - 1
    })

    // Sort newest-signup-first so outreach hits warm leads.
    stuckUsers.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

    const total = stuckUsers.length
    const now = Date.now()
    const page = stuckUsers.slice(offset, offset + limit).map((u): StuckUser => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      is_driver: u.is_driver,
      created_at: u.created_at,
      days_since_signup: Math.floor(
        (now - new Date(u.created_at).getTime()) / DAY_MS,
      ),
    }))

    const response: StuckUsersResponse = {
      ok: true,
      step,
      range,
      mode,
      total,
      users: page,
      limit,
      offset,
    }
    res.status(200).json(response)
  } catch (err) {
    next(err)
  }
}
