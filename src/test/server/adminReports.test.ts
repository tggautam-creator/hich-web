// @vitest-environment node
/**
 * 2026-05-22 — Phase 3b of docs/REPORTS_PLAN.md tests.
 *
 *   GET  /api/admin/reports/:id
 *   POST /api/admin/reports/:id/messages
 *
 * Locks the admin-side response shape (including internal notes —
 * critical that this endpoint returns them, since the user-facing
 * `/api/report/:id` filters them out) and the auto-flip behavior
 * where an admin reply to an `open` report transitions it to
 * `awaiting_user`.
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
const ADMIN_UID = 'admin-uid-aaaa-bbbb-cccc-dddddddddddd'
const REPORT_ID = '11111111-1111-1111-1111-111111111111'
const REPORTER_ID = '22222222-2222-2222-2222-222222222222'
const RIDE_ID = '33333333-3333-3333-3333-333333333333'

function authAsAdmin() {
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: ADMIN_UID } },
    error: null,
  })
}

interface DetailMocks {
  reportRow?: Record<string, unknown> | null
  messages?: unknown[]
  attachments?: unknown[]
  reporterRow?: Record<string, unknown> | null
  /** When provided, `subject_user_id` on the report is non-null. */
  subjectRow?: Record<string, unknown> | null
  rideRow?: Record<string, unknown> | null
  /** Captured by the insert mock for POST /messages tests. */
  insertCapture?: { payload: unknown }
  /** Captured by the update mock when the admin reply flips status. */
  updateCapture?: { payload: unknown }
  /** Result returned from report_messages insert.single(). */
  insertResponse?: Record<string, unknown>
}

function setupAdminMocks(opts: DetailMocks): void {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      const reporter = opts.reporterRow
      return {
        select: (cols: string) => {
          if (cols === 'is_admin') {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { is_admin: true }, error: null }),
              }),
            }
          }
          // Detail-side fetch on reporter / subject. Match by id.
          return {
            eq: (_col: string, id: string) => ({
              maybeSingle: () => {
                if (id === REPORTER_ID) {
                  return Promise.resolve({ data: reporter ?? null, error: null })
                }
                if (opts.subjectRow && id === opts.subjectRow['id']) {
                  return Promise.resolve({ data: opts.subjectRow, error: null })
                }
                return Promise.resolve({ data: null, error: null })
              },
            }),
          }
        },
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
      }
    }
    if (table === 'reports') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.reportRow !== undefined ? opts.reportRow : null,
                error: null,
              }),
          }),
        }),
        update: (payload: unknown) => {
          if (opts.updateCapture) opts.updateCapture.payload = payload
          return {
            eq: () => Promise.resolve({ data: null, error: null }),
          }
        },
      }
    }
    if (table === 'report_messages') {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () =>
          Promise.resolve({ data: opts.messages ?? [], error: null }),
      }
      return {
        select: () => chain,
        insert: (payload: unknown) => {
          if (opts.insertCapture) opts.insertCapture.payload = payload
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: opts.insertResponse ?? { id: 'msg-1', created_at: '2026-05-22T10:00:00Z' },
                  error: null,
                }),
            }),
          }
        },
      }
    }
    if (table === 'report_attachments') {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        order: () =>
          Promise.resolve({ data: opts.attachments ?? [], error: null }),
      }
      return { select: () => chain }
    }
    if (table === 'rides') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.rideRow ?? null, error: null }),
          }),
        }),
      }
    }
    throw new Error(`unmocked from(${table})`)
  })
}

