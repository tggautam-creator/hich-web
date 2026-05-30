/**
 * v1.2 Sprint 6 Slice 5 — BoardOfferAcceptPage caregiver-waiver
 * banner gating + copy. Mocks the offers fetch at the supabase + fetch
 * boundary so the test runs without a real session / server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BoardOfferAcceptPage from '@/components/ride/BoardOfferAcceptPage'

// ── Mocks ────────────────────────────────────────────────────────────

const { mockGetSession, mockFetch, mockNavigate } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
  mockFetch: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams:   () => ({ scheduleId: 'sched-1' }),
  }
})

beforeEach(() => {
  mockNavigate.mockClear()
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

interface OfferFixture {
  id?: string
  driverFullName?: string | null
  driverWaiveCaregiverFee?: boolean
}

function mockOffersResponse({
  hasCaregiver,
  caregiverFareCents,
  offer = {},
}: {
  hasCaregiver: boolean
  caregiverFareCents: number | null
  offer?: OfferFixture
}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      offers: [{
        id:                    offer.id ?? 'o-1',
        status:                'pending',
        created_at:            '2026-05-01T12:00:00Z',
        proposed_pickup_name:  null,
        proposed_dropoff_name: null,
        proposed_fare_cents:   1200,
        proposed_eta_minutes:  null,
        driver: {
          id:                       'd-1',
          full_name:                offer.driverFullName === undefined ? 'Sarah Smith' : offer.driverFullName,
          avatar_url:               null,
          rating_avg:               4.8,
          rating_count:             12,
          waive_caregiver_fee:      offer.driverWaiveCaregiverFee ?? false,
        },
        vehicle: null,
      }],
      posted: {
        pickup_name:          null,
        pickup_lat:           null,
        pickup_lng:           null,
        dropoff_name:         null,
        dropoff_lat:          null,
        dropoff_lng:          null,
        trip_date:            '2026-06-01',
        trip_time:            '10:00:00',
        time_flexible:        false,
        has_caregiver:        hasCaregiver,
        caregiver_fare_cents: caregiverFareCents,
      },
    }),
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BoardOfferAcceptPage />
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BoardOfferAcceptPage — caregiver waiver banner', () => {
  it('renders the banner when posted.has_caregiver + driver.waive_caregiver_fee are both true', async () => {
    mockOffersResponse({
      hasCaregiver: true,
      caregiverFareCents: 500,
      offer: { driverWaiveCaregiverFee: true, driverFullName: 'Sarah Smith' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('board-offer-caregiver-waiver')).toBeTruthy()
    })
    const banner = screen.getByTestId('board-offer-caregiver-waiver')
    expect(banner.textContent).toContain('Sarah waives the $5.00 caregiver seat fee')
    expect(banner.textContent).toContain("you'll only be charged the base fare")
  })

  it('falls back to "Your driver" when driver.full_name is null', async () => {
    mockOffersResponse({
      hasCaregiver: true,
      caregiverFareCents: 300,
      offer: { driverFullName: null, driverWaiveCaregiverFee: true },
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('board-offer-caregiver-waiver').textContent)
        .toContain('Your driver waives the $3.00 caregiver seat fee')
    })
  })

  it('omits the dollar amount when caregiver_fare_cents is null', async () => {
    mockOffersResponse({
      hasCaregiver: true,
      caregiverFareCents: null,
      offer: { driverWaiveCaregiverFee: true, driverFullName: 'Sarah' },
    })

    renderPage()
    await waitFor(() => {
      const text = screen.getByTestId('board-offer-caregiver-waiver').textContent ?? ''
      expect(text).toContain('Sarah waives the caregiver seat fee')
      expect(text).not.toContain('$')
    })
  })

  it('hides the banner when posted.has_caregiver is false', async () => {
    mockOffersResponse({
      hasCaregiver: false,
      caregiverFareCents: 500,
      offer: { driverWaiveCaregiverFee: true },
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('board-offer-card')).toBeTruthy()
    })
    expect(screen.queryByTestId('board-offer-caregiver-waiver')).toBeNull()
  })

  it('hides the banner when driver.waive_caregiver_fee is false', async () => {
    mockOffersResponse({
      hasCaregiver: true,
      caregiverFareCents: 500,
      offer: { driverWaiveCaregiverFee: false },
    })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('board-offer-card')).toBeTruthy()
    })
    expect(screen.queryByTestId('board-offer-caregiver-waiver')).toBeNull()
  })
})
