import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import YourShareCard from '@/components/ride/YourShareCard'
import type { ShareDetailsRiderShare, ShareDetailsSegment } from '@/lib/shareDetails'

// Stable UUIDs across tests.
const VIEWER = '00000000-0000-4000-8000-00000000aaaa'
const OTHER_B = '00000000-0000-4000-8000-00000000bbbb'
const OTHER_C = '00000000-0000-4000-8000-00000000cccc'
const OTHER_D = '00000000-0000-4000-8000-00000000dddd'

function share(overrides: Partial<ShareDetailsRiderShare> = {}): ShareDetailsRiderShare {
  return {
    rider_id: VIEWER,
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
    active_rider_ids: [VIEWER],
    gas_cost_cents: 200,
    time_cost_cents: 150,
    ...overrides,
  }
}

describe('YourShareCard', () => {
  it('renders the "Solo · X.X mi" grammar when only the viewer is in the segment', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share()}
        segments={[
          segment({
            distance_meters: 5_000, // ≈3.1 mi
            active_rider_ids: [VIEWER],
            gas_cost_cents: 200,
            time_cost_cents: 150,
          }),
        ]}
      />,
    )
    // Verbatim against iOS RideSummaryPage.swift:1043
    expect(screen.getByText('Solo · 3.1 mi')).toBeInTheDocument()
  })

  it('renders "With 1 other · X.X mi" (singular) when activeRiderIDs has 2', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share()}
        segments={[
          segment({
            distance_meters: 8_046,
            active_rider_ids: [VIEWER, OTHER_B],
            gas_cost_cents: 320,
            time_cost_cents: 80,
          }),
        ]}
      />,
    )
    // Verbatim against iOS RideSummaryPage.swift:1044
    expect(screen.getByText('With 1 other · 5.0 mi')).toBeInTheDocument()
  })

  it('renders "With N others · X.X mi" (plural) when activeRiderIDs has 3+', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share()}
        segments={[
          segment({
            distance_meters: 16_093,
            active_rider_ids: [VIEWER, OTHER_B, OTHER_C, OTHER_D],
            gas_cost_cents: 700,
            time_cost_cents: 100,
          }),
        ]}
      />,
    )
    // Verbatim against iOS RideSummaryPage.swift:1045 — note "3 others"
    expect(screen.getByText('With 3 others · 10.0 mi')).toBeInTheDocument()
  })

  it('hides caregiver + companion line items when their cents are 0', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({ caregiver_share_cents: 0, companion_share_cents: 0 })}
        segments={[segment()]}
      />,
    )
    expect(screen.queryByTestId('your-share-caregiver')).not.toBeInTheDocument()
    expect(screen.queryByTestId('your-share-companion')).not.toBeInTheDocument()
    expect(screen.getByTestId('your-share-base')).toBeInTheDocument()
    expect(screen.getByTestId('your-share-total')).toBeInTheDocument()
  })

  it('shows the caregiver line item when cents > 0', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({
          base_share_cents: 500,
          caregiver_share_cents: 500,
          total_cents: 1000,
        })}
        segments={[segment()]}
      />,
    )
    const row = screen.getByTestId('your-share-caregiver')
    expect(row).toBeInTheDocument()
    expect(row).toHaveTextContent('Caregiver seat')
    expect(row).toHaveTextContent('$5.00')
  })

  it('shows the companion line item when cents > 0', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({
          base_share_cents: 500,
          companion_share_cents: 250,
          total_cents: 750,
        })}
        segments={[segment()]}
      />,
    )
    const row = screen.getByTestId('your-share-companion')
    expect(row).toBeInTheDocument()
    expect(row).toHaveTextContent('Companion seat')
    expect(row).toHaveTextContent('$2.50')
  })

  it('renders both caregiver + companion when both > 0', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({
          base_share_cents: 500,
          caregiver_share_cents: 800,
          companion_share_cents: 300,
          total_cents: 1600,
        })}
        segments={[segment()]}
      />,
    )
    expect(screen.getByTestId('your-share-caregiver')).toHaveTextContent('$8.00')
    expect(screen.getByTestId('your-share-companion')).toHaveTextContent('$3.00')
    expect(screen.getByTestId('your-share-total')).toHaveTextContent('$16.00')
  })

  it('skips segments where the viewer is NOT in active_rider_ids', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({ segments_in_count: 1 })}
        segments={[
          // Viewer's own segment
          segment({ segment_index: 0, active_rider_ids: [VIEWER], distance_meters: 5_000 }),
          // A segment the viewer was NOT in (other rider continued solo)
          segment({
            segment_index: 1,
            active_rider_ids: [OTHER_B],
            distance_meters: 3_000,
          }),
        ]}
      />,
    )
    expect(screen.getByTestId('your-share-segment-0')).toBeInTheDocument()
    expect(screen.queryByTestId('your-share-segment-1')).not.toBeInTheDocument()
  })

  it('skips zero-cost segments (open segments with no accrued gas+time)', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share()}
        segments={[
          segment({
            segment_index: 0,
            active_rider_ids: [VIEWER],
            gas_cost_cents: 200,
            time_cost_cents: 100,
            distance_meters: 5_000,
          }),
          // Open segment — costs not yet accrued during active phase
          segment({
            segment_index: 1,
            ended_at: null,
            active_rider_ids: [VIEWER],
            gas_cost_cents: 0,
            time_cost_cents: 0,
            distance_meters: 0,
          }),
        ]}
      />,
    )
    expect(screen.getByTestId('your-share-segment-0')).toBeInTheDocument()
    expect(screen.queryByTestId('your-share-segment-1')).not.toBeInTheDocument()
  })

  it('computes per-rider share as (gas+time) / activeRiderIDs.length, rounded', () => {
    // 350¢ total / 2 riders = 175¢ → $1.75
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({
          base_share_cents: 175,
          total_cents: 500, // base minimum applies
        })}
        segments={[
          segment({
            active_rider_ids: [VIEWER, OTHER_B],
            gas_cost_cents: 200,
            time_cost_cents: 150,
          }),
        ]}
      />,
    )
    // Segment row shows the presentational per-rider share
    expect(screen.getByTestId('your-share-segment-0')).toHaveTextContent('$1.75')
    // Total row shows the canonical total from shares.total_cents (base minimum applied server-side)
    expect(screen.getByTestId('your-share-total')).toHaveTextContent('$5.00')
  })

  it('renders "1 leg" singular when segments_in_count is 1', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({ segments_in_count: 1 })}
        segments={[segment()]}
      />,
    )
    expect(screen.getByText('1 leg')).toBeInTheDocument()
  })

  it('renders "N legs" plural when segments_in_count > 1', () => {
    render(
      <YourShareCard
        viewerId={VIEWER}
        share={share({ segments_in_count: 3 })}
        segments={[segment()]}
      />,
    )
    expect(screen.getByText('3 legs')).toBeInTheDocument()
  })

  it('exposes the default + custom data-testid', () => {
    const { rerender } = render(
      <YourShareCard viewerId={VIEWER} share={share()} segments={[segment()]} />,
    )
    expect(screen.getByTestId('ride-summary-your-share-card')).toBeInTheDocument()

    rerender(
      <YourShareCard
        viewerId={VIEWER}
        share={share()}
        segments={[segment()]}
        data-testid="custom-share-card"
      />,
    )
    expect(screen.getByTestId('custom-share-card')).toBeInTheDocument()
  })
})
