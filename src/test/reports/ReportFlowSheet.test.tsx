/**
 * 2026-05-20 — Phase 2 smoke tests for the shared ReportFlowSheet.
 *
 * Verifies the core user-visible flow:
 *  1. Category step lists only categories for the given context
 *  2. Picking a category advances to the form step
 *  3. Continue button is disabled until body ≥10 chars
 *  4. Review step shows the captured fields + Submit fires the API
 *  5. Submitted step renders + "View report" navigates to /reports/:id
 *  6. Closed sheet returns null (no DOM nodes)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReportFlowSheet from '@/components/reports/ReportFlowSheet'

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      }),
    },
  },
}))

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

// fetch is the transport for /api/report/*
const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

// Geolocation not required for these tests; reject so the sheet
// just renders without GPS.
Object.defineProperty(navigator, 'geolocation', {
  value: {
    getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback) => {
      err?.({
        code: 1,
        message: 'denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError)
    },
  },
  configurable: true,
})

// ── Helpers ─────────────────────────────────────────────────────────

function ensurePortalRoot() {
  if (!document.getElementById('portal-root')) {
    const el = document.createElement('div')
    el.id = 'portal-root'
    document.body.appendChild(el)
  }
}

function renderSheet(props: Partial<Parameters<typeof ReportFlowSheet>[0]> = {}) {
  ensurePortalRoot()
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/reports']}>
          <Routes>
            <Route
              path="/reports"
              element={
                <ReportFlowSheet
                  isOpen
                  onClose={onClose}
                  context="general"
                  {...props}
                />
              }
            />
            <Route path="/reports/:id" element={<div data-testid="navigated-detail">at detail</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    onClose,
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ReportFlowSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
  })

  it('does not render when isOpen=false', () => {
    ensurePortalRoot()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ReportFlowSheet isOpen={false} onClose={vi.fn()} context="general" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByTestId('report-flow-sheet')).not.toBeInTheDocument()
  })

  it('renders category step with general-context categories only', () => {
    renderSheet()
    expect(screen.getByTestId('report-step-category')).toBeInTheDocument()
    // Categories with availableIn including 'general':
    expect(screen.getByTestId('report-category-bug_report')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-account_issue')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-feedback_feature')).toBeInTheDocument()
    expect(screen.getByTestId('report-category-harassment_messages')).toBeInTheDocument()
    // NOT in general context:
    expect(screen.queryByTestId('report-category-driver_conduct')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-category-safety_during_ride')).not.toBeInTheDocument()
  })

  it('advances to form on category pick + disables Continue until body is long enough', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByTestId('report-category-bug_report'))
    expect(await screen.findByTestId('report-step-form')).toBeInTheDocument()

    const continueBtn = screen.getByTestId('report-continue-button')
    expect(continueBtn).toBeDisabled()

    await user.type(screen.getByTestId('report-body-input'), 'too short')
    expect(continueBtn).toBeDisabled()

    await user.type(screen.getByTestId('report-body-input'), ' but now over 10 characters')
    expect(continueBtn).toBeEnabled()
  })

  it('submits via POST /api/report and reaches submitted step', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ ok: true, id: 'report-abc', severity: 'low', status: 'open' }),
    } as Response)

    renderSheet({ prefillCategory: 'bug_report' })

    // Prefill skips category step
    expect(await screen.findByTestId('report-step-form')).toBeInTheDocument()
    await user.type(
      screen.getByTestId('report-body-input'),
      'something went wrong in the app',
    )
    await user.click(screen.getByTestId('report-continue-button'))

    expect(await screen.findByTestId('report-step-review')).toBeInTheDocument()
    await user.click(screen.getByTestId('report-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('report-step-submitted')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    )
  })

  it('navigates to /reports/:id when View report is tapped', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({ ok: true, id: 'navigate-id', severity: 'normal', status: 'open' }),
    } as Response)

    renderSheet({ prefillCategory: 'feedback_feature' })
    await screen.findByTestId('report-step-form')
    await user.type(
      screen.getByTestId('report-body-input'),
      'feature suggestion goes here ok',
    )
    await user.click(screen.getByTestId('report-continue-button'))
    fireEvent.click(screen.getByTestId('report-submit-button'))
    await screen.findByTestId('report-step-submitted')
    await user.click(screen.getByTestId('report-open-detail-button'))

    await waitFor(() => {
      expect(screen.getByTestId('navigated-detail')).toBeInTheDocument()
    })
  })

  it('surfaces server error on the review step', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({ error: { code: 'INVALID_CATEGORY', message: 'nope' } }),
    } as Response)

    renderSheet({ prefillCategory: 'bug_report' })
    await screen.findByTestId('report-step-form')
    await user.type(
      screen.getByTestId('report-body-input'),
      'long enough body for validation',
    )
    await user.click(screen.getByTestId('report-continue-button'))
    fireEvent.click(screen.getByTestId('report-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('report-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('report-error').textContent).toContain('nope')
  })
})
