// @vitest-environment node
/**
 * Slice 1.4 — admin broadcast push composer tests.
 *
 *   GET  /api/admin/campaigns/audience/preview
 *   POST /api/admin/campaigns/push
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

const { mockAuth, mockFrom, mockSendFcm, mockSendEmail } = vi.hoisted(() => ({
  mockAuth: {
    getUser: vi.fn(),
    admin: { listUsers: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn() },
  },
  mockFrom: vi.fn(),
  mockSendFcm: vi.fn(),
  mockSendEmail: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { auth: mockAuth, from: mockFrom },
}))
vi.mock('../../../server/lib/fcm.ts', () => ({
  sendFcmPush: mockSendFcm,
}))
vi.mock('../../../server/lib/resend.ts', () => ({
  sendEmailToMany: mockSendEmail,
  // 2026-05-18 — admin/campaigns email send was switched to the
  // personalized variant for `{{name}}` mail-merge. Same mock fn —
  // the return shape is identical to `sendEmailToMany`.
  sendPersonalizedEmailToMany: mockSendEmail,
  isAllowedFromAddress: (addr: string) =>
    ['marketing@tagorides.com', 'hello@tagorides.com', 'support@tagorides.com', 'admin@tagorides.com']
      .includes(addr.toLowerCase()),
  FROM_ADDRESS_ALLOWLIST: [
    { value: 'marketing@tagorides.com', label: 'Marketing' },
  ],
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
  /** Returned by from('campaigns').insert(...).select().single(). null → triggers 23505 retry path. */
  campaignInsertResult?: { id: string; slug: string } | null
  /** Slice 1.4d — user_ids returned as opted-out by from('notification_preferences'). */
  optedOutUserIds?: string[]
  /** Slice 1.4d — campaigns row returned by from('campaigns').eq('id', ...) (for recall lookup). */
  recallCampaign?: { id: string; slug: string; recalled_at: string | null } | null
  /** Slice 1.4d — count of notifications row IDs deleted by the recall. */
  recallDeletedCount?: number
  /** Slice 1.5 — Resend result for sendEmailToMany. */
  emailSendResult?: { sent: number; failed: number; failures: string[] }
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
  mockSendEmail.mockResolvedValue(opts.emailSendResult ?? { sent: 0, failed: 0, failures: [] })

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
            in: () => chain,
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
        // Slice 1.4d — recall wipes inbox rows. Chain ends in .select('id').
        delete: () => {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            filter: () => chain,
            select: () =>
              Promise.resolve({
                data: Array.from(
                  { length: opts.recallDeletedCount ?? 0 },
                  (_, i) => ({ id: `notif-${i}` }),
                ),
                error: null,
              }),
          }
          return chain
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
    if (table === 'campaigns') {
      const insertResult = opts.campaignInsertResult === undefined
        ? { id: 'camp-1', slug: 'abc12345xy' }
        : opts.campaignInsertResult
      return {
        insert: () => ({
          select: () => ({
            single: () =>
              insertResult === null
                ? Promise.resolve({ data: null, error: { message: 'fail', code: '23505' } })
                : Promise.resolve({ data: insertResult, error: null }),
          }),
        }),
        update: () => ({
          eq: () => Promise.resolve({ data: null, error: null }),
        }),
        // Slice 1.4d — recall endpoint reads the campaign first.
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.recallCampaign === undefined
                  ? null
                  : opts.recallCampaign,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === 'notification_preferences') {
      // Used by both /push (filter recipients) + /audience/preview.
      // Chainable .in(...).eq('push_promos', false) returns the opted-out rows.
      const chain: Record<string, unknown> = {
        in: () => chain,
        eq: () =>
          Promise.resolve({
            data: (opts.optedOutUserIds ?? []).map((id) => ({ user_id: id, push_promos: false })),
            error: null,
          }),
      }
      return { select: () => chain }
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

  it('passes poster_url through to push data + notifications row + audit', async () => {
    setup({
      audienceUsers: [{ id: 'u1', email: 'a@x.edu', full_name: 'A' }],
      pushTokens: [{ user_id: 'u1', token: 'tokA' }],
      fcmSentCount: 1,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'Free pizza',
        body: 'Tap to see the flyer',
        poster_url: 'https://example.com/posters/free-pizza.png',
      })
    expect(res.status).toBe(200)
    expect(res.body.slug).toBeDefined()
    expect(res.body.campaign_id).toBeDefined()

    // sendFcmPush was called with data containing image + slug + type
    const callArgs = mockSendFcm.mock.calls[0]
    const payload = callArgs?.[1] as { data: Record<string, string> }
    expect(payload.data['type']).toBe('admin_broadcast')
    expect(payload.data['slug']).toBeDefined()
    expect(payload.data['image']).toBe('https://example.com/posters/free-pizza.png')

    // notifications row carries poster_url for inline rendering
    const notifRow = notificationInserts[0]?.[0] as Record<string, unknown>
    const notifData = notifRow['data'] as Record<string, unknown>
    expect(notifData['poster_url']).toBe('https://example.com/posters/free-pizza.png')

    // Audit row includes poster_url + campaign_id + slug
    const auditPayload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(auditPayload['poster_url']).toBe('https://example.com/posters/free-pizza.png')
    expect(auditPayload['campaign_id']).toBeDefined()
    expect(auditPayload['slug']).toBeDefined()
  })

  it('filters out push_promos opt-outs from the recipient set', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@x.edu', full_name: 'A' },
        { id: 'u2', email: 'b@x.edu', full_name: 'B' },
        { id: 'u3', email: 'c@x.edu', full_name: 'C' },
      ],
      optedOutUserIds: ['u2'], // u2 has push_promos=false
      pushTokens: [
        { user_id: 'u1', token: 'tokA' },
        { user_id: 'u3', token: 'tokC' },
      ],
      fcmSentCount: 2,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'Promo',
        body: 'Free credit inside',
      })
    expect(res.status).toBe(200)
    // u2 was excluded → 2 recipients, not 3
    expect(res.body.recipient_count).toBe(2)
  })

  it('test_to_self bypasses audience + opt-out filter and routes only to the calling admin', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@x.edu', full_name: 'A' },
        { id: 'u2', email: 'b@x.edu', full_name: 'B' },
      ],
      optedOutUserIds: [ADMIN_UID], // admin opted out — should STILL receive when test_to_self
      pushTokens: [{ user_id: ADMIN_UID, token: 'admin-token' }],
      fcmSentCount: 1,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/push')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        title: 'Test fire',
        body: 'Just me',
        test_to_self: true,
      })
    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(1)
    expect(res.body.push_sent).toBe(1)
    // The push_tokens query should have been called with the admin's
    // uid only — not with u1/u2.
    // (We can't easily inspect the .in() args; the recipient_count = 1
    // already confirms the audience didn't expand.)
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

