/**
 * SchedulePage tests
 *
 * Verifies:
 *  1.  Component renders with default data-testid
 *  2.  Custom data-testid forwarded to root wrapper
 *  3.  Mode prop changes header text (driver vs rider)
 *  4.  Route name input renders and accepts text
 *  5.  From location input renders
 *  6.  To location input renders
 *  7.  Direction toggles between one-way and roundtrip
 *  8.  Trip type toggles between one-time and routine
 *  9.  Continue button disabled when form incomplete
 * 10.  Validation error shown when route name empty on continue
 * 11.  Validation error shown when from location not selected on continue
 * 12.  Validation error shown when to location not selected on continue
 * 13.  From location autocomplete calls searchPlaces with debounce
 * 14.  From location suggestions displayed when results returned
 * 15.  Selecting from suggestion fills the field
 * 16.  To location autocomplete calls searchPlaces with debounce
 * 17.  To location suggestions displayed when results returned
 * 18.  Selecting to suggestion fills the field
 * 19.  Loading indicator shown during from search
 * 20.  Loading indicator shown during to search
 * 21.  Continue button enabled when all fields valid
 * 22.  Cancel button calls window.history.back
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SchedulePage from '@/components/schedule/SchedulePage'
import type { PlaceSuggestion } from '@/lib/places'

// ── Mock react-router-dom ─────────────────────────────────────────────────────

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: '/schedule/rider', search: '', hash: '', key: 'default' }),
}))

// ── Mock places module ────────────────────────────────────────────────────────

const mockSearchPlaces = vi.fn<() => Promise<PlaceSuggestion[]>>()
const mockGetPlaceCoordinates = vi.fn<() => Promise<{ lat: number; lng: number } | null>>()

vi.mock('@/lib/places', () => ({
  searchPlaces: (...args: Parameters<typeof mockSearchPlaces>) => mockSearchPlaces(...args),
  getPlaceCoordinates: (...args: Parameters<typeof mockGetPlaceCoordinates>) => mockGetPlaceCoordinates(...args),
}))

// ── Mock Supabase ─────────────────────────────────────────────────────────────

/** Creates a mock return value that works for both `.insert()` (awaitable) and `.insert().select()` chains */
function mockInsertReturn(result: { data?: unknown; error: unknown }) {
  const p = Promise.resolve(result)
  return Object.assign(p, { select: () => Promise.resolve(result) })
}

const mockInsert = vi.fn().mockReturnValue(mockInsertReturn({ data: [{ id: 'test-id' }], error: null }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: mockInsert }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

/**
 * Card precondition: rider-mode submit hits /api/payment/methods (Stripe
 * truth) before inserting. Default to "card on file" so existing happy-path
 * tests pass; tests for the no-card flow override fetch per-call.
 */
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
    default_method_id: 'pm_test',
  }),
})
vi.stubGlobal('fetch', mockFetch)

// ── Mock geo ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/geo', () => ({
  calculateBearing: () => 45.0,
}))

// ── Mock directions ──────────────────────────────────────────────────────────

vi.mock('@/lib/directions', () => ({
  getDirectionsByLatLng: () => Promise.resolve({ distance_km: 120, duration_min: 90, polyline: 'encoded_polyline_test', destLat: 38.54, destLng: -121.76 }),
}))

// ── Mock auth store ───────────────────────────────────────────────────────────

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: { id: 'user-123' }, isDriver: true }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLACE_FROM: PlaceSuggestion = {
  placeId:       'place-001',
  mainText:      'UC Davis',
  secondaryText: 'Davis, CA, USA',
  fullAddress:   'UC Davis, Davis, CA, USA',
}

