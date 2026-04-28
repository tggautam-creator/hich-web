import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateFareRange, formatCents, type FareRange, DEFAULT_GAS_PRICE_PER_GALLON, MIN_FARE_CENTS } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { parseStateFromSecondaryText, fetchGasPrice } from '@/lib/gasPrice'
import PrimaryButton from '@/components/ui/PrimaryButton'
import CardBrandBadge from '@/components/ui/CardBrandBadge'
import { useAuthStore } from '@/stores/authStore'

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
  originName?: string
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
  const [gasPrice, setGasPrice] = useState<number>(DEFAULT_GAS_PRICE_PER_GALLON)

  // Payment method state
  interface CardInfo { id: string; brand: string; last4: string; is_default: boolean }
  const [cards, setCards] = useState<CardInfo[]>([])
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [loadingCards, setLoadingCards] = useState(true)

  // Wallet-first preview: rider's wallet pays before card. profile.wallet_balance
  // comes from authStore (refreshed on app focus). The high end of the fare
  // range is the conservative threshold for "covered by wallet" so we don't
  // over-promise zero-card-charge for a ride that lands at the upper bound.
  const profile = useAuthStore((s) => s.profile)
  const walletBalanceCents = profile?.wallet_balance ?? 0

  const fetchCards = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoadingCards(false); return }
      const res = await fetch('/api/payment/methods', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const body = (await res.json()) as { methods: CardInfo[]; default_method_id: string | null }
        setCards(body.methods)
        const defaultCard = body.methods.find((c) => c.is_default) ?? body.methods[0]
        if (defaultCard) setSelectedCard(defaultCard.id)
      }
    } catch { /* non-fatal */ } finally { setLoadingCards(false) }
  }, [])

  useEffect(() => { void fetchCards() }, [fetchCards])

  // Fetch current gas price based on destination state
  useEffect(() => {
    if (!state?.destination) return
    const stateAbbrev = parseStateFromSecondaryText(state.destination.secondaryText)
    if (!stateAbbrev) return
    void fetchGasPrice(stateAbbrev).then((price) => {
      if (price != null) setGasPrice(price)
    })
  }, [state?.destination])

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
  const fareRange: FareRange = calculateFareRange(distanceKm, durationMin, undefined, gasPrice)

  const isSingleFare = fareRange.low.fare_cents === fareRange.high.fare_cents
  const fareDisplay  = isSingleFare
    ? formatCents(fareRange.low.fare_cents)
    : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`

  // Use the midpoint breakdown for display
  const breakdown = fareRange.low

  // Wallet covers the fare entirely if it can absorb the upper-bound estimate.
  // Conservative — actual settle uses the precise computed fare at /end time.
  const walletCoversFare = walletBalanceCents >= fareRange.high.fare_cents
  const walletShortfallCents = Math.max(0, fareRange.high.fare_cents - walletBalanceCents)

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

      // Send the rider's local date so the server's duplicate-active-ride
      // check classifies "today's scheduled ride" the same way the rider
      // sees it. Without this, server UTC near midnight can drift a day
      // ahead of the rider's clock and let duplicate requests slip past.
      const now = new Date()
      const clientDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

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
          route_polyline: state?.polyline,
          client_date: clientDate,
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { code?: string; message?: string } }
        if (body.error?.code === 'NO_PAYMENT_METHOD') {
          // B1 — server rejected because rider has no card. Push to /payment/add,
          // carrying the current location state so it's restored on return.
          setSubmitting(false)
          navigate('/payment/add', { state: { returnTo: '/ride/confirm', confirmState: state } })
          return
        }
        setError(body.error?.message ?? 'Failed to request ride.')
        setSubmitting(false)
        return
      }

      const { ride_id } = (await resp.json()) as { ride_id: string }
      trackEvent('ride_requested', { ride_id })
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
                <p className="text-xs text-text-secondary">{Math.round(breakdown.duration_min)} min × ${(breakdown.time_cost_cents / Math.max(1, breakdown.duration_min) / 100).toFixed(2)}/min</p>
              </div>
              <span data-testid="breakdown-time">
                {formatRange(fareRange.low.time_cost_cents, fareRange.high.time_cost_cents)}
              </span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-text-primary font-medium">
              <div>
                <span>Subtotal</span>
                {fareRange.low.fare_cents === MIN_FARE_CENTS && (
                  <p className="text-xs text-text-secondary font-normal">{formatCents(MIN_FARE_CENTS)} minimum fare</p>
                )}
              </div>
              <span>{fareDisplay}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>Platform fee (0%)</span>
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

        {/* Payment method */}
        <div data-testid="payment-section" className="bg-surface rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Payment method
          </p>

          {loadingCards ? (
            <div className="flex items-center gap-2 py-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm text-text-secondary">Loading...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Wallet-first preview — visible whenever the rider has any
                  wallet balance. Tells them upfront whether the wallet
                  alone covers this ride or only part of it. */}
              {walletBalanceCents > 0 && (
                <div
                  data-testid="wallet-row"
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    walletCoversFare
                      ? 'border-success/30 bg-success/5'
                      : 'border-border bg-white'
                  }`}
                >
                  <div className="flex h-8 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      Wallet · {formatCents(walletBalanceCents)}
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      {walletCoversFare
                        ? 'Covers this ride · no card charge'
                        : `Covers ${formatCents(walletBalanceCents)}, card charged ${formatCents(walletShortfallCents)}`}
                    </p>
                  </div>
                  {walletCoversFare && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              )}

              {cards.length === 0 && !walletCoversFare && (
                <>
                  <p className="text-sm text-text-secondary">No payment method saved.</p>
                  <button
                    data-testid="add-card-button"
                    onClick={() => { navigate('/payment/add', { state: { returnTo: '/ride/confirm', confirmState: state } }) }}
                    className="text-sm font-medium text-primary"
                  >
                    + Add a card
                  </button>
                </>
              )}

              {cards.map((card) => (
                <button
                  key={card.id}
                  data-testid="payment-card-option"
                  onClick={() => { setSelectedCard(card.id) }}
                  className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${
                    selectedCard === card.id
                      ? 'bg-primary/10 border-2 border-primary'
                      : 'bg-white border border-border'
                  }`}
                >
                  <CardBrandBadge brand={card.brand} size="sm" />
                  <span className="text-sm font-medium text-text-primary flex-1">
                    •••• {card.last4}
                  </span>
                  {selectedCard === card.id && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
              <button
                data-testid="add-another-card"
                onClick={() => { navigate('/payment/add', { state: { returnTo: '/ride/confirm', confirmState: state } }) }}
                className="text-sm font-medium text-primary mt-1"
              >
                + Add another card
              </button>
            </div>
          )}

          <p className="text-[11px] text-text-secondary leading-tight">
            You won&apos;t be charged now. The final fare is calculated automatically when the ride ends based on actual distance and time.
          </p>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="space-y-3">
          {error && (
            <p data-testid="request-error" className="text-sm text-danger text-center">
              {error}
            </p>
          )}
          <PrimaryButton
            data-testid="request-ride-button"
            onClick={() => { handleRequestRide() }}
            isLoading={isSubmitting}
            loadingLabel="Requesting ride…"
            disabled={!selectedCard && !walletCoversFare && !loadingCards}
          >
            {(() => {
              if (loadingCards) return 'Request Ride'
              if (!selectedCard && !walletCoversFare) {
                // No card AND wallet won't cover — guide the rider to the
                // correct fix instead of saying just "Add a payment method".
                return walletBalanceCents > 0
                  ? 'Add a card or top up wallet'
                  : 'Add a payment method'
              }
              if (!selectedCard && walletCoversFare) {
                // Wallet-only path — make it explicit so the rider knows
                // their card won't be touched. Closes the "is this safe?"
                // gap of the previous generic "Request Ride" text.
                return `Pay with wallet · ${fareDisplay}`
              }
              return 'Request Ride'
            })()}
          </PrimaryButton>

          <button
            data-testid="schedule-ride-button"
            onClick={() => {
              const prefillTo: PlaceSuggestion = {
                placeId: destination.placeId,
                mainText: destination.mainText,
                secondaryText: destination.secondaryText,
                fullAddress: destination.fullAddress,
              }
              const scheduleState: { prefillTo: PlaceSuggestion; prefillFrom?: PlaceSuggestion } = { prefillTo }
              if (state?.originName) {
                scheduleState.prefillFrom = {
                  placeId: 'current-location',
                  mainText: state.originName,
                  secondaryText: '',
                  fullAddress: state.originName,
                  lat: state.originLat,
                  lng: state.originLng,
                }
              }
              navigate('/schedule/rider', { state: scheduleState })
            }}
            className="w-full rounded-2xl py-3 text-sm font-semibold text-primary border-2 border-primary bg-white active:bg-primary/5 transition-colors"
          >
            Schedule This Ride
          </button>

          <button
            data-testid="change-destination-button"
            onClick={() => { navigate('/ride/search', { state: { originLat: state.originLat, originLng: state.originLng } }) }}
            className="w-full text-center text-sm text-primary font-medium py-2"
          >
            Change destination
          </button>
        </div>
      </div>
    </div>
  )
}
