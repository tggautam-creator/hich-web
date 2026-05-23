/**
 * 2026-05-22 — locks the inline attachments grid on
 * `/admin/reports/:id`. Replaces the older "Inline preview lands in
 * a follow-up" stub; admin should now see image thumbs + file rows
 * served from the pre-signed URLs the detail endpoint returns.
 *
 * Renders the full ReportDetailPage against mocked hooks so the
 * test exercises the real ContextColumn + AttachmentsGrid wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReportDetailPage from '@/components/admin/ReportDetailPage'
import type {
  AdminReportDetailResponse,
  AdminReportAttachment,
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

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

const REPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeAtt(overrides: Partial<AdminReportAttachment> = {}): AdminReportAttachment {
  return {
    id: 'att-1',
    storage_path: 'rep-1/photo-001.jpg',
    mime_type: 'image/jpeg',
    file_size: 234_000,
    uploaded_by: 'user-1',
    created_at: '2026-05-22T10:00:00.000Z',
    signed_url: 'https://example.supabase.co/storage/signed/photo-001.jpg?token=abc',
    ...overrides,
  }
}

function makeDetail(
  attachments: AdminReportAttachment[],
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
      title: 'Has photos',
      body: 'See attached.',
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
    messages: [],
    attachments,
    reporter: null,
    subject_user: null,
    ride: null,
  }
}

const EMPTY_AUDIT: AdminReportAuditResponse = { ok: true, audit: [] }

function wireMocks(detail: AdminReportDetailResponse) {
  mockAdminGet.mockImplementation((path: string) => {
    if (path.includes('/audit-log')) return Promise.resolve(EMPTY_AUDIT)
    if (path.startsWith('/reports/')) return Promise.resolve(detail)
    return Promise.resolve({})
  })
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportDetailPage — inline attachments grid', () => {
  it('shows the empty-state copy when attachments=[]', async () => {
    wireMocks(makeDetail([]))
    renderPage()
    const card = await screen.findByTestId('report-attachments')
    expect(within(card).getByText('No attachments.')).toBeInTheDocument()
  })

  it('renders image attachments as a thumbnail grid with signed-url <img> srcs', async () => {
    const a = makeAtt({ id: 'img-1', signed_url: 'https://example/x/a.jpg?t=1' })
    const b = makeAtt({ id: 'img-2', signed_url: 'https://example/x/b.png?t=2', mime_type: 'image/png' })
    wireMocks(makeDetail([a, b]))
    renderPage()

    const grid = await screen.findByTestId('report-attachments-image-grid')
    const thumbs = within(grid).getAllByRole('link')
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0]).toHaveAttribute('href', 'https://example/x/a.jpg?t=1')
    expect(thumbs[0]).toHaveAttribute('target', '_blank')
    const img = within(thumbs[0] as HTMLElement).getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example/x/a.jpg?t=1')
  })

  it('renders non-image attachments as a download row list', async () => {
    const pdf = makeAtt({
      id: 'pdf-1',
      storage_path: 'rep-1/transcript.pdf',
      mime_type: 'application/pdf',
      file_size: 4_500_000,
      signed_url: 'https://example/x/pdf?t=3',
    })
    wireMocks(makeDetail([pdf]))
    renderPage()

    const list = await screen.findByTestId('report-attachments-file-list')
    const row = within(list).getByTestId('report-attachment-pdf-1')
    expect(within(row).getByText('transcript.pdf')).toBeInTheDocument()
    expect(within(row).getByText(/application\/pdf · 4\.3 MB/)).toBeInTheDocument()
    const link = within(row).getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', 'https://example/x/pdf?t=3')
  })

  it('renders a "Preview unavailable" placeholder when signing failed', async () => {
    const broken = makeAtt({ id: 'gone-1', signed_url: null })
    wireMocks(makeDetail([broken]))
    renderPage()

    const card = await screen.findByTestId('report-attachment-gone-1')
    expect(within(card).getByText('Preview unavailable')).toBeInTheDocument()
    expect(within(card).getByText('photo-001.jpg')).toBeInTheDocument()
  })

  it('mixes images and non-images correctly in the same report', async () => {
    const img = makeAtt({ id: 'img-1' })
    const log = makeAtt({
      id: 'log-1',
      storage_path: 'rep-1/console.log',
      mime_type: 'text/plain',
      file_size: 800,
      signed_url: 'https://example/x/log?t=5',
    })
    wireMocks(makeDetail([img, log]))
    renderPage()

    await screen.findByTestId('report-attachments-image-grid')
    expect(screen.getByTestId('report-attachments-file-list')).toBeInTheDocument()
    expect(screen.getByText('console.log')).toBeInTheDocument()
  })
})
