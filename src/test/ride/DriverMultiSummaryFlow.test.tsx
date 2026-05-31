import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DriverMultiSummaryFlow from '@/components/ride/DriverMultiSummaryFlow'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )
  return { ...actual, useNavigate: () => mockNavigate }
})

const DRIVER_ID = 'driver-001'
const SCHEDULE_ID = 'schedule-001'
const RIDER_A = 'rider-a-uuid'
const RIDER_B = 'rider-b-uuid'
const RIDER_C = 'rider-c-uuid'
const RIDE_A = 'ride-a-uuid'
const RIDE_B = 'ride-b-uuid'
const RIDE_C = 'ride-c-uuid'

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector: (s: { profile: { id: string } | null }) => unknown) =>
      selector({ profile: { id: DRIVER_ID } }),
  ),
}))

vi.mock('@/lib/fare', () => ({
  formatCents: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}))

// Per-table dispatch — `rides` table returns the trip's rides,
// `users` returns the rider profiles.
interface RideRow {
  id: string
  rider_id: string | null
  fare_cents: number | null
  destination_name: string | null
  driver_id: string | null
  status: string
}
interface UserRow {
  id: string
  full_name: string | null
  avatar_url: string | null
}

const {
  ridesData,
  usersData,
  ridesError,
  usersError,
  mockFrom,
} = vi.hoisted(() => ({
  ridesData: { value: [] as RideRow[] },
  usersData: { value: [] as UserRow[] },
  ridesError: { value: null as Error | null },
  usersError: { value: null as Error | null },
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: 'test-token' } },
          error: null,
        }),
    },
  },
}))

function setupSupabase(opts: {
  rides?: RideRow[]
  users?: UserRow[]
  ridesError?: Error | null
  usersError?: Error | null
}) {
  ridesData.value = opts.rides ?? []
  usersData.value = opts.users ?? []
  ridesError.value = opts.ridesError ?? null
  usersError.value = opts.usersError ?? null

  mockFrom.mockImplementation((table: string) => {
    const builder: Record<string, (...args: never[]) => unknown> = {}

    builder['select'] = () => builder
    builder['eq'] = () => builder
    builder['in'] = () => builder
    builder['order'] = (() =>
      table === 'rides'
        ? Promise.resolve({ data: ridesData.value, error: ridesError.value })
        : Promise.resolve({ data: [], error: null })) as never

    // Make the builder thenable so `.in(...)` callers (the users fetch)
    // resolve directly.
    builder['then'] = ((onFulfilled: (v: unknown) => unknown) => {
      const result =
        table === 'users'
          ? { data: usersData.value, error: usersError.value }
          : { data: ridesData.value, error: ridesError.value }
      return Promise.resolve(result).then(onFulfilled)
    }) as unknown as (...args: never[]) => unknown

    return builder
  })
}

function renderWithRoute(node: ReactNode = <DriverMultiSummaryFlow />) {
  return render(
    <MemoryRouter initialEntries={[`/ride/multi-summary/${SCHEDULE_ID}`]}>
      <Routes>
        <Route path="/ride/multi-summary/:scheduleId" element={node} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DriverMultiSummaryFlow — iOS hero-then-list redesign', () => {
  it('renders hero + per-rider list + Done after fetching completed rides', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 850, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
        { id: RIDE_B, rider_id: RIDER_B, fare_cents: 750, destination_name: 'Davis', driver_id: DRIVER_ID, status: 'completed' },
        { id: RIDE_C, rider_id: RIDER_C, fare_cents: 900, destination_name: 'Berkeley', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [
        { id: RIDER_A, full_name: 'Alex Rider', avatar_url: null },
        { id: RIDER_B, full_name: 'Bee Carpooler', avatar_url: null },
        { id: RIDER_C, full_name: 'Cee Late', avatar_url: null },
      ],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-hero'))
    // Hero — copy verbatim from iOS DriverMultiRidePage+TripComplete.swift:111
    expect(screen.getAllByText('All riders dropped off')).toHaveLength(2) // hero + header subtitle
    expect(screen.getByTestId('trip-complete-total')).toHaveTextContent('$25.00')
    expect(screen.getByText('from 3 riders')).toBeInTheDocument()
    // Per-rider list label — verbatim against iOS line 139
    expect(screen.getByText('PER-RIDER SUMMARY')).toBeInTheDocument()
    expect(screen.getByText('Alex Rider')).toBeInTheDocument()
    expect(screen.getByText('Bee Carpooler')).toBeInTheDocument()
    expect(screen.getByText('Cee Late')).toBeInTheDocument()
  })

  it('renders "1 rider" singular when only one ride completed', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [{ id: RIDER_A, full_name: 'Alex', avatar_url: null }],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-hero'))
    expect(screen.getByText('from 1 rider')).toBeInTheDocument()
  })

  it('per-rider row click navigates to that rider\'s /ride/summary/:rideId', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
        { id: RIDE_B, rider_id: RIDER_B, fare_cents: 750, destination_name: 'Davis', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [
        { id: RIDER_A, full_name: 'Alex', avatar_url: null },
        { id: RIDER_B, full_name: 'Bee', avatar_url: null },
      ],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId(`trip-complete-row-${RIDE_B}`))
    fireEvent.click(screen.getByTestId(`trip-complete-row-${RIDE_B}`))
    expect(mockNavigate).toHaveBeenCalledWith(`/ride/summary/${RIDE_B}`)
  })

  it('Done button navigates back to driver home', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [{ id: RIDER_A, full_name: 'Alex', avatar_url: null }],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('done-button'))
    fireEvent.click(screen.getByTestId('done-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('back arrow navigates to driver home', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [{ id: RIDER_A, full_name: 'Alex', avatar_url: null }],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-back'))
    fireEvent.click(screen.getByTestId('trip-complete-back'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('renders avatar initials fallback when avatar_url is null', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [{ id: RIDER_A, full_name: 'Alex Rider', avatar_url: null }],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-hero'))
    // First letter of "Alex Rider" → "A"
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('renders <img> avatar when avatar_url is set', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
      ],
      users: [{ id: RIDER_A, full_name: 'Alex', avatar_url: 'https://example/alex.jpg' }],
    })
    const { container } = renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-hero'))
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://example/alex.jpg')
  })

  it('shows "No completed rides found" empty state when query returns 0', async () => {
    setupSupabase({ rides: [], users: [] })
    renderWithRoute()
    await waitFor(() => screen.getByText('No completed rides found'))
    fireEvent.click(screen.getByTestId('back-home-button'))
    expect(mockNavigate).toHaveBeenCalledWith('/home/driver', { replace: true })
  })

  it('filters out rides where driver_id does NOT match the current user', async () => {
    setupSupabase({
      rides: [
        { id: RIDE_A, rider_id: RIDER_A, fare_cents: 500, destination_name: 'Sacramento', driver_id: DRIVER_ID, status: 'completed' },
        // Different driver — must not appear
        { id: RIDE_B, rider_id: RIDER_B, fare_cents: 750, destination_name: 'Davis', driver_id: 'other-driver', status: 'completed' },
      ],
      users: [
        { id: RIDER_A, full_name: 'Alex', avatar_url: null },
        { id: RIDER_B, full_name: 'Bee', avatar_url: null },
      ],
    })
    renderWithRoute()
    await waitFor(() => screen.getByTestId('trip-complete-hero'))
    expect(screen.getByText('Alex')).toBeInTheDocument()
    expect(screen.queryByText('Bee')).not.toBeInTheDocument()
    expect(screen.getByText('from 1 rider')).toBeInTheDocument()
  })
})
