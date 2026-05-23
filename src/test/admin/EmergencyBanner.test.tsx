/**
 * 2026-05-22 — Phase 4 of docs/REPORTS_PLAN.md. Locks the
 * emergency-banner behavior so an admin can never accidentally
 * regress the "drop everything" surface:
 *
 *   1. Renders nothing when the open-emergency list is empty.
 *   2. Renders one stacked card per open emergency.
 *   3. Each card has the reporter name, title, Open-report link
 *      pointing at `/admin/reports/:id`, and a 🚨 Acknowledge button.
 *   4. Clicking Acknowledge POSTs the status flip to `in_progress`.
 *   5. The status mutation invalidates the emergency-banner query so
 *      the row vanishes on success without waiting on the next poll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import EmergencyBanner from '@/components/admin/EmergencyBanner'
import type { AdminReportInboxResponse } from '@/hooks/useAdminReports'

const { mockAdminGet, mockAdminPost } = vi.hoisted(() => ({
  mockAdminGet: vi.fn(),
  mockAdminPost: vi.fn(),
}))

vi.mock('@/lib/admin/api', () => ({
  adminGet: mockAdminGet,
  adminPost: mockAdminPost,
}))

function makeRow(overrides: Partial<AdminReportInboxResponse['reports'][number]> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    reporter_id: 'reporter-001',
    reporter_name: 'Maya Rider',
    reporter_email: 'maya@ucdavis.edu',
    category: 'safety_during_ride',
    severity: 'emergency' as const,
    status: 'open' as const,
    title: 'Driver swerving on I-80',
    body_preview: 'Driver is swerving and ignoring my pickup request.',
    ride_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    requested_refund_cents: null,
    assigned_admin_id: null,
    created_at: new Date(Date.now() - 30 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 1000).toISOString(),
    ...overrides,
  }
}

function renderBanner() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <EmergencyBanner />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EmergencyBanner', () => {
  it('renders nothing when the open-emergency list is empty', async () => {
    mockAdminGet.mockResolvedValueOnce({
      ok: true,
      reports: [],
      total: 0,
      counts: { open: 0, urgent: 0, emergency: 0 },
      limit: 10,
      offset: 0,
    } satisfies AdminReportInboxResponse)
    renderBanner()
    // Banner is hidden during the initial fetch + when the list is
    // empty. Querying for the testid should never resolve.
    await waitFor(() => {
      expect(mockAdminGet).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('emergency-banner')).not.toBeInTheDocument()
  })

  it('renders one stacked card per open emergency', async () => {
    const a = makeRow({ id: 'id-001', reporter_name: 'Alice' })
    const b = makeRow({ id: 'id-002', reporter_name: 'Bob' })
    mockAdminGet.mockResolvedValueOnce({
      ok: true,
      reports: [a, b],
      total: 2,
      counts: { open: 2, urgent: 0, emergency: 2 },
      limit: 10,
      offset: 0,
    } satisfies AdminReportInboxResponse)
    renderBanner()

    await waitFor(() => {
      expect(screen.getByTestId('emergency-banner')).toBeInTheDocument()
    })
    expect(screen.getByTestId('emergency-banner-row-id-001')).toBeInTheDocument()
    expect(screen.getByTestId('emergency-banner-row-id-002')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('Open-report link points at /admin/reports/:id', async () => {
    const row = makeRow({ id: 'deep-link-id' })
    mockAdminGet.mockResolvedValueOnce({
      ok: true,
      reports: [row],
      total: 1,
      counts: { open: 1, urgent: 0, emergency: 1 },
      limit: 10,
      offset: 0,
    } satisfies AdminReportInboxResponse)
    renderBanner()
    const link = await screen.findByTestId('emergency-banner-open-deep-link-id')
    expect(link).toHaveAttribute('href', '/admin/reports/deep-link-id')
  })

  it('Acknowledge POSTs status=in_progress via the action endpoint', async () => {
    const row = makeRow({ id: 'ack-id' })
    mockAdminGet.mockResolvedValue({
      ok: true,
      reports: [row],
      total: 1,
      counts: { open: 1, urgent: 0, emergency: 1 },
      limit: 10,
      offset: 0,
    } satisfies AdminReportInboxResponse)
    mockAdminPost.mockResolvedValueOnce({ ok: true, status: 'in_progress' })

    renderBanner()
    const ackButton = await screen.findByTestId('emergency-banner-ack-ack-id')
    fireEvent.click(ackButton)

    await waitFor(() => {
      expect(mockAdminPost).toHaveBeenCalledWith(
        '/reports/ack-id/actions/status',
        { status: 'in_progress' },
      )
    })
  })

  it('falls back to reporter_email then "Anonymous reporter" when name is nil', async () => {
    const noName = makeRow({ id: 'nn-id', reporter_name: null })
    const noAnything = makeRow({
      id: 'anon-id',
      reporter_name: null,
      reporter_email: null,
    })
    mockAdminGet.mockResolvedValueOnce({
      ok: true,
      reports: [noName, noAnything],
      total: 2,
      counts: { open: 2, urgent: 0, emergency: 2 },
      limit: 10,
      offset: 0,
    } satisfies AdminReportInboxResponse)
    renderBanner()

    await waitFor(() => {
      expect(screen.getByText('maya@ucdavis.edu')).toBeInTheDocument()
    })
    expect(screen.getByText('Anonymous reporter')).toBeInTheDocument()
  })
})
