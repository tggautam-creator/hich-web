/**
 * Sprint 9 Slice 3 — rider-side "Your share" card on RideSummaryPage.
 *
 * Mirrors iOS `RideSummaryPage.swift::yourShareCard` (lines 982-1057)
 * + `segmentRow` (1031-1057). Renders only when:
 *   1. /share-details returned a payload (not null = pre-097 backfill),
 *   2. shares[] contains the viewer (their settlement row exists),
 *   3. segments[] is non-empty.
 * The parent (RideSummaryPage) gates the additional driver-vs-rider
 * check by passing `null` for non-riders.
 *
 * Per-segment per-rider share is derived presentationally as
 * `(gas_cost_cents + time_cost_cents) / activeRiderIDs.length` (same
 * client-side pattern iOS uses at line 1040 — this is presentation
 * math, NOT canonical fare math; the canonical total comes from
 * `shares[].total_cents` written by server's computeRiderTotals at
 * /end).
 */

import type {
  ShareDetailsRiderShare,
  ShareDetailsSegment,
} from '@/lib/shareDetails'

interface YourShareCardProps {
  viewerId: string
  /** The viewer's own share row from /share-details.shares. */
  share: ShareDetailsRiderShare
  /** All trip segments. The component filters down to viewer's. */
  segments: ShareDetailsSegment[]
  'data-testid'?: string
}

/** "Solo · X.X mi" / "With 1 other · X.X mi" / "With N others · X.X mi" — verbatim from iOS RideSummaryPage.swift:1042-1046. */
function segmentLabel(activeRiderCount: number, distanceMeters: number): string {
  const othersCount = Math.max(0, activeRiderCount - 1)
  const miles = ((distanceMeters / 1000) * 0.621371).toFixed(1)
  if (othersCount === 0) return `Solo · ${miles} mi`
  if (othersCount === 1) return `With 1 other · ${miles} mi`
  return `With ${othersCount} others · ${miles} mi`
}

/** Format integer cents → "$X.YZ". Mirrors iOS Fare.formatCents pattern. */
function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}$${dollars}.${rem.toString().padStart(2, '0')}`
}

interface FareRowProps {
  label: string
  cents: number
  bold?: boolean
  'data-testid'?: string
}

function FareRow({ label, cents, bold = false, 'data-testid': testId }: FareRowProps) {
  const weight = bold ? 'font-bold' : 'font-medium'
  return (
    <div
      className={`flex items-baseline justify-between text-[13px] text-text-primary ${weight}`}
      data-testid={testId}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatCents(cents)}</span>
    </div>
  )
}

export default function YourShareCard({
  viewerId,
  share,
  segments,
  'data-testid': testId = 'ride-summary-your-share-card',
}: YourShareCardProps) {
  // Mirror iOS: only segments where viewer is in activeRiderIDs AND
  // the segment has accrued cost. Skips zero-cost open segments that
  // haven't closed yet during the active phase.
  const viewerSegments = segments.filter(
    (seg) =>
      seg.active_rider_ids.includes(viewerId) &&
      seg.gas_cost_cents + seg.time_cost_cents > 0,
  )

  const legsLabel =
    share.segments_in_count === 1
      ? '1 leg'
      : `${share.segments_in_count} legs`

  return (
    <div
      data-testid={testId}
      className="mx-6 mt-4 rounded-2xl bg-white shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-4 w-4 text-primary"
          aria-hidden="true"
        >
          {/* SF Symbol "person.2.fill" equivalent — two overlapping figures */}
          <path d="M8 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.5c-3 0-7 1.5-7 4.5v1.5h14V18c0-3-4-4.5-7-4.5z" />
          <path d="M16 12a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.5c-.7 0-1.5.1-2.3.3 1.3.9 2 2.3 2 4.2v1.5h7V18c0-3-3.7-4.5-6.7-4.5z" />
        </svg>
        <span className="text-[14px] font-extrabold text-text-primary">Your share</span>
        <span className="ml-auto text-xs font-medium text-text-secondary">{legsLabel}</span>
      </div>

      <div className="border-t border-border" />

      {/* Per-segment rows + totals */}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        {viewerSegments.map((seg) => {
          const denom = Math.max(1, seg.active_rider_ids.length)
          const segTotal = seg.gas_cost_cents + seg.time_cost_cents
          const perRiderShare = Math.round(segTotal / denom)
          return (
            <div
              key={seg.segment_index}
              data-testid={`your-share-segment-${seg.segment_index}`}
              className="flex items-baseline justify-between text-[13px] text-text-primary"
            >
              <span className="font-medium">
                {segmentLabel(seg.active_rider_ids.length, seg.distance_meters)}
              </span>
              <span className="font-semibold tabular-nums">{formatCents(perRiderShare)}</span>
            </div>
          )
        })}

        {viewerSegments.length > 0 && <div className="my-1 border-t border-border" />}

        <FareRow
          label="Base share"
          cents={share.base_share_cents}
          data-testid="your-share-base"
        />
        {share.caregiver_share_cents > 0 && (
          <FareRow
            label="Caregiver seat"
            cents={share.caregiver_share_cents}
            data-testid="your-share-caregiver"
          />
        )}
        {share.companion_share_cents > 0 && (
          <FareRow
            label="Companion seat"
            cents={share.companion_share_cents}
            data-testid="your-share-companion"
          />
        )}

        <div className="my-1 border-t border-border" />

        <FareRow
          label="Your total"
          cents={share.total_cents}
          bold
          data-testid="your-share-total"
        />
      </div>
    </div>
  )
}
