import type { ScheduledRide } from './boardTypes'
import { formatDate, formatTime } from './boardHelpers'

interface RideBoardConfirmSheetProps {
  ride: ScheduledRide | null
  isRequesting: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function RideBoardConfirmSheet({
  ride,
  isRequesting,
  onConfirm,
  onCancel,
}: RideBoardConfirmSheetProps) {
  if (!ride) return null

  const isDriverPost = ride.mode === 'driver'
  const poster = ride.poster
  const initial = poster?.full_name?.[0]?.toUpperCase() ?? '?'

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="confirm-backdrop"
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onCancel}
      />

      {/* Sheet */}
      <div
        data-testid="confirm-sheet"
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white shadow-xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1.5 w-12 rounded-full bg-border" />
        </div>

        <div className="px-5 pb-4">
          {/* Title */}
          <h3 className="text-lg font-bold text-text-primary text-center mb-4">
            {isDriverPost ? 'Request This Ride?' : 'Offer to Drive?'}
          </h3>

          {/* Poster info */}
          <div className="flex items-center gap-3 mb-4">
            <div className={[
              'h-12 w-12 rounded-full flex items-center justify-center font-bold text-lg',
              isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
            ].join(' ')}>
              {initial}
            </div>
            <div>
              <p className="font-semibold text-text-primary">{poster?.full_name ?? 'Unknown'}</p>
              {poster?.rating_avg != null && (
                <p className="text-sm text-text-secondary">★ {poster.rating_avg.toFixed(1)}</p>
              )}
            </div>
            <span className={[
              'ml-auto text-xs font-semibold px-3 py-1.5 rounded-full',
              isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
            ].join(' ')}>
              {isDriverPost ? 'Driver' : 'Rider'}
            </span>
          </div>

          {/* Route */}
          <div className="rounded-2xl bg-surface p-3 mb-4 space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-success mt-0.5 text-sm">●</span>
              <p className="text-sm text-text-primary">{ride.origin_address}</p>
            </div>
            <div className="ml-[5px] h-3 border-l border-dashed border-text-secondary/30" />
            <div className="flex items-start gap-2">
              <span className="text-danger mt-0.5 text-sm">●</span>
              <p className="text-sm text-text-primary">{ride.dest_address}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-secondary pt-2">
              <span>{formatDate(ride.trip_date)}</span>
              <span>{ride.time_type === 'departure' ? 'Departs' : 'Arrives'} {formatTime(ride.trip_time)}</span>
            </div>
          </div>

          {/* Info text */}
          <p className="text-xs text-text-secondary text-center mb-4">
            {isDriverPost
              ? 'Your request will be sent to the driver. They\'ll see it in their notifications.'
              : 'Your offer will be sent to the rider. They\'ll see it in their notifications.'}
          </p>

          {/* Buttons */}
          <button
            data-testid="confirm-send-button"
            disabled={isRequesting}
            onClick={onConfirm}
            className={[
              'mb-3 w-full rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50',
              isDriverPost ? 'bg-success' : 'bg-primary',
            ].join(' ')}
          >
            {isRequesting
              ? 'Sending…'
              : isDriverPost ? 'Send Request' : 'Send Offer'}
          </button>
          <button
            data-testid="confirm-cancel-button"
            onClick={onCancel}
            className="w-full rounded-2xl py-3 text-sm font-semibold text-text-secondary active:bg-surface"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
