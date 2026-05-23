// @vitest-environment node
/**
 * 2026-05-23 — locks the no-push fallback email behavior so a
 * regression doesn't silently flip into "spam every user" or
 * "fail to email users without push" — both of which were the
 * pre-helper baseline in different directions.
 *
 * Mocks the supabase + Resend client surfaces and asserts what
 * the helper would have sent.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

type SendResult = { data: { id: string } | null; error: { message: string } | null }

const { mockFrom, mockSend, mockGetResendClient } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockSend: vi.fn<(args: unknown) => Promise<SendResult>>(() =>
    Promise.resolve({ data: { id: 'r-msg-001' }, error: null } as SendResult),
  ),
  mockGetResendClient: vi.fn(),
}))

vi.mock('../../../server/lib/supabaseAdmin.ts', () => ({
  supabaseAdmin: { from: mockFrom },
}))

vi.mock('../../../server/lib/resend.ts', () => ({
  getResendClient: mockGetResendClient,
}))

mockGetResendClient.mockReturnValue({ emails: { send: mockSend } })

import { sendNoPushFallbackEmail } from '../../../server/lib/noPushFallbackEmail.ts'

interface UserRow {
  email: string | null
  full_name: string | null
}

interface SetupOpts {
  userRow?: UserRow | null
  pushTokenRows?: Array<{ id: string }>
}

function setup(opts: SetupOpts) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.userRow ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'push_tokens') {
      return {
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({ data: opts.pushTokenRows ?? [], error: null }),
          }),
        }),
      }
    }
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetResendClient.mockReturnValue({ emails: { send: mockSend } })
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'fake'
  process.env['FIREBASE_SERVICE_ACCOUNT_PATH'] = './fake.json'
  process.env['QR_HMAC_SECRET'] = 'fake'
  process.env['STRIPE_SECRET_KEY'] = 'sk_test'
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test'
  process.env['RESEND_API_KEY'] = 'fake-resend-key'
})

describe('sendNoPushFallbackEmail', () => {
  it('sends an offer email when the recipient has no push tokens', async () => {
    setup({
      userRow: { email: 'vansh@ucdavis.edu', full_name: 'Vansh Kumar' },
      pushTokenRows: [],
    })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-001',
      eventKind: 'board_offer',
      routeStr: 'UC Davis → Vacaville Premium Outlets',
      tripDate: '2026-05-23',
      tripTime: '12:02',
      actorName: 'Maya',
    })
    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledOnce()
    const call = mockSend.mock.calls[0]?.[0] as {
      to: string
      subject: string
      html: string
    }
    expect(call.to).toBe('vansh@ucdavis.edu')
    expect(call.subject).toBe('🚗 You have a new ride offer on TAGO!')
    expect(call.html).toContain('Hi Vansh,')
    expect(call.html).toContain('Maya has responded to')
    expect(call.html).toContain('UC Davis')
    expect(call.html).toContain('Vacaville Premium Outlets')
    expect(call.html).toContain('Sat, May 23 at 12:02 PM')
    expect(call.html).toContain('Download the TAGO App for iOS')
  })

  it('uses request-flavored copy when eventKind=board_request', async () => {
    setup({
      userRow: { email: 'driver@ucdavis.edu', full_name: 'Alex Driver' },
      pushTokenRows: [],
    })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-002',
      eventKind: 'board_request',
      routeStr: 'Davis → Sacramento',
      tripDate: '2026-05-25',
      tripTime: '08:30',
      actorName: 'Riley',
    })
    expect(result.sent).toBe(true)
    const call = mockSend.mock.calls[0]?.[0] as { subject: string; html: string }
    expect(call.subject).toBe('🙋 Someone wants to ride with you on TAGO!')
    expect(call.html).toContain('Riley wants to ride with you')
    expect(call.html).toContain('1 new ride request waiting')
  })

  it('skips when the recipient still has at least one push token (sanity gate)', async () => {
    setup({
      userRow: { email: 'has-push@ucdavis.edu', full_name: 'Has Push' },
      pushTokenRows: [{ id: 'tok-1' }],
    })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-003',
      eventKind: 'board_offer',
      routeStr: 'A → B',
      tripDate: null,
      tripTime: null,
      actorName: 'X',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_email_or_has_push')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips when the recipient has no email on file', async () => {
    setup({
      userRow: { email: null, full_name: 'No Email' },
      pushTokenRows: [],
    })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-004',
      eventKind: 'board_offer',
      routeStr: 'A → B',
      tripDate: null,
      tripTime: null,
      actorName: 'X',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_email_or_has_push')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips silently when RESEND_API_KEY is empty (local dev)', async () => {
    process.env['RESEND_API_KEY'] = ''
    setup({
      userRow: { email: 'a@b.com', full_name: 'A B' },
      pushTokenRows: [],
    })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-005',
      eventKind: 'board_offer',
      routeStr: 'A → B',
      tripDate: null,
      tripTime: null,
      actorName: 'X',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_resend_key')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('falls back to "there" when full_name is empty', async () => {
    setup({
      userRow: { email: 'noname@ucdavis.edu', full_name: '' },
      pushTokenRows: [],
    })
    await sendNoPushFallbackEmail({
      recipientUserId: 'user-006',
      eventKind: 'board_offer',
      routeStr: 'A → B',
      tripDate: '2026-05-23',
      tripTime: '12:00',
      actorName: 'X',
    })
    const call = mockSend.mock.calls[0]?.[0] as { html: string }
    expect(call.html).toContain('Hi there,')
  })

  it('formats time without seconds + escapes HTML in actor name', async () => {
    setup({
      userRow: { email: 'a@b.com', full_name: 'Alice' },
      pushTokenRows: [],
    })
    await sendNoPushFallbackEmail({
      recipientUserId: 'user-007',
      eventKind: 'board_offer',
      routeStr: 'X → Y',
      tripDate: '2026-05-23',
      tripTime: '09:05:00',
      actorName: '<script>evil()</script>',
    })
    const call = mockSend.mock.calls[0]?.[0] as { html: string }
    expect(call.html).toContain('9:05 AM')
    expect(call.html).not.toContain('<script>evil()</script>')
    expect(call.html).toContain('&lt;script&gt;evil()&lt;/script&gt;')
  })

  it('handles missing date gracefully', async () => {
    setup({
      userRow: { email: 'a@b.com', full_name: 'Alice' },
      pushTokenRows: [],
    })
    await sendNoPushFallbackEmail({
      recipientUserId: 'user-008',
      eventKind: 'board_offer',
      routeStr: 'X → Y',
      tripDate: null,
      tripTime: null,
      actorName: 'Z',
    })
    const call = mockSend.mock.calls[0]?.[0] as { html: string }
    expect(call.html).toContain('an upcoming time')
  })

  it('returns sent=false + reason=resend_error when Resend rejects', async () => {
    setup({
      userRow: { email: 'a@b.com', full_name: 'Alice' },
      pushTokenRows: [],
    })
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'rejected' } })
    const result = await sendNoPushFallbackEmail({
      recipientUserId: 'user-009',
      eventKind: 'board_offer',
      routeStr: 'A → B',
      tripDate: null,
      tripTime: null,
      actorName: 'X',
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('resend_error')
  })
})
