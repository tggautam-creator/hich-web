/**
 * `/api/admin/users/*` — user lookup + per-user admin surfaces.
 *
 * Sits behind the same JWT + adminAuth gate as the rest of the admin
 * router (mounted in `./index.ts`).
 *
 * Current endpoints:
 *   GET /stuck?step=&range=&mode=&limit=&offset=   (Slice 1.2)
 *     → list of users stuck at a given funnel step
 *   GET /search?q=&limit=&offset=                  (Slice 1.3a)
 *     → search users by email / full_name / phone / exact user_id
 *   GET /:id                                       (Slice 1.3a)
 *     → full profile + Overview-tab derived data
 *       (vehicle, routines count, ratings, email_verified, university)
 *
 * Future (Slice 1.3b+):
 *   GET /:id/rides         → Rides tab
 *   GET /:id/wallet        → Wallet tab
 *   GET /:id/notifications → Notifications tab
 *   GET /:id/devices       → Devices tab
 *   POST /:id/actions/*    → Admin Actions tab (audit-logged)
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { handleStuckUsers } from './funnel.ts'
import { supabaseAdmin } from '../../lib/supabaseAdmin.ts'

export const adminUsersRouter = Router()

// ── /stuck (from Slice 1.2) ──────────────────────────────────────────────────
adminUsersRouter.get('/stuck', handleStuckUsers)

// ── shared types (mirror these in src/hooks/useAdminUsers.ts) ────────────────

interface SearchHit {
  id: string
  email: string
  full_name: string | null
  is_driver: boolean
  created_at: string
  last_active_at: string | null
}

interface SearchResponse {
  ok: true
  q: string
  total: number // approximate; we cap at the queried page
  users: SearchHit[]
  limit: number
  offset: number
}

interface UserOverviewResponse {
  ok: true
  user: {
    id: string
    email: string
    phone: string | null
    full_name: string | null
    avatar_url: string | null
    is_driver: boolean
    onboarding_completed: boolean
    is_admin: boolean
    wallet_balance: number
    default_payment_method_id: string | null
    stripe_account_id: string | null
    stripe_onboarding_complete: boolean
    rating_avg: number | null
    rating_count: number
    date_of_birth: string | null
    last_active_at: string | null
    created_at: string
  }
  email_verified: boolean
  university: string
  vehicle: {
    id: string
    make: string
    model: string
    year: number
    color: string
    plate: string
  } | null
  routines_count: number
  rides_count: number
  rides_completed_count: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Returns true when `s` is a complete v4-ish UUID (matches the shape Supabase uses). */
function isFullUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/**
 * Derives a human-readable university name from an email. Curated map
 * for the schools we already see in Tago, with a graceful fallback to
 * the raw domain. Lives here (not in src/lib) so the server returns
 * a stable string the client can render without computing it.
 *
 * To add a school: drop a line in the switch. Lowercase the key.
 */
function universityFromEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 0) return ''
  const domain = email.slice(at + 1).toLowerCase()
  switch (domain) {
    case 'davis.edu':
    case 'ucdavis.edu':
      return 'UC Davis'
    case 'berkeley.edu':
    case 'ucla.edu':
    case 'ucsd.edu':
    case 'ucsc.edu':
    case 'uci.edu':
    case 'ucsb.edu':
    case 'ucr.edu':
    case 'ucmerced.edu':
      return `UC ${domain.replace('.edu', '').replace(/^uc/, '').toUpperCase()}`
    case 'stanford.edu': return 'Stanford'
    case 'mit.edu': return 'MIT'
    case 'harvard.edu': return 'Harvard'
    case 'tagorides.com': return 'Tago (admin)'
    default: return domain
  }
}

// ── GET /search ─────────────────────────────────────────────────────────────

