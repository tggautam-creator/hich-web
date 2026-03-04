import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { onForegroundMessage } from '@/lib/fcm'
import { formatCents } from '@/lib/fare'
import BottomSheet from '@/components/ui/BottomSheet'

/** Payload shape sent by the ride request push. */
interface RideRequestData {
  type: 'ride_request'
  ride_id: string
  rider_name?: string
  destination?: string
  distance_km?: string
  estimated_earnings_cents?: string
}

interface NotificationState {
  rideId: string
  riderName: string
  destination: string
  distanceKm: string
  estimatedEarnings: string
}

const DISMISS_SECONDS = 90

export default function RideRequestNotification({
  'data-testid': testId = 'ride-request-notification',
}: {
  'data-testid'?: string
}) {
  const navigate = useNavigate()
  const [notification, setNotification] = useState<NotificationState | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(DISMISS_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const dismiss = useCallback(() => {
    setNotification(null)
    setSecondsLeft(DISMISS_SECONDS)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Listen for foreground FCM messages
  useEffect(() => {
    const unsub = onForegroundMessage((payload) => {
      if (payload.data?.type !== 'ride_request') return
      const data = payload.data as unknown as RideRequestData

      const earningsCents = parseInt(data.estimated_earnings_cents ?? '0', 10)

      setNotification({
        rideId: data.ride_id,
        riderName: data.rider_name ?? 'A rider',
        destination: data.destination ?? 'Nearby destination',
        distanceKm: data.distance_km ?? '–',
        estimatedEarnings: earningsCents > 0 ? formatCents(earningsCents) : '–',
      })
      setSecondsLeft(DISMISS_SECONDS)
    })

    return () => {
      if (unsub) unsub()
    }
  }, [])

  // Countdown timer — auto-dismiss after 90s
  useEffect(() => {
    if (!notification) return

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          dismiss()
          return DISMISS_SECONDS
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [notification, dismiss])

  function handleViewDetails() {
    if (!notification) return
    const rideId = notification.rideId
    dismiss()
    navigate(`/ride/suggestion/${rideId}`)
  }

  return (
    <BottomSheet
      isOpen={notification !== null}
      onClose={dismiss}
      title="New Ride Request"
      data-testid={testId}
    >
      {notification && (
        <div className="space-y-4" data-testid="ride-request-content">
          {/* Rider info */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-light">
              <span className="text-lg">🧑</span>
            </div>
            <div>
              <p
                className="font-semibold text-text-primary"
                data-testid="rider-name"
              >
                {notification.riderName}
              </p>
              <p className="text-sm text-text-secondary">needs a ride</p>
            </div>
          </div>

          {/* Details row */}
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface p-3">
            <div className="text-center">
              <p className="text-xs text-text-secondary">Destination</p>
              <p
                className="mt-0.5 text-sm font-medium text-text-primary"
                data-testid="notification-destination"
              >
                {notification.destination}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-text-secondary">Distance</p>
              <p
                className="mt-0.5 text-sm font-medium text-text-primary"
                data-testid="notification-distance"
              >
                {notification.distanceKm} km
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-text-secondary">You earn</p>
              <p
                className="mt-0.5 text-sm font-medium text-success"
                data-testid="notification-earnings"
              >
                {notification.estimatedEarnings}
              </p>
            </div>
          </div>

          {/* Countdown */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-secondary" data-testid="countdown">
              Auto-dismiss in {secondsLeft}s
            </p>
            {/* Progress bar */}
            <div className="h-1 w-32 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${(secondsLeft / DISMISS_SECONDS) * 100}%` }}
              />
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={handleViewDetails}
            className="w-full rounded-xl bg-primary py-3 text-center font-semibold text-white active:bg-primary-dark"
            data-testid="view-details-button"
          >
            View Details
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
