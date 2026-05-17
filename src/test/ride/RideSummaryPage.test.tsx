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

type TestProfile = {
  id: string
  stripe_customer_id?: string | null
  default_payment_method_id?: string | null
  wallet_balance?: number
}

const profileRef: { current: TestProfile } = { current: { id: 'rider-001' } }

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: TestProfile | null; refreshProfile: () => Promise<void> }) => unknown) =>
      selector({ profile: profileRef.current, refreshProfile: async () => {} }),
  ),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSingleFns: Record<string, ReturnType<typeof vi.fn>> = {}
// Override for list queries (e.g. ride_ratings, transactions). Default
// is empty list so unrelated tests stay quiet.
const mockListFns: Record<string, ReturnType<typeof vi.fn>> = {}

const { mockSingle } = vi.hoisted(() => ({
  mockSingle: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const listResult = () =>
          mockListFns[table]?.() ?? Promise.resolve({ data: [], error: null })
        const single = () => {
          const fn = mockSingleFns[table]
          return fn ? fn() : mockSingle()
        }
        // Thenable so `await select().eq(...)` resolves to the list
        // result, while .single() / .maybeSingle() / .in() keep their
        // existing semantics.
        const eqChain = () => {
          const chain: Record<string, unknown> = {
            eq: eqChain,
            in: () => listResult(),
            single,
            maybeSingle: single,
          }
          ;(chain as { then: PromiseLike<unknown>['then'] }).then = (
            onFulfilled,
            onRejected,
          ) => listResult().then(onFulfilled, onRejected)
          return chain
        }
        return { eq: eqChain }
      },
    }),
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: 'test-token' } },
          error: null,
        }),
    },
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
    // Reset list-query overrides each test.
    for (const k of Object.keys(mockListFns)) delete mockListFns[k]
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

    // Sprint 2 W-T1-R1+R2 — rating + tip are now inline on RideSummary.
    // The old "Rate Your Driver" PrimaryButton + navigate-to-rate-page
    // flow has been folded into the new `rate-section`. The two tests
    // that exercised the old surface (`rate-button` exists + navigates)
    // are replaced with verifications of the new inline form.
    it('renders the inline rate section with prompt + star row', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('rate-section')).toBeInTheDocument()
      })
      expect(screen.getByText('How was your trip?')).toBeInTheDocument()
      expect(screen.getByTestId('star-row')).toBeInTheDocument()
      expect(screen.getByTestId('submit-rating')).toBeDisabled()
    })

    it('enables Submit button once stars are picked', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('star-row'))
      fireEvent.click(screen.getByTestId('star-5'))
      expect(screen.getByTestId('submit-rating')).not.toBeDisabled()
    })

    // Sprint 2 W-T1-R1+R2 — happy-path coverage for the new inline
    // submit flow. The previous form-behavior tests lived on the
    // separate /ride/rate page (now a redirect); these replace them
    // for the consolidated screen.

    it('low rating shows comment textarea + issue-style tags', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('star-row'))

      // 2 stars → low rating
      fireEvent.click(screen.getByTestId('star-2'))
      expect(screen.getByText('What could be improved?')).toBeInTheDocument()
      expect(screen.getByTestId('comment-input')).toBeInTheDocument()
      // One of the driver-issue tags should render (proves issue tag set is in use)
      expect(screen.getByTestId('tag-Late pickup')).toBeInTheDocument()

      // Flip up to 5 stars → tags should switch to positive set, no comment
      fireEvent.click(screen.getByTestId('star-5'))
      expect(screen.getByText('What went well?')).toBeInTheDocument()
      expect(screen.queryByTestId('comment-input')).not.toBeInTheDocument()
      expect(screen.getByTestId('tag-Smooth driving')).toBeInTheDocument()
    })

    it('submit POSTs /rate and transitions to thank-you state', async () => {
      // URL-routed fetch mock — the rider tip-card load on mount also
      // hits fetch (`GET /api/payment/methods`), so a strict
      // mockResolvedValueOnce sequence would mis-route the rate
      // response into the card fetch. Route by URL instead.
      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/payment/methods') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ methods: [], default_method_id: null }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ revealed: false, other_rating: null }),
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => screen.getByTestId('star-row'))

        fireEvent.click(screen.getByTestId('star-5'))
        fireEvent.click(screen.getByTestId('submit-rating'))

        await waitFor(() => {
          expect(screen.getByTestId('rate-submitted')).toBeInTheDocument()
        })
        expect(screen.getByText('Thanks for your feedback!')).toBeInTheDocument()
        expect(screen.getByTestId('waiting-reveal')).toBeInTheDocument()

        // Find the /rate call by URL (might not be index 0 because the
        // card-load mount fetch fires first).
        const rateCall = fetchMock.mock.calls.find(
          ([url]) => (url as string) === '/api/rides/ride-001/rate',
        ) as [string, RequestInit] | undefined
        expect(rateCall).toBeDefined()
        expect(rateCall![1].method).toBe('POST')
        const body = JSON.parse(rateCall![1].body as string) as { stars: number; tags: string[] }
        expect(body.stars).toBe(5)
        expect(body.tags).toEqual([])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('submit with tip POSTs /rate then /tip and shows tip confirmation', async () => {
      // Rider has a saved card so tip goes via card path
      profileRef.current = {
        id: 'rider-001',
        stripe_customer_id: 'cus_test',
        default_payment_method_id: 'pm_test',
        wallet_balance: 0,
      }

      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/payment/methods') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
              default_method_id: 'pm_test',
            }),
          })
        }
        if (url.endsWith('/rate')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ revealed: false, other_rating: null }),
          })
        }
        if (url.endsWith('/tip')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ tipped: true, method: 'card', stripe_fee_cents: 33 }),
          })
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => screen.getByTestId('star-row'))

        fireEvent.click(screen.getByTestId('star-5'))
        // Tip picker is always shown for rider — pick the 20% chip.
        await waitFor(() => screen.getByTestId('tip-picker'))
        fireEvent.click(screen.getByTestId('tip-20%'))

        // Submit
        fireEvent.click(screen.getByTestId('submit-rating'))

        await waitFor(() => {
          expect(screen.getByTestId('rate-submitted')).toBeInTheDocument()
        })
        expect(screen.getByTestId('tip-method-confirm')).toBeInTheDocument()

        // Both /rate and /tip were called (URL-based, since /payment/methods
        // also gets called on mount and shifts the indices).
        const urls = fetchMock.mock.calls.map(([url]) => url as string)
        expect(urls).toContain('/api/rides/ride-001/rate')
        expect(urls).toContain('/api/rides/ride-001/tip')
        // Order between /rate and /tip — /rate must fire first.
        expect(urls.indexOf('/api/rides/ride-001/rate')).toBeLessThan(
          urls.indexOf('/api/rides/ride-001/tip'),
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('tip picker is always rendered for riders regardless of star count', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('star-row'))
      // Tip picker shown before any stars picked (matches iOS).
      expect(screen.getByTestId('tip-picker')).toBeInTheDocument()
      expect(screen.getByTestId('tip-none')).toBeInTheDocument()
    })

    it('allows tip-only submit (rider sends a tip without rating)', async () => {
      profileRef.current = {
        id: 'rider-001',
        stripe_customer_id: 'cus_test',
        default_payment_method_id: 'pm_test',
        wallet_balance: 0,
      }
      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/payment/methods') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
              default_method_id: 'pm_test',
            }),
          })
        }
        if (url.endsWith('/tip')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ tipped: true, method: 'card', stripe_fee_cents: 33 }),
          })
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => screen.getByTestId('tip-picker'))
        fireEvent.click(screen.getByTestId('tip-20%'))

        const submit = screen.getByTestId('submit-rating')
        expect(submit).not.toBeDisabled()
        expect(submit).toHaveTextContent('Send tip')

        fireEvent.click(submit)
        await waitFor(() => screen.getByTestId('rate-submitted'))

        // /tip called; /rate not called (stars were 0)
        const urls = fetchMock.mock.calls.map(([url]) => url as string)
        expect(urls).toContain('/api/rides/ride-001/tip')
        expect(urls.filter((u) => u.endsWith('/rate'))).toEqual([])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('shows the saved-card brand + last4 in the tip-method row when a card is on file', async () => {
      profileRef.current = {
        id: 'rider-001',
        stripe_customer_id: 'cus_test',
        default_payment_method_id: 'pm_test',
        wallet_balance: 0,
      }
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
            default_method_id: 'pm_test',
          }),
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => {
          expect(screen.getByTestId('tip-method-row')).toHaveTextContent('Visa •••• 4242')
        })
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('Done button copy is "Maybe later" pre-submit and "Done" post-submit', async () => {
      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/payment/methods') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ methods: [], default_method_id: null }),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ revealed: false, other_rating: null }),
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => screen.getByTestId('done-button'))
        expect(screen.getByTestId('done-button')).toHaveTextContent('Maybe later')

        fireEvent.click(screen.getByTestId('star-5'))
        fireEvent.click(screen.getByTestId('submit-rating'))

        await waitFor(() => screen.getByTestId('rate-submitted'))
        expect(screen.getByTestId('done-button')).toHaveTextContent('Done')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('hydrates submitted state when the rider already rated this ride', async () => {
      // Mirrors iOS hydrateExistingRating — re-opening /ride/summary/<id>
      // for an already-rated ride should show "Thanks for your feedback!"
      // + the revealed counterpart rating, not the empty form.
      mockListFns['ride_ratings'] = vi.fn(() =>
        Promise.resolve({
          data: [
            {
              rater_id: 'rider-001',
              stars: 4,
              tags: ['On time', 'Friendly'],
              comment: null,
            },
            {
              rater_id: 'driver-001',
              stars: 5,
              tags: ['Respectful'],
              comment: null,
            },
          ],
          error: null,
        }),
      )

      renderWithRouter()

      await waitFor(() => {
        expect(screen.getByTestId('rate-submitted')).toBeInTheDocument()
      })
      // Empty form should NOT render
      expect(screen.queryByTestId('star-row')).not.toBeInTheDocument()
      expect(screen.queryByTestId('submit-rating')).not.toBeInTheDocument()
      // Counterpart rating revealed
      expect(screen.getByTestId('revealed-rating')).toBeInTheDocument()
    })

    it('rate API failure surfaces an error and keeps form open', async () => {
      const fetchMock = vi.fn((url: string) => {
        if (url === '/api/payment/methods') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ methods: [], default_method_id: null }),
          })
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'INTERNAL', message: 'Server exploded' } }),
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      try {
        renderWithRouter()
        await waitFor(() => screen.getByTestId('star-row'))

        fireEvent.click(screen.getByTestId('star-5'))
        fireEvent.click(screen.getByTestId('submit-rating'))

        await waitFor(() => {
          expect(screen.getByTestId('rating-error')).toHaveTextContent('Server exploded')
        })
        // Form stays open — no submitted state
        expect(screen.queryByTestId('rate-submitted')).not.toBeInTheDocument()
        expect(screen.getByTestId('submit-rating')).toBeInTheDocument()
      } finally {
        vi.unstubAllGlobals()
      }
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

    it('driver view also renders the inline rate section (but no tip picker)', async () => {
      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('rate-section')).toBeInTheDocument()
      })
      // The "How was your trip?" prompt is the same for driver + rider.
      expect(screen.getByText('How was your trip?')).toBeInTheDocument()
      // Tip picker is rider-only — drivers never see it even at 5 stars.
      fireEvent.click(screen.getByTestId('star-5'))
      expect(screen.queryByTestId('tip-picker')).not.toBeInTheDocument()
    })

    it('Done button navigates driver to /home/driver', async () => {
      renderWithRouter()
      await waitFor(() => screen.getByTestId('done-button'))

      fireEvent.click(screen.getByTestId('done-button'))
      await waitFor(() => {
        expect(screen.getByTestId('driver-home')).toBeInTheDocument()
      })
    })

    // Sprint 3 W-T1-P9 — drivers never see "PAYMENT FAILED" and DO see
    // the "Settling with the rider" reassurance card when payment is
    // pending/failed. They earn the fare either way; only riders need
    // the dunning friction.
    it('driver view shows "Payment pending" + Settling note when payment_status=failed', async () => {
      mockSingleFns['rides'] = vi.fn(() =>
        Promise.resolve({
          data: { ...completedRide, payment_status: 'failed' },
          error: null,
        }),
      )
      mockSingleFns['users'] = vi.fn(() => Promise.resolve({ data: { ...otherUser, id: 'rider-001', full_name: 'John Rider', is_driver: false }, error: null }))
      mockSingleFns['vehicles'] = vi.fn(() => Promise.resolve({ data: vehicle, error: null }))

      renderWithRouter()
      await waitFor(() => {
        expect(screen.getByTestId('fare-message')).toHaveTextContent('You earned')
      })
      const pill = screen.getByTestId('payment-status')
      expect(pill).toHaveTextContent('Payment pending')
      expect(pill).not.toHaveTextContent('failed')
      expect(screen.getByTestId('driver-settling-note')).toBeInTheDocument()
      // Rider-only dunning CTAs must NOT render
      expect(screen.queryByTestId('retry-payment-button')).not.toBeInTheDocument()
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
