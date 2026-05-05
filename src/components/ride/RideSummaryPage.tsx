import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents, calculateFare, estimateStripeFee } from '@/lib/fare'
import { colors as tokenColors } from '@/lib/tokens'
import { haversineMetres } from '@/lib/geo'
import PrimaryButton from '@/components/ui/PrimaryButton'
import type { Ride, User, Vehicle } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideSummaryPageProps {
  'data-testid'?: string
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const colors = [tokenColors.primary, tokenColors.success, tokenColors.warning, tokenColors.danger, tokenColors.primaryDark, tokenColors.primaryLight]
    const particles: Array<{
      x: number; y: number; w: number; h: number
      color: string; vx: number; vy: number; rot: number; vr: number
    }> = []

    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * -1,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)] ?? tokenColors.primary,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.15,
      })
    }

    let frameId: number
    let frame = 0
    const maxFrames = 180 // ~3 seconds at 60fps

    function animate() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      frame++

      const alpha = frame > maxFrames - 30 ? Math.max(0, (maxFrames - frame) / 30) : 1
      ctx.globalAlpha = alpha

      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        p.vy += 0.05 // gravity

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }

      if (frame < maxFrames) {
        frameId = requestAnimationFrame(animate)
      }
    }

    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-testid="confetti"
      className="pointer-events-none fixed inset-0 z-50"
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RideSummaryPage({ 'data-testid': testId }: RideSummaryPageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [otherUser, setOtherUser] = useState<User | null>(null)
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBreakdown, setShowBreakdown] = useState(false)
  // Phase 3a: net amount actually pulled from the rider's wallet for this
  // ride (sum of fare_debit minus sum of wallet_refund). The remainder of
  // ride.fare_cents was paid by the rider's card. Used to render a "Paid
  // · $X wallet + $Y card" row so the rider doesn't think the two
  // transactions in their history mean they were charged twice.
  const [walletPaidCents, setWalletPaidCents] = useState<number>(0)

  const isDriver = profile?.id === ride?.driver_id

  // Refresh profile to get latest wallet_balance after fare transfer
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  // ── Fetch ride + related data ───────────────────────────────────────────
  useEffect(() => {
    if (!rideId || !profile?.id) return

    const profileId = profile.id

    async function load() {
      const { data: rideData } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId!)
        .single()

      if (!rideData) { setLoading(false); return }
      setRide(rideData)

      // Fetch the other party's profile
      const otherId = profileId === rideData.driver_id
        ? rideData.rider_id
        : rideData.driver_id

      if (otherId) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', otherId)
          .single()
        if (userData) setOtherUser(userData)
      }

      // Fetch vehicle
      if (rideData.vehicle_id) {
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', rideData.vehicle_id)
          .maybeSingle()
        if (vehicleData) setVehicle(vehicleData)
      }

      // Compute the rider's wallet contribution to this ride's payment.
      // Sum of fare_debit (stored negative) minus sum of wallet_refund
      // (stored positive). RLS allows the rider to read their own rows.
      if (rideData.rider_id === profileId) {
        const { data: txRows } = await supabase
          .from('transactions')
          .select('amount_cents, type')
          .eq('user_id', profileId)
          .eq('ride_id', rideData.id)
          .in('type', ['fare_debit', 'wallet_refund'])
        let debited = 0
        let refunded = 0
        for (const r of txRows ?? []) {
          const amt = (r.amount_cents as number | null) ?? 0
          if (r.type === 'fare_debit') debited += -amt
          else if (r.type === 'wallet_refund') refunded += amt
        }
        setWalletPaidCents(Math.max(0, debited - refunded))
      }

      setLoading(false)
    }

    void load()
  }, [rideId, profile])

  // ── Derived fare values ────────────────────────────────────────────────
  const fareCents = ride?.fare_cents ?? 0
  const paymentStatus = (ride as Record<string, unknown>)?.payment_status as string | undefined
  // Phase 3a wallet/card split:
  //   walletPaidCents — net pulled from rider's wallet (already netted of
  //     wallet_refund rollbacks above)
  //   cardPaidCents   — remainder taken from the card; 0 when wallet
  //     covered the whole fare
  // We only show the split row to the rider once payment has actually
  // settled (paid / processing). For pending / failed states the existing
  // retry UI handles the messaging.
  const walletApplied = Math.min(walletPaidCents, fareCents)
  const cardPaidCents = Math.max(0, fareCents - walletApplied)
  // The Stripe fee row only makes sense for the card portion.
  const stripeFeeCents = cardPaidCents > 0
    ? (ride?.stripe_fee_cents ?? estimateStripeFee(cardPaidCents))
    : 0
  const totalCharged = fareCents + stripeFeeCents
  const driverEarnsCents = fareCents // driver gets full fare (0% platform commission)
  const showSplit = !isDriver
    && (paymentStatus === 'paid' || paymentStatus === 'processing')
    && fareCents > 0

  // ── Fare breakdown details ────────────────────────────────────────────
  const fareBreakdown = (() => {
    if (!ride) return null
    // Use actual pickup/dropoff points, falling back to origin/destination
    const pickup = (ride.pickup_point ?? ride.origin) as { type: string; coordinates: [number, number] } | null
    const dropoff = (ride.dropoff_point ?? ride.destination) as { type: string; coordinates: [number, number] } | null
    if (!pickup || !dropoff) return null
    const distanceM = haversineMetres(
      pickup.coordinates[1], pickup.coordinates[0],
      dropoff.coordinates[1], dropoff.coordinates[0],
    )
    const distanceKm = distanceM / 1000
    const durationMin = ride.started_at && ride.ended_at
      ? Math.round((new Date(ride.ended_at).getTime() - new Date(ride.started_at).getTime()) / 60000)
      : 0
    return calculateFare(distanceKm, durationMin)
  })()

  // ── Duration ──────────────────────────────────────────────────────────
  const durationLabel = (() => {
    if (!ride?.started_at || !ride?.ended_at) return null
    const diffMs = new Date(ride.ended_at).getTime() - new Date(ride.started_at).getTime()
    const mins = Math.round(diffMs / 60000)
    return mins < 1 ? 'Less than a minute' : `${mins} min`
  })()

  // ── Navigation ────────────────────────────────────────────────────────
  const goHome = () => {
    navigate(isDriver ? '/home/driver' : '/home/rider', { replace: true })
  }

  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  async function handleRetryPayment() {
    if (!rideId) return
    setRetrying(true)
    setRetryError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setRetryError('Please sign in to retry payment.'); return }

      const resp = await fetch(`/api/rides/${rideId}/retry-payment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { message?: string } }
        setRetryError(body.error?.message ?? 'Payment failed. Please try again.')
        return
      }

      // Poll payment_status until it resolves (paid/failed) or the 30s budget
      // is exhausted. The retry hits Stripe off-session and commits to the
      // wallet in the same request, but until the /retry-payment handler
      // returns we can't read the new row, so poll the DB here.
      const maxAttempts = 10
      for (let i = 0; i < maxAttempts; i++) {
        const { data: updatedRide } = await supabase
          .from('rides')
          .select('*')
          .eq('id', rideId)
          .single()
        if (updatedRide) {
          setRide(updatedRide)
          const status = (updatedRide as Record<string, unknown>).payment_status as string | undefined
          if (status === 'paid' || status === 'failed') break
        }
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    } catch {
      setRetryError('Network error. Please try again.')
    } finally {
      setRetrying(false)
    }
  }

  const goRate = () => {
    navigate(`/ride/rate/${rideId}`)
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface" data-testid={testId ?? 'ride-summary'}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6" data-testid={testId ?? 'ride-summary'}>
        <p className="text-text-secondary">Ride not found.</p>
        <PrimaryButton onClick={() => navigate('/home/rider', { replace: true })} data-testid="go-home">
          Go Home
        </PrimaryButton>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface" data-testid={testId ?? 'ride-summary'}>
      <Confetti />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3 px-6 pb-6" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
        {/* Green checkmark */}
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full bg-success"
          data-testid="checkmark"
        >
          <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-text-primary">Ride Complete!</h1>

        {/* Main fare message */}
        <p className="text-lg text-text-secondary" data-testid="fare-message">
          {isDriver
            ? `You earned ${formatCents(driverEarnsCents)}`
            : `${formatCents(totalCharged)} charged`
          }
        </p>

        {/* Payment status badge */}
        {paymentStatus && paymentStatus !== 'paid' && (
          <span
            data-testid="payment-status"
            className={`mt-1 rounded-full px-3 py-0.5 text-xs font-medium ${
              paymentStatus === 'processing' ? 'bg-warning/10 text-warning' :
              paymentStatus === 'failed' ? 'bg-danger/10 text-danger' :
              'bg-gray-100 text-text-secondary'
            }`}
          >
            {paymentStatus === 'processing' ? 'Payment processing' :
             paymentStatus === 'failed' ? 'Payment failed' :
             'Payment pending'}
          </span>
        )}

        {/* Retry payment for rider when payment failed */}
        {!isDriver && (paymentStatus === 'failed' || paymentStatus === 'pending') && (
          <div className="mt-3 flex flex-col items-center gap-2 w-full px-6">
            {retryError && (
              <p data-testid="retry-error" className="text-xs text-danger text-center">{retryError}</p>
            )}
            <button
              data-testid="retry-payment-button"
              onClick={() => { void handleRetryPayment() }}
              disabled={retrying}
              className="w-full max-w-xs rounded-xl bg-primary py-2.5 text-sm font-semibold text-white shadow active:opacity-80 disabled:opacity-50"
            >
              {retrying ? 'Retrying...' : 'Retry Payment'}
            </button>
            <button
              data-testid="manage-payment-methods"
              onClick={() => { navigate('/payment/methods') }}
              className="text-xs text-primary font-medium"
            >
              Manage payment methods
            </button>
          </div>
        )}
      </div>

      {/* ── Ride info card ────────────────────────────────────────────────── */}
      <div className="mx-6 rounded-2xl bg-white p-5 shadow-sm" data-testid="ride-card">
        {/* Other user info */}
        {otherUser && (
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-light text-primary font-bold">
              {otherUser.full_name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="font-semibold text-text-primary">{otherUser.full_name}</p>
              <p className="text-sm text-text-secondary">
                {isDriver ? 'Rider' : 'Driver'}
                {otherUser.rating_avg != null && ` · ★ ${otherUser.rating_avg.toFixed(1)}`}
              </p>
            </div>
          </div>
        )}

        {/* Vehicle info (shown to rider) */}
        {!isDriver && vehicle && (
          <p className="mb-4 text-sm text-text-secondary">
            {vehicle.color} {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.plate}
          </p>
        )}

        {/* Destination */}
        {ride.destination_name && (
          <div className="mb-3 flex items-start gap-2">
            <span className="mt-0.5 text-primary">📍</span>
            <p className="text-sm text-text-primary">{ride.destination_name}</p>
          </div>
        )}

        {/* Duration */}
        {durationLabel && (
          <div className="flex items-center gap-2">
            <span className="text-text-secondary">⏱</span>
            <p className="text-sm text-text-secondary">Time together: {durationLabel}</p>
          </div>
        )}

        {/* Distance traveled */}
        {fareBreakdown && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-text-secondary">📏</span>
            <p className="text-sm text-text-secondary">Distance: {fareBreakdown.distance_miles.toFixed(1)} mi</p>
          </div>
        )}
      </div>

      {/* ── Fare breakdown (tappable) ────────────────────────────────────── */}
      <div className="mx-6 mt-4">
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="flex w-full items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-sm"
          data-testid="fare-breakdown-toggle"
        >
          <span className="font-semibold text-text-primary">Fare Breakdown</span>
          <span className="text-text-secondary">{showBreakdown ? '▲' : '▼'}</span>
        </button>

        {showBreakdown && (
          <div className="mt-1 rounded-b-2xl bg-white px-5 pb-4 shadow-sm" data-testid="fare-breakdown">
            <div className="space-y-2 border-t border-border pt-3 text-sm">
              {fareBreakdown && (
                <>
                  {/* Base fare row — currently $0.00 in MVP. Surfaced
                      explicitly so riders + drivers see it from day
                      one; if monetization later flips it non-zero,
                      the line item is already in place. */}
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Base fare</span>
                    <span className="text-text-primary">{formatCents(fareBreakdown.base_fare_cents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Gas cost ({fareBreakdown.distance_miles.toFixed(1)} mi)</span>
                    <span className="text-text-primary">{formatCents(fareBreakdown.gas_cost_cents)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Time ({fareBreakdown.duration_min} min × ${(fareBreakdown.time_cost_cents / Math.max(1, fareBreakdown.duration_min) / 100).toFixed(2)})</span>
                    <span className="text-text-primary">{formatCents(fareBreakdown.time_cost_cents)}</span>
                  </div>
                  {fareCents > fareBreakdown.gas_cost_cents + fareBreakdown.time_cost_cents && (
                    <div className="flex justify-between text-xs">
                      <span className="text-text-secondary italic">Minimum fare applied</span>
                      <span className="text-text-secondary italic">{formatCents(fareCents)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="font-medium text-text-primary">Ride fare</span>
                    <span className="font-medium text-text-primary">{formatCents(fareCents)}</span>
                  </div>
                </>
              )}
              {!fareBreakdown && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Ride fare</span>
                  <span className="text-text-primary">{formatCents(fareCents)}</span>
                </div>
              )}
              {!isDriver && cardPaidCents > 0 && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Processing fee</span>
                  <span className="text-text-primary">{formatCents(stripeFeeCents)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span className="text-text-primary">{isDriver ? 'You earn' : 'Total charged'}</span>
                <span className={isDriver ? 'text-success' : 'text-text-primary'}>
                  {formatCents(isDriver ? driverEarnsCents : totalCharged)}
                </span>
              </div>

              {/* Phase 3a — wallet/card split. Lives below "Total charged"
                  so the totals read top-to-bottom and the split line just
                  explains where the money came from. Hidden when payment
                  hasn't settled (the retry-payment banner above handles
                  pending/failed messaging). */}
              {showSplit && (
                <div className="rounded-xl bg-surface px-3 py-2 text-xs" data-testid="payment-split">
                  {walletApplied === 0 && cardPaidCents > 0 && (
                    <p className="text-text-secondary">
                      Paid by <span className="font-semibold text-text-primary">card</span> · {formatCents(totalCharged)}
                    </p>
                  )}
                  {walletApplied > 0 && cardPaidCents === 0 && (
                    <p className="text-text-secondary">
                      Paid from your <span className="font-semibold text-text-primary">wallet</span> · {formatCents(walletApplied)} (no processing fee)
                    </p>
                  )}
                  {walletApplied > 0 && cardPaidCents > 0 && (
                    <p className="text-text-secondary">
                      Paid · <span className="font-semibold text-text-primary">{formatCents(walletApplied)}</span> wallet
                      {' + '}
                      <span className="font-semibold text-text-primary">{formatCents(cardPaidCents + stripeFeeCents)}</span> card
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="mt-auto space-y-3 px-6 pb-8 pt-6">
        <PrimaryButton
          onClick={goRate}
          className="w-full"
          data-testid="rate-button"
        >
          Rate Your {isDriver ? 'Rider' : 'Driver'}
        </PrimaryButton>

        <button
          onClick={goHome}
          className="w-full rounded-2xl border border-border py-3 text-sm font-medium text-text-secondary"
          data-testid="done-button"
        >
          Done
        </button>

        <button
          onClick={() => navigate(`/report/${rideId}`)}
          className="w-full text-center text-xs text-text-secondary underline"
          data-testid="report-link"
        >
          Report an issue
        </button>
      </div>
    </div>
  )
}
