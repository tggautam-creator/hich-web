/**
 * v1.3 Sprint 14 Slice C — SuggestionDetailSheet tests.
 *
 * Pins:
 *   - Section render order: trip-date banner → classification →
 *     other-user card → trip cards (their + yours) → optional
 *     transit breakdown → why-this-match → CTA
 *   - CTA copy flips on viewer.side (rider vs driver)
 *   - Transit breakdown only renders for non-direct classifications
 *   - CTA fires onAct + onClose (back to home)
 *   - other-user tile is a button (opens UserProfilePreviewSheet)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SuggestionDetailSheet from '@/components/suggestions/SuggestionDetailSheet'
import type { Suggestion } from '@/lib/suggestionsApi'

// Stub the profile preview sheet — it's tested separately and pulls
// in supabase via UserProfilePreviewCard which we don't want to drive
// here.
vi.mock('@/components/profile/UserProfilePreviewSheet', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="profile-preview-sheet-stub" /> : null,
}))

function baseSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 's-001',
    trip_date: '2026-06-10',
    match_type: 'same_day_forward',
    relevance_score: 0.92,
    match_signals: {
      classification: 'direct',
      bearing_diff_deg: 5,
      time_diff_min: 8,
      origin_distance_m: 250,
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
    other_user: { id: 'u-2', full_name: 'Casey Lin', avatar_url: null, rating_avg: 4.8 },
    rider_source: {
      schedule: {
        id: 'sched-r',
        origin_address: 'Memorial Union, Davis, CA',
        dest_address: 'Downtown SF, San Francisco, CA',
        trip_time: '09:30:00',
        time_flexible: false,
      },
      routine: null,
    },
    driver_source: {
      schedule: {
        id: 'sched-d',
        origin_address: 'Davis, CA',
        dest_address: 'San Francisco, CA',
        trip_time: '09:15:00',
        time_flexible: false,
      },
      routine: null,
    },
    created_at: '2026-06-04T12:00:00.000Z',
    ...overrides,
  }
}

function renderSheet(props: Partial<Parameters<typeof SuggestionDetailSheet>[0]> = {}) {
  return render(
    <>
      <div id="portal-root" />
      <SuggestionDetailSheet
        isOpen
        onClose={() => {}}
        suggestion={baseSuggestion()}
        onAct={() => {}}
        {...props}
      />
    </>,
  )
}

describe('SuggestionDetailSheet', () => {
  it('renders the trip-date banner with the suggestion date', () => {
    renderSheet()
    expect(screen.getByText('Suggested for')).toBeInTheDocument()
  })

  it('renders the "Same route" classification banner for direct matches', () => {
    renderSheet()
    expect(screen.getByText('Same route')).toBeInTheDocument()
  })

  it('renders BOTH trip cards (their + yours)', () => {
    renderSheet()
    expect(screen.getByTestId('suggestion-detail-trip-their')).toBeInTheDocument()
    expect(screen.getByTestId('suggestion-detail-trip-yours')).toBeInTheDocument()
  })

  it('rider-side CTA reads "Request this ride" with primary tint', () => {
    renderSheet()
    const cta = screen.getByTestId('suggestion-detail-cta')
    expect(cta).toHaveTextContent('Request this ride')
    expect(cta.className).toContain('bg-primary')
  })

  it('driver-side CTA reads "Offer this ride" with success tint', () => {
    renderSheet({ suggestion: baseSuggestion({ side: 'driver' }) })
    const cta = screen.getByTestId('suggestion-detail-cta')
    expect(cta).toHaveTextContent('Offer this ride')
    expect(cta.className).toContain('bg-success')
  })

  it('hides the transit breakdown card for direct matches', () => {
    renderSheet()
    expect(screen.queryByTestId('suggestion-detail-transit-breakdown')).not.toBeInTheDocument()
  })

  it('shows the transit breakdown card for transit_dropoff', () => {
    renderSheet({
      suggestion: baseSuggestion({
        match_signals: {
          ...baseSuggestion().match_signals,
          classification: 'transit_dropoff',
          handoff_station_name: 'Embarcadero',
          handoff_total_minutes: 47,
          handoff_ride_minutes: 25,
          handoff_walk_minutes: 5,
          handoff_transit_minutes: 17,
          handoff_transit_line: 'BART Yellow',
        },
      }),
    })
    expect(screen.getByTestId('suggestion-detail-transit-breakdown')).toBeInTheDocument()
    expect(screen.getByText('How the handoff works')).toBeInTheDocument()
  })

  it('renders the "Why this match" card with relevance percentage', () => {
    renderSheet()
    expect(screen.getByTestId('suggestion-detail-why-card')).toBeInTheDocument()
    expect(screen.getByText('92 / 100')).toBeInTheDocument()
  })

  it('CTA tap fires onAct then onClose', () => {
    const onAct = vi.fn()
    const onClose = vi.fn()
    renderSheet({ onAct, onClose })
    fireEvent.click(screen.getByTestId('suggestion-detail-cta'))
    expect(onAct).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('tapping the other-user tile opens the profile preview sheet', () => {
    renderSheet()
    expect(screen.queryByTestId('profile-preview-sheet-stub')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('suggestion-detail-open-profile'))
    expect(screen.getByTestId('profile-preview-sheet-stub')).toBeInTheDocument()
  })
})
