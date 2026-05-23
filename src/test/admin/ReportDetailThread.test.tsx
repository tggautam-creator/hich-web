/**
 * 2026-05-22 — locks the audit-interleaved thread behavior on
 * `/admin/reports/:id` so an admin reading a report sees a single
 * chronological timeline of (user messages, admin replies, internal
 * notes, status flips, severity overrides) instead of a thread that
 * silently omits half the activity.
 *
 * Renders the full `ReportDetailPage` against mocked hooks so the
 * test exercises the real `ThreadColumn` merge path, not a private
 * helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReportDetailPage from '@/components/admin/ReportDetailPage'
import type {
  AdminReportDetailResponse,
  AdminReportAuditResponse,
} from '@/hooks/useAdminReports'

const { mockAdminGet, mockAdminPost } = vi.hoisted(() => ({
  mockAdminGet: vi.fn(),
  mockAdminPost: vi.fn(),
}))

vi.mock('@/lib/admin/api', () => ({
  adminGet: mockAdminGet,
  adminPost: mockAdminPost,
  AdminApiException: class AdminApiException extends Error {},
}))

vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}))

const REPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeDetail(
  messages: AdminReportDetailResponse['messages'] = [],
): AdminReportDetailResponse {
  return {
    ok: true,
    report: {
      id: REPORT_ID,
      reporter_id: 'rep-1',
      subject_user_id: null,
      ride_id: null,
      schedule_id: null,
      category: 'feedback_feature',
      severity: 'normal',
      status: 'open',
      title: 'Bug report',
      body: 'Something is wrong.',
      requested_refund_cents: null,
      ride_state_at_report: null,
      metadata: {},
      assigned_admin_id: null,
      resolution_note: null,
      resolved_at: null,
      resolved_by: null,
      created_at: '2026-05-22T10:00:00.000Z',
      updated_at: '2026-05-22T10:00:00.000Z',
    },
    messages,
    attachments: [],
    reporter: null,
    subject_user: null,
    ride: null,
  }
}

function makeAudit(
  rows: AdminReportAuditResponse['audit'] = [],
): AdminReportAuditResponse {
  return { ok: true, audit: rows }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/reports/${REPORT_ID}`]}>
        <Routes>
          <Route path="/admin/reports/:id" element={<ReportDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function wireMocks({
  detail,
  audit,
}: {
  detail: AdminReportDetailResponse
  audit: AdminReportAuditResponse
}) {
  mockAdminGet.mockImplementation((path: string) => {
    if (path.includes('/audit-log')) return Promise.resolve(audit)
    if (path.startsWith('/reports/')) return Promise.resolve(detail)
    return Promise.resolve({})
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportDetailPage — audit-interleaved thread', () => {
  it('renders an audit entry inline between messages in chronological order', async () => {
    const detail = makeDetail([
      {
        id: 'msg-1',
        author_id: 'rep-1',
        author_role: 'user',
        body: 'I have an issue.',
        channel: 'in_app',
        is_internal_note: false,
        email_message_id: null,
        created_at: '2026-05-22T10:01:00.000Z',
      },
      {
        id: 'msg-2',
        author_id: 'admin-1',
        author_role: 'admin',
        body: 'Thanks, looking now.',
        channel: 'admin_panel',
        is_internal_note: false,
        email_message_id: null,
        created_at: '2026-05-22T10:03:00.000Z',
      },
    ])
    const audit = makeAudit([
      {
        id: 'audit-status',
        admin_id: 'admin-1',
        admin_email: 'tarun@tagorides.com',
        action: 'status_change',
        payload: { from: 'open', to: 'in_progress' },
        created_at: '2026-05-22T10:02:00.000Z',
      },
    ])
    wireMocks({ detail, audit })
    renderPage()

    // Wait for the audit query to settle (separate async request)
    // before snapshotting the list — otherwise we race the message
    // render against the audit refetch. Generous timeout because
    // the full vitest suite under parallel load can let a single
    // React Query refetch slip past the default 1000ms.
    await screen.findByTestId('thread-audit-audit-status', undefined, { timeout: 5000 })
    const thread = screen.getByTestId('report-thread')
    const items = within(thread).getAllByRole('listitem')
    // Expected order: msg-1 (10:01) → audit-status (10:02) → msg-2 (10:03)
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveAttribute('data-testid', 'thread-msg-msg-1')
    expect(items[1]).toHaveAttribute('data-testid', 'thread-audit-audit-status')
    expect(items[2]).toHaveAttribute('data-testid', 'thread-msg-msg-2')

    // Audit copy + admin label visible
    expect(within(items[1] as HTMLElement).getByText(/tarun@tagorides.com/)).toBeInTheDocument()
    expect(within(items[1] as HTMLElement).getByText(/flipped status open → in_progress/)).toBeInTheDocument()
  })

  it('formats severity_change audit entries with the from → to delta', async () => {
    wireMocks({
      detail: makeDetail([]),
      audit: makeAudit([
        {
          id: 'audit-sev',
          admin_id: 'admin-1',
          admin_email: 'tarun@tagorides.com',
          action: 'severity_change',
          payload: { from: 'normal', to: 'emergency' },
          created_at: '2026-05-22T10:05:00.000Z',
        },
      ]),
    })
    renderPage()

    const row = await screen.findByTestId('thread-audit-audit-sev')
    expect(within(row).getByText(/overrode severity normal → emergency/)).toBeInTheDocument()
  })

  it('includes the resolution note inline on resolution flips', async () => {
    wireMocks({
      detail: makeDetail([]),
      audit: makeAudit([
        {
          id: 'audit-resolved',
          admin_id: 'admin-1',
          admin_email: 'tarun@tagorides.com',
          action: 'status_change',
          payload: {
            from: 'in_progress',
            to: 'resolved',
            resolution_note: 'Issued $5 refund, user confirmed satisfied.',
          },
          created_at: '2026-05-22T10:10:00.000Z',
        },
      ]),
    })
    renderPage()

    const row = await screen.findByTestId('thread-audit-audit-resolved')
    expect(
      within(row).getByText(/flipped status in_progress → resolved/),
    ).toBeInTheDocument()
    expect(
      within(row).getByText(/Issued \$5 refund/),
    ).toBeInTheDocument()
  })

  it('falls back to a truncated admin id when admin_email is nil', async () => {
    wireMocks({
      detail: makeDetail([]),
      audit: makeAudit([
        {
          id: 'audit-anon',
          admin_id: 'abcdef12-3456-7890-abcd-ef1234567890',
          admin_email: null,
          action: 'status_change',
          payload: { from: 'open', to: 'closed' },
          created_at: '2026-05-22T10:11:00.000Z',
        },
      ]),
    })
    renderPage()

    const row = await screen.findByTestId('thread-audit-audit-anon')
    expect(within(row).getByText(/Admin abcdef12/)).toBeInTheDocument()
  })

  it('renders the empty-thread copy only when BOTH messages and audit are empty', async () => {
    wireMocks({ detail: makeDetail([]), audit: makeAudit([]) })
    renderPage()
    const thread = await screen.findByTestId('report-thread')
    expect(
      within(thread).getByText(/No messages yet/),
    ).toBeInTheDocument()
  })
})
