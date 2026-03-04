import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateFareRange, formatCents, type FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideConfirmProps {
  'data-testid'?: string
}

interface LocationState {
  destination: PlaceSuggestion
  estimatedDistanceKm?: number
  estimatedDurationMin?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_DISTANCE_KM  = 5
const DEFAULT_DURATION_MIN = 10

// ── Component ─────────────────────────────────────────────────────────────────

export default function RideConfirm({ 'data-testid': testId }: RideConfirmProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  const [isSubmitting, setSubmitting] = useState(false)

  // Redirect if no destination in state
  useEffect(() => {
    if (!state?.destination) {
      navigate('/ride/search', { replace: true })
    }
  }, [state, navigate])

  if (!state?.destination) return null

  const { destination } = state
  const distanceKm  = state.estimatedDistanceKm ?? DEFAULT_DISTANCE_KM
  const durationMin = state.estimatedDurationMin ?? DEFAULT_DURATION_MIN
  const fareRange: FareRange = calculateFareRange(distanceKm, durationMin)

  const isSingleFare = fareRange.low.fare_cents === fareRange.high.fare_cents
  const fareDisplay  = isSingleFare
    ? formatCents(fareRange.low.fare_cents)
    : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`

  function handleRequestRide() {
    setSubmitting(true)
    // TODO: call POST /api/rides/request and use real rideId from response
    const rideId = `ride-${Date.now()}`
    navigate('/ride/waiting', {
      state: { destination, fareRange, rideId },
    })
  }

  return (
    <div
      data-testid={testId ?? 'ride-confirm-page'}
      className="min-h-dvh w-full bg-white flex flex-col font-sans"
    >

      {/* ── Top bar — back arrow ──────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)', paddingBottom: '0.75rem' }}
      >
        <button
          data-testid="back-button"
          onClick={() => { navigate(-1 as unknown as string) }}
          aria-label="Go back"
          className="p-1 shrink-0 text-text-primary active:opacity-60 transition-opacity"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="m12 5-7 7 7 7" />
          </svg>
        </button>

        <h1 className="text-lg font-semibold text-text-primary">Confirm Ride</h1>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">

        {/* Destination card */}
        <div className="bg-surface rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Destination
          </p>
          <div className="flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 shrink-0 text-primary mt-0.5"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="min-w-0">
              <p
                data-testid="destination-address"
                className="text-base font-medium text-text-primary truncate"
              >
                {destination.mainText}
              </p>
              <p className="text-sm text-text-secondary truncate">
                {destination.secondaryText}
              </p>
            </div>
          </div>
        </div>

        {/* Fare estimate */}
        <div className="bg-surface rounded-2xl p-5 space-y-2">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Estimated fare
          </p>
          <p
            data-testid="fare-range"
            className="text-3xl font-bold text-text-primary"
          >
            {fareDisplay}
          </p>
          <p className="text-xs text-text-secondary">
            Final fare based on actual distance and duration
          </p>
        </div>

        {/* Fare breakdown (expandable in future) */}
        <div className="text-sm text-text-secondary space-y-1">
          <div className="flex justify-between">
            <span>Platform fee (15%)</span>
            <span>
              {isSingleFare
                ? formatCents(fareRange.low.platform_fee_cents)
                : `${formatCents(fareRange.low.platform_fee_cents)}–${formatCents(fareRange.high.platform_fee_cents)}`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Driver earns</span>
            <span>
              {isSingleFare
                ? formatCents(fareRange.low.driver_earns_cents)
                : `${formatCents(fareRange.low.driver_earns_cents)}–${formatCents(fareRange.high.driver_earns_cents)}`}
            </span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="space-y-3">
          <PrimaryButton
            data-testid="request-ride-button"
            onClick={() => { handleRequestRide() }}
            isLoading={isSubmitting}
          >
            Request Ride
          </PrimaryButton>

          <button
            data-testid="change-destination-button"
            onClick={() => { navigate('/ride/search') }}
            className="w-full text-center text-sm text-primary font-medium py-2"
          >
            Change destination
          </button>
        </div>
      </div>
    </div>
  )
}
