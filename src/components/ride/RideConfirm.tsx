import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateFareRange, formatCents, type FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideConfirmProps {
  'data-testid'?: string
}

interface LocationState {
  destination: PlaceSuggestion
  estimatedDistanceKm?: number
  estimatedDurationMin?: number
  polyline?: string
  originLat?: number
  originLng?: number
  destinationLat?: number
  destinationLng?: number
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
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const hasRealEstimates = state.estimatedDistanceKm != null
  const fareRange: FareRange = calculateFareRange(distanceKm, durationMin)

  const isSingleFare = fareRange.low.fare_cents === fareRange.high.fare_cents
  const fareDisplay  = isSingleFare
    ? formatCents(fareRange.low.fare_cents)
    : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`

  // Use the midpoint breakdown for display
  const breakdown = fareRange.low

  async function handleRequestRide() {
    setSubmitting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('You must be signed in to request a ride.')
        setSubmitting(false)
        return
      }

      const originLat = state?.originLat ?? 0
      const originLng = state?.originLng ?? 0

      const resp = await fetch('/api/rides/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          origin: { type: 'Point', coordinates: [originLng, originLat] },
          destination_name: destination.mainText,
          destination_lat: state?.destinationLat,
          destination_lng: state?.destinationLng,
          distance_km: distanceKm,
          estimated_fare_cents: fareRange.low.fare_cents,
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to request ride.')
        setSubmitting(false)
        return
      }

      const { ride_id } = (await resp.json()) as { ride_id: string }
      navigate('/ride/waiting', {
        state: {
          destination,
          fareRange,
          rideId: ride_id,
          originLat: state?.originLat,
          originLng: state?.originLng,
          destinationLat: state?.destinationLat,
          destinationLng: state?.destinationLng,
          polyline: state?.polyline,
        },
      })
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }

  function formatRange(lowCents: number, highCents: number): string {
    return lowCents === highCents
      ? formatCents(lowCents)
      : `${formatCents(lowCents)}–${formatCents(highCents)}`
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
      <div className="flex-1 flex flex-col px-6 py-6 gap-5">

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

        {/* Route info — distance + duration */}
        {hasRealEstimates && (
          <div data-testid="route-info" className="flex gap-3">
            <div className="flex-1 bg-surface rounded-2xl p-4 text-center">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Distance</p>
              <p data-testid="route-distance" className="text-lg font-bold text-text-primary mt-1">
                {(distanceKm * 0.621371).toFixed(1)} mi
              </p>
            </div>
            <div className="flex-1 bg-surface rounded-2xl p-4 text-center">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Duration</p>
              <p data-testid="route-duration" className="text-lg font-bold text-text-primary mt-1">
                {Math.round(durationMin)} min
              </p>
            </div>
          </div>
        )}

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
            {hasRealEstimates
              ? 'Based on Google Maps route. Final fare uses actual trip data.'
              : 'Approximate estimate. Final fare based on actual distance and duration.'}
          </p>
        </div>

        {/* Transparent fare breakdown — tap to expand */}
        <button
          data-testid="breakdown-toggle"
          onClick={() => { setShowBreakdown(!showBreakdown) }}
          className="flex items-center justify-between text-sm font-medium text-primary py-1"
        >
          <span>How is this fare calculated?</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showBreakdown && (
          <div data-testid="fare-breakdown" className="bg-surface rounded-2xl p-5 space-y-3 text-sm">
            <div className="flex justify-between text-text-primary">
              <span>Base fare</span>
              <span data-testid="breakdown-base">{formatCents(breakdown.base_cents)}</span>
            </div>
            <div className="flex justify-between text-text-primary">
              <div>
                <span>Gas cost</span>
                <p className="text-xs text-text-secondary">
                  {(breakdown.distance_km * 0.621371).toFixed(1)} mi • {breakdown.mpg} MPG • ${breakdown.gas_price_per_gallon.toFixed(2)}/gal
                </p>
              </div>
              <span data-testid="breakdown-gas">
                {formatRange(fareRange.low.gas_cost_cents, fareRange.high.gas_cost_cents)}
              </span>
            </div>
            <div className="flex justify-between text-text-primary">
              <div>
                <span>Time cost</span>
                <p className="text-xs text-text-secondary">{Math.round(breakdown.duration_min)} min × $0.05/min</p>
              </div>
              <span data-testid="breakdown-time">
                {formatRange(fareRange.low.time_cost_cents, fareRange.high.time_cost_cents)}
              </span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-text-primary font-medium">
              <span>Subtotal</span>
              <span>{fareDisplay}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>Platform fee (15%)</span>
              <span data-testid="breakdown-fee">
                {formatRange(fareRange.low.platform_fee_cents, fareRange.high.platform_fee_cents)}
              </span>
            </div>
            <div className="flex justify-between text-success font-semibold">
              <span>Driver earns</span>
              <span data-testid="breakdown-driver-earns">
                {formatRange(fareRange.low.driver_earns_cents, fareRange.high.driver_earns_cents)}
              </span>
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="space-y-3">
          {error && (
            <p data-testid="request-error" className="text-sm text-red-600 text-center">
              {error}
            </p>
          )}
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
