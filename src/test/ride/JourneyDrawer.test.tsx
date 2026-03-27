/**
 * JourneyDrawer tests
 *
 * Verifies:
 *  1. Renders collapsed drawer with action buttons
 *  2. QR button calls onShowQr
 *  3. Navigate button calls onNavigate
 *  4. Chat button calls onChat with unread badge
 *  5. Safety button calls onEmergency
 *  6. Shows ETA and fare when provided
 *  7. Expands on click to show person info and route
 *  8. Shows driver info for rider view
 *  9. Shows rider info for driver view
 * 10. Shows vehicle info for rider view
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import JourneyDrawer from '@/components/ride/JourneyDrawer'
import type { Ride } from '@/types/database'

// ── Mock fare module ───────────────────────────────────────────────────────────

vi.mock('@/lib/fare', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  calculateFare: vi.fn(),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeRide = (_overrides?: Partial<Ride>): Ride => ({
  id: 'ride-1',
  rider_id: 'rider-1',
  driver_id: 'driver-1',
  status: 'active',
  origin: { type: 'Point', coordinates: [-121.76, 38.54] },
  destination: { type: 'Point', coordinates: [-121.78, 38.56] },
  destination_name: '123 Main St',
  pickup_note: 'By the fountain',
  fare_cents: 1200,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  pickup_point: null,
  pickup_confirmed: false,
  started_at: null,
  ended_at: null,
  route_polyline: null,
  seats: 1,
  trip_date: null,
  trip_time: null,
  origin_name: null,
  driver_destination: null,
  driver_destination_name: null,
  board_post_id: null,
  reminder_sent: false,
} as unknown as Ride)

const mockDriver = {
  id: 'driver-1',
  full_name: 'Jane Driver',
  avatar_url: null,
  rating_avg: 4.8,
  rating_count: 25,
}

const mockRider = {
  id: 'rider-1',
  full_name: 'Bob Rider',
  avatar_url: null,
  rating_avg: 4.5,
  rating_count: 10,
}

const mockVehicle = {
  color: 'Blue',
  plate: 'ABC123',
  make: 'Toyota',
  model: 'Camry',
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('JourneyDrawer', () => {
  const onShowQr = vi.fn()
  const onNavigate = vi.fn()
  const onChat = vi.fn()
  const onEmergency = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure portal target exists
    if (!document.getElementById('portal-root')) {
      const el = document.createElement('div')
      el.id = 'portal-root'
      document.body.appendChild(el)
    }
  })

  const renderDrawer = (props?: Record<string, unknown>) =>
    render(
      <JourneyDrawer
        ride={makeRide()}
        driver={mockDriver}
        vehicle={mockVehicle}
        isRider
        estimatedFare={1200}
        etaMinutes={5}
        distanceKm={3.2}
        onShowQr={onShowQr}
        onNavigate={onNavigate}
        onChat={onChat}
        onEmergency={onEmergency}
        unreadChat={0}
        {...props}
      />,
    )

  it('renders the drawer', () => {
    renderDrawer()
    expect(screen.getByTestId('journey-drawer')).toBeInTheDocument()
  })

  it('QR button calls onShowQr', () => {
    renderDrawer()
    fireEvent.click(screen.getByTestId('drawer-qr-button'))
    expect(onShowQr).toHaveBeenCalledOnce()
  })

  it('Navigate button calls onNavigate', () => {
    renderDrawer()
    fireEvent.click(screen.getByTestId('drawer-navigate-button'))
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('Chat button calls onChat', () => {
    renderDrawer()
    fireEvent.click(screen.getByTestId('drawer-chat-button'))
    expect(onChat).toHaveBeenCalledOnce()
  })

  it('Safety button calls onEmergency', () => {
    renderDrawer()
    fireEvent.click(screen.getByTestId('safety-button'))
    expect(onEmergency).toHaveBeenCalledOnce()
  })

  it('shows ETA when provided', () => {
    renderDrawer()
    expect(screen.getByText('5 min')).toBeInTheDocument()
    expect(screen.getByText('ETA')).toBeInTheDocument()
  })

  it('shows fare when provided', () => {
    renderDrawer()
    expect(screen.getAllByText('$12.00').length).toBeGreaterThanOrEqual(1)
  })

  it('shows distance in miles', () => {
    renderDrawer()
    // 3.2 km * 0.621371 = ~1.99 mi → "2.0 mi"
    expect(screen.getByText('2.0 mi')).toBeInTheDocument()
  })

  it('shows unread chat badge when > 0', () => {
    renderDrawer({ unreadChat: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows "Scan QR" label for rider', () => {
    renderDrawer({ isRider: true })
    expect(screen.getByText('Scan QR')).toBeInTheDocument()
  })

  it('shows "Show QR" label for driver', () => {
    renderDrawer({ isRider: false })
    expect(screen.getByText('Show QR')).toBeInTheDocument()
  })

  it('expands on drag handle click and shows driver info for rider', () => {
    renderDrawer()
    // Click drag handle to expand
    const backdrop = screen.queryByTestId('drawer-backdrop')
    expect(backdrop).not.toBeInTheDocument() // not expanded yet

    // Find the drag handle area and click
    const handles = document.querySelectorAll('.cursor-grab')
    expect(handles.length).toBeGreaterThan(0)
    fireEvent.click(handles[0])

    // Should now show backdrop
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument()
    // Should show driver info
    expect(screen.getByText('Your Driver')).toBeInTheDocument()
    expect(screen.getByText('Jane Driver')).toBeInTheDocument()
  })

  it('shows rider info for driver view when expanded', () => {
    renderDrawer({ isRider: false, rider: mockRider, driver: undefined })

    // Click drag handle to expand
    const handles = document.querySelectorAll('.cursor-grab')
    fireEvent.click(handles[0])

    expect(screen.getByText('Your Rider')).toBeInTheDocument()
    expect(screen.getByText('Bob Rider')).toBeInTheDocument()
  })

  it('shows vehicle info for rider view when expanded', () => {
    renderDrawer()

    // Click drag handle to expand
    const handles = document.querySelectorAll('.cursor-grab')
    fireEvent.click(handles[0])

    expect(screen.getByText('Vehicle')).toBeInTheDocument()
    expect(screen.getByText('Blue Toyota Camry')).toBeInTheDocument()
    expect(screen.getByText('ABC123')).toBeInTheDocument()
  })

  it('shows journey route with pickup and destination when expanded', () => {
    renderDrawer()

    // Click drag handle to expand
    const handles = document.querySelectorAll('.cursor-grab')
    fireEvent.click(handles[0])

    expect(screen.getByText('Your Journey')).toBeInTheDocument()
    expect(screen.getByText('Pickup')).toBeInTheDocument()
    expect(screen.getByText('Destination')).toBeInTheDocument()
    expect(screen.getByText('By the fountain')).toBeInTheDocument()
    expect(screen.getByText('123 Main St')).toBeInTheDocument()
  })

  // ── Safety button floating above drawer ─────────────────────────────────

  it('renders safety button outside the drawer container', () => {
    renderDrawer()
    const safety = screen.getByTestId('safety-button')
    const drawer = screen.getByTestId('journey-drawer')
    expect(drawer.contains(safety)).toBe(false)
  })

  // ── Start ride button ───────────────────────────────────────────────────

  it('shows start ride button when startRideLabel is provided', () => {
    renderDrawer({ startRideLabel: 'Scan QR to Start Ride' })
    const btn = screen.getByTestId('drawer-start-ride-button')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Scan QR to Start Ride')
    fireEvent.click(btn)
    expect(onShowQr).toHaveBeenCalledOnce()
  })

  it('does not show start ride button when startRideLabel is not provided', () => {
    renderDrawer()
    expect(screen.queryByTestId('drawer-start-ride-button')).not.toBeInTheDocument()
  })

  // ── Transit remaining journey ───────────────────────────────────────────

  it('shows transit remaining journey when transitInfo is provided', () => {
    renderDrawer({
      transitInfo: {
        station_name: 'Davis Station',
        transit_options: [{ type: 'bus', icon: 'Bus', line_name: 'Route 42', walk_minutes: 3, total_minutes: 25 }],
        walk_to_station_minutes: 5,
        transit_to_dest_minutes: 20,
        rider_dest_name: 'Downtown Sacramento',
        total_rider_minutes: 25,
        dropoff_lat: 38.54,
        dropoff_lng: -121.76,
        rider_dest_lat: 38.58,
        rider_dest_lng: -121.49,
      },
    })

    // Expand the drawer
    const handles = document.querySelectorAll('.cursor-grab')
    fireEvent.click(handles[0])

    expect(screen.getByTestId('transit-remaining-journey')).toBeInTheDocument()
    expect(screen.getByText('Your Remaining Journey')).toBeInTheDocument()
    expect(screen.getByText(/Walk to Davis Station/)).toBeInTheDocument()
    expect(screen.getByText('Route 42')).toBeInTheDocument()
    expect(screen.getByText('Total remaining journey')).toBeInTheDocument()
    expect(screen.queryByText('Your Journey')).not.toBeInTheDocument()
  })

  it('shows original YOUR JOURNEY when no transitInfo', () => {
    renderDrawer()

    const handles = document.querySelectorAll('.cursor-grab')
    fireEvent.click(handles[0])

    expect(screen.getByText('Your Journey')).toBeInTheDocument()
    expect(screen.queryByTestId('transit-remaining-journey')).not.toBeInTheDocument()
  })
})
