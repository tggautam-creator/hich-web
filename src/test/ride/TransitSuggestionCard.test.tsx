/**
 * TransitSuggestionCard + TransitSuggestionPicker tests
 *
 * Verifies:
 *  Card:
 *  1. Renders station name and address
 *  2. Renders transit chips with icons and line names
 *  3. Shows time info (transit to dest, walk to station)
 *  4. Shows Accept/Counter buttons for rider
 *  5. Hides buttons for non-rider
 *  6. Backward compat: old data without departure_stop/arrival_stop
 *  7. Mini-map renders when geo props are provided
 *  8. Mini-map hidden when no polyline data
 *  9. Progress badge renders when rider_progress_pct is set
 *
 *  Picker:
 *  10. Renders numbered station cards
 *  11. Shows map preview when driverRoutePolyline provided
 *  12. Hides map preview when no polyline
 *  13. Highlights selected card on click
 *  14. Shows rider/driver destination markers on map
 *  15. Shows progress badge on station cards
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TransitSuggestionCard, { TransitSuggestionPicker } from '@/components/ride/TransitSuggestionCard'
import type { TransitDropoffSuggestion } from '@/components/ride/TransitSuggestionCard'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="google-map" {...props}>{children as React.ReactNode}</div>
  ),
  AdvancedMarker: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <div data-testid="advanced-marker" onClick={onClick}>{children}</div>
  ),
  useMap: () => null,
}))

vi.mock('@/components/map/RoutePreview', () => ({
  RoutePolyline: () => null,
  MapBoundsFitter: () => null,
  decodePolyline: () => [{ lat: 38.5, lng: -121.7 }, { lat: 37.8, lng: -122.4 }],
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
  },
}))

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SUGGESTION: TransitDropoffSuggestion = {
  station_name: 'Downtown BART',
  station_lat: 37.7749,
  station_lng: -122.4194,
  station_place_id: 'place123',
  station_address: '123 Market St, San Francisco',
  transit_options: [
    {
      type: 'SUBWAY', icon: '\u{1F687}', line_name: 'Blue Line',
      departure_stop: 'Downtown Station', arrival_stop: 'Mission District',
      duration_minutes: 15,
      walk_minutes: 3, total_minutes: 20,
    },
    {
      type: 'BUS', icon: '\u{1F68C}', line_name: 'Route 42',
      departure_stop: 'Mission District', arrival_stop: 'Sunset Blvd',
      duration_minutes: 25,
      walk_minutes: 1, total_minutes: 30,
    },
  ],
  ride_with_driver_minutes: 10,
  walk_to_station_minutes: 3,
  driver_detour_minutes: 5,
  transit_to_dest_minutes: 20,
  total_rider_minutes: 33,
  rider_progress_pct: 72,
  transit_polyline: 'encoded_transit_polyline_abc',
}

const SUGGESTION_2: TransitDropoffSuggestion = {
  station_name: 'Mission BART',
  station_lat: 37.76,
  station_lng: -122.42,
  station_place_id: 'place456',
  station_address: '456 Mission St',
  transit_options: [
    {
      type: 'SUBWAY', icon: '\u{1F687}', line_name: 'Red Line',
      departure_stop: 'Mission BART', arrival_stop: 'SFO Airport',
      duration_minutes: 30,
      walk_minutes: 2, total_minutes: 15,
    },
  ],
  ride_with_driver_minutes: 8,
  walk_to_station_minutes: 2,
  driver_detour_minutes: 3,
  transit_to_dest_minutes: 15,
  total_rider_minutes: 25,
  rider_progress_pct: 85,
  transit_polyline: 'encoded_transit_polyline_def',
}

// ── TransitSuggestionCard tests (rider view) ────────────────────────────────

describe('TransitSuggestionCard', () => {
  it('renders station name and address', () => {
    render(
      <TransitSuggestionCard suggestion={SUGGESTION} isRider={true} />,
    )

    expect(screen.getByText('Downtown BART')).toBeDefined()
    expect(screen.getByText('123 Market St, San Francisco')).toBeDefined()
  })

  it('shows unified journey breakdown with transit legs', () => {
    render(
      <TransitSuggestionCard suggestion={SUGGESTION} isRider={true} />,
    )

    // Section header
    expect(screen.getByText('Your journey')).toBeDefined()
    // Step 1: Driver drops you at station with ride time
    expect(screen.getByText(/Driver drops you at Downtown BART/)).toBeDefined()
    expect(screen.getByText(/~10 min/)).toBeDefined()
    // Transit legs shown inside journey
    expect(screen.getByText('Blue Line')).toBeDefined()
    expect(screen.getByText('Route 42')).toBeDefined()
    // Total time
    expect(screen.getByText(/~33 min rider/)).toBeDefined()
  })

  it('shows Accept and Counter buttons for rider', () => {
    const onAccept = vi.fn()
    const onCounter = vi.fn()

    render(
      <TransitSuggestionCard
        suggestion={SUGGESTION}
        isRider={true}
        onAccept={onAccept}
        onCounter={onCounter}
      />,
    )

    const acceptBtn = screen.getByTestId('accept-transit-dropoff')
    const counterBtn = screen.getByTestId('counter-transit-dropoff')

    expect(acceptBtn).toBeDefined()
    expect(counterBtn).toBeDefined()

    fireEvent.click(acceptBtn)
    expect(onAccept).toHaveBeenCalledTimes(1)

    fireEvent.click(counterBtn)
    expect(onCounter).toHaveBeenCalledTimes(1)
  })

  it('hides buttons when isRider is false', () => {
    render(
      <TransitSuggestionCard
        suggestion={SUGGESTION}
        isRider={false}
        onAccept={() => {}}
      />,
    )

    expect(screen.queryByTestId('accept-transit-dropoff')).toBeNull()
    expect(screen.queryByTestId('counter-transit-dropoff')).toBeNull()
  })

  it('hides buttons when no callbacks provided', () => {
    render(
      <TransitSuggestionCard suggestion={SUGGESTION} isRider={true} />,
    )

    expect(screen.queryByTestId('accept-transit-dropoff')).toBeNull()
    expect(screen.queryByTestId('counter-transit-dropoff')).toBeNull()
  })

  it('falls back gracefully when departure_stop/arrival_stop are missing', () => {
    const oldSuggestion: TransitDropoffSuggestion = {
      ...SUGGESTION,
      transit_options: [
        { type: 'BUS', icon: 'Bus', line_name: 'Route 99', duration_minutes: 40, walk_minutes: 1, total_minutes: 40 },
      ],
    }
    render(
      <TransitSuggestionCard suggestion={oldSuggestion} isRider={true} />,
    )

    expect(screen.getByText('Route 99')).toBeDefined()
    expect(screen.getByText(/40 min/)).toBeDefined()
  })

  it('renders mini-map when geo props are provided', () => {
    render(
      <TransitSuggestionCard
        suggestion={SUGGESTION}
        isRider={true}
        driverRoutePolyline="encoded_driver_route"
        transitPolyline="encoded_transit_route"
        pickupLat={38.54}
        pickupLng={-121.76}
        riderDestLat={38.78}
        riderDestLng={-121.25}
        driverDestLat={38.58}
        driverDestLng={-121.49}
      />,
    )

    expect(screen.getByTestId('transit-mini-map')).toBeDefined()
    expect(screen.getByTestId('google-map')).toBeDefined()
  })

  it('hides mini-map when no polyline data', () => {
    render(
      <TransitSuggestionCard suggestion={SUGGESTION} isRider={true} />,
    )

    expect(screen.queryByTestId('transit-mini-map')).toBeNull()
  })

  it('shows progress badge when rider_progress_pct is set', () => {
    render(
      <TransitSuggestionCard suggestion={SUGGESTION} isRider={true} />,
    )

    expect(screen.getByText('72% of the way')).toBeDefined()
  })
})

// ── TransitSuggestionPicker tests (driver view) ─────────────────────────────

describe('TransitSuggestionPicker', () => {
  it('renders numbered station cards', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
      />,
    )

    const options = screen.getAllByTestId('transit-suggestion-option')
    expect(options).toHaveLength(2)
    expect(screen.getByText('Downtown BART')).toBeDefined()
    expect(screen.getByText('Mission BART')).toBeDefined()
    // Numbered labels
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('shows route preview map when driverRoutePolyline is provided', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
        driverRoutePolyline="encoded_test_polyline"
        pickupLat={38.54}
        pickupLng={-121.76}
      />,
    )

    expect(screen.getByTestId('route-preview-map')).toBeDefined()
    expect(screen.getByTestId('google-map')).toBeDefined()
  })

  it('hides route preview map when no polyline', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
      />,
    )

    expect(screen.queryByTestId('route-preview-map')).toBeNull()
  })

  it('auto-highlights first card on mount and shows suggest button', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
        driverRoutePolyline="encoded_test_polyline"
      />,
    )

    // Suggest button should be visible immediately (first card auto-selected)
    expect(screen.getByTestId('suggest-station-button')).toBeDefined()
    expect(screen.getByText('Suggest this station')).toBeDefined()
  })

  it('highlights a different card on click', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
        driverRoutePolyline="encoded_test_polyline"
      />,
    )

    const options = screen.getAllByTestId('transit-suggestion-option')
    fireEvent.click(options[1])

    // After clicking second card, suggest button should still be visible
    expect(screen.getByTestId('suggest-station-button')).toBeDefined()
  })

  it('returns null when suggestions array is empty', () => {
    const { container } = render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[]}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('shows rider and driver destination markers on map', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION]}
        driverRoutePolyline="encoded_test_polyline"
        pickupLat={38.54}
        pickupLng={-121.76}
        riderDestLat={38.78}
        riderDestLng={-121.25}
        riderDestName="Roseville Galleria"
        driverDestLat={38.58}
        driverDestLng={-121.49}
        driverDestName="Rancho Cordova"
      />,
    )

    // Rider destination label (sliced to 12 chars)
    expect(screen.getByText('Roseville Ga')).toBeDefined()
    // Driver destination label (sliced to 12 chars)
    expect(screen.getByText('Rancho Cordo')).toBeDefined()
  })

  it('shows progress badge on station cards', () => {
    render(
      <TransitSuggestionPicker
        rideId="ride-1"
        suggestions={[SUGGESTION, SUGGESTION_2]}
      />,
    )

    expect(screen.getByText('72% of the way')).toBeDefined()
    expect(screen.getByText('85% of the way')).toBeDefined()
  })
})