adminUsersRouter.get(
  '/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const qRaw = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''
      const limit = Math.min(
        Math.max(parseInt(String(req.query['limit'] ?? '25'), 10) || 25, 1),
        100,
      )
      const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)

      // Empty query: return newest signups (acts as a "browse" view —
      // marketing's first visit to /admin/users shouldn't be blank).
      if (qRaw.length === 0) {
        const { data, count, error } = await supabaseAdmin
          .from('users')
          .select(
            'id, email, full_name, is_driver, created_at, last_active_at',
            { count: 'exact' },
          )
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)
        if (error) throw error
        const response: SearchResponse = {
          ok: true,
          q: '',
          total: count ?? data?.length ?? 0,
          users: (data ?? []) as SearchHit[],
          limit,
          offset,
        }
        res.status(200).json(response)
        return
      }

      // Full UUID → exact id lookup. Otherwise text match across
      // email / full_name / phone via PostgREST .or() with ILIKE.
      // Partial UUID prefix search is a known follow-up — would need
      // a SQL function with id::text ILIKE because PostgREST can't
      // cast UUID → text in ad-hoc filters.
      const q = qRaw
      if (isFullUuid(q)) {
        const { data, error } = await supabaseAdmin
          .from('users')
          .select('id, email, full_name, is_driver, created_at, last_active_at')
          .eq('id', q)
        if (error) throw error
        const response: SearchResponse = {
          ok: true,
          q,
          total: data?.length ?? 0,
          users: (data ?? []) as SearchHit[],
          limit,
          offset,
        }
        res.status(200).json(response)
        return
      }

      // Escape PostgREST `,` and `)` in the query to avoid breaking
      // the .or() syntax — neither is meaningful in an email/name/
      // phone anyway, so stripping them is harmless.
      const safe = q.replace(/[,()]/g, '')
      const pattern = `%${safe}%`
      const { data, count, error } = await supabaseAdmin
        .from('users')
        .select(
          'id, email, full_name, is_driver, created_at, last_active_at',
          { count: 'exact' },
        )
        .or(
          `email.ilike.${pattern},full_name.ilike.${pattern},phone.ilike.${pattern}`,
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      const response: SearchResponse = {
        ok: true,
        q,
        total: count ?? data?.length ?? 0,
        users: (data ?? []) as SearchHit[],
        limit,
        offset,
      }
      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id ────────────────────────────────────────────────────────────────

adminUsersRouter.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idRaw = req.params['id']
      const id = typeof idRaw === 'string' ? idRaw : ''
      if (!id || !isFullUuid(id)) {
        res.status(400).json({
          error: { code: 'INVALID_USER_ID', message: 'user id must be a UUID' },
        })
        return
      }

      // Parallel fetch — the Overview tab needs all of these on first paint.
      const [userRes, vehiclesRes, routinesRes, ridesRes, authRes] =
        await Promise.all([
          supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', id)
            .maybeSingle(),
          supabaseAdmin
            .from('vehicles')
            .select('id, make, model, year, color, plate, deleted_at')
            .eq('user_id', id)
            .is('deleted_at', null)
            .limit(1),
          supabaseAdmin
            .from('ride_schedules')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', id),
          supabaseAdmin
            .from('rides')
            .select('id, status, rider_id, driver_id'),
          supabaseAdmin.auth.admin.getUserById(id),
        ])

      if (userRes.error) throw userRes.error
      if (!userRes.data) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'user not found' },
        })
        return
      }
      if (vehiclesRes.error) throw vehiclesRes.error
      if (routinesRes.error) throw routinesRes.error
      if (ridesRes.error) throw ridesRes.error
      // authRes.error is silently swallowed — a missing auth row
      // shouldn't 500 the whole profile (e.g. dev test users created
      // via SQL without an auth shadow). email_verified just reads false.

      const u = userRes.data as UserOverviewResponse['user']
      const vehicleRow = vehiclesRes.data?.[0] ?? null
      const routinesCount = routinesRes.count ?? 0
      const rides = (ridesRes.data ?? []) as Array<{
        id: string
        status: string
        rider_id: string
        driver_id: string | null
      }>
      const ridesCount = rides.filter(
        (r) => r.rider_id === id || r.driver_id === id,
      ).length
      const ridesCompletedCount = rides.filter(
        (r) =>
          r.status === 'completed' &&
          (r.rider_id === id || r.driver_id === id),
      ).length

      const emailVerified = !!authRes?.data?.user?.email_confirmed_at

      const response: UserOverviewResponse = {
        ok: true,
        user: u,
        email_verified: emailVerified,
        university: universityFromEmail(u.email),
        vehicle: vehicleRow
          ? {
              id: vehicleRow.id,
              make: vehicleRow.make,
              model: vehicleRow.model,
              year: vehicleRow.year,
              color: vehicleRow.color,
              plate: vehicleRow.plate,
            }
          : null,
        routines_count: routinesCount,
        rides_count: ridesCount,
        rides_completed_count: ridesCompletedCount,
      }
      res.status(200).json(response)
    } catch (err) {
      next(err)
    }
  },
)

// ──────────────────────────────────────────────────────────────────────────────
// Slice 1.3b — per-user read-only tab endpoints (rides / wallet /
// notifications / devices). All paginated except /devices (one row
// per user post-migration 009, so pagination is pointless).
//
// Permissions: inherited from adminRouter — JWT + adminAuth gate.
// All endpoints return 400 INVALID_USER_ID for non-UUID :id values.
// ──────────────────────────────────────────────────────────────────────────────

