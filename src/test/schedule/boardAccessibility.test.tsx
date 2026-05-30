/**
 * v1.2 Sprint 7 Slice 4 — board mobility-aid pill (RideBoardCard) +
 * accessibility filter (boardFilters + RideBoardFilterSheet). Mirrors
 * the iOS coverage on `RideBoardCard.swift` / `RideBoardViewModel.swift`
 * F5.2 / F5.3 for the cases that map cleanly to web.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RideBoardCard from '@/components/schedule/RideBoardCard'
import RideBoardFilterSheet from '@/components/schedule/RideBoardFilterSheet'
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  type RideBoardFilters,
} from '@/components/schedule/boardFilters'
import type { Poster, ScheduledRide } from '@/components/schedule/boardTypes'

// ── Fixtures ─────────────────────────────────────────────────────────

function makeRide(poster: Poster | null): ScheduledRide {
  return {
    id:              'sched-1',
    user_id:         'u-1',
    mode:            'rider',
    route_name:      'Davis → SF',
    origin_address:  '1 Main St, Davis CA',
    dest_address:    '500 Mission St, San Francisco CA',
    direction_type:  'one_way',
    trip_date:       '2026-06-10',
    time_type:       'departure',
    trip_time:       '09:00:00',
    available_seats: 2,
    created_at:      '2026-06-09T18:00:00Z',
    poster,
  }
}

const basePoster: Poster = {
  id:                       'u-1',
  full_name:                'Maya',
  avatar_url:               null,
  rating_avg:               4.8,
  is_driver:                false,
  has_accessibility_needs:  false,
  needs_wheelchair:         false,
}

// ── boardFilters ─────────────────────────────────────────────────────

describe('boardFilters — accessibility', () => {
  it('default accessibility is "any"', () => {
    expect(DEFAULT_FILTERS.accessibility).toBe('any')
  })

  it('countActiveFilters bumps when accessibility ≠ "any"', () => {
    const f: RideBoardFilters = { ...DEFAULT_FILTERS, accessibility: 'accessibility_only' }
    expect(countActiveFilters(f)).toBe(1)
  })
})

// ── RideBoardCard pill ───────────────────────────────────────────────

describe('RideBoardCard — mobility-aid pill', () => {
  const noop = vi.fn()

  it('renders the pill when both has_accessibility_needs + needs_wheelchair are true', () => {
    const ride = makeRide({ ...basePoster, has_accessibility_needs: true, needs_wheelchair: true })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onRequestClick={noop}
        onDeleteClick={noop}
        onOpenMessages={noop}
        onCardClick={noop}
      />,
    )
    expect(screen.getByTestId('board-card-mobility-aid')).toBeTruthy()
  })

  it('does NOT render the pill when has_accessibility_needs is true but needs_wheelchair is false', () => {
    const ride = makeRide({ ...basePoster, has_accessibility_needs: true, needs_wheelchair: false })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onRequestClick={noop}
        onDeleteClick={noop}
        onOpenMessages={noop}
        onCardClick={noop}
      />,
    )
    expect(screen.queryByTestId('board-card-mobility-aid')).toBeNull()
  })

  it('does NOT render the pill when the poster fields are absent (pre-088 server)', () => {
    const ride = makeRide({
      id:         'u-1',
      full_name:  'Maya',
      avatar_url: null,
      rating_avg: 4.8,
      is_driver:  false,
    })
    render(
      <RideBoardCard
        ride={ride}
        isOwn={false}
        deletingId={null}
        onRequestClick={noop}
        onDeleteClick={noop}
        onOpenMessages={noop}
        onCardClick={noop}
      />,
    )
    expect(screen.queryByTestId('board-card-mobility-aid')).toBeNull()
  })
})

// ── RideBoardFilterSheet chip ─────────────────────────────────────────

describe('RideBoardFilterSheet — accessibility chip', () => {
  beforeEachPortalRoot()

  it('renders both options + reflects the current selection', () => {
    render(
      <RideBoardFilterSheet
        isOpen={true}
        filters={DEFAULT_FILTERS}
        hasUserLocation={false}
        showSeatsFilter={true}
        onApply={() => {}}
        onClose={() => {}}
      />,
    )

    const any = screen.getByTestId('filter-accessibility-any')
    const only = screen.getByTestId('filter-accessibility-only')
    expect(any).toBeTruthy()
    expect(only).toBeTruthy()
    // The "All riders" chip should look active by default.
    expect(any.className).toContain('border-primary')
    expect(only.className).not.toContain('border-primary')
  })

  it('toggling the chip + Apply propagates the new filter shape', () => {
    const onApply = vi.fn()
    render(
      <RideBoardFilterSheet
        isOpen={true}
        filters={DEFAULT_FILTERS}
        hasUserLocation={false}
        showSeatsFilter={true}
        onApply={onApply}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('filter-accessibility-only'))
    fireEvent.click(screen.getByTestId('filter-apply'))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      accessibility: 'accessibility_only',
    }))
  })
})

// ── Test setup helper ────────────────────────────────────────────────

function beforeEachPortalRoot() {
  // BottomSheet portals into #portal-root; provide one for jsdom.
  beforeAll(() => {
    document.body.innerHTML = '<div id="portal-root"></div>'
  })
  beforeEach(() => {
    document.body.innerHTML = '<div id="portal-root"></div>'
  })
}

// vitest auto-imports these but TS doesn't see them — re-declare for type-safety.
import { beforeAll, beforeEach } from 'vitest'
