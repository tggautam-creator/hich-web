// @vitest-environment node
/**
 * Slice 1.8 — global admin audit log endpoint tests.
 *
 *   GET /api/admin/audit-log?limit=&offset=&action=&admin_id=&target_user_id=
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: { getUser: vi.fn() },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'
const VALID_UUID_1 = '11111111-1111-4111-8111-111111111111'
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222'

interface AuditRow {
  id: string
  admin_id: string
  target_user_id: string | null
  action: string
  payload: Record<string, unknown>
  created_at: string
}

interface SetupOpts {
  isAdmin?: boolean
  rows?: AuditRow[]
  total?: number
  users?: Array<{ id: string; email: string }>
}

const lastFilters: Record<string, string | null> = {}

function setup(opts: SetupOpts = {}) {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  const rows = opts.rows ?? []
  const total = opts.total ?? rows.length
  Object.keys(lastFilters).forEach((k) => delete lastFilters[k])

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: isAdmin }, error: null }),
              }),
            }
          }
          // hydration lookup .select('id, email').in('id', [...])
          return {
            in: () => Promise.resolve({ data: opts.users ?? [], error: null }),
          }
        },
        update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      }
    }
    if (table === 'admin_audit_log') {
      // Filter-recording chainable thenable. .order().range().eq().is()
      // can all appear; only the final await matters.
      const chain: Record<string, unknown> = {
        order: () => chain,
        range: () => chain,
        eq: (col: string, val: unknown) => {
          lastFilters[col] = String(val)
          return chain
        },
        is: (col: string, val: unknown) => {
          lastFilters[col + '_is'] = String(val)
          return chain
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: rows, count: total, error: null }),
      }
      return { select: () => chain }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

function mkRow(over: Partial<AuditRow>): AuditRow {
  return {
    id: over.id ?? 'a-1',
    admin_id: over.admin_id ?? ADMIN_UID,
    target_user_id: over.target_user_id === undefined ? VALID_UUID_1 : over.target_user_id,
    action: over.action ?? 'send_push',
    payload: over.payload ?? { title: 'hi' },
    created_at: over.created_at ?? '2026-05-17T10:00:00Z',
  }
}

describe('GET /api/admin/audit-log — permission gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/audit-log')
    expect(res.status).toBe(401)
  })

  it('returns 403 NOT_AN_ADMIN when user is_admin=false', async () => {
    setup({ isAdmin: false })
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })
})

describe('GET /api/admin/audit-log — shape + hydration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array with zero total when nothing matches', async () => {
    setup({ rows: [], total: 0 })
    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.audit).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.distinct_actions).toEqual([])
  })

  it('hydrates admin_email + target_email from users lookup', async () => {
    setup({
      rows: [mkRow({ admin_id: ADMIN_UID, target_user_id: VALID_UUID_1, action: 'send_push' })],
      total: 1,
      users: [
        { id: ADMIN_UID, email: 'admin@tagorides.com' },
        { id: VALID_UUID_1, email: 'rider@davis.edu' },
      ],
    })

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(res.body.audit[0].admin_email).toBe('admin@tagorides.com')
    expect(res.body.audit[0].target_email).toBe('rider@davis.edu')
  })

  it('target_email is null for broadcast rows (target_user_id null)', async () => {
    setup({
      rows: [mkRow({ target_user_id: null, action: 'send_campaign_push' })],
      total: 1,
      users: [{ id: ADMIN_UID, email: 'admin@tagorides.com' }],
    })

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', VALID_JWT)

    expect(res.body.audit[0].target_user_id).toBeNull()
    expect(res.body.audit[0].target_email).toBeNull()
  })

  it('returns distinct_actions list from the current page', async () => {
    setup({
      rows: [
        mkRow({ id: 'a1', action: 'send_push' }),
        mkRow({ id: 'a2', action: 'grant_wallet_credit' }),
        mkRow({ id: 'a3', action: 'send_push' }),
      ],
      total: 3,
    })

    const res = await request(app)
      .get('/api/admin/audit-log')
      .set('Authorization', VALID_JWT)

    expect(res.body.distinct_actions.sort()).toEqual(['grant_wallet_credit', 'send_push'])
  })
})

describe('GET /api/admin/audit-log — filter validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 INVALID_ADMIN_ID on malformed admin_id UUID', async () => {
    setup()
    const res = await request(app)
      .get('/api/admin/audit-log?admin_id=not-a-uuid')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ADMIN_ID')
  })

  it('400 INVALID_TARGET_USER_ID on malformed target_user_id (but accepts "null")', async () => {
    setup()
    const bad = await request(app)
      .get('/api/admin/audit-log?target_user_id=garbage')
      .set('Authorization', VALID_JWT)
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('INVALID_TARGET_USER_ID')

    const good = await request(app)
      .get('/api/admin/audit-log?target_user_id=null')
      .set('Authorization', VALID_JWT)
    expect(good.status).toBe(200)
    expect(lastFilters['target_user_id_is']).toBe('null')
  })

  it('applies action + admin_id + target_user_id filters server-side', async () => {
    setup({
      rows: [mkRow({ action: 'force_cancel_ride' })],
      total: 1,
      users: [
        { id: ADMIN_UID, email: 'admin@tagorides.com' },
        { id: VALID_UUID_2, email: 'rider@davis.edu' },
      ],
    })

    const res = await request(app)
      .get(`/api/admin/audit-log?action=force_cancel_ride&admin_id=${ADMIN_UID}&target_user_id=${VALID_UUID_2}`)
      .set('Authorization', VALID_JWT)

    expect(res.status).toBe(200)
    expect(lastFilters['action']).toBe('force_cancel_ride')
    expect(lastFilters['admin_id']).toBe(ADMIN_UID)
    expect(lastFilters['target_user_id']).toBe(VALID_UUID_2)
  })

  it('caps limit at 100 (200 → 100)', async () => {
    setup({ rows: [], total: 0 })
    const res = await request(app)
      .get('/api/admin/audit-log?limit=200')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(100)
  })
})
