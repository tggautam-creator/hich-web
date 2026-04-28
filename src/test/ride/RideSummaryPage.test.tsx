/**
 * RideSummaryPage tests
 *
 * Verifies:
 *  1. Shows loading spinner initially
 *  2. Shows "Ride not found" when ride doesn't exist
 *  3. Green checkmark is displayed
 *  4. Confetti canvas renders
 *  5. Rider view: shows "$X.XX charged"
 *  6. Driver view: shows "You earned $X.XX"
 *  7. Fare breakdown toggle opens/closes
 *  8. Fare breakdown shows ride fare, platform fee, driver earns
 *  9. Rate button exists and navigates to /ride/rate/:rideId
 * 10. Done button navigates rider to /home/rider
 * 11. Done button navigates driver to /home/driver
 * 12. Report link exists
 * 13. Shows other user info and ride duration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RideSummaryPage from '@/components/ride/RideSummaryPage'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  env: {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
  },
}))

const profileRef = { current: { id: 'rider-001' } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null; refreshProfile: () => Promise<void> }) => unknown) =>
      selector({ profile: profileRef.current, refreshProfile: async () => {} }),
  ),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSingleFns: Record<string, ReturnType<typeof vi.fn>> = {}

const { mockSingle } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        // Chained .eq().eq().in() lands here as a "list" query — used by
        // the wallet/card-split fetch in RideSummaryPage. Default: empty
        // list so the split row stays hidden in tests that don't care.
        const listResult = Promise.resolve({ data: [], error: null })
        const single = () => {
          const fn = mockSingleFns[table]
          return fn ? fn() : mockSingle()
        }
        const eqChain = () => ({
          eq: eqChain,
          in: () => listResult,
          single,
          maybeSingle: single,
        })
        return { eq: eqChain }
      },
    }),
  },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const completedRide = {
  id: 'ride-001',
  rider_id: 'rider-001',
  driver_id: 'driver-001',
  vehicle_id: 'vehicle-001',
  status: 'completed' as const,
  origin: { type: 'Point' as const, coordinates: [-121.74, 38.54] as [number, number] },
  destination: { type: 'Point' as const, coordinates: [-121.75, 38.55] as [number, number] },
  destination_name: '123 Main St, Davis',
  destination_bearing: null,
  pickup_point: null,
  pickup_note: null,
  dropoff_point: null,
  fare_cents: 850,
  stripe_fee_cents: 55,
  payment_status: 'paid',
  payment_intent_id: 'pi_test_001',
  started_at: '2026-03-09T10:00:00Z',
  ended_at: '2026-03-09T10:15:00Z',
  created_at: '2026-03-09T09:55:00Z',
}

const otherUser = {
  id: 'driver-001',
  email: 'driver@ucdavis.edu',
  phone: null,
  full_name: 'Jane Driver',
  avatar_url: null,
  wallet_balance: 5000,
  stripe_customer_id: null,
  is_driver: true,
  rating_avg: 4.8,
  rating_count: 10,
  home_location: null,
  created_at: '2026-01-01T00:00:00Z',
}

const vehicle = {
  id: 'vehicle-001',
  user_id: 'driver-001',
  vin: '12345678901234567',
  make: 'Toyota',
  model: 'Camry',
  year: 2022,
  color: 'Blue',
  plate: 'ABC1234',
  license_plate_photo_url: null,
  car_photo_url: null,
  seats_available: 4,
  fuel_efficiency_mpg: 30,
  is_active: true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithRouter(rideId = 'ride-001') {
  return render(
    <MemoryRouter initialEntries={[`/ride/summary/${rideId}`]}>
      <Routes>
        <Route path="/ride/summary/:rideId" element={<RideSummaryPage />} />
        <Route path="/ride/rate/:rideId" element={<div data-testid="rate-page">Rate</div>} />
        <Route path="/home/rider" element={<div data-testid="rider-home">Rider Home</div>} />
        <Route path="/home/driver" element={<div data-testid="driver-home">Driver Home</div>} />
        <Route path="/report/:rideId" element={<div data-testid="report-page">Report</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RideSummaryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profileRef.current = { id: 'rider-001' }

    // Default: all table lookups return null
    mockSingleFns['rides'] = vi.fn(() => Promise.resolve({ data: null, error: null }))
    mockSingleFns['users'] = vi.fn(() => Promise.resolve({ data: null, error: null }))
    mockSingleFns['vehicles'] = vi.fn(() => Promise.resolve({ data: null, error: null }))
  })

  it('shows loading spinner initially', () => {
    // ride query never resolves (hangs)
    mockSingleFns['rides'] = vi.fn(() => new Promise(() => {}))
    renderWithRouter()

    expect(screen.getByTestId('ride-summary')).toBeInTheDocument()
  })

  it('shows "Ride not found" when ride does not exist', async () => {
    mockSingleFns['rides'] = vi.fn(() => Promise.resolve({ data: null, error: null }))
    renderWithRouter()

    await waitFor(() => {
      expect(screen.getByText('Ride not found.')).toBeInTheDocument()
    })
    expect(screen.getByTestId('go-home')).toBeInTheDocument()
  })

  describe('Rider view', () => {
    beforeEach(() => {
      profileRef.current = { id: 'rider-001' }
      mockSingleFns['rides'] = vi.fn(() => Promise.resolve({ data: completedRide, error: null }))
      mockSingleFns['users'] = vi.fn(() => Promise.resolve({ data: otherUser, error: null }))
      mockSingleFns['vehicles'] = vi.fn(() => Promise.resolve({ data: vehicle, error: null }))
    })

    it('shows green checkmark', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('checkmark')).toBeInTheDocument()
      })
    })

    it('renders confetti canvas', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('confetti')).toBeInTheDocument()
      })
    })

    it('shows "$X.XX charged" for rider (fare + Stripe fee)', async () => {
      renderWithRouter()
      await waitFor(() => {
        // totalCharged = fare_cents(850) + stripe_fee_cents(55) = 905 → $9.05
        expect(screen.getByTestId('fare-message')).toHaveTextContent('$9.05 charged')
      })
    })

    it('shows destination name', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByText('123 Main St, Davis')).toBeInTheDocument()
      })
    })

    it('shows ride duration', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByText('Time together: 15 min')).toBeInTheDocument()
      })
    })

    it('shows driver info', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByText('Jane Driver')).toBeInTheDocument()
      })
      const rideCard = screen.getByTestId('ride-card')
      expect(rideCard.textContent).toContain('Driver')
    })

    it('shows vehicle info for rider', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByText(/Blue 2022 Toyota Camry/)).toBeInTheDocument()
      })
    })

    it('has fare breakdown toggle', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('fare-breakdown-toggle')).toBeInTheDocument()
      })

      // Initially closed
      expect(screen.queryByTestId('fare-breakdown')).not.toBeInTheDocument()

      // Open
      fireEvent.click(screen.getByTestId('fare-breakdown-toggle'))
      expect(screen.getByTestId('fare-breakdown')).toBeInTheDocument()

      // Shows correct values: ride fare $8.50, processing fee $0.55, total $9.05
      expect(screen.getAllByText('$8.50').length).toBeGreaterThanOrEqual(1) // ride fare
      expect(screen.getByText('$0.55')).toBeInTheDocument() // processing fee
      expect(screen.getByText('$9.05')).toBeInTheDocument() // total charged

      // Close
      fireEvent.click(screen.getByTestId('fare-breakdown-toggle'))
      expect(screen.queryByTestId('fare-breakdown')).not.toBeInTheDocument()
    })

    it('has Rate button labelled for rider', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('rate-button')).toHaveTextContent('Rate Your Driver')
      })
    })

    it('Rate button navigates to rate page', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('rate-button'))

      fireEvent.click(screen.getByTestId('rate-button'))
      await waitFor(() => {
        expect(screen.getByTestId('rate-page')).toBeInTheDocument()
      })
    })

    it('Done button navigates rider to /home/rider', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('done-button'))

      fireEvent.click(screen.getByTestId('done-button'))
      await waitFor(() => {
        expect(screen.getByTestId('rider-home')).toBeInTheDocument()
      })
    })

    it('has Report link', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('report-link')).toBeInTheDocument()
        expect(screen.getByText('Report an issue')).toBeInTheDocument()
      })
    })

    it('Report link navigates to report page', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('report-link'))

      fireEvent.click(screen.getByTestId('report-link'))
      await waitFor(() => {
        expect(screen.getByTestId('report-page')).toBeInTheDocument()
      })
    })
  })

  describe('Driver view', () => {
    beforeEach(() => {
      profileRef.current = { id: 'driver-001' }
      mockSingleFns['rides'] = vi.fn(() => Promise.resolve({ data: completedRide, error: null }))
      mockSingleFns['users'] = vi.fn(() => Promise.resolve({ data: { ...otherUser, id: 'rider-001', full_name: 'John Rider', is_driver: false }, error: null }))
      mockSingleFns['vehicles'] = vi.fn(() => Promise.resolve({ data: vehicle, error: null }))
    })

    it('shows "You earned $X.XX" for driver (full fare, zero commission)', async () => {
      renderWithRouter()
      await waitFor(() => {
        // Driver earns full fare: 850 → $8.50
        expect(screen.getByTestId('fare-message')).toHaveTextContent('You earned $8.50')
      })
    })

    it('has Rate button labelled for driver', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('rate-button')).toHaveTextContent('Rate Your Rider')
      })
    })

    it('Done button navigates driver to /home/driver', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('done-button'))

      fireEvent.click(screen.getByTestId('done-button'))
      await waitFor(() => {
        expect(screen.getByTestId('driver-home')).toBeInTheDocument()
      })
    })

    it('does not show vehicle info for driver', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('ride-card')).toBeInTheDocument()
      })

      expect(screen.queryByText(/Blue 2022 Toyota Camry/)).not.toBeInTheDocument()
    })

    it('shows rider info', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByText('John Rider')).toBeInTheDocument()
      })
      // Check there's a label that says "Rider" (inside the ride card, not the button)
      const rideCard = screen.getByTestId('ride-card')
      expect(rideCard.textContent).toContain('Rider')
    })
  })
})
