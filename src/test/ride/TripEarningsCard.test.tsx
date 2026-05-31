import type { ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TripEarningsCard from '@/components/ride/TripEarningsCard'
import type {
  ShareDetailsCoRider,
  ShareDetailsRiderShare,
  ShareDetailsSegment,
} from '@/lib/shareDetails'

const RIDER_A = '00000000-0000-4000-8000-00000000aaaa'
const RIDER_B = '00000000-0000-4000-8000-00000000bbbb'
const RIDER_C = '00000000-0000-4000-8000-00000000cccc'
const RIDE_A = '11111111-1111-4111-8111-111111111aaa'
const RIDE_B = '11111111-1111-4111-8111-111111111bbb'
const RIDE_C = '11111111-1111-4111-8111-111111111ccc'

function coRider(overrides: Partial<ShareDetailsCoRider> = {}): ShareDetailsCoRider {
  return {
    rider_id: RIDER_A,
    ride_id: RIDE_A,
    full_name: 'Alex Rider',
    avatar_url: null,
    destination_name: 'Sacramento',
    ...overrides,
  }
}

function share(overrides: Partial<ShareDetailsRiderShare> = {}): ShareDetailsRiderShare {
  return {
    rider_id: RIDER_A,
    base_share_cents: 500,
    caregiver_share_cents: 0,
    companion_share_cents: 0,
    total_cents: 500,
    segments_in_count: 1,
    payment_status: 'paid',
    ...overrides,
  }
}

function segment(overrides: Partial<ShareDetailsSegment> = {}): ShareDetailsSegment {
  return {
    segment_index: 0,
    started_at: '2026-05-31T18:00:00Z',
    ended_at: '2026-05-31T18:30:00Z',
    distance_meters: 5_000,
    active_rider_ids: [RIDER_A],
    gas_cost_cents: 200,
    time_cost_cents: 150,
    ...overrides,
  }
}

function renderWithRouter(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="/start" element={<>{ui}</>} />
        <Route path="/ride/summary/:rideId" element={<div data-testid="navigated-summary" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TripEarningsCard', () => {
  it('renders one row per co-rider with name + destination + earnings', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({ rider_id: RIDER_A, ride_id: RIDE_A, full_name: 'Alex', destination_name: 'Sacramento' }),
          coRider({ rider_id: RIDER_B, ride_id: RIDE_B, full_name: 'Bee', destination_name: 'Davis' }),
        ]}
        shares={[
          share({ rider_id: RIDER_A, total_cents: 500 }),
          share({ rider_id: RIDER_B, total_cents: 750 }),
        ]}
        segments={[
          segment({ active_rider_ids: [RIDER_A, RIDER_B], distance_meters: 8_046 }),
        ]}
      />,
    )
    expect(screen.getByText('Alex')).toBeInTheDocument()
    expect(screen.getByText('To: Sacramento')).toBeInTheDocument()
    expect(screen.getByText('Bee')).toBeInTheDocument()
    expect(screen.getByText('To: Davis')).toBeInTheDocument()
    expect(screen.getByTestId(`trip-earnings-amount-${RIDER_A}`)).toHaveTextContent('+$5.00')
    expect(screen.getByTestId(`trip-earnings-amount-${RIDER_B}`)).toHaveTextContent('+$7.50')
  })

  it('shows total earnings = sum of share.total_cents across all rows', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({ rider_id: RIDER_A, ride_id: RIDE_A }),
          coRider({ rider_id: RIDER_B, ride_id: RIDE_B }),
          coRider({ rider_id: RIDER_C, ride_id: RIDE_C }),
        ]}
        shares={[
          share({ rider_id: RIDER_A, total_cents: 500 }),
          share({ rider_id: RIDER_B, total_cents: 750 }),
          share({ rider_id: RIDER_C, total_cents: 825 }),
        ]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByTestId('trip-earnings-total')).toHaveTextContent('$20.75')
    expect(screen.getByText('3 riders')).toBeInTheDocument()
  })

  it('uses 0 for riders without a shares row (active phase, not yet dropped off)', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({ rider_id: RIDER_A, ride_id: RIDE_A }),
          coRider({ rider_id: RIDER_B, ride_id: RIDE_B }),
        ]}
        shares={[
          share({ rider_id: RIDER_A, total_cents: 500 }),
          // RIDER_B has no shares row yet
        ]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByTestId(`trip-earnings-amount-${RIDER_B}`)).toHaveTextContent('+$0.00')
    // Total = $5.00 + $0.00 = $5.00
    expect(screen.getByTestId('trip-earnings-total')).toHaveTextContent('$5.00')
  })

  it('shows the "+ caregiver $X" badge when caregiver_share_cents > 0', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A })]}
        shares={[
          share({
            rider_id: RIDER_A,
            base_share_cents: 500,
            caregiver_share_cents: 500,
            total_cents: 1000,
          }),
        ]}
        segments={[segment()]}
      />,
    )
    const badge = screen.getByTestId(`trip-earnings-caregiver-${RIDER_A}`)
    expect(badge).toHaveTextContent('+ caregiver $5.00')
  })

  it('HIDES the caregiver badge when caregiver_share_cents is 0 (matches iOS — server-side waiver zeros it)', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A })]}
        shares={[
          share({
            rider_id: RIDER_A,
            base_share_cents: 500,
            caregiver_share_cents: 0,
            total_cents: 500,
          }),
        ]}
        segments={[segment()]}
      />,
    )
    expect(
      screen.queryByTestId(`trip-earnings-caregiver-${RIDER_A}`),
    ).not.toBeInTheDocument()
  })

  it('renders the per-rider "X.X mi shared" derived from segments', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A })]}
        shares={[share()]}
        segments={[
          // 8046m = 5.0 mi, RIDER_A is in
          segment({ active_rider_ids: [RIDER_A], distance_meters: 8_046 }),
        ]}
      />,
    )
    expect(screen.getByText('5.0 mi shared')).toBeInTheDocument()
  })

  it('skips the "X.X mi shared" line when distance is 0', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A })]}
        shares={[share()]}
        segments={[
          // RIDER_A is NOT in any segment — 0 distance
          segment({ active_rider_ids: [RIDER_B] }),
        ]}
      />,
    )
    expect(screen.queryByText(/mi shared/)).not.toBeInTheDocument()
  })

  it('falls back to "Rider" when full_name is null', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A, full_name: null })]}
        shares={[share()]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByText('Rider')).toBeInTheDocument()
  })

  it('falls back to "—" when destination_name is null', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A, destination_name: null })]}
        shares={[share()]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByText('To: —')).toBeInTheDocument()
  })

  it('renders the initials fallback avatar when avatar_url is null', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({ rider_id: RIDER_A, ride_id: RIDE_A, full_name: 'Alex Rider', avatar_url: null }),
        ]}
        shares={[share()]}
        segments={[segment()]}
      />,
    )
    // "Alex Rider" → "AR" initials
    expect(screen.getByText('AR')).toBeInTheDocument()
  })

  it('renders the <img> avatar when avatar_url is set', () => {
    const { container } = renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({
            rider_id: RIDER_A,
            ride_id: RIDE_A,
            full_name: 'Alex',
            avatar_url: 'https://example/alex.jpg',
          }),
        ]}
        shares={[share()]}
        segments={[segment()]}
      />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example/alex.jpg')
  })

  it('per-rider row click navigates to /ride/summary/{ride_id}', async () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[
          coRider({ rider_id: RIDER_A, ride_id: RIDE_A }),
          coRider({ rider_id: RIDER_B, ride_id: RIDE_B }),
        ]}
        shares={[share({ rider_id: RIDER_A }), share({ rider_id: RIDER_B })]}
        segments={[segment()]}
      />,
    )
    await userEvent.click(screen.getByTestId(`trip-earnings-row-${RIDER_B}`))
    expect(screen.getByTestId('navigated-summary')).toBeInTheDocument()
  })

  it('renders "1 rider" singular when coRiders.length === 1', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider()]}
        shares={[share()]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByText('1 rider')).toBeInTheDocument()
  })

  it('exposes the default + custom data-testid', () => {
    const { rerender } = renderWithRouter(
      <TripEarningsCard coRiders={[coRider()]} shares={[share()]} segments={[segment()]} />,
    )
    expect(screen.getByTestId('ride-summary-trip-earnings-card')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <TripEarningsCard
          coRiders={[coRider()]}
          shares={[share()]}
          segments={[segment()]}
          data-testid="custom-trip-earnings"
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('custom-trip-earnings')).toBeInTheDocument()
  })

  it('shows both caregiver badge AND earnings together', () => {
    renderWithRouter(
      <TripEarningsCard
        coRiders={[coRider({ rider_id: RIDER_A, ride_id: RIDE_A })]}
        shares={[
          share({
            rider_id: RIDER_A,
            base_share_cents: 500,
            caregiver_share_cents: 800,
            total_cents: 1300,
          }),
        ]}
        segments={[segment()]}
      />,
    )
    expect(screen.getByTestId(`trip-earnings-caregiver-${RIDER_A}`)).toHaveTextContent('$8.00')
    expect(screen.getByTestId(`trip-earnings-amount-${RIDER_A}`)).toHaveTextContent('+$13.00')
  })
})
