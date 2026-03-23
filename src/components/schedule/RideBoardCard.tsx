import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTime } from './boardHelpers'

interface RideBoardCardProps {
  ride: ScheduledRide
  isOwn: boolean
  deletingId: string | null
  onRequestClick: (ride: ScheduledRide) => void
  onDeleteClick: (scheduleId: string) => void
  onOpenMessages: (ride: ScheduledRide) => void
  onCardClick: (ride: ScheduledRide) => void
  'data-testid'?: string
}

export default function RideBoardCard({
  ride,
  isOwn,
  deletingId,
  onRequestClick,
  onDeleteClick,
  onOpenMessages,
  onCardClick,
}: RideBoardCardProps) {
  const isDriverPost = ride.mode === 'driver'
  const poster = ride.poster
  const name = isOwn ? 'You' : poster?.full_name ?? 'Unknown'

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

      {/* Date, time, roundtrip */}
      <div className="flex items-center gap-2 text-xs text-text-secondary mb-3">
        <span>{formatDate(ride.trip_date)}</span>
        <span>·</span>
        <span>{ride.time_type === 'departure' ? 'Departs' : 'Arrives'} {formatTime(ride.trip_time)}</span>
        {ride.direction_type === 'roundtrip' && (
          <>
            <span>·</span>
            <span>Roundtrip</span>
          </>
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
        <div className="w-full rounded-2xl py-2.5 text-center text-sm font-semibold bg-surface text-text-secondary" data-testid="already-requested-badge">
          Request Sent
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
