// @vitest-environment node
/**
 * Slice 1.4 — admin broadcast push composer tests.
 *
 *   GET  /api/admin/campaigns/audience/preview
 *   POST /api/admin/campaigns/push
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockSendFcm } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn() },
  },
  mockFrom: vi.fn(),
  mockSendFcm: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcm,
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const ADMIN_UID = '00000000-0000-4000-8000-000000000aaa'

const auditInserts: Array<Record<string, unknown>> = []
const notificationInserts: Array<Array<Record<string, unknown>>> = []

interface SetupOpts {
  isAdmin?: boolean
  audienceUsers?: Array<{ id: string; email: string; full_name: string | null }>
  pushTokens?: Array<{ user_id: string; token: string }>
  fcmSentCount?: number
  notificationsInsertFails?: boolean
}

function setup(opts: SetupOpts = {}): void {
  const isAdmin = opts.isAdmin === undefined ? true : opts.isAdmin
  auditInserts.length = 0
  notificationInserts.length = 0

  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })
  mockSendFcm.mockResolvedValue(opts.fcmSentCount ?? (opts.pushTokens?.length ?? 0))

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
          // Audience resolver select. Chain ignores filters, resolves
          // with the fixture audience.
          const chain: Record<string, unknown> = {
            is: () => chain,
            eq: () => chain,
            ilike: () => chain,
            gte: () => chain,
            lt: () => chain,
            not: () => chain,
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: opts.audienceUsers ?? [], error: null }),
          }
          return chain
        },
      }
    }
    if (table === 'push_tokens') {
      return {
        select: () => ({
          in: () =>
            Promise.resolve({ data: opts.pushTokens ?? [], error: null }),
        }),
      }
    }
    if (table === 'notifications') {
      return {
        insert: (rows: Array<Record<string, unknown>>) => {
          if (opts.notificationsInsertFails) {
            return Promise.resolve({ data: null, error: { message: 'insert failed' } })
          }
          notificationInserts.push(rows)
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    if (table === 'admin_audit_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          auditInserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

// ── audience preview ────────────────────────────────────────────────────────

describe('GET /api/admin/campaigns/audience/preview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/campaigns/audience/preview?type=all_users')
    expect(res.status).toBe(401)
  })

  it('400s INVALID_AUDIENCE on unknown type', async () => {
    setup()
    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=galaxy_brain')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_AUDIENCE')
  })

  it('400s DOMAIN_REQUIRED on by_university with no domain', async () => {
    setup()
    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=by_university')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('DOMAIN_REQUIRED')
  })

  it('returns count + sample (capped at 10) on success', async () => {
    const audienceUsers = Array.from({ length: 14 }, (_, i) => ({
      id: `u${i}`,
      email: `u${i}@davis.edu`,
      full_name: `User ${i}`,
    }))
    setup({ audienceUsers })
    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=all_users')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(14)
    expect(res.body.sample_users.length).toBe(10)
    expect(res.body.audience).toEqual({ type: 'all_users' })
  })

  it('returns zero for an empty audience', async () => {
    setup({ audienceUsers: [] })
    const res = await request(app)
      .get('/api/admin/campaigns/audience/preview?type=active_last_7d')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(0)
    expect(res.body.sample_users).toEqual([])
  })
})

// ── push send ───────────────────────────────────────────────────────────────

describe('POST /api/admin/campaigns/push', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 INVALID_AUDIENCE when audience type is missing', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({ audience: {}, title: 'Hi', body: 'Test' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_AUDIENCE')
  })

  it('400 INVALID_BODY when title or body is missing', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({ audience: { type: 'all_users' }, title: 'Hi' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('400 TOO_LONG when title or body exceeds caps', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'x'.repeat(200),
        body: 'ok',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOO_LONG')
  })

  it('409 AUDIENCE_DRIFT when confirm_count disagrees with current resolution', async () => {
    setup({
      audienceUsers: [{ id: 'u1', email: 'a@x.edu', full_name: 'A' }],
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'Hi',
        body: 'Test',
        confirm_count: 5, // stale
      })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AUDIENCE_DRIFT')
    expect(res.body.previous_count).toBe(5)
    expect(res.body.current_count).toBe(1)
  })

  it('returns 200 with zero counts when audience is empty', async () => {
    setup({ audienceUsers: [] })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'dormant_30d' },
        title: 'Come back',
        body: 'We miss you',
      })
    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(0)
    expect(res.body.push_sent).toBe(0)
    expect(mockSendFcm).not.toHaveBeenCalled()
    expect(auditInserts.length).toBe(0)
  })

  it('fans out push + writes N notifications + 1 audit row on success', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@davis.edu', full_name: 'A' },
        { id: 'u2', email: 'b@davis.edu', full_name: 'B' },
        { id: 'u3', email: 'c@davis.edu', full_name: 'C' },
      ],
      pushTokens: [
        { user_id: 'u1', token: 'tokA' },
        { user_id: 'u2', token: 'tokB' },
        // u3 has no push token registered
      ],
      fcmSentCount: 2,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'by_university', domain: 'davis.edu' },
        title: 'Free credit',
        body: 'You have a $5 credit on us',
        reason: 'monthly engagement boost',
        confirm_count: 3,
      })

    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(3)
    expect(res.body.push_sent).toBe(2) // only 2 had tokens
    expect(res.body.tokens_attempted).toBe(2)
    expect(res.body.notifications_written).toBe(3) // every recipient gets an inbox row

    expect(mockSendFcm).toHaveBeenCalledOnce()
    expect(notificationInserts.length).toBe(1)
    expect(notificationInserts[0]?.length).toBe(3)
    expect(notificationInserts[0]?.[0]).toMatchObject({
      type: 'admin_broadcast',
      title: 'Free credit',
      body: 'You have a $5 credit on us',
    })

    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      target_user_id: null,
      action: 'send_campaign_push',
    })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({
      title: 'Free credit',
      body: 'You have a $5 credit on us',
      reason: 'monthly engagement boost',
      recipient_count: 3,
      push_sent: 2,
      tokens_attempted: 2,
    })
    expect((payload['audience'] as Record<string, unknown>)['type']).toBe('by_university')
  })

  it('still audits + sends push even when notifications insert fails', async () => {
    setup({
      audienceUsers: [{ id: 'u1', email: 'a@x.edu', full_name: 'A' }],
      pushTokens: [{ user_id: 'u1', token: 'tokA' }],
      fcmSentCount: 1,
      notificationsInsertFails: true,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'Hi',
        body: 'Test',
      })
    expect(res.status).toBe(200)
    expect(res.body.push_sent).toBe(1)
    expect(res.body.notifications_written).toBe(0) // insert failed
    expect(auditInserts.length).toBe(1) // audit still wrote
  })
})
