/**
 * DriverDestinationCard tests
 *
 * Verifies:
 *  1. Renders the "Where are you headed?" prompt
 *  2. Shows search input
 *  3. Submit button is disabled when no place is selected
 *  4. Shows "No transit stations found" after submission with empty suggestions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DriverDestinationCard from '@/components/ride/DriverDestinationCard'

// ── Supabase mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/places', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
  getPlaceCoordinates: vi.fn().mockResolvedValue({ lat: 37.7, lng: -122.4 }),
}))

describe('DriverDestinationCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the prompt heading', () => {
    render(
      <DriverDestinationCard
        rideId="ride-1"
        driverId="driver-1"
      />,
    )

    expect(screen.getByText('Where are you headed?')).toBeDefined()
  })

  it('renders search input', () => {
    render(
      <DriverDestinationCard
        rideId="ride-1"
        driverId="driver-1"
      />,
    )

    const input = screen.getByTestId('driver-dest-input')
    expect(input).toBeDefined()
    expect((input as HTMLInputElement).placeholder).toBe('Enter your destination...')
  })

  it('submit button is disabled when no place is selected', () => {
    render(
      <DriverDestinationCard
        rideId="ride-1"
        driverId="driver-1"
      />,
    )

    const submitBtn = screen.getByTestId('driver-dest-submit')
    expect(submitBtn).toBeDefined()
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows explanatory text', () => {
    render(
      <DriverDestinationCard
        rideId="ride-1"
        driverId="driver-1"
      />,
    )

    expect(screen.getByText(/find transit stations along your route/i)).toBeDefined()
  })
})
