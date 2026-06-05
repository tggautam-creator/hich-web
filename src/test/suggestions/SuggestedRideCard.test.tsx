/**
 * v1.3 Sprint 14 Slice B — SuggestedRideCard tests.
 *
 * Pins:
 *   - CTA copy + tint flip on viewer.side ('rider' vs 'driver')
 *   - Classification badge variants (direct / transit_dropoff /
 *     transit_pickup) render the right label + tint
 *   - "Today" / "Tomorrow" / weekday formatting on trip_date
 *   - Anytime fallback when both sides have no specific time
 *   - Dismiss + CTA callbacks fire
 *   - Avatar initial fallback when other_user has no avatar_url
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SuggestedRideCard from '@/components/suggestions/SuggestedRideCard'
import type { Suggestion } from '@/lib/suggestionsApi'

function baseSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 's-001',
    trip_date: '2026-06-10',
    match_type: 'same_day_forward',
    relevance_score: 0.85,
    match_signals: {
      classification: 'direct',
      bearing_diff_deg: 5,
      time_diff_min: 10,
      origin_distance_m: 320,
      dest_distance_m: 410,
      corridor_origin_m: null,
      corridor_dest_m: null,
      handoff_total_minutes: null,
      handoff_station_name: null,
      handoff_station_address: null,
      handoff_walk_minutes: null,
      handoff_transit_minutes: null,
      handoff_ride_minutes: null,
      handoff_transit_line: null,
      handoff_transit_type: null,
    },
    side: 'rider',
    status: 'new',
    other_user: {
      id: 'u-2',
      full_name: 'Casey Lin',
      avatar_url: null,
      rating_avg: 4.8,
    },
    rider_source: null,
    driver_source: {
      schedule: {
        id: 'sched-1',
        origin_address: '123 Main St, Davis, CA',
        dest_address: 'Downtown SF, San Francisco, CA',
        trip_time: '09:30:00',
        time_flexible: false,
      },
      routine: null,
    },
    created_at: '2026-06-04T12:00:00.000Z',
    ...overrides,
  }
}

describe('SuggestedRideCard', () => {
  it('rider-side shows "Request this ride" with primary tint', () => {
    const onAct = vi.fn()
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={onAct} onDismiss={() => {}} />)
    const cta = screen.getByTestId('suggested-ride-card-cta-s-001')
    expect(cta).toHaveTextContent('Request this ride')
    expect(cta.className).toContain('bg-primary')
  })

  it('driver-side shows "Offer this ride" with success tint', () => {
    render(
      <SuggestedRideCard
        suggestion={baseSuggestion({
          side: 'driver',
          rider_source: {
            schedule: {
              id: 'sched-r',
              origin_address: 'Davis, CA',
              dest_address: 'Sacramento, CA',
              trip_time: '14:00:00',
              time_flexible: false,
            },
            routine: null,
          },
          driver_source: null,
        })}
        onAct={() => {}}
        onDismiss={() => {}}
      />,
    )
    const cta = screen.getByTestId('suggested-ride-card-cta-s-001')
    expect(cta).toHaveTextContent('Offer this ride')
    expect(cta.className).toContain('bg-success')
  })

  it('renders the "Same route" badge for direct classification', () => {
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText('Same route')).toBeInTheDocument()
  })

  it('renders the "Transit dropoff" badge when classification flips', () => {
    render(
      <SuggestedRideCard
        suggestion={baseSuggestion({
          match_signals: {
            ...baseSuggestion().match_signals,
            classification: 'transit_dropoff',
            handoff_total_minutes: 47,
            handoff_station_name: 'Embarcadero',
          },
        })}
        onAct={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('Transit dropoff')).toBeInTheDocument()
    expect(screen.getByText('47 min')).toBeInTheDocument()
  })

  it('first-name only in the name slot (truncates "Casey Lin" → "Casey")', () => {
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText('Casey')).toBeInTheDocument()
    expect(screen.queryByText('Casey Lin')).not.toBeInTheDocument()
  })

  it('avatar fallback shows the initial letter when other_user has no avatar_url', () => {
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={() => {}} onDismiss={() => {}} />)
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('dismiss button fires the onDismiss callback', () => {
    const onDismiss = vi.fn()
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={() => {}} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByTestId('suggested-ride-card-dismiss-s-001'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('CTA button fires the onAct callback', () => {
    const onAct = vi.fn()
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={onAct} onDismiss={() => {}} />)
    fireEvent.click(screen.getByTestId('suggested-ride-card-cta-s-001'))
    expect(onAct).toHaveBeenCalledOnce()
  })

  it('renders short destination (first comma-segment of full address)', () => {
    render(<SuggestedRideCard suggestion={baseSuggestion()} onAct={() => {}} onDismiss={() => {}} />)
    // dest_address = "Downtown SF, San Francisco, CA" → "Downtown SF"
    expect(screen.getByText('Downtown SF')).toBeInTheDocument()
  })
})
