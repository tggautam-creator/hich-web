// @vitest-environment node
/**
 * 2026-05-20 — Phase 1 of the reports & issue-tracking system.
 *
 *   POST /api/report
 *   GET  /api/report/me
 *   GET  /api/report/:id
 *   POST /api/report/:id/messages
 *   POST /api/report/:id/attachments
 *
 * The mock here intercepts every `supabaseAdmin.from(table)` call and
 * returns a per-table chain whose terminator can be `.single()`,
 * `.maybeSingle()`, `.range()`, or a bare `await` (head:true count
 * queries). Each test sets only the chains it needs and uses
 * `expect.extend`-style assertions for the outputs.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn() },
  },
  mockFrom: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))

import { app } from '../../../server/app.ts'

const VALID_JWT = 'Bearer valid.jwt.token'
const USER_UUID = '11111111-1111-1111-1111-111111111111'
const OTHER_USER_UUID = '22222222-2222-2222-2222-222222222222'
const REPORT_UUID = '33333333-3333-3333-3333-333333333333'
const RIDE_UUID = '44444444-4444-4444-4444-444444444444'
const ATTACHMENT_ID = '55555555-5555-5555-5555-555555555555'

function authAsUser(uid = USER_UUID) {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: uid } },
    error: null,
  })
}

// ── Chain helpers ──────────────────────────────────────────────────

interface Resolution<T = unknown> {
  data: T | null
  count?: number
  error: null | { message: string }
}

/** Chain that resolves to a single row via `.maybeSingle()` or `.single()`. */
function singleChain<T>(payload: T | null) {
  const out: Resolution<T> = { data: payload, error: null }
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(out),
    single: () => Promise.resolve(out),
  }
  return chain
}

/** Chain that resolves an array list via `.range()` or bare await. */
function listChain(payload: unknown[], count?: number) {
  const out: Resolution<unknown[]> = { data: payload, count: count ?? payload.length, error: null }
  const chain: Record<string, unknown> & PromiseLike<typeof out> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => Promise.resolve(out),
    then: <T1, T2 = never>(
      onFulfilled?: ((v: typeof out) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) => Promise.resolve(out).then(onFulfilled, onRejected),
  }
  return chain
}

/** Chain that captures the insert payload + responds with a synthetic id. */
function insertChain<T>(
  capture: { payload: unknown },
  responseRow: T,
) {
  const out: Resolution<T> = { data: responseRow, error: null }
  const chain: Record<string, unknown> = {
    select: () => chain,
    single: () => Promise.resolve(out),
  }
  return {
    insert: (p: unknown) => {
      capture.payload = p
      return chain
    },
  }
}

/** Chain that captures an update payload + resolves to no-op. */
function updateChain(capture: { payload: unknown }) {
  return {
    update: (p: unknown) => {
      capture.payload = p
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      }
    },
  }
}

// ──────────────────────────────────────────────────────────────────

describe('POST /api/report', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/report').send({ category: 'bug_report', body: 'short report' })
    expect(res.status).toBe(401)
  })

  it('returns 400 missing category', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({ body: 'I have a bug report here' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MISSING_FIELD')
  })

  it('returns 400 on unknown category', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({ category: 'totally_made_up', body: 'description body here' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CATEGORY')
  })

  it('returns 400 when body shorter than 10 chars (legacy `description` alias)', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({ category: 'bug_report', description: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MISSING_FIELD')
  })

  it('returns 400 on invalid refund amount', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({
        category: 'fare_dispute',
        body: 'overcharged for this ride significantly',
        requested_refund_cents: 9999999,
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_REFUND_AMOUNT')
  })

  it('maps legacy category driver_behavior → driver_conduct with default severity', async () => {
    authAsUser()
    const capture: { payload: unknown } = { payload: null }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return insertChain(capture, {
          id: REPORT_UUID,
          severity: 'normal',
          status: 'open',
        })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({ category: 'driver_behavior', description: 'driver was rude and unsafe' })
    expect(res.status).toBe(201)
    expect(res.body.severity).toBe('normal')
    const captured = capture.payload as { category: string; severity: string; title: string }
    expect(captured.category).toBe('driver_conduct')
    expect(captured.title).toBe('Driver conduct report')
  })

  it('legacy "safety" category forces severity = emergency regardless of client', async () => {
    authAsUser()
    const capture: { payload: unknown } = { payload: null }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return insertChain(capture, {
          id: REPORT_UUID,
          severity: 'emergency',
          status: 'open',
        })
      }
      if (table === 'rides') {
        return singleChain({
          status: 'active',
          fare_cents: 750,
          rider_id: USER_UUID,
          driver_id: OTHER_USER_UUID,
          vehicle_id: null,
        })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post('/api/report')
      .set('Authorization', VALID_JWT)
      .send({
        category: 'safety',
        description: 'driver swerving aggressively right now',
        ride_id: RIDE_UUID,
      })
    expect(res.status).toBe(201)
    expect(res.body.severity).toBe('emergency')
    const captured = capture.payload as {
      category: string; severity: string;
      ride_state_at_report: string;
      metadata: { fare_cents: number; rider_id: string }
    }
    expect(captured.category).toBe('safety_during_ride')
    expect(captured.severity).toBe('emergency')
    expect(captured.ride_state_at_report).toBe('active')
    expect(captured.metadata.fare_cents).toBe(750)
    expect(captured.metadata.rider_id).toBe(USER_UUID)
  })
})

describe('GET /api/report/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/report/me')
    expect(res.status).toBe(401)
  })

  it('returns paginated reports for caller', async () => {
    authAsUser()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return listChain([
          {
            id: REPORT_UUID,
            category: 'bug_report',
            severity: 'low',
            status: 'open',
            title: 'Bug report',
            body: 'something is broken',
            ride_id: null,
            schedule_id: null,
            subject_user_id: null,
            requested_refund_cents: null,
            ride_state_at_report: null,
            created_at: '2026-05-20T10:00:00Z',
            updated_at: '2026-05-20T10:00:00Z',
            resolved_at: null,
          },
        ], 1)
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app).get('/api/report/me').set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.reports[0].id).toBe(REPORT_UUID)
  })
})

