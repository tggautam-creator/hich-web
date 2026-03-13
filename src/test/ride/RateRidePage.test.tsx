/**
 * RateRidePage tests
 *
 * Verifies:
 *  1. Shows loading spinner initially
 *  2. Renders 5 tappable stars
 *  3. Selecting 4-5 stars shows positive tags
 *  4. Selecting 1-3 stars shows issue tags + comment textarea
 *  5. Tags are toggleable
 *  6. Submit button disabled until stars selected
 *  7. Submit calls POST /api/rides/:id/rate
 *  8. Shows success state after submit
 *  9. Shows blind reveal message when other hasn't rated
 * 10. Shows revealed rating when both have rated
 * 11. Skip button navigates to home
 * 12. Tag conditional rendering — switching stars resets tags
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RateRidePage from '@/components/ride/RateRidePage'

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
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: profileRef.current }),
  ),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSingleFns: Record<string, ReturnType<typeof vi.fn>> = {}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => {
            const fn = mockSingleFns[table]
            return fn ? fn() : Promise.resolve({ data: null, error: null })
          },
        }),
      }),
    }),
    auth: {
      getSession: () => Promise.resolve({
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
  destination_name: '123 Main St',
  destination_bearing: null,
  pickup_point: null,
  pickup_note: null,
  dropoff_point: null,
  fare_cents: 850,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithRouter(rideId = 'ride-001') {
  return render(
    <MemoryRouter initialEntries={[`/ride/rate/${rideId}`]}>
      <Routes>
        <Route path="/ride/rate/:rideId" element={<RateRidePage />} />
        <Route path="/home/rider" element={<div data-testid="rider-home">Rider Home</div>} />
        <Route path="/home/driver" element={<div data-testid="driver-home">Driver Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RateRidePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profileRef.current = { id: 'rider-001' }
    mockSingleFns['rides'] = vi.fn(() => Promise.resolve({ data: completedRide, error: null }))
    mockSingleFns['users'] = vi.fn(() => Promise.resolve({ data: otherUser, error: null }))

    // Reset fetch mock
    vi.restoreAllMocks()
  })

  it('shows loading spinner initially', () => {
    mockSingleFns['rides'] = vi.fn(() => new Promise(() => {}))
    renderWithRouter()
    expect(screen.getByTestId('rate-ride')).toBeInTheDocument()
  })

  it('renders 5 tappable stars', async () => {
    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByTestId('star-row')).toBeInTheDocument()
    })

    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`star-${i}`)).toBeInTheDocument()
    }
  })

  it('submit button is disabled until stars are selected', async () => {
    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByTestId('submit-button')).toBeInTheDocument()
    })

    expect(screen.getByTestId('submit-button')).toBeDisabled()

    fireEvent.click(screen.getByTestId('star-4'))
    expect(screen.getByTestId('submit-button')).not.toBeDisabled()
  })

  it('selecting 4-5 stars shows positive tags', async () => {
    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-5'))

    await waitFor(() => {
      expect(screen.getByTestId('tags-section')).toBeInTheDocument()
    })

    expect(screen.getByText('What went well?')).toBeInTheDocument()
    expect(screen.getByTestId('tag-Great conversation')).toBeInTheDocument()
    expect(screen.getByTestId('tag-Smooth driving')).toBeInTheDocument()
    // Comment textarea should NOT be visible for positive ratings
    expect(screen.queryByTestId('comment-section')).not.toBeInTheDocument()
  })

  it('selecting 1-3 stars shows issue tags + comment textarea', async () => {
    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-2'))

    await waitFor(() => {
      expect(screen.getByTestId('tags-section')).toBeInTheDocument()
    })

    expect(screen.getByText('What could be improved?')).toBeInTheDocument()
    expect(screen.getByTestId('tag-Late pickup')).toBeInTheDocument()
    expect(screen.getByTestId('tag-Unsafe driving')).toBeInTheDocument()
    expect(screen.getByTestId('comment-section')).toBeInTheDocument()
    expect(screen.getByTestId('comment-input')).toBeInTheDocument()
  })

  it('tags are toggleable', async () => {
    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-5'))
    await waitFor(() => screen.getByTestId('tags-section'))

    const tag = screen.getByTestId('tag-Friendly')

    // Select
    fireEvent.click(tag)
    expect(tag.className).toContain('border-success')

    // Deselect
    fireEvent.click(tag)
    expect(tag.className).toContain('border-border')
  })

  it('switching from positive to negative stars resets tags', async () => {
    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    // Select 5 stars + a positive tag
    fireEvent.click(screen.getByTestId('star-5'))
    await waitFor(() => screen.getByTestId('tags-section'))
    fireEvent.click(screen.getByTestId('tag-Friendly'))

    // Switch to 2 stars
    fireEvent.click(screen.getByTestId('star-2'))
    await waitFor(() => {
      expect(screen.getByText('What could be improved?')).toBeInTheDocument()
    })

    // Positive tags should be gone, issue tags shown
    expect(screen.queryByTestId('tag-Friendly')).not.toBeInTheDocument()
    expect(screen.getByTestId('tag-Late pickup')).toBeInTheDocument()
  })

  it('submits rating and shows success with blind reveal message', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ride_id: 'ride-001',
        stars: 5,
        tags: ['Friendly'],
        revealed: false,
        other_rating: null,
      }), { status: 201 }),
    )

    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-5'))
    await waitFor(() => screen.getByTestId('tags-section'))
    fireEvent.click(screen.getByTestId('tag-Friendly'))
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => {
      expect(screen.getByText('Thanks for your feedback!')).toBeInTheDocument()
    })

    // Should show "waiting for other" message
    expect(screen.getByTestId('waiting-reveal')).toBeInTheDocument()

    // Verify API call
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/rides/ride-001/rate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ stars: 5, tags: ['Friendly'] }),
      }),
    )
  })

  it('shows revealed rating when both parties have rated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        ride_id: 'ride-001',
        stars: 4,
        tags: [],
        revealed: true,
        other_rating: { stars: 5, tags: ['Great conversation'] },
      }), { status: 201 }),
    )

    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-4'))
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('revealed-rating')).toBeInTheDocument()
    })

    expect(screen.getByText(/Jane Driver rated you/)).toBeInTheDocument()
  })

  it('skip button navigates rider to /home/rider', async () => {
    renderWithRouter()
    await waitFor(() => screen.getByTestId('skip-button'))

    fireEvent.click(screen.getByTestId('skip-button'))
    await waitFor(() => {
      expect(screen.getByTestId('rider-home')).toBeInTheDocument()
    })
  })

  it('skip button navigates driver to /home/driver', async () => {
    profileRef.current = { id: 'driver-001' }
    renderWithRouter()
    await waitFor(() => screen.getByTestId('skip-button'))

    fireEvent.click(screen.getByTestId('skip-button'))
    await waitFor(() => {
      expect(screen.getByTestId('driver-home')).toBeInTheDocument()
    })
  })

  it('shows other user name in header', async () => {
    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByText('Jane Driver')).toBeInTheDocument()
    })
    expect(screen.getByText('Rate your driver')).toBeInTheDocument()
  })

  it('shows "Rate your rider" for driver', async () => {
    profileRef.current = { id: 'driver-001' }
    renderWithRouter()
    await waitFor(() => {
      expect(screen.getByText('Rate your rider')).toBeInTheDocument()
    })
  })

  it('shows error on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { code: 'ALREADY_RATED', message: 'You have already rated this ride' },
      }), { status: 409 }),
    )

    renderWithRouter()
    await waitFor(() => screen.getByTestId('star-row'))

    fireEvent.click(screen.getByTestId('star-3'))
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('rating-error')).toHaveTextContent('You have already rated this ride')
    })
  })
})
