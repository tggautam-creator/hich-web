import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTripSchedule } from './boardHelpers'
import { estimateScheduleFare } from '@/lib/fareEstimate'

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
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{name}</span>
          {poster?.rating_avg != null && (
            <span className="text-xs text-text-secondary shrink-0">★ {poster.rating_avg.toFixed(1)}</span>
          )}
        </div>
      </div>

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