describe('GET /api/report/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on non-UUID id', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app).get('/api/report/not-a-uuid').set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ID')
  })

  it('returns 404 when report belongs to another user (no info leak)', async () => {
    authAsUser()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return singleChain({
          id: REPORT_UUID,
          reporter_id: OTHER_USER_UUID,
          category: 'bug_report',
          severity: 'low',
          status: 'open',
          title: 'Bug',
          body: 'not yours',
          ride_id: null,
          schedule_id: null,
          subject_user_id: null,
          requested_refund_cents: null,
          ride_state_at_report: null,
          metadata: {},
          created_at: '',
          updated_at: '',
          resolved_at: null,
        })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .get(`/api/report/${REPORT_UUID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('returns own report with messages + attachments', async () => {
    authAsUser()
    let reportCalls = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        reportCalls++
        return singleChain({
          id: REPORT_UUID,
          reporter_id: USER_UUID,
          category: 'fare_dispute',
          severity: 'urgent',
          status: 'open',
          title: 'Fare dispute',
          body: 'charged twice',
          ride_id: RIDE_UUID,
          schedule_id: null,
          subject_user_id: null,
          requested_refund_cents: 500,
          ride_state_at_report: 'completed',
          metadata: { gps_lat: 38.5 },
          created_at: '2026-05-20T10:00:00Z',
          updated_at: '2026-05-20T10:00:00Z',
          resolved_at: null,
        })
      }
      if (table === 'report_messages') {
        return listChain([
          {
            id: 'msg1',
            author_id: USER_UUID,
            author_role: 'user',
            body: 'help please',
            channel: 'in_app',
            created_at: '2026-05-20T10:05:00Z',
          },
        ])
      }
      if (table === 'report_attachments') {
        return listChain([
          {
            id: ATTACHMENT_ID,
            storage_path: `${REPORT_UUID}/uuid.png`,
            mime_type: 'image/png',
            file_size: 12345,
            uploaded_by: USER_UUID,
            created_at: '2026-05-20T10:06:00Z',
          },
        ])
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .get(`/api/report/${REPORT_UUID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.report.id).toBe(REPORT_UUID)
    // reporter_id is stripped from the response body (already verified)
    expect(res.body.report.reporter_id).toBeUndefined()
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.attachments).toHaveLength(1)
    expect(reportCalls).toBe(1)
  })
})

describe('POST /api/report/:id/messages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 on empty body', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: '' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MISSING_FIELD')
  })

  it('returns 404 when report not owned', async () => {
    authAsUser()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return singleChain({
          id: REPORT_UUID,
          reporter_id: OTHER_USER_UUID,
          status: 'open',
        })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'hello?' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when report is closed', async () => {
    authAsUser()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return singleChain({
          id: REPORT_UUID,
          reporter_id: USER_UUID,
          status: 'closed',
        })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'hi' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REPORT_CLOSED')
  })

  it('inserts message + flips awaiting_user → in_progress', async () => {
    authAsUser()
    const capturedInsert: { payload: unknown } = { payload: null }
    const capturedUpdate: { payload: unknown } = { payload: null }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        // First call (own check) → singleChain. Second call (update)
        // → updateChain. Pick which based on call order:
        if (capturedInsert.payload === null) {
          return {
            select: () => singleChain({
              id: REPORT_UUID,
              reporter_id: USER_UUID,
              status: 'awaiting_user',
            }),
            ...updateChain(capturedUpdate),
          }
        }
        return updateChain(capturedUpdate)
      }
      if (table === 'report_messages') {
        return insertChain(capturedInsert, { id: 'msg-1', created_at: '2026-05-20T10:00:00Z' })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'replying back to admin' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('msg-1')
    expect((capturedInsert.payload as { body: string }).body).toBe('replying back to admin')
    expect((capturedUpdate.payload as { status: string }).status).toBe('in_progress')
  })
})

describe('POST /api/report/:id/attachments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 missing storage_path', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/attachments`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MISSING_FIELD')
  })

  it('rejects storage_path that does not start with report id', async () => {
    authAsUser()
    mockFrom.mockImplementation(() => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }))
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/attachments`)
      .set('Authorization', VALID_JWT)
      .send({ storage_path: 'other-report/file.png' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PATH')
  })

  it('inserts an attachment row on success', async () => {
    authAsUser()
    const capture: { payload: unknown } = { payload: null }
    mockFrom.mockImplementation((table: string) => {
      if (table === 'reports') {
        return singleChain({ id: REPORT_UUID, reporter_id: USER_UUID })
      }
      if (table === 'report_attachments') {
        return insertChain(capture, { id: ATTACHMENT_ID, created_at: '2026-05-20T10:00:00Z' })
      }
      if (table === 'users') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unmocked from(${table})`)
    })
    const res = await request(app)
      .post(`/api/report/${REPORT_UUID}/attachments`)
      .set('Authorization', VALID_JWT)
      .send({
        storage_path: `${REPORT_UUID}/uuid.png`,
        mime_type: 'image/png',
        file_size: 12345,
      })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(ATTACHMENT_ID)
    expect((capture.payload as { storage_path: string }).storage_path).toBe(
      `${REPORT_UUID}/uuid.png`,
    )
  })
})
