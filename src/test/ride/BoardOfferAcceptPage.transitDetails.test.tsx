/**
 * v1.3 Sprint 10 Slice 1 — BoardOfferAcceptPage transit-handoff
 * stop row + leg pills.
 *
 * Verifies:
 *   - When proposed_transit_line_name + proposed_dropoff_name are both
 *     present, the standard "Drop: {name}" row is REPLACED by the
 *     transit-stop card pattern (eyebrow + station + "Then take X to Y"
 *     subtitle + walk/transit/total pills filtered to non-zero values).
 *   - When proposed_transit_line_name is null, the standard Drop row
 *     renders (the common non-transit case is unaffected).
 *   - Pill ordering is walk → transit → total (mirrors iOS line 700-728).
 *   - Falls back to "your destination" when posted.dropoff_name is null.
 *
 * Verbatim parity against iOS BoardOfferAcceptPage.swift:653-728.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BoardOfferAcceptPage from '@/components/ride/BoardOfferAcceptPage'

// ── Mocks ────────────────────────────────────────────────────────────

const { mockGetSession, mockFetch, mockNavigate } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  }),
  mockFetch: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams:   () => ({ scheduleId: 'sched-1' }),
  }
})

beforeEach(() => {
  mockNavigate.mockClear()
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

interface TransitOfferFixture {
  proposed_dropoff_name?: string | null
  proposed_transit_line_name?: string | null
  proposed_transit_walk_minutes?: number | null
  proposed_transit_to_dest_minutes?: number | null
  proposed_transit_total_minutes?: number | null
}

function mockOffersResponse(opts: {
  offer?: TransitOfferFixture
  // 'postedDropoffName' in opts distinguishes "omitted" from "explicit null".
  // ?? would coerce explicit-null to the default string, masking the
  // null-destination test scenario (same pattern as rides.contact.test.ts).
  postedDropoffName?: string | null
} = {}) {
  const offer = opts.offer ?? {}
  const postedDropoffName =
    'postedDropoffName' in opts ? opts.postedDropoffName : 'Berkeley Campus'
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      offers: [{
        id:                    'o-1',
        status:                'pending',
        created_at:            '2026-05-01T12:00:00Z',
        proposed_pickup_name:  '123 Main St',
        proposed_dropoff_name: 'proposed_dropoff_name' in offer ? offer.proposed_dropoff_name : 'Embarcadero BART',
        proposed_fare_cents:   1200,
        proposed_eta_minutes:  null,
        proposed_transit_line_name: 'proposed_transit_line_name' in offer ? offer.proposed_transit_line_name : null,
        proposed_transit_walk_minutes: 'proposed_transit_walk_minutes' in offer ? offer.proposed_transit_walk_minutes : null,
        proposed_transit_to_dest_minutes: 'proposed_transit_to_dest_minutes' in offer ? offer.proposed_transit_to_dest_minutes : null,
        proposed_transit_total_minutes: 'proposed_transit_total_minutes' in offer ? offer.proposed_transit_total_minutes : null,
        driver: {
          id:                       'd-1',
          full_name:                'Sarah Smith',
          avatar_url:               null,
          rating_avg:               4.8,
          rating_count:             12,
          waive_caregiver_fee:      false,
        },
        vehicle: null,
      }],
      posted: {
        pickup_name:          '123 Main St',
        pickup_lat:           37.7,
        pickup_lng:           -122.4,
        dropoff_name:         postedDropoffName,
        dropoff_lat:          37.87,
        dropoff_lng:          -122.26,
        trip_date:            '2026-06-01',
        trip_time:            '10:00:00',
        time_flexible:        false,
        has_caregiver:        false,
        caregiver_fare_cents: null,
      },
    }),
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BoardOfferAcceptPage />
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BoardOfferAcceptPage — transit hand-off stop row', () => {
  it('renders the transit-stop card when proposed_transit_line_name + proposed_dropoff_name are both present', async () => {
    mockOffersResponse({
      offer: {
        proposed_dropoff_name: 'Embarcadero BART',
        proposed_transit_line_name: 'BART Yellow Line',
        proposed_transit_walk_minutes: 3,
        proposed_transit_to_dest_minutes: 22,
        proposed_transit_total_minutes: 25,
      },
      postedDropoffName: 'Berkeley Campus',
    })
    renderPage()
    await waitFor(() => screen.getByTestId('board-offer-transit-stop'))
    const card = screen.getByTestId('board-offer-transit-stop')
    // Eyebrow verbatim vs iOS line 663
    expect(card.textContent).toContain('DRIVER DROPS YOU HERE')
    // Station name (proposed_dropoff_name)
    expect(card.textContent).toContain('Embarcadero BART')
    // Subtitle verbatim vs iOS line 672 — "Then take {line} to {destName}"
    expect(card.textContent).toContain('Then take BART Yellow Line to Berkeley Campus')
  })

  it('renders walk → transit → total pills in that order', async () => {
    mockOffersResponse({
      offer: {
        proposed_transit_line_name: 'BART Yellow Line',
        proposed_transit_walk_minutes: 3,
        proposed_transit_to_dest_minutes: 22,
        proposed_transit_total_minutes: 25,
      },
    })
    renderPage()
    await waitFor(() => screen.getByTestId('board-offer-transit-pills'))
    const pillRow = screen.getByTestId('board-offer-transit-pills')
    const text = pillRow.textContent ?? ''
    const walkIdx = text.indexOf('3 min walk')
    const transitIdx = text.indexOf('22 min ride')
    const totalIdx = text.indexOf('25 min total')
    expect(walkIdx).toBeGreaterThanOrEqual(0)
    expect(transitIdx).toBeGreaterThan(walkIdx)
    expect(totalIdx).toBeGreaterThan(transitIdx)
    // Total pill copy starts with ~ (mirrors iOS line 706 — "~\(total) min total")
    expect(text).toContain('~25 min total')
  })

  it('filters out pills whose minute value is null or zero', async () => {
    mockOffersResponse({
      offer: {
        proposed_transit_line_name: 'AC Transit 51B',
        proposed_transit_walk_minutes: 0,
        proposed_transit_to_dest_minutes: 18,
        proposed_transit_total_minutes: null,
      },
    })
    renderPage()
    await waitFor(() => screen.getByTestId('board-offer-transit-pills'))
    const pillRow = screen.getByTestId('board-offer-transit-pills')
    const text = pillRow.textContent ?? ''
    expect(text).toContain('18 min ride')
    expect(text).not.toContain('min walk')
    expect(text).not.toContain('min total')
  })

  it('falls back to "your destination" when posted.dropoff_name is null', async () => {
    mockOffersResponse({
      offer: {
        proposed_transit_line_name: 'BART Red Line',
        proposed_transit_walk_minutes: 5,
        proposed_transit_to_dest_minutes: 15,
        proposed_transit_total_minutes: 20,
      },
      postedDropoffName: null,
    })
    renderPage()
    await waitFor(() => screen.getByTestId('board-offer-transit-stop'))
    expect(screen.getByTestId('board-offer-transit-stop').textContent)
      .toContain('Then take BART Red Line to your destination')
  })

  it('does NOT render the transit-stop card when proposed_transit_line_name is null (standard Drop row instead)', async () => {
    mockOffersResponse({
      offer: {
        proposed_dropoff_name: 'Berkeley Campus',
        proposed_transit_line_name: null,
      },
    })
    renderPage()
    // The standard "Drop: …" row renders, not the transit-stop card.
    await waitFor(() => screen.getByText(/Drop: Berkeley Campus/))
    expect(screen.queryByTestId('board-offer-transit-stop')).toBeNull()
  })

  it('does NOT render the transit-stop card when proposed_dropoff_name is null even if line_name is set', async () => {
    // Defensive: line_name without a station headline is unusable; gate
    // requires both. Falls through to "nothing" since the standard Drop
    // row also requires proposed_dropoff_name.
    mockOffersResponse({
      offer: {
        proposed_dropoff_name: null,
        proposed_transit_line_name: 'BART Yellow Line',
      },
    })
    renderPage()
    // Wait for SOMETHING to render so we know the page mounted.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByTestId('board-offer-transit-stop')).toBeNull()
    expect(screen.queryByText(/^Drop:/)).toBeNull()
  })

  it('renders the transit-stop card when ONLY a subset of minute fields are present (line_name alone is enough)', async () => {
    // Server may return line_name without populating all 3 minute
    // counts (e.g. Google's directions API returned the route name but
    // not granular times). Card still renders; pill row hides.
    mockOffersResponse({
      offer: {
        proposed_transit_line_name: 'BART Yellow Line',
        proposed_transit_walk_minutes: null,
        proposed_transit_to_dest_minutes: null,
        proposed_transit_total_minutes: null,
      },
    })
    renderPage()
    await waitFor(() => screen.getByTestId('board-offer-transit-stop'))
    // Card present, pill row absent.
    expect(screen.queryByTestId('board-offer-transit-pills')).toBeNull()
  })
})
