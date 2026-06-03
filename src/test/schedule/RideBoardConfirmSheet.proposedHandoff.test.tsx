/**
 * v1.2.1 S2.1 (Sprint 10 Slice 2) — direction-aware Proposed Handoff
 * Card on RideBoardConfirmSheet. Mirrors iOS RideBoardConfirmSheet.swift
 * lines 421-472. Hidden when proposedHandoff is null (the existing
 * direct-match flow keeps working). Forward = warning-tinted "Driver
 * drops you at X" card; reverse = primary-tinted "You take transit to
 * X" card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RideBoardConfirmSheet from '@/components/schedule/RideBoardConfirmSheet'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

vi.mock('@/lib/places', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
  getPlaceCoordinates: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/fareEstimate', () => ({
  estimateScheduleFare: vi.fn().mockReturnValue(null),
}))

// v1.3 Sprint 10 Slice 6 — caregiver picker hook stub (test profile
// has no accessibility needs, so the picker doesn't render here).
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
    origin_address: 'Origin St',
    origin_lat: 37.7,
    origin_lng: -122.4,
    dest_address: 'Dest St',
    dest_lat: 37.87,
    dest_lng: -122.26,
    driver_origin_lat: 37.7,
    driver_origin_lng: -122.4,
    driver_dest_lat: 37.87,
    driver_dest_lng: -122.26,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RideBoardConfirmSheet — Proposed Handoff Card', () => {
  it('renders nothing when proposedHandoff is null (common non-transit case)', () => {
    render(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.queryByTestId('proposed-handoff-card')).toBeNull()
  })

  it('renders forward (warning tint) card with "Driver drops you at X" + "You continue by transit"', () => {
    render(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={{ station_name: 'MacArthur BART', direction: 'forward' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const card = screen.getByTestId('proposed-handoff-card')
    expect(card.getAttribute('data-direction')).toBe('forward')
    expect(card.textContent).toContain('Driver drops you at MacArthur BART')
    expect(card.textContent).toContain('You continue by transit from there to your destination.')
    // Warning tint when forward (matches iOS color semantics).
    expect(card.className).toContain('warning')
  })

  it('renders reverse (primary tint) card with "You take transit to X" + "Driver picks you up there"', () => {
    render(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={{ station_name: 'Embarcadero BART', direction: 'reverse' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const card = screen.getByTestId('proposed-handoff-card')
    expect(card.getAttribute('data-direction')).toBe('reverse')
    expect(card.textContent).toContain('You take transit to Embarcadero BART')
    expect(card.textContent).toContain('Driver picks you up there and continues to your destination.')
    expect(card.className).toContain('primary')
  })

  it('shows the eyebrow "Transit hand-off" verbatim regardless of direction', () => {
    const { rerender } = render(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={{ station_name: 'X', direction: 'forward' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Transit hand-off')).toBeInTheDocument()

    rerender(
      <RideBoardConfirmSheet
        ride={makeRide()}
        isRequesting={false}
        initialEnrichment={null}
        proposedHandoff={{ station_name: 'X', direction: 'reverse' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Transit hand-off')).toBeInTheDocument()
  })
})
