/**
 * v1.2.1 S2.1 (Sprint 10 Slice 2) — unit-level coverage of the
 * MatchBadge + TransitHandoffCard reverse_transit_handoff variants
 * exported from RideBoardHome. Avoids spinning up the full
 * autocomplete + search UI; targets the two small presentational
 * helpers directly. Mirrors iOS RideBoardHomePage.swift:
 *   • matchBadge switch (lines 820-858) + .reverseTransitHandoff case
 *     (842-849) — "Meet via transit" + primary tint
 *   • transitHandoffCard (889-947) — direction-aware copy + tint
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MatchBadge, TransitHandoffCard } from '@/components/schedule/RideBoardHome'
import type { BoardSearchTransitHandoff } from '@/lib/boardSearch'

function makeHandoff(overrides: Partial<BoardSearchTransitHandoff> = {}): BoardSearchTransitHandoff {
  return {
    station_name: 'MacArthur BART',
    station_place_id: 'p1',
    station_address: '555 40th St',
    station_lat: 37.83,
    station_lng: -122.27,
    walk_to_station_minutes: 5,
    transit_to_dest_minutes: 28,
    total_rider_minutes: 35,
    direction: 'forward',
    transit_option: {
      type: 'SUBWAY',
      icon: 'tram',
      line_name: 'BART Yellow Line',
      walk_minutes: 5,
      total_minutes: 35,
    },
    ...overrides,
  }
}

describe('MatchBadge', () => {
  it('renders "On your route" for direct match', () => {
    render(<MatchBadge matchType="direct" handoff={null} />)
    expect(screen.getByText(/On your route/)).toBeInTheDocument()
  })

  it('renders "Drop + transit" warning badge for forward transit_handoff', () => {
    const handoff = makeHandoff({ direction: 'forward' })
    const { container } = render(<MatchBadge matchType="transit_handoff" handoff={handoff} />)
    expect(screen.getByText(/Drop \+ transit/)).toBeInTheDocument()
    expect(container.firstChild?.textContent).toContain('35 min')
    // Reverse-variant testid should NOT be present for forward result.
    expect(screen.queryByTestId('board-match-badge-reverse')).toBeNull()
  })

  it('renders "Meet via transit" primary badge for reverse_transit_handoff', () => {
    const handoff = makeHandoff({ direction: 'reverse' })
    render(<MatchBadge matchType="reverse_transit_handoff" handoff={handoff} />)
    const badge = screen.getByTestId('board-match-badge-reverse')
    expect(badge.textContent).toContain('Meet via transit')
    // Total minutes appended when handoff provides them
    expect(badge.textContent).toContain('35 min')
    // Primary tint (matches iOS choice — different from the forward
    // warning tint so users can scan results and tell the directions
    // apart at a glance).
    expect(badge.className).toContain('primary')
  })

  it('handles reverse_transit_handoff with no handoff data gracefully (no total minutes appended)', () => {
    render(<MatchBadge matchType="reverse_transit_handoff" handoff={null} />)
    const badge = screen.getByTestId('board-match-badge-reverse')
    expect(badge.textContent).toContain('Meet via transit')
    // No "min" suffix when totalRiderMinutes is missing.
    expect(badge.textContent ?? '').not.toMatch(/\d+ min/)
  })
})

describe('TransitHandoffCard — direction-aware copy', () => {
  it('FORWARD: "Drop at X" headline + "{line} · X to your destination" leg + warning tint', () => {
    const handoff = makeHandoff({ direction: 'forward' })
    const { container } = render(<TransitHandoffCard handoff={handoff} />)
    expect(screen.getByText('Drop at MacArthur BART')).toBeInTheDocument()
    expect(container.firstChild?.textContent).toContain('to your destination')
    expect((container.firstChild as HTMLElement | null)?.className ?? '').toContain('warning')
  })

  it('REVERSE: "Take transit to X" headline + "{line} · X from your pickup" leg + primary tint', () => {
    const handoff = makeHandoff({ direction: 'reverse' })
    const { container } = render(<TransitHandoffCard handoff={handoff} />)
    expect(screen.getByText('Take transit to MacArthur BART')).toBeInTheDocument()
    expect(container.firstChild?.textContent).toContain('from your pickup')
    expect((container.firstChild as HTMLElement | null)?.className ?? '').toContain('primary')
    // Reverse breakdown copy includes "+ ride with driver" suffix.
    expect(container.firstChild?.textContent).toContain('+ ride with driver')
  })

  it('FORWARD breakdown reads "Walk N min · ride X · ~Y total" (no driver suffix)', () => {
    const handoff = makeHandoff({ direction: 'forward' })
    const { container } = render(<TransitHandoffCard handoff={handoff} />)
    expect(container.firstChild?.textContent).toContain('Walk 5 min')
    expect(container.firstChild?.textContent).toContain('~35 min total')
    // Forward breakdown does NOT include the "+ ride with driver" suffix.
    expect(container.firstChild?.textContent).not.toContain('+ ride with driver')
  })

  it('defaults to FORWARD when direction is omitted (backward-compat with pre-S2 servers)', () => {
    const handoff: BoardSearchTransitHandoff = {
      station_name: 'X',
      station_place_id: 'p',
      station_address: '',
      station_lat: 0,
      station_lng: 0,
      walk_to_station_minutes: 5,
      transit_to_dest_minutes: 10,
      total_rider_minutes: 15,
      transit_option: null,
      // direction omitted — older servers don't send it
    }
    render(<TransitHandoffCard handoff={handoff} />)
    expect(screen.getByText('Drop at X')).toBeInTheDocument()
    // No reverse copy.
    expect(screen.queryByText(/Take transit to/)).toBeNull()
  })

  it('shows "Transit info unavailable" when transit_option is null', () => {
    const handoff = makeHandoff({ direction: 'reverse', transit_option: null })
    render(<TransitHandoffCard handoff={handoff} />)
    expect(screen.getByText(/Transit info unavailable/)).toBeInTheDocument()
  })
})
