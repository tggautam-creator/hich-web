/**
 * v1.3 Sprint 10 Slice 4 — transit mini-map + station peek +
 * "Use this stop" CTA inside RideBoardConfirmSheet.
 *
 * Mirrors iOS RideBoardTransitMiniMap.swift (overview vs peek
 * markers) + RideBoardConfirmDestinationSection.swift::transitRow
 * (lines 199-343) + transitSubtitle (line 341 verbatim).
 *
 * Tests:
 *   - Loading spinner while /api/transit/preview pending
 *   - Mini-map + station rows render after suggestions arrive
 *   - Overview: all numbered station pins + rider dest + driver
 *     origin + driver dest context pins all rendered
 *   - Tap a station row → peek mode (only peeked station + rider
 *     dest pins on the map; "Use this stop" CTA on the peeked card)
 *   - Tap the peeked row again → collapses back to overview
 *   - Tap "Use this stop" → swaps selectedPlace to the station and
 *     clears the suggestions list (consistent with pre-Slice-4 commit
 *     semantics; peek now gated behind the explicit CTA)
 *   - Subtitle copy verbatim against iOS line 341:
 *     "{walk} min walk · {transit} min transit · {total} min total"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import RideBoardConfirmSheet from '@/components/schedule/RideBoardConfirmSheet'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="google-map" {...(props as Record<string, string>)}>{children as React.ReactNode}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode; [k: string]: unknown }) => (
    <div data-testid="advanced-marker">{children}</div>
  ),
  useMap: () => null,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
  decodePolyline: () => [],
}))

vi.mock('@/lib/places', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
  getPlaceCoordinates: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/fareEstimate', () => ({
  estimateScheduleFare: vi.fn().mockReturnValue(null),
}))

const { mockGetSession, mockFetch } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

// v1.3 Sprint 10 Slice 6 — RideBoardConfirmSheet now consumes
// useMyCaregivers (for the caregiver picker on the rider-on-driver-post
// path). Stub here so the test doesn't need a QueryClientProvider — the
// transit mini-map paths exercised below don't involve the caregiver
// picker (test profile has no accessibility needs).
vi.mock('@/hooks/useCaregivers', () => ({
  useMyCaregivers: () => ({ data: [], isLoading: false, error: null }),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: null }) => unknown) =>
    selector({ profile: null }),
}))

function makeRide(overrides: Partial<ScheduledRide> = {}): ScheduledRide {
  return {
    id: 'sched-1',
    user_id: 'u-poster',
    mode: 'driver',
    origin_address: 'San Jose',
    origin_lat: 37.34,
    origin_lng: -121.89,
    dest_address: 'Davis',
    dest_lat: 38.55,
    dest_lng: -121.74,
    driver_origin_lat: 37.34,
    driver_origin_lng: -121.89,
    driver_dest_lat: 38.55,
    driver_dest_lng: -121.74,
    trip_date: '2026-06-10',
    trip_time: '09:00:00',
    time_type: 'departure',
    time_flexible: false,
    created_at: '2026-06-01T12:00:00Z',
    poster: { id: 'u-poster', full_name: 'Alex Driver', avatar_url: null, rating_avg: 4.9 },
    already_requested: false,
    ...overrides,
  } as ScheduledRide
}

const STATIONS = [
  { station_name: 'MacArthur BART', station_lat: 37.83, station_lng: -122.27, walk_to_station_minutes: 5, transit_to_dest_minutes: 18, total_rider_minutes: 25 },
  { station_name: 'Downtown Berkeley BART', station_lat: 37.87, station_lng: -122.27, walk_to_station_minutes: 8, transit_to_dest_minutes: 12, total_rider_minutes: 22 },
  { station_name: 'Ashby BART', station_lat: 37.85, station_lng: -122.27, walk_to_station_minutes: 11, transit_to_dest_minutes: 14, total_rider_minutes: 28 },
]

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

/**
 * Mounts RideBoardConfirmSheet with an initialEnrichment that pre-
 * selects a destination — this triggers the /api/transit/preview
 * fetch on mount and shortcuts past the autocomplete UX, which is
 * what we want to exercise here.
 */
function renderWithStations(stations = STATIONS) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ suggestions: stations }),
  })
  return render(
    <RideBoardConfirmSheet
      ride={makeRide()}
      isRequesting={false}
      initialEnrichment={{
        destination_lat: 37.7,
        destination_lng: -122.1,
        destination_name: 'Some Custom Destination',
        destination_flexible: false,
      }}
      proposedHandoff={null}
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  )
}

