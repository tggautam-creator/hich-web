/**
 * v1.3 — SchedulePage edit-mode tests. Mirrors iOS
 * SchedulePostViewModel.prefill(from:) + updateExistingSchedule.
 *
 * Pins:
 *   - When `location.state.editingRide` is provided, the form
 *     hydrates from that row + the header copy flips to "Edit Ride"
 *   - The submit button label flips to "Save Changes"
 *   - Save calls `.update().eq()` on `ride_schedules` (NOT insert)
 *   - Synthetic "edit:<id>:origin|dest" place IDs are stripped from
 *     the UPDATE so the real Google place_id isn't overwritten when
 *     the user kept the original address
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SchedulePage from '@/components/schedule/SchedulePage'
import type { ScheduledRide } from '@/components/schedule/boardTypes'

const mockNavigate = vi.fn()

const EDITING_RIDE: ScheduledRide = {
  id: 'sched-edit-001',
  user_id: 'user-001',
  mode: 'driver',
  route_name: 'Davis → SF',
  origin_address: '1 Shields Ave, Davis, CA',
  dest_address: '1 Market St, San Francisco, CA',
  direction_type: 'one_way',
  trip_date: '2026-08-10',
  time_type: 'departure',
  trip_time: '09:30:00',
  time_flexible: false,
  available_seats: 3,
  note: 'I have room for one bag.',
  created_at: '2026-06-01T00:00:00Z',
  poster: null,
  origin_lat: 38.54,
  origin_lng: -121.75,
  dest_lat: 37.79,
  dest_lng: -122.39,
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    state: { editingRide: EDITING_RIDE },
    pathname: '/schedule/driver',
    search: '',
    hash: '',
    key: 'edit',
  }),
}))

vi.mock('@/lib/places', () => ({
  searchPlaces: vi.fn().mockResolvedValue([]),
  getPlaceCoordinates: vi.fn().mockResolvedValue({ lat: 38.54, lng: -121.75 }),
  geocodeAddress: vi.fn().mockResolvedValue({ lat: 38.54, lng: -121.75 }),
}))

vi.mock('@/lib/directions', () => ({
  getDirectionsByLatLng: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/lastSeats', () => ({
  rememberLastSeats: vi.fn(),
  getLastSeats: () => 1,
}))

vi.mock('@/hooks/useCaregivers', () => ({
  useMyCaregivers: () => ({ caregivers: [], isLoading: false }),
}))

vi.mock('@/components/profile/CaregiverPickerSection', () => ({
  default: () => null,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ id: 'user-001', email: 'test@uni.edu' }),
}))

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }))

// Supabase mock — only the chain pieces SchedulePage submit uses.
const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
const mockUpdate = vi.fn(() => ({ eq: mockEq }))
const mockInsert = vi.fn(() => ({
  select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'NEW' }, error: null }) }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: mockInsert, update: mockUpdate }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ schedules: [] }),
  })
})

describe('SchedulePage edit mode (v1.3, iOS parity)', () => {
  it('hydrates form + flips header to "Edit Ride" on mount', () => {
    render(<SchedulePage mode="driver" />)
    expect(screen.getByText('Edit Ride')).toBeInTheDocument()
    expect(
      screen.getByText('Update the trip details below and save.'),
    ).toBeInTheDocument()
  })

  it('renders "Save Changes" instead of "Schedule Trip" on the submit button', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="driver" />)
    // Walk through to the schedule step where submit lives.
    await user.click(screen.getByTestId('continue-button'))
    await waitFor(() => {
      expect(screen.getByTestId('submit-schedule-button')).toBeInTheDocument()
    })
    expect(screen.getByTestId('submit-schedule-button')).toHaveTextContent('Save Changes')
  })

  it('save calls supabase.update().eq() on ride_schedules (not insert) + strips synthetic place IDs', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="driver" />)
    await user.click(screen.getByTestId('continue-button'))
    await waitFor(() => {
      expect(screen.getByTestId('submit-schedule-button')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('submit-schedule-button'))
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled()
      expect(mockEq).toHaveBeenCalledWith('id', 'sched-edit-001')
    })
    // INSERT must NOT fire on the edit path.
    expect(mockInsert).not.toHaveBeenCalled()
    // Synthetic "edit:<id>:origin" / "edit:<id>:dest" place IDs must be
    // stripped so the real Google place_id stays intact server-side.
    const updateArg = (mockUpdate.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(updateArg).not.toHaveProperty('origin_place_id')
    expect(updateArg).not.toHaveProperty('dest_place_id')
    // Non-synthetic fields still get sent.
    expect(updateArg.route_name).toBe('Davis → SF')
    expect(updateArg.available_seats).toBe(3)
  })
})
