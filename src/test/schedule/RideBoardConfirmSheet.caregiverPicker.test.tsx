/**
 * v1.3 Sprint 10 Slice 6 — caregiver picker on RideBoardConfirmSheet.
 *
 * Mirrors iOS RideBoardConfirmSheet.swift:54-115 + 293-299
 * (caregiverSectionVisible gate). Verifies:
 *   • Render gate: only on rider-on-driver-post AND wheelchair rider
 *     AND has caregivers
 *   • Driver-on-rider-post: picker hidden (drivers don't bring
 *     caregivers in v1.2)
 *   • Wheelchair rider but no caregivers: picker hidden
 *   • Non-accessibility profile: picker hidden
 *   • Toggling the picker ON + tapping Confirm forwards
 *     caregiver_id + distance_km in the enrichment payload
 *   • Picker stays hidden when isDriverPost is true but viewer
 *     profile lacks accessibility needs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RideBoardConfirmSheet from '@/components/schedule/RideBoardConfirmSheet'
import type { RequestEnrichment } from '@/components/schedule/RideBoardConfirmSheet'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

// ── Hoisted mocks ───────────────────────────────────────────────────

const { mockGetSession, mockFetch, mockUseMyCaregivers, profileRef } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
  mockFetch: vi.fn(),
  mockUseMyCaregivers: vi.fn(),
  profileRef: { current: null as null | { has_accessibility_needs?: boolean; accessibility_profile?: { needs_wheelchair?: boolean } } },
}))

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="google-map" {...(props as Record<string, string>)}>{children as React.ReactNode}</div>
  ),
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

vi.mock('@/hooks/useCaregivers', () => ({
  useMyCaregivers: () => mockUseMyCaregivers(),
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof profileRef.current }) => unknown) =>
    selector({ profile: profileRef.current }),
}))

// ── Helpers ──────────────────────────────────────────────────────────

const CAREGIVERS = [
  {
    id: 'caregiver-1',
    user_id: 'u-rider',
    name: 'Mom',
    relationship: 'parent',
    phone: '+15550100',
    notes: null,
    avatar_url: null,
    created_at: '2026-05-01T00:00:00Z',
  },
  {
    id: 'caregiver-2',
    user_id: 'u-rider',
    name: 'Sibling',
    relationship: 'sibling',
    phone: null,
    notes: null,
    avatar_url: null,
    created_at: '2026-05-02T00:00:00Z',
  },
]

function makeRide(overrides: Partial<ScheduledRide> = {}): ScheduledRide {
  return {
    id: 'sched-1',
    user_id: 'u-poster',
    mode: 'driver',
    route_name: '',
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
    direction_type: 'one_way',
    trip_date: '2026-06-10',
    time_type: 'departure',
    trip_time: '09:00:00',
    created_at: '2026-06-01T12:00:00Z',
    poster: { id: 'u-poster', full_name: 'Alex Driver', avatar_url: null, rating_avg: 4.9, is_driver: true },
    already_requested: false,
    ...overrides,
  } as ScheduledRide
}

function setWheelchairRiderProfile() {
  profileRef.current = {
    has_accessibility_needs: true,
    accessibility_profile: { needs_wheelchair: true },
  }
}

function setNonAccessibilityProfile() {
  profileRef.current = {
    has_accessibility_needs: false,
    accessibility_profile: { needs_wheelchair: false },
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  mockUseMyCaregivers.mockReset()
  profileRef.current = null
  vi.stubGlobal('fetch', mockFetch)
})

function renderRiderOnDriverPost(extraProps: Partial<{
  onConfirm: (e: RequestEnrichment) => void
}> = {}) {
  return render(
    <RideBoardConfirmSheet
      ride={makeRide({ mode: 'driver' })}
      isRequesting={false}
      initialEnrichment={{
        pickup_lat: 37.34,
        pickup_lng: -121.89,
        pickup_name: '123 Origin St',
        destination_lat: 38.55,
        destination_lng: -121.74,
        destination_name: 'Driver dest',
        destination_flexible: false,
      }}
      proposedHandoff={null}
      onConfirm={extraProps.onConfirm ?? (() => {})}
      onCancel={() => {}}
    />,
  )
}

// ── Tests ────────────────────────────────────────────────────────────

describe('RideBoardConfirmSheet — caregiver picker (Sprint 10 Slice 6)', () => {
  it('renders the picker when isDriverPost + wheelchair rider + caregivers on file', async () => {
    setWheelchairRiderProfile()
    mockUseMyCaregivers.mockReturnValue({ data: CAREGIVERS, isLoading: false, error: null })
    renderRiderOnDriverPost()
    await waitFor(() => screen.getByTestId('ride-board-confirm-caregiver-picker-block'))
    expect(screen.getByTestId('caregiver-picker')).toBeInTheDocument()
  })

  it('HIDES the picker when the viewer is not an accessibility rider', () => {
    setNonAccessibilityProfile()
    mockUseMyCaregivers.mockReturnValue({ data: CAREGIVERS, isLoading: false, error: null })
    renderRiderOnDriverPost()
    expect(screen.queryByTestId('ride-board-confirm-caregiver-picker-block')).toBeNull()
  })

  it('HIDES the picker when the wheelchair rider has zero caregivers on file', () => {
    setWheelchairRiderProfile()
    mockUseMyCaregivers.mockReturnValue({ data: [], isLoading: false, error: null })
    renderRiderOnDriverPost()
    expect(screen.queryByTestId('ride-board-confirm-caregiver-picker-block')).toBeNull()
  })

  it('HIDES the picker on the driver-on-rider-post path (drivers don\'t bring caregivers)', () => {
    setWheelchairRiderProfile()
    mockUseMyCaregivers.mockReturnValue({ data: CAREGIVERS, isLoading: false, error: null })
    render(
      <RideBoardConfirmSheet
        ride={makeRide({ mode: 'rider' })}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByTestId('ride-board-confirm-caregiver-picker-block')).toBeNull()
  })

  it('forwards caregiver_id + distance_km in the enrichment when picker is ON + caregiver selected', async () => {
    setWheelchairRiderProfile()
    mockUseMyCaregivers.mockReturnValue({ data: CAREGIVERS, isLoading: false, error: null })
    const onConfirm = vi.fn()
    renderRiderOnDriverPost({ onConfirm })

    // Wait for the picker to render + auto-select first caregiver when
    // the toggle flips ON.
    await waitFor(() => screen.getByTestId('caregiver-picker'))
    // The picker exposes a toggle button — flip it ON. The picker
    // auto-selects the first caregiver when toggled on.
    fireEvent.click(screen.getByTestId('caregiver-picker-toggle'))

    // Submit
    fireEvent.click(screen.getByTestId('confirm-send-button'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const enrichment = onConfirm.mock.calls[0]?.[0] as RequestEnrichment
    expect(enrichment.caregiver_id).toBe('caregiver-1')
    expect(typeof enrichment.distance_km).toBe('number')
    expect(enrichment.distance_km).toBeGreaterThan(0)
  })

  it('does NOT forward caregiver_id when picker remains OFF (default state)', async () => {
    setWheelchairRiderProfile()
    mockUseMyCaregivers.mockReturnValue({ data: CAREGIVERS, isLoading: false, error: null })
    const onConfirm = vi.fn()
    renderRiderOnDriverPost({ onConfirm })
    await waitFor(() => screen.getByTestId('caregiver-picker'))
    // Don't flip the toggle — just submit
    fireEvent.click(screen.getByTestId('confirm-send-button'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const enrichment = onConfirm.mock.calls[0]?.[0] as RequestEnrichment
    expect(enrichment.caregiver_id).toBeUndefined()
    expect(enrichment.distance_km).toBeUndefined()
  })
})
