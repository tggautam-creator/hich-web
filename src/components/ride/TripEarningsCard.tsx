/**
 * Sprint 9 Slice 4 — driver-side "Trip earnings" card on RideSummaryPage.
 *
 * Mirrors iOS `RideSummaryPage.swift::tripEarningsCard` (lines 1073-1155)
 * + `tripEarningsRow` (1115-1155) + `tripEarningsAvatar` (1158-…).
 * Lists every rider on the multi-rider trip with their avatar, name,
 * destination, distance shared, optional "+ caregiver $X" badge, and
 * their per-rider earnings contribution. Footer sums to "Total earnings".
 *
 * Per-rider earnings semantics (iOS lines 1066-1071):
 *   - For exited riders → ride_rider_shares.total_cents (canonical,
 *     includes caregiver + companion seat fees, written by
 *     computeRiderTotals at /end).
 *   - For in-trip riders without a shares row yet → 0 from the
 *     per-rider settlement. (iOS computes a segment-based estimate;
 *     web defers because the rare mid-trip multi-rider summary case
 *     refreshes when the next /end fires.)
 *
 * Per-rider distance shared = sum over segments where the rider was in
 *   active_rider_ids of segment.distance_meters → miles via the
 *   standard 0.621371 conversion. Hidden when 0.
 *
 * Caregiver badge: shows when share.caregiver_share_cents > 0. iOS does
 *   NOT apply waiver-detection on this card (the waiver-detection at
 *   iOS lines 1242-1260 is on the SINGLE-rider fare breakdown, a
 *   different surface). Server-side, if the driver waived the caregiver
 *   fee, caregiver_share_cents is 0 in ride_rider_shares — the badge
 *   silently doesn't render for that rider. We match iOS exactly.
 *
 * Each per-rider row is tappable → opens /ride/{ride_id}/summary so the
 *   driver can drill into that rider's specific ride view (web-native
 *   upgrade over iOS's fullScreenCover sheet pattern).
 */

import { useNavigate } from 'react-router-dom'
import type {
  ShareDetailsCoRider,
  ShareDetailsRiderShare,
  ShareDetailsSegment,
} from '@/lib/shareDetails'

