// @vitest-environment node
/**
 * 2026-05-21 — Phase 4 of docs/REPORTS_PLAN.md. Locks the alert
 * orchestrator's severity routing + Block Kit payload shape so a
 * future code change can't silently drop emergency reports.
 *
 * Doesn't hit the real Slack webhook — we mock `slackWebhook` and
 * `resend` to assert what the orchestrator would have called them
 * with. The actual HTTP wire is tested separately + is the same
 * fetch path Slack runs in CI all day.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockPostToSlack, mockSendEmailToMany, mockGetResendClient } = vi.hoisted(() => ({
  mockPostToSlack: vi.fn(() => Promise.resolve(true)),
  mockSendEmailToMany: vi.fn(() =>
    Promise.resolve({ sent: 1, failed: 0, failures: [] }),
  ),
  mockGetResendClient: vi.fn(() => ({})),
}))

vi.mock('../../../server/lib/slackWebhook.ts', () => ({
  postToSlack: mockPostToSlack,
}))

vi.mock('../../../server/lib/resend.ts', () => ({
  sendEmailToMany: mockSendEmailToMany,
  getResendClient: mockGetResendClient,
}))

import {
  notifyReportSubmitted,
  notifyAdminOfUserReply,
  buildSlackMessage,
  buildUserReplySlackMessage,
  emailSubjectFor,
  emailHtmlFor,
  type ReportAlertContext,
  type UserReplyAlertContext,
} from '../../../server/lib/adminAlerts.ts'

function makeCtx(overrides: Partial<ReportAlertContext> = {}): ReportAlertContext {
  return {
    reportID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    category: 'safety_during_ride',
    severity: 'emergency',
    title: 'Unsafe driving',
    body: 'Driver was swerving',
    rideID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    requestedRefundCents: null,
    metadata: {
      platform: 'ios',
      app_version: '1.0.0',
      gps_lat: 38.5449,
      gps_lng: -121.7405,
    },
    reporterEmail: 'rider@ucdavis.edu',
    reporterName: 'Maya Rider',
    reporterID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    createdAt: '2026-05-21T12:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['SLACK_ALERTS_WEBHOOK_URL'] = 'https://hooks.slack.com/services/T/B/X'
  process.env['ADMIN_ALERT_EMAILS'] = 'tarungautam.us@gmail.com'
  process.env['RESEND_API_KEY'] = 'fake-key'
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fake'
  process.env['FIREBASE_SERVICE_ACCOUNT_PATH'] = './fake.json'
  process.env['QR_HMAC_SECRET'] = 'fake'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test'
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test'
})

// ── Severity routing ────────────────────────────────────────────

describe('notifyReportSubmitted — severity routing', () => {
  it('emergency severity fires Slack AND email', async () => {
    notifyReportSubmitted(makeCtx({ severity: 'emergency' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).toHaveBeenCalledTimes(1)
    expect(mockSendEmailToMany).toHaveBeenCalledTimes(1)
  })

  it('urgent severity fires Slack AND email (per Tarun 2026-05-21)', async () => {
    notifyReportSubmitted(makeCtx({ severity: 'urgent' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).toHaveBeenCalledTimes(1)
    expect(mockSendEmailToMany).toHaveBeenCalledTimes(1)
  })

  it('normal severity stays silent', async () => {
    notifyReportSubmitted(makeCtx({ severity: 'normal' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).not.toHaveBeenCalled()
    expect(mockSendEmailToMany).not.toHaveBeenCalled()
  })

  it('low severity stays silent', async () => {
    notifyReportSubmitted(makeCtx({ severity: 'low' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).not.toHaveBeenCalled()
    expect(mockSendEmailToMany).not.toHaveBeenCalled()
  })

  it('Slack failure does not block email', async () => {
    mockPostToSlack.mockRejectedValueOnce(new Error('slack 500'))
    notifyReportSubmitted(makeCtx({ severity: 'emergency' }))
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockSendEmailToMany).toHaveBeenCalledTimes(1)
  })

  it('email channel skipped when ADMIN_ALERT_EMAILS empty', async () => {
    process.env['ADMIN_ALERT_EMAILS'] = ''
    notifyReportSubmitted(makeCtx({ severity: 'emergency' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).toHaveBeenCalledTimes(1)
    expect(mockSendEmailToMany).not.toHaveBeenCalled()
  })
})

// ── Slack Block Kit payload ─────────────────────────────────────

describe('buildSlackMessage', () => {
  it('emergency carries the 🚨 emoji + danger button style', () => {
    const msg = buildSlackMessage(makeCtx({ severity: 'emergency' }))
    expect(msg.text).toContain('🚨')
    const actions = msg.blocks?.find((b) => b.type === 'actions')
    expect(actions).toBeDefined()
    if (actions?.type === 'actions') {
      expect(actions.elements[0]?.style).toBe('danger')
      expect(actions.elements[0]?.url).toContain('/admin/reports/aaaaaaaa-')
    }
  })

  it('urgent uses ⚠️ + primary button style', () => {
    const msg = buildSlackMessage(makeCtx({ severity: 'urgent' }))
    expect(msg.text).toContain('⚠️')
    const actions = msg.blocks?.find((b) => b.type === 'actions')
    if (actions?.type === 'actions') {
      expect(actions.elements[0]?.style).toBe('primary')
    }
  })

  it('GPS metadata becomes a clickable Google Maps field', () => {
    const msg = buildSlackMessage(makeCtx())
    const fields = collectMrkdwnFields(msg)
    const gps = fields.find((t) => t.includes('GPS'))
    expect(gps).toBeDefined()
    expect(gps).toContain('https://www.google.com/maps?q=38.5449,-121.7405')
  })

  it('omits GPS field when metadata has no coords', () => {
    const msg = buildSlackMessage(
      makeCtx({ metadata: { platform: 'web', app_version: '1.0.0' } }),
    )
    const fields = collectMrkdwnFields(msg)
    expect(fields.find((t) => t.includes('GPS'))).toBeUndefined()
  })

  it('includes refund request when present', () => {
    const msg = buildSlackMessage(makeCtx({ requestedRefundCents: 1250 }))
    const fields = collectMrkdwnFields(msg)
    expect(fields.find((t) => t.includes('$12.50'))).toBeDefined()
  })

  it('truncates a very long body to 400 chars', () => {
    const longBody = 'A'.repeat(1000)
    const msg = buildSlackMessage(makeCtx({ body: longBody }))
    const section = msg.blocks?.find(
      (b) => b.type === 'section' && b.text.text.includes('A'),
    )
    if (section?.type === 'section') {
      expect(section.text.text.length).toBeLessThan(420)
      expect(section.text.text.endsWith('…')).toBe(true)
    }
  })

  it('falls back to reporter id when name + email are nil', () => {
    const msg = buildSlackMessage(
      makeCtx({ reporterName: null, reporterEmail: null }),
    )
    const fields = collectMrkdwnFields(msg)
    const reporter = fields.find((t) => t.includes('Reporter'))
    expect(reporter).toContain('cccccccc')
  })
})

// ── Email body ──────────────────────────────────────────────────

describe('emailSubjectFor / emailHtmlFor', () => {
  it('emergency subject leads with 🚨 EMERGENCY', () => {
    const subject = emailSubjectFor(makeCtx({ severity: 'emergency' }))
    expect(subject.startsWith('🚨 EMERGENCY')).toBe(true)
  })

  it('urgent subject leads with ⚠️ Urgent', () => {
    const subject = emailSubjectFor(makeCtx({ severity: 'urgent' }))
    expect(subject.startsWith('⚠️ Urgent')).toBe(true)
  })

  it('HTML escapes the body so injection is impossible', () => {
    const html = emailHtmlFor(makeCtx({ body: '<script>alert(1)</script>' }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes the admin deep-link button', () => {
    const html = emailHtmlFor(makeCtx())
    expect(html).toContain('https://www.tagorides.com/admin/reports/aaaaaaaa-')
  })
})

// ── notifyAdminOfUserReply ──────────────────────────────────────

function makeReplyCtx(overrides: Partial<UserReplyAlertContext> = {}): UserReplyAlertContext {
  return {
    reportID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    reportTitle: 'Unsafe driving',
    reportSeverity: 'urgent',
    replyPreview: 'any update on this?',
    reporterEmail: 'rider@ucdavis.edu',
    reporterName: 'Maya Rider',
    reporterID: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    createdAt: '2026-05-22T12:00:00.000Z',
    ...overrides,
  }
}

describe('notifyAdminOfUserReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires Slack on urgent', async () => {
    notifyAdminOfUserReply(makeReplyCtx({ reportSeverity: 'urgent' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).toHaveBeenCalledTimes(1)
  })

  it('fires Slack on emergency', async () => {
    notifyAdminOfUserReply(makeReplyCtx({ reportSeverity: 'emergency' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).toHaveBeenCalledTimes(1)
  })

  it('stays silent on normal severity', async () => {
    notifyAdminOfUserReply(makeReplyCtx({ reportSeverity: 'normal' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).not.toHaveBeenCalled()
  })

  it('stays silent on low severity', async () => {
    notifyAdminOfUserReply(makeReplyCtx({ reportSeverity: 'low' }))
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockPostToSlack).not.toHaveBeenCalled()
  })

  it('Slack payload carries reply preview + deep link', () => {
    const msg = buildUserReplySlackMessage(makeReplyCtx({
      reportSeverity: 'emergency',
      replyPreview: 'help me please',
    }))
    expect(msg.text).toContain('💬')
    expect(JSON.stringify(msg.blocks)).toContain('help me please')
    expect(JSON.stringify(msg.blocks)).toContain('/admin/reports/aaaaaaaa-')
  })
})

// ── Helpers ─────────────────────────────────────────────────────

function collectMrkdwnFields(msg: ReturnType<typeof buildSlackMessage>): string[] {
  const out: string[] = []
  for (const block of msg.blocks ?? []) {
    if (block.type !== 'section') continue
    for (const field of block.fields ?? []) {
      out.push(field.text)
    }
  }
  return out
}