describe('GET /api/admin/reports/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/api/admin/reports/${REPORT_ID}`)
    expect(res.status).toBe(401)
  })

  it('returns 400 on non-UUID id', async () => {
    authAsAdmin()
    setupAdminMocks({})
    const res = await request(app)
      .get('/api/admin/reports/notauuid')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_ID')
  })

  it('returns 404 when report not found', async () => {
    authAsAdmin()
    setupAdminMocks({ reportRow: null })
    const res = await request(app)
      .get(`/api/admin/reports/${REPORT_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(404)
  })

  it('returns full detail with internal notes visible', async () => {
    // Critical: admin endpoint returns internal notes; the user-
    // facing endpoint filters them out. This locks that distinction.
    authAsAdmin()
    setupAdminMocks({
      reportRow: {
        id: REPORT_ID,
        reporter_id: REPORTER_ID,
        subject_user_id: null,
        ride_id: RIDE_ID,
        schedule_id: null,
        category: 'safety_during_ride',
        severity: 'emergency',
        status: 'in_progress',
        title: 'Test',
        body: 'body',
        requested_refund_cents: null,
        ride_state_at_report: 'active',
        metadata: { platform: 'ios' },
        assigned_admin_id: null,
        resolution_note: null,
        resolved_at: null,
        resolved_by: null,
        created_at: '2026-05-22T10:00:00Z',
        updated_at: '2026-05-22T10:00:00Z',
      },
      reporterRow: {
        id: REPORTER_ID,
        email: 'reporter@ucdavis.edu',
        full_name: 'Reporter Test',
        avatar_url: null,
        is_driver: false,
        suspended_at: null,
      },
      rideRow: {
        id: RIDE_ID,
        status: 'active',
        payment_status: 'paid',
        rider_id: REPORTER_ID,
        driver_id: 'some-driver',
        vehicle_id: null,
        origin_name: 'A',
        destination_name: 'B',
        fare_cents: 750,
        created_at: '2026-05-22T09:00:00Z',
        ended_at: null,
      },
      messages: [
        {
          id: 'msg-public',
          author_id: REPORTER_ID,
          author_role: 'user',
          body: 'Please help',
          channel: 'in_app',
          is_internal_note: false,
          email_message_id: null,
          created_at: '2026-05-22T10:01:00Z',
        },
        {
          id: 'msg-internal',
          author_id: ADMIN_UID,
          author_role: 'admin',
          body: 'Looks like a duplicate of report 0xdead',
          channel: 'admin_panel',
          is_internal_note: true,
          email_message_id: null,
          created_at: '2026-05-22T10:02:00Z',
        },
      ],
    })

    const res = await request(app)
      .get(`/api/admin/reports/${REPORT_ID}`)
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.report.severity).toBe('emergency')
    expect(res.body.messages).toHaveLength(2)
    const internal = res.body.messages.find((m: { is_internal_note: boolean }) => m.is_internal_note)
    expect(internal).toBeDefined()
    expect(internal.body).toContain('duplicate')
    expect(res.body.reporter.email).toBe('reporter@ucdavis.edu')
    expect(res.body.ride.fare_cents).toBe(750)
  })
})

describe('GET /api/admin/reports (inbox)', () => {
  beforeEach(() => vi.clearAllMocks())

  function setupInboxMocks(opts: {
    rows?: Array<Record<string, unknown>>
    total?: number
    openCount?: number
    urgentCount?: number
    emergencyCount?: number
    reporters?: Array<{ id: string; full_name: string | null; email: string | null }>
  }) {
    let reportsCalls = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: (cols: string) => {
            if (cols === 'is_admin') {
              return {
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { is_admin: true }, error: null }),
                }),
              }
            }
            // Batch lookup `.in('id', ...)` — chain ends with `.in()`.
            const out = Promise.resolve({ data: opts.reporters ?? [], error: null })
            return { in: () => out }
          },
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }
      }
      if (table === 'reports') {
        const call = reportsCalls++
        // Call 0 → main paginated list (terminates on .range())
        // Calls 1-3 → counts (head:true, resolve via bare await)
        if (call === 0) {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            in: () => chain,
            not: () => chain,
            is: () => chain,
            order: () => chain,
            range: () =>
              Promise.resolve({
                data: opts.rows ?? [],
                count: opts.total ?? (opts.rows?.length ?? 0),
                error: null,
              }),
          }
          return { select: () => chain }
        }
        const counts = [opts.openCount, opts.urgentCount, opts.emergencyCount]
        const value = counts[call - 1] ?? 0
        const resolution = { data: null, count: value, error: null }
        const chain: Record<string, unknown> & PromiseLike<typeof resolution> = {
          eq: () => chain,
          in: () => chain,
          then: <T1, T2 = never>(
            onFulfilled?: ((v: typeof resolution) => T1 | PromiseLike<T1>) | null,
            onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
          ) => Promise.resolve(resolution).then(onFulfilled, onRejected),
        }
        return { select: () => chain }
      }
      throw new Error(`unmocked from(${table})`)
    })
  }

  it('returns counts + paginated rows', async () => {
    authAsAdmin()
    setupInboxMocks({
      rows: [
        {
          id: REPORT_ID,
          reporter_id: REPORTER_ID,
          category: 'safety_during_ride',
          severity: 'emergency',
          status: 'open',
          title: 'Safety thing',
          body: 'Long body of the report content',
          ride_id: RIDE_ID,
          requested_refund_cents: null,
          assigned_admin_id: null,
          created_at: '2026-05-22T10:00:00Z',
          updated_at: '2026-05-22T10:00:00Z',
        },
      ],
      total: 1,
      openCount: 5,
      urgentCount: 2,
      emergencyCount: 1,
      reporters: [
        { id: REPORTER_ID, full_name: 'Reporter Name', email: 'r@ucdavis.edu' },
      ],
    })
    const res = await request(app)
      .get('/api/admin/reports')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.counts).toEqual({ open: 5, urgent: 2, emergency: 1 })
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.reports[0].reporter_name).toBe('Reporter Name')
    expect(res.body.reports[0].body_preview).toContain('Long body')
  })

  it('truncates long body to a preview', async () => {
    authAsAdmin()
    const longBody = 'X'.repeat(300)
    setupInboxMocks({
      rows: [
        {
          id: REPORT_ID,
          reporter_id: REPORTER_ID,
          category: 'bug_report',
          severity: 'low',
          status: 'open',
          title: 'Long bug',
          body: longBody,
          ride_id: null,
          requested_refund_cents: null,
          assigned_admin_id: null,
          created_at: '2026-05-22T10:00:00Z',
          updated_at: '2026-05-22T10:00:00Z',
        },
      ],
      total: 1,
    })
    const res = await request(app)
      .get('/api/admin/reports')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.reports[0].body_preview.length).toBeLessThanOrEqual(141)
    expect(res.body.reports[0].body_preview.endsWith('…')).toBe(true)
  })

  it('empty inbox returns zero counts and empty rows', async () => {
    authAsAdmin()
    setupInboxMocks({})
    const res = await request(app)
      .get('/api/admin/reports')
      .set('Authorization', VALID_JWT)
    expect(res.status).toBe(200)
    expect(res.body.reports).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.counts).toEqual({ open: 0, urgent: 0, emergency: 0 })
  })
})

describe('POST /api/admin/reports/:id/messages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 missing body', async () => {
    authAsAdmin()
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MISSING_FIELD')
  })

  it('admin reply flips status from open → awaiting_user', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    const updateCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
      updateCapture: updateCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'Got it — looking into this now.' })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { author_role: string; is_internal_note: boolean }
    expect(inserted.author_role).toBe('admin')
    expect(inserted.is_internal_note).toBe(false)
    const updated = updateCap.payload as { status: string }
    expect(updated.status).toBe('awaiting_user')
  })

  it('internal note does NOT flip status', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    const updateCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
      updateCapture: updateCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'duplicate of #abc — flagging', is_internal_note: true })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { is_internal_note: boolean }
    expect(inserted.is_internal_note).toBe(true)
    // Update should NOT have fired — internal notes don't change status
    expect(updateCap.payload).toBeNull()
  })

  it('channel="email" persists the message row as channel=email_outbound', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'Sent via email.', channel: 'email' })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { channel: string }
    expect(inserted.channel).toBe('email_outbound')
  })

  it('channel="both" also persists as email_outbound (thread row is the source of truth)', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'Both ways.', channel: 'both' })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { channel: string }
    expect(inserted.channel).toBe('email_outbound')
  })

  it('internal note ignores channel override (always admin_panel)', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'note', is_internal_note: true, channel: 'email' })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { channel: string; is_internal_note: boolean }
    expect(inserted.channel).toBe('admin_panel')
    expect(inserted.is_internal_note).toBe(true)
  })

  it('unknown channel falls back to in_app (admin_panel)', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'open' },
      insertCapture: insertCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'mystery', channel: 'sms' })
    expect(res.status).toBe(201)
    const inserted = insertCap.payload as { channel: string }
    expect(inserted.channel).toBe('admin_panel')
  })

  it('resolved reports do not get auto-flipped on admin reply', async () => {
    authAsAdmin()
    const insertCap: { payload: unknown } = { payload: null }
    const updateCap: { payload: unknown } = { payload: null }
    setupAdminMocks({
      reportRow: { id: REPORT_ID, status: 'resolved' },
      insertCapture: insertCap,
      updateCapture: updateCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/messages`)
      .set('Authorization', VALID_JWT)
      .send({ body: 'one more thing' })
    expect(res.status).toBe(201)
    const updated = updateCap.payload as { status: string } | null
    // The update fires but keeps status the same (it's not open/in_progress)
    expect(updated?.status).toBe('resolved')
  })
})