function parsePaging(req: Request, defaultLimit = 25): { limit: number; offset: number } {
  const limit = Math.min(
    Math.max(parseInt(String(req.query['limit'] ?? defaultLimit), 10) || defaultLimit, 1),
    100,
  )
  const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0)
  return { limit, offset }
}

function parseUserIdParam(req: Request, res: Response): string | null {
  const raw = req.params['id']
  const id = typeof raw === 'string' ? raw : ''
  if (!id || !isFullUuid(id)) {
    res.status(400).json({
      error: { code: 'INVALID_USER_ID', message: 'user id must be a UUID' },
    })
    return null
  }
  return id
}

// ── GET /:id/rides ──────────────────────────────────────────────────────────

interface UserRideRow {
  id: string
  status: string
  role: 'rider' | 'driver'
  other_party_id: string | null
  origin_name: string | null
  destination_name: string | null
  fare_cents: number | null
  created_at: string
  ended_at: string | null
}

adminUsersRouter.get(
  '/:id/rides',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const { data, count, error } = await supabaseAdmin
        .from('rides')
        .select(
          'id, status, rider_id, driver_id, origin_name, destination_name, fare_cents, created_at, ended_at',
          { count: 'exact' },
        )
        .or(`rider_id.eq.${id},driver_id.eq.${id}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      const rows: UserRideRow[] = (data ?? []).map((r) => ({
        id: r.id,
        status: r.status,
        role: r.rider_id === id ? 'rider' : 'driver',
        other_party_id: r.rider_id === id ? r.driver_id : r.rider_id,
        origin_name: r.origin_name,
        destination_name: r.destination_name,
        fare_cents: r.fare_cents,
        created_at: r.created_at,
        ended_at: r.ended_at,
      }))

      res.status(200).json({
        ok: true,
        rides: rows,
        total: count ?? rows.length,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/wallet ─────────────────────────────────────────────────────────

interface WalletTxnRow {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  pm_brand: string | null
  pm_last4: string | null
  pm_wallet: string | null
  ride_id: string | null
  created_at: string
  transfer_id: string | null
  transfer_paid_at: string | null
}

adminUsersRouter.get(
  '/:id/wallet',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const [userRes, txRes] = await Promise.all([
        supabaseAdmin
          .from('users')
          .select('wallet_balance')
          .eq('id', id)
          .maybeSingle(),
        supabaseAdmin
          .from('transactions')
          .select(
            'id, type, amount_cents, balance_after_cents, description, pm_brand, pm_last4, pm_wallet, ride_id, created_at, transfer_id, transfer_paid_at',
            { count: 'exact' },
          )
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1),
      ])
      if (userRes.error) throw userRes.error
      if (!userRes.data) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'user not found' },
        })
        return
      }
      if (txRes.error) throw txRes.error

      res.status(200).json({
        ok: true,
        wallet_balance_cents: userRes.data.wallet_balance,
        transactions: (txRes.data ?? []) as WalletTxnRow[],
        total: txRes.count ?? txRes.data?.length ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/notifications ──────────────────────────────────────────────────

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

adminUsersRouter.get(
  '/:id/notifications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return
      const { limit, offset } = parsePaging(req)

      const { data, count, error } = await supabaseAdmin
        .from('notifications')
        .select('id, type, title, body, is_read, created_at', { count: 'exact' })
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (error) throw error

      res.status(200).json({
        ok: true,
        notifications: (data ?? []) as NotificationRow[],
        total: count ?? data?.length ?? 0,
        limit,
        offset,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ── GET /:id/devices ────────────────────────────────────────────────────────

interface DeviceRow {
  id: string
  token_suffix: string // last 8 chars only — full token is enough to send a push
  platform: 'ios' | 'android' | 'web' | null
  created_at: string
}

adminUsersRouter.get(
  '/:id/devices',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseUserIdParam(req, res)
      if (!id) return

      const { data, error } = await supabaseAdmin
        .from('push_tokens')
        .select('id, token, platform, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
      if (error) throw error

      const rows: DeviceRow[] = (data ?? []).map((d) => ({
        id: d.id,
        token_suffix: d.token.slice(-8),
        platform: d.platform,
        created_at: d.created_at,
      }))
      res.status(200).json({
        ok: true,
        devices: rows,
        total: rows.length,
      })
    } catch (err) {
      next(err)
    }
  },
)
