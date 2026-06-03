import { useState } from 'react'
import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTripSchedule } from './boardHelpers'
import { estimateScheduleFare } from '@/lib/fareEstimate'
import UserProfilePreviewSheet from '@/components/profile/UserProfilePreviewSheet'

interface RideBoardCardProps {
  ride: ScheduledRide
  isOwn: boolean
  isNearby?: boolean
  deletingId: string | null
  withdrawingRideId?: string | null
  onRequestClick: (ride: ScheduledRide) => void
  onDeleteClick: (scheduleId: string) => void
  onOpenMessages: (ride: ScheduledRide) => void
  onWithdrawClick?: (rideId: string) => void
  onCardClick: (ride: ScheduledRide) => void
  'data-testid'?: string
}

export default function RideBoardCard({
  ride,
  isOwn,
  isNearby = false,
  deletingId,
  withdrawingRideId = null,
  onRequestClick,
  onDeleteClick,
  onOpenMessages,
  onWithdrawClick,
  onCardClick,
}: RideBoardCardProps) {
  const isDriverPost = ride.mode === 'driver'
  const poster = ride.poster
  const name = isOwn ? 'You' : poster?.full_name ?? 'Unknown'
  // v1.3 Sprint 10 Slice 5 — poster profile preview sheet. Tap the
  // name+rating row (the avatar-tap equivalent on web — iOS taps the
  // 36×36 avatar circle on `posterAvatar`; web has no avatar image on
  // RideBoardCard today, so the name row serves as the tap target).
  // Only enabled for non-own posts when we have a poster id to fetch
  // against. Mirrors iOS `RideBoardPage.swift::posterPreview` mount
  // at lines 55-60 + sheet presentation at 249-255.
  const [profilePreviewOpen, setProfilePreviewOpen] = useState(false)
  const canPreviewPoster = !isOwn && poster?.id != null && poster.id.length > 0
  // Fare preview shows on every post (driver and rider) as long as the
  // schedule carries coords — gives riders an expected cost and drivers
  // a sense of what they'd earn before offering to drive.
  const fareEstimate = estimateScheduleFare(ride)

  return (
    <div
      data-testid="ride-card"
      role="button"
      tabIndex={0}
      onClick={() => { onCardClick(ride) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCardClick(ride) }}
      className={[
        'rounded-2xl bg-white p-4 shadow-sm border cursor-pointer active:bg-surface/50 transition-colors',
        isDriverPost ? 'border-success/30' : 'border-primary/30',
      ].join(' ')}
    >
      {/* Top row: mode badge + name/rating */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={[
              'text-xs font-semibold px-3 py-1 rounded-full',
              isDriverPost
                ? 'bg-success/10 text-success'
                : 'bg-primary/10 text-primary',
            ].join(' ')}
          >
            {isDriverPost ? 'Offering Ride' : 'Needs Ride'}
          </span>
          {isNearby && (
            <span
              data-testid="nearby-badge"
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warning/10 text-warning whitespace-nowrap"
              title="This route passes within a 5-minute walk of you"
            >
              Near you
            </span>
          )}
        </div>
        {canPreviewPoster ? (
          <button
            type="button"
            onClick={(e) => {
              // Stop bubbling so the card-level onClick (open detail)
              // doesn't fire alongside the profile preview.
              e.stopPropagation()
              setProfilePreviewOpen(true)
            }}
            data-testid="board-card-poster-preview-trigger"
            className="flex items-center gap-1.5 min-w-0 rounded-md px-1 -mx-1 active:bg-surface/60"
          >
            <span className="text-sm font-semibold text-text-primary truncate">{name}</span>
            {poster?.rating_avg != null && (
              <span className="text-xs text-text-secondary shrink-0">★ {poster.rating_avg.toFixed(1)}</span>
            )}
            {/* v1.2 F5.2 — mobility-aid access pill. */}
            {poster?.has_accessibility_needs === true && poster.needs_wheelchair === true && (
              <span
                data-testid="board-card-mobility-aid"
                title="Rider uses a mobility aid"
                aria-label="Rider uses a mobility aid"
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
              >
                ♿
              </span>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-text-primary truncate">{name}</span>
            {poster?.rating_avg != null && (
              <span className="text-xs text-text-secondary shrink-0">★ {poster.rating_avg.toFixed(1)}</span>
            )}
            {/* v1.2 F5.2 — mobility-aid access pill (own-post branch). */}
            {poster?.has_accessibility_needs === true && poster.needs_wheelchair === true && (
              <span
                data-testid="board-card-mobility-aid"
                title="Rider uses a mobility aid"
                aria-label="Rider uses a mobility aid"
                className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
              >
                ♿
              </span>
            )}
          </div>
        )}
      </div>

      {/* v1.3 Sprint 10 Slice 5 — poster profile preview. Renders only
          when the user tapped the name row above. Sheet is a portal so
          mounting it inside the card is safe. */}
      {canPreviewPoster && poster?.id != null && (
        <UserProfilePreviewSheet
          isOpen={profilePreviewOpen}
          onClose={() => setProfilePreviewOpen(false)}
          userId={poster.id}
          // Seed instantly from the poster snapshot the card already has,
          // so the sheet opens to a complete card (background fetch
          // upgrades bio / school / vehicle / member-since silently).
          initialProfile={{
            id: poster.id,
            full_name: poster.full_name ?? null,
            avatar_url: poster.avatar_url ?? null,
            is_driver: poster.is_driver,
            rating_avg: poster.rating_avg ?? null,
            // Poster snapshot doesn't carry rating_count — render as
            // "New on Tago" until the background fetch lands the real
            // value. The fetch reliably arrives in <300ms on warm
            // connections; the visual flip is brief.
            rating_count: 0,
            rides_completed: 0,
            bio: null,
            gender: null,
            school: null,
            major: null,
            graduation_year: null,
            has_accessibility_needs: poster.has_accessibility_needs ?? false,
            needs_wheelchair: poster.needs_wheelchair ?? false,
            // Poster snapshot doesn't carry waive_caregiver_fee — the
            // /api/schedule/board response strips it. Defaults false;
            // the background fetch's authoritative value upgrades the
            // pill if applicable.
            waive_caregiver_fee: false,
            member_since: '',
            vehicle: null,
          }}
          fallbackName={poster.full_name ?? null}
          fallbackAvatarUrl={poster.avatar_url ?? null}
        />
      )}

      {/* Route — single line with arrow */}
      <p className="text-sm text-text-primary mb-1 truncate">
        {ride.origin_address}
        <span className="text-text-secondary mx-1.5">→</span>
        {ride.dest_address}
      </p>

      {/* Date, time, roundtrip, fare */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-xs text-text-secondary min-w-0">
          <span className="truncate">{formatDate(ride.trip_date)}</span>
          <span>·</span>
          <span className="truncate">{formatTripSchedule({ trip_time: ride.trip_time, time_type: ride.time_type, time_flexible: ride.time_flexible })}</span>
          {ride.direction_type === 'roundtrip' && (
            <>
              <span>·</span>
              <span>Roundtrip</span>
            </>
          )}
        </div>
        {fareEstimate && (
          <span
            data-testid="card-fare-estimate"
            className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
          >
            ~{fareEstimate.label}
          </span>
        )}
      </div>

      {/* Action button — depends on ride state */}
      {!isOwn && !ride.already_requested && (
        <button
          data-testid="contact-button"
          onClick={(e) => { e.stopPropagation(); onRequestClick(ride) }}
          className={[
            'w-full rounded-2xl py-2.5 text-sm font-semibold text-white active:opacity-80',
            isDriverPost ? 'bg-success' : 'bg-primary',
          ].join(' ')}
        >
          {isDriverPost ? 'Request This Ride' : 'Offer to Drive'}
        </button>
      )}

      {!isOwn && ride.already_requested && (ride.ride_status === 'coordinating' || ride.ride_status === 'accepted') && ride.ride_id && (
        <div className="space-y-2">
          <div className="w-full rounded-2xl py-2 text-center text-sm font-semibold bg-success/10 text-success" data-testid="ride-confirmed-badge">
            Ride Confirmed
          </div>
          <button
            data-testid="open-messages-button"
            onClick={(e) => { e.stopPropagation(); onOpenMessages(ride) }}
            className="w-full rounded-2xl py-2.5 text-sm font-semibold text-primary bg-primary/10 active:bg-primary/20"
          >
            Open Messages
          </button>
        </div>
      )}

      {!isOwn && ride.already_requested && ride.ride_status !== 'coordinating' && ride.ride_status !== 'accepted' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-2xl py-2.5 text-center text-sm font-semibold bg-surface text-text-secondary" data-testid="already-requested-badge">
            Request Sent
          </div>
          {onWithdrawClick && ride.ride_id && (
            <button
              data-testid="withdraw-button"
              disabled={withdrawingRideId === ride.ride_id}
              onClick={(e) => { e.stopPropagation(); if (ride.ride_id) onWithdrawClick(ride.ride_id) }}
              className="rounded-2xl px-3 py-2.5 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
            >
              {withdrawingRideId === ride.ride_id ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
        </div>
      )}

      {isOwn && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary italic">Your posted ride</p>
          <button
            data-testid="delete-schedule-button"
            disabled={deletingId === ride.id}
            onClick={(e) => { e.stopPropagation(); onDeleteClick(ride.id) }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
          >
            {deletingId === ride.id ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}