const PLACE_TO: PlaceSuggestion = {
  placeId:       'place-002',
  mainText:      'San Francisco',
  secondaryText: 'CA, USA',
  fullAddress:   'San Francisco, CA, USA',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SchedulePage', () => {
  beforeEach(() => {
    mockSearchPlaces.mockResolvedValue([])
    mockInsert.mockReturnValue(mockInsertReturn({ data: [{ id: 'test-id' }], error: null }))
    mockGetPlaceCoordinates.mockResolvedValue({ lat: 38.54, lng: -121.76 })
    // restoreAllMocks in afterEach wipes mockResolvedValue on every spy,
    // so reseat fetch (used by the /api/payment/methods precheck) to its
    // happy-path "card on file" response.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
        default_method_id: 'pm_test',
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Rendering ──────────────────────────────────────────────────────────────

  it('renders with default data-testid', () => {
    render(<SchedulePage mode="rider" />)
    expect(screen.getByTestId('schedule-page')).toBeInTheDocument()
  })

  it('forwards custom data-testid to root wrapper', () => {
    render(<SchedulePage mode="rider" data-testid="custom-schedule" />)
    expect(screen.getByTestId('custom-schedule')).toBeInTheDocument()
  })

  it('displays "Schedule a Ride" header for rider mode', () => {
    render(<SchedulePage mode="rider" />)
    expect(screen.getByText('Schedule a Ride')).toBeInTheDocument()
  })

  it('displays "Schedule a Drive" header for driver mode', () => {
    render(<SchedulePage mode="driver" />)
    expect(screen.getByText('Schedule a Drive')).toBeInTheDocument()
  })

  it('displays "Where do you usually travel?" subheading', () => {
    render(<SchedulePage mode="rider" />)
    expect(screen.getByText('Where do you usually travel?')).toBeInTheDocument()
  })

  // ── Form Fields ────────────────────────────────────────────────────────────

  it('renders route name input when routine is selected', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    // Route name hidden by default (one-time)
    expect(screen.queryByTestId('route-name-input')).not.toBeInTheDocument()
    // Select routine to reveal it
    await user.click(screen.getByTestId('trip-type-routine'))
    expect(screen.getByTestId('route-name-input')).toBeInTheDocument()
  })

  it('route name input accepts text', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    await user.click(screen.getByTestId('trip-type-routine'))
    const input = screen.getByTestId('route-name-input')
    await user.type(input, 'Home to SF')
    expect(input).toHaveValue('Home to SF')
  })

  it('renders from location input', () => {
    render(<SchedulePage mode="rider" />)
    expect(screen.getByTestId('from-location-input')).toBeInTheDocument()
  })

  it('renders to location input', () => {
    render(<SchedulePage mode="rider" />)
    expect(screen.getByTestId('to-location-input')).toBeInTheDocument()
  })

  // ── Trip Type Toggles ──────────────────────────────────────────────────────

  it('defaults to one-time trip type', () => {
    render(<SchedulePage mode="rider" />)
    const oneTimeBtn = screen.getByTestId('trip-type-one-time')
    expect(oneTimeBtn).toHaveClass('bg-primary')
  })

  it('switches to routine when clicked', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    const routineBtn = screen.getByTestId('trip-type-routine')
    await user.click(routineBtn)
    expect(routineBtn).toHaveClass('bg-primary')
  })

  // ── Validation ─────────────────────────────────────────────────────────────

  it('shows all validation errors when continue clicked with empty form', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    const continueBtn = screen.getByTestId('continue-button')
    await user.click(continueBtn)
    expect(screen.getByText('Please select a From location')).toBeInTheDocument()
    expect(screen.getByText('Please select a To location')).toBeInTheDocument()
  })

  it('allows continue without route name (route name is optional)', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)

    // Fill locations but not route name
    const fromInput = screen.getByTestId('from-location-input')
    await user.type(fromInput, 'UC')

    mockSearchPlaces.mockResolvedValue([PLACE_FROM])

    await waitFor(() => {
      expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))

    const toInput = screen.getByTestId('to-location-input')
    await user.type(toInput, 'SF')

    mockSearchPlaces.mockResolvedValue([PLACE_TO])

    await waitFor(() => {
      expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId(`to-suggestion-${PLACE_TO.placeId}`))

    // Click continue without route name — should proceed
    const continueBtn = screen.getByTestId('continue-button')
    await user.click(continueBtn)

    // Should advance to schedule step (no validation error for route name)
    expect(screen.getByTestId('trip-date-input')).toBeInTheDocument()
  })

  it('shows validation error when from location not selected on continue', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)

    // Try to continue without filling locations
    const continueBtn = screen.getByTestId('continue-button')
    await user.click(continueBtn)
    
    expect(screen.getByText('Please select a From location')).toBeInTheDocument()
  })

  it('shows validation error when to location not selected on continue', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)

    // Fill from location only
    const fromInput = screen.getByTestId('from-location-input')
    await user.type(fromInput, 'UC')
    
    mockSearchPlaces.mockResolvedValue([PLACE_FROM])
    
    await waitFor(() => {
      expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
    })
    
    await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))
    
    // Try to continue without to location
    const continueBtn = screen.getByTestId('continue-button')
    await user.click(continueBtn)
    
    expect(screen.getByText('Please select a To location')).toBeInTheDocument()
  })

  // ── From Location Autocomplete ─────────────────────────────────────────────

  it('does not call searchPlaces before debounce fires for from input', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    const input = screen.getByTestId('from-location-input')
    await user.type(input, 'UC')
    
    // Immediately after typing, searchPlaces should not have been called yet
    expect(mockSearchPlaces).not.toHaveBeenCalled()
  })

  it('calls searchPlaces after 300ms debounce for from input', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    const input = screen.getByTestId('from-location-input')
    await user.type(input, 'UC Davis')
    
    await waitFor(() => {
      expect(mockSearchPlaces).toHaveBeenCalledWith('UC Davis', expect.any(String))
    }, { timeout: 1000 })
  })

  it('displays from location suggestions when results returned', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockResolvedValue([PLACE_FROM])
    
    const input = screen.getByTestId('from-location-input')
    await user.type(input, 'UC')
    
    await waitFor(() => {
      expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
      expect(screen.getByText('UC Davis')).toBeInTheDocument()
    }, { timeout: 1000 })
  })

  it('fills from field when from suggestion selected', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockResolvedValue([PLACE_FROM])
    
    const input = screen.getByTestId('from-location-input')
    await user.type(input, 'UC')
    
    await waitFor(() => {
      expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
    }, { timeout: 1000 })
    
    await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))
    
    expect(input).toHaveValue('UC Davis')
    expect(screen.queryByTestId('from-suggestions')).not.toBeInTheDocument()
  })

  // ── To Location Autocomplete ───────────────────────────────────────────────

  it('does not call searchPlaces before debounce fires for to input', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockClear()
    
    const input = screen.getByTestId('to-location-input')
    await user.type(input, 'SF')
    
    // Immediately after typing, searchPlaces should not have been called yet
    expect(mockSearchPlaces).not.toHaveBeenCalled()
  })

  it('calls searchPlaces after 300ms debounce for to input', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockClear()
    
    const input = screen.getByTestId('to-location-input')
    await user.type(input, 'San Francisco')
    
    await waitFor(() => {
      expect(mockSearchPlaces).toHaveBeenCalledWith('San Francisco', expect.any(String))
    }, { timeout: 1000 })
  })

  it('displays to location suggestions when results returned', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockResolvedValue([PLACE_TO])
    
    const input = screen.getByTestId('to-location-input')
    await user.type(input, 'SF')
    
    await waitFor(() => {
      expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
      expect(screen.getByText('San Francisco')).toBeInTheDocument()
    }, { timeout: 1000 })
  })

  it('fills to field when to suggestion selected', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)
    
    mockSearchPlaces.mockResolvedValue([PLACE_TO])
    
    const input = screen.getByTestId('to-location-input')
    await user.type(input, 'SF')
    
    await waitFor(() => {
      expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
    }, { timeout: 1000 })
    
    await user.click(screen.getByTestId(`to-suggestion-${PLACE_TO.placeId}`))
    
    expect(input).toHaveValue('San Francisco')
    expect(screen.queryByTestId('to-suggestions')).not.toBeInTheDocument()
  })

  // ── Continue Button ────────────────────────────────────────────────────────

  it('continue button enabled when all required fields filled', async () => {
    const user = userEvent.setup()
    render(<SchedulePage mode="rider" />)

    // Fill from location
    const fromInput = screen.getByTestId('from-location-input')
    await user.type(fromInput, 'UC')
    
    mockSearchPlaces.mockResolvedValue([PLACE_FROM])
    
    await waitFor(() => {
      expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
    }, { timeout: 1000 })
    
    await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))
    
    // Fill to location
    mockSearchPlaces.mockClear()
    const toInput = screen.getByTestId('to-location-input')
    await user.type(toInput, 'SF')
    
    mockSearchPlaces.mockResolvedValue([PLACE_TO])
    
    await waitFor(() => {
      expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
    }, { timeout: 1000 })
    
    await user.click(screen.getByTestId(`to-suggestion-${PLACE_TO.placeId}`))
    
    const continueBtn = screen.getByTestId('continue-button')
    expect(continueBtn).not.toBeDisabled()
  })

  // ── Cancel Button ──────────────────────────────────────────────────────────

  it('cancel button calls window.history.back', async () => {
    const user = userEvent.setup()
    const backSpy = vi.spyOn(window.history, 'back')

    render(<SchedulePage mode="rider" />)

    const cancelBtn = screen.getByTestId('cancel-button')
    await user.click(cancelBtn)

    expect(backSpy).toHaveBeenCalled()

    backSpy.mockRestore()
  })

  // ── One-Time Trip Flow ─────────────────────────────────────────────────────

  describe('One-Time Trip schedule step', () => {
    /** Helper: fill out the details form and click Continue to reach schedule step */
    async function goToScheduleStep() {
      const user = userEvent.setup()
      render(<SchedulePage mode="rider" />)

      // From location
      mockSearchPlaces.mockResolvedValue([PLACE_FROM])
      await user.type(screen.getByTestId('from-location-input'), 'UC')
      await waitFor(() => {
        expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
      }, { timeout: 1000 })
      await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))

      // To location
      mockSearchPlaces.mockResolvedValue([PLACE_TO])
      await user.type(screen.getByTestId('to-location-input'), 'SF')
      await waitFor(() => {
        expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
      }, { timeout: 1000 })
      await user.click(screen.getByTestId(`to-suggestion-${PLACE_TO.placeId}`))

      // Click continue (trip-type defaults to one-time)
      await user.click(screen.getByTestId('continue-button'))

      return user
    }

    it('shows date & time step after clicking continue with trip-type one-time', async () => {
      await goToScheduleStep()
      expect(screen.getByTestId('trip-date-input')).toBeInTheDocument()
      expect(screen.getByTestId('trip-time-input')).toBeInTheDocument()
      expect(screen.getByText('Pick Date & Time')).toBeInTheDocument()
    })

    it('renders departure/arrival toggle defaulting to departure', async () => {
      await goToScheduleStep()
      const depBtn = screen.getByTestId('time-type-departure')
      expect(depBtn).toHaveClass('bg-primary')
    })

    it('switches time type to arrival when clicked', async () => {
      const user = await goToScheduleStep()
      await user.click(screen.getByTestId('time-type-arrival'))
      expect(screen.getByTestId('time-type-arrival')).toHaveClass('bg-primary')
      expect(screen.getByText('Arrival Time')).toBeInTheDocument()
    })

    it('date input has min set to today', async () => {
      await goToScheduleStep()
      const dateInput = screen.getByTestId('trip-date-input')
      const today = new Date()
      const y = today.getFullYear()
      const m = String(today.getMonth() + 1).padStart(2, '0')
      const d = String(today.getDate()).padStart(2, '0')
      expect(dateInput).toHaveAttribute('min', `${y}-${m}-${d}`)
    })

    it('shows validation error when submitting without date', async () => {
      const user = await goToScheduleStep()
      await user.click(screen.getByTestId('submit-schedule-button'))
      expect(screen.getByTestId('trip-date-error')).toBeInTheDocument()
      expect(screen.getByText('Please select a date')).toBeInTheDocument()
    })

    it('shows validation error when submitting without time', async () => {
      const user = await goToScheduleStep()
      // Set a valid date but no time
      const dateInput = screen.getByTestId('trip-date-input')
      await user.clear(dateInput)
      // Set date via native change event
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(dateInput, '2027-06-15')
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))
      
      await user.click(screen.getByTestId('submit-schedule-button'))
      expect(screen.getByTestId('trip-time-error')).toBeInTheDocument()
      expect(screen.getByText('Please select a time')).toBeInTheDocument()
    })

    it('shows past date error when date is before today', async () => {
      const user = await goToScheduleStep()
      const dateInput = screen.getByTestId('trip-date-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(dateInput, '2020-01-01')
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))
      
      // Set a valid time
      const timeInput = screen.getByTestId('trip-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '09:00')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))
      
      await user.click(screen.getByTestId('submit-schedule-button'))
      expect(screen.getByTestId('trip-date-error')).toBeInTheDocument()
      expect(screen.getByText('Date cannot be in the past')).toBeInTheDocument()
    })

    it('calls supabase insert on valid submit', async () => {
      const user = await goToScheduleStep()

      // Set valid date
      const dateInput = screen.getByTestId('trip-date-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(dateInput, '2027-06-15')
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Set valid time
      const timeInput = screen.getByTestId('trip-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '09:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Two endpoints get called: /api/payment/methods (card precheck) and
      // /api/schedule/notify (post-insert push). Route both through the same
      // global mock — the precheck has to return a card for the insert path
      // to run.
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/api/payment/methods')) {
          return {
            ok: true,
            json: async () => ({
              methods: [{ id: 'pm_test', brand: 'visa', last4: '4242', is_default: true }],
              default_method_id: 'pm_test',
            }),
          } as unknown as Response
        }
        return new Response()
      })

      await user.click(screen.getByTestId('submit-schedule-button'))

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalledWith({
          user_id:          'user-123',
          mode:             'rider',
          route_name:       '',
          origin_place_id:  PLACE_FROM.placeId,
          origin_address:   PLACE_FROM.fullAddress,
          dest_place_id:    PLACE_TO.placeId,
          dest_address:     PLACE_TO.fullAddress,
          direction_type:   'one_way',
          trip_date:        '2027-06-15',
          time_type:        'departure',
          trip_time:        '09:30:00',
          available_seats:  null,
          note:             null,
          time_flexible:    false,
          origin_lat:       38.54,
          origin_lng:       -121.76,
          dest_lat:         38.54,
          dest_lng:         -121.76,
        })
      })

      // Shows confirmation screen instead of navigating back
      await waitFor(() => {
        expect(screen.getByTestId('schedule-confirmation')).toBeInTheDocument()
      })
      expect(screen.getByText('Ride Scheduled!')).toBeInTheDocument()
    })

    it('redirects rider-mode submit to /payment/add when poster has no card', async () => {
      // Card precondition: rider posts charge a card after the ride completes,
      // so submitting without one would leave a dead-end post on the board.
      // Simulate "Stripe says no methods" and verify we redirect instead of
      // calling supabase insert.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ methods: [], default_method_id: null }),
      })

      const user = await goToScheduleStep()

      const dateInput = screen.getByTestId('trip-date-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(dateInput, '2027-06-15')
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))

      const timeInput = screen.getByTestId('trip-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '09:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-schedule-button'))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/payment/add', expect.objectContaining({
          state: expect.objectContaining({ returnTo: '/schedule/rider' }),
        }))
      })
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('shows submit error when supabase insert fails', async () => {
      mockInsert.mockReturnValue(mockInsertReturn({ data: null, error: { message: 'DB error' } }))
      const user = await goToScheduleStep()

      const dateInput = screen.getByTestId('trip-date-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(dateInput, '2027-06-15')
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))

      const timeInput = screen.getByTestId('trip-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '09:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-schedule-button'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
        expect(screen.getByText('DB error')).toBeInTheDocument()
      })
    })

    it('back button returns to details step', async () => {
      const user = await goToScheduleStep()
      await user.click(screen.getByTestId('back-button'))
      // Should see the details form again
      expect(screen.getByTestId('from-location-input')).toBeInTheDocument()
      expect(screen.getByText('Schedule a Ride')).toBeInTheDocument()
    })
  })

  // ── Recurring Routine Flow ─────────────────────────────────────────────────

  describe('Recurring Routine schedule step', () => {
    /** Helper: fill details form with trip-type=routine and click Continue */
    async function goToRoutineStep() {
      const user = userEvent.setup()
      render(<SchedulePage mode="driver" />)

      // From location
      mockSearchPlaces.mockResolvedValue([PLACE_FROM])
      await user.type(screen.getByTestId('from-location-input'), 'UC')
      await waitFor(() => {
        expect(screen.getByTestId('from-suggestions')).toBeInTheDocument()
      }, { timeout: 1000 })
      await user.click(screen.getByTestId(`from-suggestion-${PLACE_FROM.placeId}`))

      // To location
      mockSearchPlaces.mockResolvedValue([PLACE_TO])
      await user.type(screen.getByTestId('to-location-input'), 'SF')
      await waitFor(() => {
        expect(screen.getByTestId('to-suggestions')).toBeInTheDocument()
      }, { timeout: 1000 })
      await user.click(screen.getByTestId(`to-suggestion-${PLACE_TO.placeId}`))

      // Select routine trip type (reveals route name field)
      await user.click(screen.getByTestId('trip-type-routine'))

      // Route name (only visible for routines)
      await user.type(screen.getByTestId('route-name-input'), 'Daily Commute')

      // Click continue
      await user.click(screen.getByTestId('continue-button'))

      return user
    }

    it('shows day pills after clicking continue with trip-type routine', async () => {
      await goToRoutineStep()
      expect(screen.getByText('Pick Your Days')).toBeInTheDocument()
      for (let d = 0; d <= 6; d++) {
        expect(screen.getByTestId(`day-pill-${d}`)).toBeInTheDocument()
      }
    })

    it('clicking a day pill selects it and shows inline time picker', async () => {
      const user = await goToRoutineStep()
      const mondayPill = screen.getByTestId('day-pill-1')
      expect(mondayPill).toHaveAttribute('aria-pressed', 'false')

      await user.click(mondayPill)

      expect(mondayPill).toHaveAttribute('aria-pressed', 'true')
      // Inline time picker now appears (no more BottomSheet)
      expect(screen.getByTestId('sheet-time-input')).toBeInTheDocument()
      expect(screen.getByText('Set time for 1 day')).toBeInTheDocument()
    })

    it('supports multi-day selection', async () => {
      const user = await goToRoutineStep()

      // Select Monday, Wednesday, Friday
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))
      await user.click(screen.getByTestId('day-pill-5'))

      expect(screen.getByTestId('day-pill-1')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('day-pill-3')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('day-pill-5')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('day-pill-0')).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('Set time for 3 days')).toBeInTheDocument()
    })

    it('bottom sheet has departure/arrival toggle defaulting to departure', async () => {
      const user = await goToRoutineStep()
      await user.click(screen.getByTestId('day-pill-1'))
      expect(screen.getByTestId('sheet-time-type-departure')).toHaveClass('bg-primary')
    })

    it('bottom sheet switches to arrival when clicked', async () => {
      const user = await goToRoutineStep()
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('sheet-time-type-arrival'))
      expect(screen.getByTestId('sheet-time-type-arrival')).toHaveClass('bg-primary')
      expect(screen.getByText('Arrival Time')).toBeInTheDocument()
    })

    it('inline time picker sets shared time for all days', async () => {
      const user = await goToRoutineStep()

      // Select Monday
      await user.click(screen.getByTestId('day-pill-1'))
      const timeInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '08:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Time input should now have value
      expect(timeInput).toHaveValue('08:30')
    })

    it('time applies to all selected days (single shared time)', async () => {
      const user = await goToRoutineStep()

      // Select Monday and Wednesday
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Set single shared time
      const timeInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '08:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Both days should be selected with the same time picker visible
      expect(screen.getByTestId('day-pill-1')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('day-pill-3')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Set time for 2 days')).toBeInTheDocument()
    })

    it('toggling a selected day deselects it', async () => {
      const user = await goToRoutineStep()

      // Select then deselect Monday
      await user.click(screen.getByTestId('day-pill-1'))
      expect(screen.getByTestId('day-pill-1')).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByTestId('day-pill-1'))
      expect(screen.getByTestId('day-pill-1')).toHaveAttribute('aria-pressed', 'false')

      // Time picker should no longer be visible
      expect(screen.queryByTestId('sheet-time-input')).not.toBeInTheDocument()
    })

    it('shows validation error when submitting with no days selected', async () => {
      const user = await goToRoutineStep()
      await user.click(screen.getByTestId('submit-routine-button'))
      expect(screen.getByTestId('days-error')).toBeInTheDocument()
      expect(screen.getByText('Please select at least one day')).toBeInTheDocument()
    })

    it('shows validation error when days selected but no time set', async () => {
      const user = await goToRoutineStep()

      // Select Monday but don't set a time
      await user.click(screen.getByTestId('day-pill-1'))

      await user.click(screen.getByTestId('submit-routine-button'))
      expect(screen.getByTestId('time-error')).toBeInTheDocument()
      expect(screen.getByText('Please set a time')).toBeInTheDocument()
    })

    it('calls supabase insert with correct driver_routines data on submit', async () => {
      const user = await goToRoutineStep()

      // Select Monday and set departure 08:30 inline
      await user.click(screen.getByTestId('day-pill-1'))
      const timeInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '08:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-routine-button'))

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalledWith({
          user_id:             'user-123',
          route_name:          'Daily Commute',
          origin:              { type: 'Point', coordinates: [-121.76, 38.54] },
          destination:         { type: 'Point', coordinates: [-121.76, 38.54] },
          destination_bearing: 45.0,
          direction_type:      'one_way',
          day_of_week:         [1],
          departure_time:      '08:30:00',
          arrival_time:        null,
          origin_address:      'UC Davis, Davis, CA, USA',
          dest_address:        'San Francisco, CA, USA',
          route_polyline:      'encoded_polyline_test',
          available_seats:     1,
          end_date:            null,
          note:                null,
        })
      })

      // Shows confirmation screen
      await waitFor(() => {
        expect(screen.getByTestId('schedule-confirmation')).toBeInTheDocument()
      })
      expect(screen.getByText('Routine Saved!')).toBeInTheDocument()
    })

    it('shows error when getPlaceCoordinates returns null', async () => {
      mockGetPlaceCoordinates.mockResolvedValue(null)
      const user = await goToRoutineStep()

      // Select Monday and set time inline
      await user.click(screen.getByTestId('day-pill-1'))
      const timeInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '08:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-routine-button'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
        expect(screen.getByText('Could not determine coordinates for your locations.')).toBeInTheDocument()
      })
    })

    it('shows error when supabase insert fails', async () => {
      mockInsert.mockReturnValue(mockInsertReturn({ error: { message: 'DB error' } }))
      const user = await goToRoutineStep()

      // Select Monday and set time inline
      await user.click(screen.getByTestId('day-pill-1'))
      const timeInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(timeInput, '08:30')
      timeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-routine-button'))

      await waitFor(() => {
        expect(screen.getByTestId('submit-error')).toBeInTheDocument()
        expect(screen.getByText('DB error')).toBeInTheDocument()
      })
    })

    it('back button returns to details step', async () => {
      const user = await goToRoutineStep()
      await user.click(screen.getByTestId('back-button'))
      expect(screen.getByTestId('route-name-input')).toBeInTheDocument()
      expect(screen.getByText('Schedule a Drive')).toBeInTheDocument()
    })

    // ── Per-Day Time Mode ──────────────────────────────────────────────────────

    it('shows per-day toggle when 2+ days are selected', async () => {
      const user = await goToRoutineStep()

      // Select only one day — toggle should NOT appear
      await user.click(screen.getByTestId('day-pill-1'))
      expect(screen.queryByTestId('per-day-toggle')).not.toBeInTheDocument()

      // Select a second day — toggle SHOULD appear
      await user.click(screen.getByTestId('day-pill-3'))
      expect(screen.getByTestId('per-day-toggle')).toBeInTheDocument()
      expect(screen.getByText('Set different time per day')).toBeInTheDocument()
    })

    it('toggling per-day mode shows individual day time rows', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))

      // Should show per-day time rows
      expect(screen.getByTestId('day-time-row-1')).toBeInTheDocument()
      expect(screen.getByTestId('day-time-row-3')).toBeInTheDocument()
      expect(screen.getByText('Monday')).toBeInTheDocument()
      expect(screen.getByText('Wednesday')).toBeInTheDocument()

      // Shared time picker should NOT be visible
      expect(screen.queryByTestId('sheet-time-input')).not.toBeInTheDocument()
    })

    it('per-day mode pre-fills all days with the shared time', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed, Fri
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))
      await user.click(screen.getByTestId('day-pill-5'))

      // Set shared time first
      const sharedInput = screen.getByTestId('sheet-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(sharedInput, '08:30')
      sharedInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))

      // All three days should be pre-filled with 08:30
      expect(screen.getByTestId('day-1-time-input')).toHaveValue('08:30')
      expect(screen.getByTestId('day-3-time-input')).toHaveValue('08:30')
      expect(screen.getByTestId('day-5-time-input')).toHaveValue('08:30')

      // Now change just Friday to 10:00
      const friInput = screen.getByTestId('day-5-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(friInput, '10:00')
      friInput.dispatchEvent(new Event('change', { bubbles: true }))

      expect(screen.getByTestId('day-1-time-input')).toHaveValue('08:30')
      expect(screen.getByTestId('day-3-time-input')).toHaveValue('08:30')
      expect(screen.getByTestId('day-5-time-input')).toHaveValue('10:00')
    })

    it('per-day mode allows different times per day', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))

      // Set Monday time: 08:00
      const monTimeInput = screen.getByTestId('day-1-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(monTimeInput, '08:00')
      monTimeInput.dispatchEvent(new Event('change', { bubbles: true }))

      // Set Wednesday time: 10:00
      const wedTimeInput = screen.getByTestId('day-3-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(wedTimeInput, '10:00')
      wedTimeInput.dispatchEvent(new Event('change', { bubbles: true }))

      expect(monTimeInput).toHaveValue('08:00')
      expect(wedTimeInput).toHaveValue('10:00')
    })

    it('per-day mode can toggle back to shared mode', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))
      expect(screen.getByText('Use same time for all days')).toBeInTheDocument()

      // Switch back to shared mode
      await user.click(screen.getByTestId('per-day-toggle'))
      expect(screen.getByTestId('sheet-time-input')).toBeInTheDocument()
      expect(screen.getByText('Set time for 2 days')).toBeInTheDocument()
    })

    it('shows validation error in per-day mode when time not set for a day', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))

      // Set only Monday time, leave Wednesday empty
      const monTimeInput = screen.getByTestId('day-1-time-input')
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )?.set?.call(monTimeInput, '08:00')
      monTimeInput.dispatchEvent(new Event('change', { bubbles: true }))

      await user.click(screen.getByTestId('submit-routine-button'))
      expect(screen.getByText(/Please set a time for Wednesday/i)).toBeInTheDocument()
    })

    it('per-day mode supports departure/arrival per day', async () => {
      const user = await goToRoutineStep()

      // Select Mon, Wed
      await user.click(screen.getByTestId('day-pill-1'))
      await user.click(screen.getByTestId('day-pill-3'))

      // Switch to per-day mode
      await user.click(screen.getByTestId('per-day-toggle'))

      // Monday: departure (default), Wednesday: arrival
      await user.click(screen.getByTestId('day-3-time-type-arrival'))
      expect(screen.getByTestId('day-3-time-type-arrival')).toHaveClass('bg-primary')
      expect(screen.getByTestId('day-1-time-type-departure')).toHaveClass('bg-primary')
    })
  })
})