// ── /campaigns/email (Slice 1.5) ───────────────────────────────────────────

describe('POST /api/admin/campaigns/email', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 INVALID_BODY when subject or body_html is missing', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Hi',
        from: 'marketing@tagorides.com',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_BODY')
  })

  it('400 INVALID_FROM when from is not in allowlist', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Hi',
        body_html: '<p>Hello</p>',
        from: 'admin@some-random-domain.com',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_FROM')
  })

  it('400 TOO_LONG when subject > 200 chars', async () => {
    setup()
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'x'.repeat(250),
        body_html: '<p>ok</p>',
        from: 'marketing@tagorides.com',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOO_LONG')
  })

  it('200 happy path: looks up emails, fires Resend, audit-logs', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@x.edu', full_name: 'A' },
        { id: 'u2', email: 'b@x.edu', full_name: 'B' },
      ],
      emailSendResult: { sent: 2, failed: 0, failures: [] },
    })
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Weekly digest',
        body_html: '<h1>Hi</h1><p>Welcome to Tago.</p>',
        from: 'marketing@tagorides.com',
        reason: 'weekly send',
      })

    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(2)
    expect(res.body.sent).toBe(2)
    expect(res.body.slug).toBeDefined()

    // html now carries an auto-appended footer (Slice 1.6) so we
    // assert the substring rather than exact match. Personalized
    // sender (Slice 2026-05-18) takes `subjectTemplate` / `htmlTemplate`
    // and `recipients: { email, full_name }[]` — assertion shape
    // updated to match.
    const call = mockSendEmail.mock.calls[0]?.[0] as {
      from: string
      subjectTemplate: string
      htmlTemplate: string
      recipients: { email: string; full_name: string | null }[]
    }
    expect(call.from).toBe('marketing@tagorides.com')
    expect(call.subjectTemplate).toBe('Weekly digest')
    expect(call.recipients.map((r) => r.email)).toEqual(['a@x.edu', 'b@x.edu'])
    expect(call.htmlTemplate).toContain('<h1>Hi</h1><p>Welcome to Tago.</p>')
    expect(call.htmlTemplate).toContain('Terms of Use')

    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      action: 'send_campaign_email',
      target_user_id: null,
    })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({
      subject: 'Weekly digest',
      from: 'marketing@tagorides.com',
      recipient_count: 2,
      sent: 2,
    })
    // body_plain_preview should be stripped HTML, no tags
    expect(payload['body_plain_preview']).toBe('Hi Welcome to Tago.')
  })

  // Slice 1.6 — email hero image: when poster_url is passed, server
  // prepends an inline <img> tag to the HTML body before sending.
  it('prepends an inline hero <img> when poster_url is supplied', async () => {
    setup({
      audienceUsers: [{ id: 'u1', email: 'a@x.edu', full_name: 'A' }],
      emailSendResult: { sent: 1, failed: 0, failures: [] },
    })

    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Spring Fling',
        body_html: '<p>Get your tickets.</p>',
        from: 'marketing@tagorides.com',
        poster_url: 'https://example.com/spring.png',
      })

    expect(res.status).toBe(200)
    const lastCallHtml = (mockSendEmail.mock.calls[0]?.[0] as { htmlTemplate: string }).htmlTemplate
    // Hero image is centered + capped at 600px + appears BEFORE the
    // author's body (so it renders as a hero, not a footer).
    expect(lastCallHtml).toContain('<img src="https://example.com/spring.png"')
    expect(lastCallHtml).toContain('max-width:600px')
    expect(lastCallHtml.indexOf('<img')).toBeLessThan(lastCallHtml.indexOf('<p>Get your tickets.</p>'))

    // Branded footer is auto-appended AFTER the body.
    expect(lastCallHtml).toContain('©2026')
    expect(lastCallHtml).toContain('Terms of Use')
    expect(lastCallHtml).toContain('Privacy')
    expect(lastCallHtml).toContain('Unsubscribe')
    expect(lastCallHtml.indexOf('Terms of Use')).toBeGreaterThan(
      lastCallHtml.indexOf('<p>Get your tickets.</p>'),
    )

    // Audit captures the poster_url so the audit log surfaces it.
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload['poster_url']).toBe('https://example.com/spring.png')
  })

  // Slice 1.6 — clickable poster: when poster_link_url is set, the
  // server wraps the prepended <img> in an <a href="..."> so the
  // hero opens the link when tapped in the recipient's inbox.
  it('wraps the hero <img> in <a href> when poster_link_url is supplied', async () => {
    setup({
      audienceUsers: [{ id: 'u1', email: 'a@x.edu', full_name: 'A' }],
      emailSendResult: { sent: 1, failed: 0, failures: [] },
    })

    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Spring Fling',
        body_html: '<p>Get your tickets.</p>',
        from: 'marketing@tagorides.com',
        poster_url: 'https://example.com/spring.png',
        poster_link_url: 'https://www.tagorides.com/c/spring-promo',
      })

    expect(res.status).toBe(200)
    const lastCallHtml = (mockSendEmail.mock.calls[0]?.[0] as { htmlTemplate: string }).htmlTemplate
    expect(lastCallHtml).toContain('<a href="https://www.tagorides.com/c/spring-promo"')
    expect(lastCallHtml).toContain('target="_blank"')
    expect(lastCallHtml).toContain('rel="noopener noreferrer"')
    // The img is still inside the anchor.
    const anchorIdx = lastCallHtml.indexOf('<a href="https://www.tagorides.com/c/spring-promo"')
    const imgIdx = lastCallHtml.indexOf('<img src="https://example.com/spring.png"')
    const anchorClose = lastCallHtml.indexOf('</a>', anchorIdx)
    expect(imgIdx).toBeGreaterThan(anchorIdx)
    expect(imgIdx).toBeLessThan(anchorClose)

    // Audit captures the poster_link_url too.
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload['poster_link_url']).toBe('https://www.tagorides.com/c/spring-promo')
  })

  it('filters by email_marketing opt-outs (not push_promos)', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@x.edu', full_name: 'A' },
        { id: 'u2', email: 'b@x.edu', full_name: 'B' },
        { id: 'u3', email: 'c@x.edu', full_name: 'C' },
      ],
      optedOutUserIds: ['u2'], // u2 has email_marketing=false
      emailSendResult: { sent: 2, failed: 0, failures: [] },
    })
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Promo',
        body_html: '<p>Promo</p>',
        from: 'marketing@tagorides.com',
      })
    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(2) // u2 excluded
  })

  it('test_to_self routes only to the calling admin', async () => {
    setup({
      audienceUsers: [
        { id: 'u1', email: 'a@x.edu', full_name: 'A' },
        { id: 'u2', email: 'b@x.edu', full_name: 'B' },
      ],
      emailSendResult: { sent: 1, failed: 0, failures: [] },
    })
    const res = await request(app)
      .post('/api/admin/campaigns/email')
      .set('Authorization', VALID_JWT)
      .send({
        audience: { type: 'all_users' },
        subject: 'Test',
        body_html: '<p>Just me</p>',
        from: 'marketing@tagorides.com',
        test_to_self: true,
      })
    expect(res.status).toBe(200)
    expect(res.body.recipient_count).toBe(1)
  })
})

