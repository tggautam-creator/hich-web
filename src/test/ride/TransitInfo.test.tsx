/**
 * TransitInfo tests
 *
 * Verifies:
 *  1. Renders transit chips when API returns options
 *  2. Shows loading skeleton while fetching
 *  3. Shows "No transit nearby" when options are empty
 *  4. Does not render when dropoff and destination are too close (< 200m)
 *  5. Handles API errors gracefully (renders nothing)
 *  6. Shows correct walk time and total time per chip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TransitInfo from '@/components/ride/TransitInfo'

// ── Supabase mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// ── Mock transit data ───────────────────────────────────────────────────────

const TRANSIT_OPTIONS = {
  options: [
    {
      type: 'SUBWAY',
      icon: '\u{1F687}',
      line_name: 'BART Blue',
      departure_stop: 'Downtown BART',
      arrival_stop: 'Oakland City Center',
      duration_minutes: 20,
      walk_minutes: 4,
      total_minutes: 25,
    },
    {
      type: 'BUS',
      icon: '\u{1F68C}',
      line_name: 'Route 42',
      departure_stop: 'Oakland City Center',
      arrival_stop: 'Berkeley Campus',
      duration_minutes: 30,
      walk_minutes: 2,
      total_minutes: 35,
    },
  ],
}

// SF coords for dropoff, Oakland coords for destination (far apart)
const DROPOFF_LAT = 37.7749
const DROPOFF_LNG = -122.4194
const DEST_LAT = 37.8044
const DEST_LNG = -122.2712

// Close coords (< 200m apart)
const CLOSE_LAT = 37.7750
const CLOSE_LNG = -122.4195

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TransitInfo', () => {
  let fetchSpy: { mockRestore: () => void }

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(TRANSIT_OPTIONS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('renders transit legs when API returns options', async () => {
    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('transit-leg')).toHaveLength(2)
    })

    expect(screen.getByText('BART Blue')).toBeDefined()
    expect(screen.getByText('Route 42')).toBeDefined()
    expect(screen.getByText('Transit from dropoff')).toBeDefined()
  })

  it('shows loading skeleton while fetching', () => {
    // Make fetch hang
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))

    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    expect(screen.getAllByTestId('transit-skeleton')).toHaveLength(2)
  })

  it('shows "No transit nearby" when API returns empty array', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ options: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('no-transit')).toBeDefined()
    })

    expect(screen.getByText('No transit options nearby')).toBeDefined()
  })

  it('does not render when dropoff and destination are < 200m apart', () => {
    const { container } = render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={CLOSE_LAT}
        destLng={CLOSE_LNG}
      />,
    )

    expect(container.innerHTML).toBe('')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('renders nothing on API error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )

    const { container } = render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      // Should show nothing after error
      expect(container.innerHTML).toBe('')
    })
  })

  it('shows step-by-step journey with stops and duration', async () => {
    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('transit-leg')).toHaveLength(2)
    })

    // BART Blue: Downtown BART → Oakland City Center · 20 min
    expect(screen.getByText(/Downtown BART → Oakland City Center/)).toBeDefined()
    expect(screen.getByText(/· 20 min/)).toBeDefined()
    // Route 42: Oakland City Center → Berkeley Campus · 30 min
    expect(screen.getByText(/Oakland City Center → Berkeley Campus/)).toBeDefined()
    expect(screen.getByText(/· 30 min/)).toBeDefined()
  })

  it('passes correct query parameters to the API', async () => {
    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    })

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0])
    expect(callUrl).toContain('/api/transit/options')
    expect(callUrl).toContain(`dropoff_lat=${DROPOFF_LAT}`)
    expect(callUrl).toContain(`dropoff_lng=${DROPOFF_LNG}`)
    expect(callUrl).toContain(`dest_lat=${DEST_LAT}`)
    expect(callUrl).toContain(`dest_lng=${DEST_LNG}`)
  })

  it('sends auth header with the request', async () => {
    render(
      <TransitInfo
        dropoffLat={DROPOFF_LAT}
        dropoffLng={DROPOFF_LNG}
        destLat={DEST_LAT}
        destLng={DEST_LNG}
      />,
    )

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    })

    const callOpts = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect((callOpts.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
  })
})