describe('RideBoardConfirmSheet — transit mini-map + station peek (Slice 4)', () => {
  it('renders the mini-map + numbered station rows once /api/transit/preview returns', async () => {
    renderWithStations()
    await waitFor(() => screen.getByTestId('transit-mini-map'))
    // 3 numbered stations + station rows rendered
    expect(screen.getByTestId('transit-mini-map-station-0')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-station-1')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-station-2')).toBeInTheDocument()
    const rows = screen.getAllByTestId('ride-board-transit-station-row')
    expect(rows).toHaveLength(3)
  })

  it('subtitle copy is verbatim against iOS line 341 — "X min walk · Y min transit · Z min total"', async () => {
    renderWithStations([STATIONS[0]!])
    await waitFor(() => screen.getByTestId('ride-board-transit-station-row'))
    expect(
      screen.getByText('5 min walk · 18 min transit · 25 min total'),
    ).toBeInTheDocument()
  })

  it('OVERVIEW: renders rider dest + driver origin + driver dest context pins alongside stations', async () => {
    renderWithStations()
    await waitFor(() => screen.getByTestId('transit-mini-map'))
    expect(screen.getByTestId('transit-mini-map-rider-dest')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-driver-origin')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-driver-dest')).toBeInTheDocument()
  })

  it('TAP A STATION ROW → peek mode: only peeked station + rider dest pins; "Use this stop" CTA appears', async () => {
    renderWithStations()
    await waitFor(() => screen.getAllByTestId('ride-board-transit-station-row'))
    const firstRowTap = screen.getAllByTestId('ride-board-transit-station-row-tap')[0]!
    fireEvent.click(firstRowTap)

    // Now the row is peeked
    await waitFor(() => screen.getByTestId('ride-board-transit-station-row-peeked'))
    expect(screen.getByTestId('ride-board-transit-station-row-use-this-stop')).toBeInTheDocument()

    // Mini-map: peek mode drops driver-origin + driver-dest context pins
    expect(screen.queryByTestId('transit-mini-map-driver-origin')).toBeNull()
    expect(screen.queryByTestId('transit-mini-map-driver-dest')).toBeNull()
    // Rider dest pin stays
    expect(screen.getByTestId('transit-mini-map-rider-dest')).toBeInTheDocument()
    // Only the peeked station pin renders (idx 0)
    expect(screen.getByTestId('transit-mini-map-station-0')).toBeInTheDocument()
    expect(screen.queryByTestId('transit-mini-map-station-1')).toBeNull()
    expect(screen.queryByTestId('transit-mini-map-station-2')).toBeNull()
  })

  it('TAP THE PEEKED ROW AGAIN → collapses back to overview', async () => {
    renderWithStations()
    await waitFor(() => screen.getAllByTestId('ride-board-transit-station-row'))
    // Peek first row
    fireEvent.click(screen.getAllByTestId('ride-board-transit-station-row-tap')[0]!)
    await waitFor(() => screen.getByTestId('ride-board-transit-station-row-peeked'))
    // Tap the now-peeked row to collapse
    fireEvent.click(screen.getByTestId('ride-board-transit-station-row-peeked'))
    // Back to overview — all 3 pins again + driver context pins
    await waitFor(() => screen.getByTestId('transit-mini-map-driver-origin'))
    expect(screen.getByTestId('transit-mini-map-station-0')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-station-1')).toBeInTheDocument()
    expect(screen.getByTestId('transit-mini-map-station-2')).toBeInTheDocument()
    expect(screen.queryByTestId('ride-board-transit-station-row-use-this-stop')).toBeNull()
  })

  it('TAP "Use this stop" on the peeked row → suggestions list disappears (commit)', async () => {
    renderWithStations()
    await waitFor(() => screen.getAllByTestId('ride-board-transit-station-row'))
    // Peek + commit
    fireEvent.click(screen.getAllByTestId('ride-board-transit-station-row-tap')[1]!)
    await waitFor(() => screen.getByTestId('ride-board-transit-station-row-use-this-stop'))
    fireEvent.click(screen.getByTestId('ride-board-transit-station-row-use-this-stop'))
    // After commit: suggestions cleared → list + map go away
    await waitFor(() => {
      expect(screen.queryByTestId('transit-suggestions')).toBeNull()
    })
    expect(screen.queryByTestId('transit-mini-map')).toBeNull()
    expect(screen.queryAllByTestId('ride-board-transit-station-row')).toHaveLength(0)
  })

  it('does NOT render any of the mini-map / station rows while /api/transit/preview is still pending', async () => {
    // Hold the fetch indefinitely
    mockFetch.mockReturnValueOnce(new Promise(() => {}))
    render(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={{
          destination_lat: 37.7,
          destination_lng: -122.1,
          destination_name: 'Pending Dest',
          destination_flexible: false,
        }}
        proposedHandoff={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    // Spinner copy: "Finding transit stops..."
    await waitFor(() => screen.getByText(/Finding transit stops/))
    expect(screen.queryByTestId('transit-mini-map')).toBeNull()
    expect(screen.queryAllByTestId('ride-board-transit-station-row')).toHaveLength(0)
  })
})