interface TripEarningsCardProps {
  coRiders: ShareDetailsCoRider[]
  /** Per-rider settlement rows keyed by rider_id (partial during active phase). */
  shares: ShareDetailsRiderShare[]
  /** All trip segments — used to compute per-rider distance shared. */
  segments: ShareDetailsSegment[]
  'data-testid'?: string
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}$${dollars}.${rem.toString().padStart(2, '0')}`
}

function initials(name: string | null): string {
  if (name == null) return '?'
  const trimmed = name.trim()
  if (trimmed.length === 0) return '?'
  const parts = trimmed.split(/\s+/).slice(0, 2)
  return parts
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}

function distanceMilesShared(
  riderId: string,
  segments: ShareDetailsSegment[],
): number {
  return segments
    .filter((seg) => seg.active_rider_ids.includes(riderId))
    .reduce((acc, seg) => acc + seg.distance_meters, 0) / 1000 * 0.621371
}

interface AvatarProps {
  fullName: string | null
  avatarUrl: string | null
}

function Avatar({ fullName, avatarUrl }: AvatarProps) {
  if (avatarUrl != null && avatarUrl.length > 0) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-text-secondary"
    >
      {initials(fullName)}
    </div>
  )
}

export default function TripEarningsCard({
  coRiders,
  shares,
  segments,
  'data-testid': testId = 'ride-summary-trip-earnings-card',
}: TripEarningsCardProps) {
  const navigate = useNavigate()
  const sharesByRider = new Map(shares.map((s) => [s.rider_id, s]))

  const riderRows = coRiders.map((rider) => {
    const share = sharesByRider.get(rider.rider_id)
    const earnings = share?.total_cents ?? 0
    const caregiverCents = share?.caregiver_share_cents ?? 0
    const milesShared = distanceMilesShared(rider.rider_id, segments)
    return {
      rider,
      earnings,
      caregiverCents,
      milesShared,
      targetRideId: rider.ride_id,
    }
  })

  const totalCents = riderRows.reduce((acc, r) => acc + r.earnings, 0)

  const ridersLabel = coRiders.length === 1 ? '1 rider' : `${coRiders.length} riders`

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
          {/* SF Symbol "person.3.fill" equivalent — three overlapping figures */}
          <path d="M5 11a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm14 0a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm-7 1a3 3 0 100-6 3 3 0 000 6zm0 1.5c-3 0-7 1.5-7 4.5v1.5h14V18c0-3-4-4.5-7-4.5zm-9.5 6h3v-1.5c0-1.4.5-2.6 1.3-3.5C5.4 14.7 4 15 3 15.4 1.8 15.9 1 16.6 1 17.5V19h1.5zm17.5 0H22v-1.5c0-.9-.8-1.6-2-2.1-1-.4-2.4-.7-3.8-.9.8.9 1.3 2.1 1.3 3.5V19z" />
        </svg>
        <span className="text-[14px] font-extrabold text-text-primary">Trip earnings</span>
        <span className="ml-auto text-xs font-medium text-text-secondary">{ridersLabel}</span>
      </div>

      <div className="border-t border-border" />

      {/* Per-rider rows */}
      <div className="flex flex-col">
        {riderRows.map((row, idx) => {
          const isLast = idx === riderRows.length - 1
          const rowContent = (
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar fullName={row.rider.full_name} avatarUrl={row.rider.avatar_url} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[14px] font-semibold text-text-primary">
                  {row.rider.full_name ?? 'Rider'}
                </span>
                <span className="truncate text-xs text-text-secondary">
                  To: {row.rider.destination_name ?? '—'}
                </span>
                {row.milesShared > 0 && (
                  <span className="text-xs font-medium text-text-secondary tabular-nums">
                    {row.milesShared.toFixed(1)} mi shared
                  </span>
                )}
                {row.caregiverCents > 0 && (
                  <span
                    className="flex items-center gap-1 text-xs font-medium text-primary tabular-nums"
                    data-testid={`trip-earnings-caregiver-${row.rider.rider_id}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-3 w-3 text-primary"
                      aria-hidden="true"
                    >
                      <path d="M12 11a4 4 0 100-8 4 4 0 000 8zm-7 9c0-3 4-4.5 7-4.5s7 1.5 7 4.5v1H5v-1zm15-9h-2v2h-2v2h2v2h2v-2h2v-2h-2v-2z" />
                    </svg>
                    <span>+ caregiver {formatCents(row.caregiverCents)}</span>
                  </span>
                )}
              </div>
              <span
                className="shrink-0 text-[15px] font-extrabold text-success tabular-nums"
                data-testid={`trip-earnings-amount-${row.rider.rider_id}`}
              >
                +{formatCents(row.earnings)}
              </span>
            </div>
          )

          const rowWrapper =
            row.targetRideId != null ? (
              <button
                type="button"
                key={row.rider.rider_id}
                onClick={() => navigate(`/ride/summary/${row.targetRideId}`)}
                className="w-full text-left active:bg-surface transition-colors"
                data-testid={`trip-earnings-row-${row.rider.rider_id}`}
              >
                {rowContent}
              </button>
            ) : (
              <div
                key={row.rider.rider_id}
                data-testid={`trip-earnings-row-${row.rider.rider_id}`}
              >
                {rowContent}
              </div>
            )

          return (
            <div key={row.rider.rider_id} className="flex flex-col">
              {rowWrapper}
              {!isLast && (
                <div className="ml-[72px] border-t border-border opacity-30" />
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-border" />

      {/* Footer total */}
      <div className="flex items-baseline gap-3 px-4 py-3">
        <span className="text-[13px] font-semibold text-text-secondary">Total earnings</span>
        <span
          className="ml-auto text-[16px] font-extrabold text-primary tabular-nums"
          data-testid="trip-earnings-total"
        >
          {formatCents(totalCents)}
        </span>
      </div>
    </div>
  )
}
