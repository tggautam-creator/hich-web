// @vitest-environment node
/**
 * Slice 0.3 — adminAuth middleware tests.
 *
 * Verifies the JWT + is_admin permission gate for `/api/admin/*`.
 * Hits the live `GET /api/admin/ping` endpoint (added in the same
 * slice) end-to-end through Express so the routing + middleware
 * order match what runs in prod.
 *
 * Permission matrix tested:
 *   - No Authorization header              → 401 MISSING_TOKEN  (validateJwt fires)
 *   - Bad JWT                              → 401 INVALID_TOKEN  (validateJwt fires)
 *   - Valid JWT, user not found            → 403 NOT_AN_ADMIN   (adminAuth fires)
 *   - Valid JWT, users.is_admin=false      → 403 NOT_AN_ADMIN
 *   - Valid JWT, users.is_admin=true       → 200 ok=true
 *   - Valid JWT but Supabase lookup errors → 500 ADMIN_LOOKUP_FAILED
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

function authAsUser(userId = 'user-123') {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/** Wires `from('users').select('is_admin').eq('id', ...).maybeSingle()` to a value. */
function mockAdminLookup(result: { data: { is_admin: boolean } | null; error: { message: string } | null }) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(result),
      }),
    }),
  })
}

describe('adminAuth middleware (via GET /api/admin/ping)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).get('/api/admin/ping')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when the JWT is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'bad token' },
    })
    const res = await request(app)
      .get('/api/admin/ping')
      .set('Authorization', 'Bearer not.a.real.token')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('returns 403 NOT_AN_ADMIN when the user has no public.users row', async () => {
    authAsUser('user-no-row')
    // maybeSingle returns data=null when no row matches
    mockAdminLookup({ data: null, error: null })

    const res = await request(app).get('/api/admin/ping').set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })

  it('returns 403 NOT_AN_ADMIN when users.is_admin is false', async () => {
    authAsUser('user-not-admin')
    mockAdminLookup({ data: { is_admin: false }, error: null })

    const res = await request(app).get('/api/admin/ping').set('Authorization', VALID_JWT)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_AN_ADMIN')
  })

  it('returns 200 with admin payload when users.is_admin is true', async () => {
    authAsUser('user-is-admin')
    mockAdminLookup({ data: { is_admin: true }, error: null })

    const res = await request(app).get('/api/admin/ping').set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.is_admin).toBe(true)
    expect(res.body.user_id).toBe('user-is-admin')
    expect(typeof res.body.server_time).toBe('string')
  })

  it('returns 500 ADMIN_LOOKUP_FAILED when the Supabase query errors', async () => {
    authAsUser('user-db-error')
    mockAdminLookup({ data: null, error: { message: 'connection refused' } })

    const res = await request(app).get('/api/admin/ping').set('Authorization', VALID_JWT)
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('ADMIN_LOOKUP_FAILED')
  })
})