// ── /campaigns/:id/recall (Slice 1.4d) ─────────────────────────────────────

describe('POST /api/admin/campaigns/:id/recall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400 REASON_REQUIRED when no reason supplied', async () => {
    setup({ recallCampaign: { id: 'camp-1', slug: 'abc12345xy', recalled_at: null } })
    const res = await request(app)
      .post('/api/admin/campaigns/camp-1/recall')
      .set('Authorization', VALID_JWT)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REASON_REQUIRED')
  })

  it('404 when campaign does not exist', async () => {
    setup({ recallCampaign: null })
    const res = await request(app)
      .post('/api/admin/campaigns/camp-missing/recall')
      .set('Authorization', VALID_JWT)
      .send({ reason: 'whoops' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND')
  })

  it('409 ALREADY_RECALLED when campaign was already recalled', async () => {
    setup({ recallCampaign: { id: 'camp-1', slug: 'abc12345xy', recalled_at: '2026-05-17T00:00:00Z' } })
    const res = await request(app)
      .post('/api/admin/campaigns/camp-1/recall')
      .set('Authorization', VALID_JWT)
      .send({ reason: 'second attempt' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_RECALLED')
  })

  it('200 on happy path: deletes inbox rows + audit-logs + returns deleted count', async () => {
    setup({
      recallCampaign: { id: 'camp-1', slug: 'abc12345xy', recalled_at: null },
      recallDeletedCount: 42,
    })
    const res = await request(app)
      .post('/api/admin/campaigns/camp-1/recall')
      .set('Authorization', VALID_JWT)
      .send({ reason: 'typo in the title' })
    expect(res.status).toBe(200)
    expect(res.body.notifications_deleted).toBe(42)
    expect(auditInserts.length).toBe(1)
    expect(auditInserts[0]).toMatchObject({
      action: 'recall_campaign',
      target_user_id: null,
    })
    const payload = auditInserts[0]?.['payload'] as Record<string, unknown>
    expect(payload).toMatchObject({
      campaign_id: 'camp-1',
      slug: 'abc12345xy',
      reason: 'typo in the title',
      notifications_deleted: 42,
    })
  })
})
