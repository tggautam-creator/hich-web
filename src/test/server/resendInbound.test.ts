// @vitest-environment node
/**
 * 2026-05-22 — Phase 6b — route-level tests for the Resend inbound
 * webhook handler. Covers the happy path + every short-circuit
 * the handler can take so a malformed payload, spoofed sender, or
 * Resend retry never causes the wrong thing to happen.
 *
 * Signature verification is unit-tested separately in
 * `inboundEmail.test.ts`; here the env var is left empty so the
 * handler skips that step (matches the "local dev" branch).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockFrom, mockPostToSlack } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPostToSlack: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: mockFrom },
}))

vi.mock('../../../server/lib/slackWebhook.ts', () => ({
  postToSlack: mockPostToSlack,
}))

import { app } from '../../../server/app.ts'

const REPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const REPORTER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const REPORTER_EMAIL = 'maya@ucdavis.edu'

interface SetupOpts {
  reportRow?: Record<string, unknown> | null
  reporterRow?: { email: string | null; full_name: string | null } | null
  existingMessageByEmailId?: boolean
  insertCapture?: { payload: unknown }
  insertError?: { message: string } | null
  updateCapture?: { payload: unknown }
}

function setup(opts: SetupOpts) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'reports') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.reportRow ?? null,
                error: null,
              }),
          }),
        }),
        update: (payload: unknown) => ({
          eq: () => {
            if (opts.updateCapture) opts.updateCapture.payload = payload
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    }
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.reporterRow ?? null,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === 'report_messages') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.existingMessageByEmailId ? { id: 'existing' } : null,
                error: null,
              }),
          }),
        }),
        insert: (payload: unknown) => {
          if (opts.insertCapture) opts.insertCapture.payload = payload
          return Promise.resolve({ data: null, error: opts.insertError ?? null })
        },
      }
    }
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
  })
}

function postInbound(body: object) {
  return request(app)
    .post('/api/webhooks/resend-inbound')
    .set('Content-Type', 'application/json')
    .send(body)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Leave RESEND_WEBHOOK_SECRET unset so signature verification
  // is skipped (handler logs a warning + proceeds).
  delete process.env['RESEND_WEBHOOK_SECRET']
  // Required env vars for the rest of the server boot path.
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fake'
  process.env['FIREBASE_SERVICE_ACCOUNT_PATH'] = './fake.json'
  process.env['QR_HMAC_SECRET'] = 'fake'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test'
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test'
})

describe('POST /api/webhooks/resend-inbound', () => {
  it('ingests a clean reply, inserts a thread row, flips status, and 200s', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    const updateCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'awaiting_user',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
      insertCapture: insertCap,
      updateCapture: updateCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: `Maya <${REPORTER_EMAIL}>`,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        subject: 'Re: Tago report — Bug',
        text: `Just one more detail.\n\nOn Wed, May 22, 2026, Tago Support wrote:\n> Hi`,
        message_id: 'resend-id-001',
      },
    })
    expect(res.status).toBe(200)
    const inserted = insertCap.payload as {
      report_id: string
      author_role: string
      channel: string
      body: string
      email_message_id: string
    }
    expect(inserted.report_id).toBe(REPORT_ID)
    expect(inserted.author_role).toBe('user')
    expect(inserted.channel).toBe('email_inbound')
    expect(inserted.body).toBe('Just one more detail.')
    expect(inserted.email_message_id).toBe('resend-id-001')
    const updated = updateCap.payload as { status: string }
    expect(updated.status).toBe('in_progress')
  })

  it('skips when the To: address has no valid +tag', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: null,
      reporterRow: null,
      insertCapture: insertCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: ['contact@tagorides.com'],
        text: 'Hi',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe('no_report_id')
    expect(insertCap.payload).toBeNull()
  })

  it('rejects spoofed sender (From: != reporter on file)', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'awaiting_user',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
      insertCapture: insertCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: 'attacker@elsewhere.com',
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: 'gimme the data',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe('sender_mismatch')
    expect(insertCap.payload).toBeNull()
  })

  it('dedupes on repeat delivery of the same email_message_id (Resend retry)', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'awaiting_user',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
      existingMessageByEmailId: true, // already ingested
      insertCapture: insertCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: 'duplicate body',
        message_id: 'resend-id-already-seen',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe('duplicate')
    expect(insertCap.payload).toBeNull()
  })

  it('skips when stripped body is empty (user sent only a quoted reply)', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'awaiting_user',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
      insertCapture: insertCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: `On Wed, May 22, 2026, Tago Support wrote:\n> Original message`,
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe('empty_body')
    expect(insertCap.payload).toBeNull()
  })

  it('skips when the report does not exist (bogus tag)', async () => {
    const insertCap: { payload: unknown } = { payload: null }
    setup({ reportRow: null, reporterRow: null, insertCapture: insertCap })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: 'looking for something to inject into',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe('report_not_found')
    expect(insertCap.payload).toBeNull()
  })

  it('does NOT flip status when the report is already in_progress', async () => {
    const updateCap: { payload: unknown } = { payload: null }
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'in_progress',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
      updateCapture: updateCap,
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: 'another reply',
      },
    })
    expect(res.status).toBe(200)
    expect(updateCap.payload).toBeNull()
  })

  it('signature check is skipped (200) when RESEND_WEBHOOK_SECRET is empty', async () => {
    setup({
      reportRow: {
        id: REPORT_ID,
        status: 'awaiting_user',
        reporter_id: REPORTER_ID,
        title: 'Bug',
        severity: 'normal',
      },
      reporterRow: { email: REPORTER_EMAIL, full_name: 'Maya Rider' },
    })
    const res = await postInbound({
      type: 'email.inbound',
      data: {
        from: REPORTER_EMAIL,
        to: [`reports+${REPORT_ID}@tagorides.com`],
        text: 'hi',
      },
    })
    expect(res.status).toBe(200)
  })

  it('returns 401 on bad signature when RESEND_WEBHOOK_SECRET is set', async () => {
    process.env['RESEND_WEBHOOK_SECRET'] = 'whsec_' + Buffer.from('thirty-two-bytes-of-padding-data', 'utf8').toString('base64')
    setup({
      reportRow: null,
      reporterRow: null,
    })
    const res = await request(app)
      .post('/api/webhooks/resend-inbound')
      .set('Content-Type', 'application/json')
      .set('svix-id', 'm1')
      .set('svix-timestamp', '123')
      .set('svix-signature', 'v1,bogus')
      .send({ type: 'email.inbound', data: { from: REPORTER_EMAIL, to: [`reports+${REPORT_ID}@tagorides.com`], text: 'hi' } })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_SIGNATURE')
  })
})