// ── Phase 3c — Status / severity / audit actions ───────────────────

describe('POST /api/admin/reports/:id/actions/status', () => {
  beforeEach(() => vi.clearAllMocks())

  function setupStatusMocks(opts: {
    existingStatus?: string
    updateCapture?: { payload: unknown }
    auditCapture?: { payload: unknown }
  }) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { is_admin: true }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }
      }
      if (table === 'reports') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: REPORT_ID,
                    status: opts.existingStatus ?? 'open',
                    resolution_note: null,
                  },
                  error: null,
                }),
            }),
          }),
          update: (payload: unknown) => {
            if (opts.updateCapture) opts.updateCapture.payload = payload
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            }
          },
        }
      }
      if (table === 'report_audit_log') {
        return {
          insert: (payload: unknown) => {
            if (opts.auditCapture) opts.auditCapture.payload = payload
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unmocked from(${table})`)
    })
  }

  it('rejects unknown status with 400', async () => {
    authAsAdmin()
    setupStatusMocks({})
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/actions/status`)
      .set('Authorization', VALID_JWT)
      .send({ status: 'invented_state' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_STATUS')
  })

  it('flipping to resolved writes audit + stamps resolved_at/by', async () => {
    authAsAdmin()
    const updateCap: { payload: unknown } = { payload: null }
    const auditCap: { payload: unknown } = { payload: null }
    setupStatusMocks({
      existingStatus: 'in_progress',
      updateCapture: updateCap,
      auditCapture: auditCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/actions/status`)
      .set('Authorization', VALID_JWT)
      .send({ status: 'resolved', resolution_note: 'fixed via refund tx_abc' })
    expect(res.status).toBe(200)
    const updated = updateCap.payload as Record<string, unknown>
    expect(updated['status']).toBe('resolved')
    expect(updated['resolution_note']).toBe('fixed via refund tx_abc')
    expect(updated['resolved_at']).toBeTruthy()
    expect(updated['resolved_by']).toBe(ADMIN_UID)
    const audited = auditCap.payload as Record<string, unknown>
    expect(audited['action']).toBe('status_change')
    expect((audited['payload'] as Record<string, unknown>)['from']).toBe('in_progress')
    expect((audited['payload'] as Record<string, unknown>)['to']).toBe('resolved')
  })

  it('reopening from resolved clears resolved_at + resolved_by', async () => {
    authAsAdmin()
    const updateCap: { payload: unknown } = { payload: null }
    setupStatusMocks({
      existingStatus: 'resolved',
      updateCapture: updateCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/actions/status`)
      .set('Authorization', VALID_JWT)
      .send({ status: 'in_progress' })
    expect(res.status).toBe(200)
    const updated = updateCap.payload as Record<string, unknown>
    expect(updated['status']).toBe('in_progress')
    expect(updated['resolved_at']).toBeNull()
    expect(updated['resolved_by']).toBeNull()
  })
})

describe('POST /api/admin/reports/:id/actions/severity', () => {
  beforeEach(() => vi.clearAllMocks())

  function setupSeverityMocks(opts: {
    existingSeverity?: string
    updateCapture?: { payload: unknown }
    auditCapture?: { payload: unknown }
  }) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { is_admin: true }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ data: null, error: null }),
          }),
        }
      }
      if (table === 'reports') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: REPORT_ID,
                    severity: opts.existingSeverity ?? 'normal',
                  },
                  error: null,
                }),
            }),
          }),
          update: (payload: unknown) => {
            if (opts.updateCapture) opts.updateCapture.payload = payload
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            }
          },
        }
      }
      if (table === 'report_audit_log') {
        return {
          insert: (payload: unknown) => {
            if (opts.auditCapture) opts.auditCapture.payload = payload
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unmocked from(${table})`)
    })
  }

  it('rejects unknown severity', async () => {
    authAsAdmin()
    setupSeverityMocks({})
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/actions/severity`)
      .set('Authorization', VALID_JWT)
      .send({ severity: 'catastrophic' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_SEVERITY')
  })

  it('downgrade from emergency to urgent writes audit', async () => {
    authAsAdmin()
    const updateCap: { payload: unknown } = { payload: null }
    const auditCap: { payload: unknown } = { payload: null }
    setupSeverityMocks({
      existingSeverity: 'emergency',
      updateCapture: updateCap,
      auditCapture: auditCap,
    })
    const res = await request(app)
      .post(`/api/admin/reports/${REPORT_ID}/actions/severity`)
      .set('Authorization', VALID_JWT)
      .send({ severity: 'urgent' })
    expect(res.status).toBe(200)
    const updated = updateCap.payload as Record<string, unknown>
    expect(updated['severity']).toBe('urgent')
    const audited = auditCap.payload as Record<string, unknown>
    expect(audited['action']).toBe('severity_change')
    expect((audited['payload'] as Record<string, unknown>)['from']).toBe('emergency')
    expect((audited['payload'] as Record<string, unknown>)['to']).toBe('urgent')
  })
})
