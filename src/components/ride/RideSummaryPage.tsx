import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents, calculateFare, estimateStripeFee } from '@/lib/fare'
import { colors as tokenColors } from '@/lib/tokens'
import { haversineMetres } from '@/lib/geo'
import PrimaryButton from '@/components/ui/PrimaryButton'
import type { Ride, User, Vehicle } from '@/types/database'

// ── Rating tag options (mirrors RateRidePage before consolidation) ────────────

// Tags shown when a RIDER rates a DRIVER
const DRIVER_POSITIVE_TAGS = [
  'Great conversation',
  'Smooth driving',
  'On time',
  'Clean car',
  'Friendly',
  'Good music',
]

const DRIVER_ISSUE_TAGS = [
  'Late pickup',
  'Unsafe driving',
  'Rude behavior',
  'Car not clean',
  'Wrong route',
  'Made me uncomfortable',
]

// Tags shown when a DRIVER rates a RIDER
const RIDER_POSITIVE_TAGS = [
  'Great conversation',
  'Friendly',
  'On time',
  'Respectful',
  'Good directions',
  'Pleasant ride',
]

const RIDER_ISSUE_TAGS = [
  'Late to pickup',
  'Rude behavior',
  'Left mess in car',
  'Wrong pickup spot',
  'Made me uncomfortable',
  'Disruptive',
]

// ── Star button (shared between rating + reveal) ──────────────────────────────

function StarButton({
  filled,
  onClick,
  index,
}: {
  filled: boolean
  onClick: () => void
  index: number
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`star-${index}`}
      className="p-1 transition-transform active:scale-110"
      type="button"
    >
      <svg
        className={`h-9 w-9 ${filled ? 'text-warning' : 'text-border'}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
        />
      </svg>
    </button>
  )
}

// Smaller (24px) star used inside the reveal card after submit.
function MiniStar({ filled }: { filled: boolean }) {
  return (
    <svg
      className={`h-5 w-5 ${filled ? 'text-warning' : 'text-border'}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  )
}

/**
 * Round cents UP to the nearest $0.50 (e.g. 285 → 300, 264 → 300,
 * 250 → 250). Mirrors iOS `RideSummaryPage.swift::tipPresets` so the
 * percentage chips line up across platforms — riders on iOS + web
 * see the same dollar value for the same fare.
 */
function roundUpToHalfDollar(cents: number): number {
  return Math.ceil(cents / 50) * 50
}

/**
 * Map server tip-error codes to UX-friendly copy. Mirrors iOS
 * `friendlyTipError`. The `chargeTip` server lib returns these codes:
 *   - `ALREADY_TIPPED` (409) — tip already exists for this ride
 *   - `NO_PAYMENT_OPTION` (400) — no card AND wallet too low
 *   - `CHARGE_FAILED` (402) — card declined
 *   - `INVALID_TIP` (400) — out-of-range cents
 */
function friendlyTipError(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'ALREADY_TIPPED':
      return 'You already tipped for this ride.'
    case 'NO_PAYMENT_OPTION':
      return "No saved card and your Tago credit can't cover this tip. Add a card or top up to send."
    case 'CHARGE_FAILED':
      return 'Card declined. Try a different card from Payment Methods.'
    case 'INVALID_TIP':
      return 'Tips must be between $1 and $20.'
    default:
      return fallback
  }
}

interface SavedCard {
  id: string
  brand: string
  last4: string
  isDefault: boolean
}

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

  // ── Inline rating + tip state (Sprint 2 / W-T1-R1+R2) ────────────────────
  // The old separate `/ride/rate/:id` page is now a thin redirect to this
  // screen; all rating + tip flow lives inline here, matching iOS.
  const [stars, setStars] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [otherRating, setOtherRating] = useState<{ stars: number; tags: string[] } | null>(null)
  const [rateError, setRateError] = useState<string | null>(null)

  // Tip state — rider-only, optional.
  // `selectedTipCents` is the chip value: a positive cents number, -1 for
  // "Custom", or null for nothing picked. Custom dollar value lives in
  // `customTip`. `tipResult` captures what the server actually charged so
  // the post-submit toast can be specific (card vs wallet, total + fee).
  const [selectedTipCents, setSelectedTipCents] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
  const [tipError, setTipError] = useState<string | null>(null)
  const [tipResult, setTipResult] = useState<{
    method: 'card' | 'wallet'
    cents: number
    feeCents?: number
  } | null>(null)
  // Rider's default saved card — loaded lazily on appear (matches iOS
  // `loadDefaultTipCard`). Drives the "Tip charged to Visa •••• 4242"
  // copy above the picker AND the post-submit confirmation. Driver-side
  // never sees the tip picker so the load is rider-only.
  const [defaultTipCard, setDefaultTipCard] = useState<SavedCard | null>(null)

  const isDriver = profile?.id === ride?.driver_id

  // Refresh profile to get latest wallet_balance after fare transfer
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  // Load the rider's default saved card so the tip row shows
  // "Tip charged to Visa •••• 4242" instead of generic copy. Rider-
  // side only; driver-side never sees the picker. Silent on failure —
  // row falls back to the wallet copy when defaultTipCard is null.
  useEffect(() => {
    if (!profile?.id || isDriver) return
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const resp = await fetch('/api/payment/methods', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) return
        const body = (await resp.json()) as {
          methods: Array<{ id: string; brand: string; last4: string; is_default: boolean }>
          default_method_id: string | null
        }
        if (cancelled) return
        const defaultMatch = body.methods.find((m) => m.id === body.default_method_id)
          ?? body.methods.find((m) => m.is_default)
          ?? body.methods[0]
        if (defaultMatch) {
          setDefaultTipCard({
            id: defaultMatch.id,
            brand: defaultMatch.brand,
            last4: defaultMatch.last4,
            isDefault: !!defaultMatch.is_default,
          })
        }
      } catch {
        // silent — row uses wallet fallback copy
      }
    })()
    return () => { cancelled = true }
  }, [profile?.id, isDriver])

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

      // Hydrate any prior rating for this ride so a history re-open
      // (or a deep-link from FCM/email to an already-rated ride)
      // renders the submitted state instead of an empty form. Mirrors
      // iOS `RideSummaryPage.swift::hydrateExistingRating`. RLS lets
      // any participant read their own row + the counterpart's row
      // for the same ride.
      const { data: ratingRows } = (await supabase
        .from('ride_ratings')
        .select('rater_id, stars, tags, comment')
        .eq('ride_id', rideData.id)) as {
          data:
            | Array<{
                rater_id: string
                stars: number
                tags: string[] | null
                comment: string | null
              }>
            | null
        }
      if (ratingRows && ratingRows.length > 0) {
        const mine = ratingRows.find((r) => r.rater_id === profileId)
        if (mine) {
          setStars(mine.stars)
          setSelectedTags(mine.tags ?? [])
          setComment(mine.comment ?? '')
          setSubmitted(true)
        }
        const theirs = ratingRows.find((r) => r.rater_id !== profileId)
        if (theirs) {
          setRevealed(true)
          setOtherRating({ stars: theirs.stars, tags: theirs.tags ?? [] })
        }
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

  // ── Rating + tip derived values ────────────────────────────────────────

  const isPositiveRating = stars >= 4

  // Switch tag set based on who's rating whom + sentiment.
  const availableTags = isDriver
    ? (isPositiveRating ? RIDER_POSITIVE_TAGS : RIDER_ISSUE_TAGS)
    : (isPositiveRating ? DRIVER_POSITIVE_TAGS : DRIVER_ISSUE_TAGS)

  // Reset tags when sentiment flips so the user doesn't carry a "Smooth
  // driving" tag into a 2-star rating where it'd be nonsensical. Done
  // in the star click handler (not a useEffect on isPositiveRating)
  // so programmatic stars updates from hydration don't wipe the
  // already-loaded tags. Effect-based reset would fire AFTER hydration
  // set both stars + tags, clobbering the tags before the user even
  // sees them.
  const pickStars = (i: number) => {
    if ((i >= 4) !== isPositiveRating) {
      setSelectedTags([])
    }
    setStars(i)
  }

  // Fare-scaled tip chips (15% / 20% / 25%) rounded UP to nearest $0.50.
  // Falls back to flat $1 / $2 / $5 when fare isn't loaded yet, so the
  // chips never render at $0.00. Round direction matches iOS
  // (`RideSummaryPage.swift::tipPresets`) so the same fare produces
  // the same chip values across platforms.
  const tipChips = useMemo<Array<{ label: string; subtitle: string; cents: number }>>(() => {
    if (fareCents > 0) {
      return [15, 20, 25].map((pct) => {
        const cents = Math.max(100, roundUpToHalfDollar(Math.ceil((fareCents * pct) / 100)))
        return {
          label: `${pct}%`,
          subtitle: `$${(cents / 100).toFixed(2)}`,
          cents,
        }
      })
    }
    return [
      { label: '$1', subtitle: '', cents: 100 },
      { label: '$2', subtitle: '', cents: 200 },
      { label: '$5', subtitle: '', cents: 500 },
    ]
  }, [fareCents])

  // Resolve the picker into a cents value: chip → its cents; -1 → custom
  // dollars parsed from the input. Null = nothing chosen (no tip).
  const tipCents = useMemo<number | null>(() => {
    if (selectedTipCents == null) return null
    if (selectedTipCents === -1) {
      const dollars = parseFloat(customTip)
      if (!Number.isFinite(dollars)) return null
      return Math.round(dollars * 100)
    }
    return selectedTipCents
  }, [selectedTipCents, customTip])

  // Mirror the server's path-selection: card-first if a saved card is on
  // file (rider's stripe_customer_id + default_payment_method_id), else
  // wallet if it covers the tip.
  const hasCard = !!profile?.stripe_customer_id && !!profile?.default_payment_method_id
  const walletBalanceCents = profile?.wallet_balance ?? 0
  const willTipUseCard = hasCard
  const walletCoversTip = tipCents != null && walletBalanceCents >= tipCents
  const tipFeeCents = willTipUseCard && tipCents && tipCents > 0 ? estimateStripeFee(tipCents) : 0

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  // Single Submit handler: posts /rate (if stars picked), then (rider
  // only, when a tip was picked) posts /tip. Either piece is optional
  // — riders can tip without rating (rare but allowed, matches iOS).
  // Both happen before the "thank you" state appears so the user
  // only ever sees one loading spinner. Mirrors iOS
  // `RideSummaryPage.swift::handleSubmit`.
  const handleSubmitRatingAndTip = async () => {
    if (submitting) return
    // Need at least one piece (stars OR tip) to have anything to submit.
    if (stars === 0 && (tipCents == null || tipCents <= 0)) return
    setSubmitting(true)
    setRateError(null)
    setTipError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setRateError('Please sign in to submit your rating.')
        setSubmitting(false)
        return
      }

      // 1. Rating — only when the user actually picked stars.
      let rateBody: {
        revealed?: boolean
        other_rating?: { stars: number; tags: string[] } | null
        error?: { code?: string; message?: string }
      } = {}
      if (stars > 0) {
        const rateResp = await fetch(`/api/rides/${rideId}/rate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            stars,
            tags: selectedTags,
            comment: comment.trim() || undefined,
          }),
        })
        rateBody = (await rateResp.json()) as typeof rateBody

        // 'ALREADY_RATED' is treated as success — re-tap after the row
        // already landed (network double-fire, back/forward, tab
        // reopen). Matches iOS.
        const alreadyRated = rateBody.error?.code === 'ALREADY_RATED'
        if (!rateResp.ok && !alreadyRated) {
          setRateError(rateBody.error?.message ?? 'Failed to submit rating')
          setSubmitting(false)
          return
        }
      }

      // 2. Tip (rider only, only when picked). Wrapped in its own
      // try/catch so a tip-side network failure doesn't get reported
      // as a rating failure — the rating already landed by this point.
      let resolvedTipResult: { method: 'card' | 'wallet'; cents: number; feeCents?: number } | null = null
      if (!isDriver && tipCents != null && tipCents > 0) {
        if (tipCents < 100 || tipCents > 2000) {
          setTipError('Tips must be between $1 and $20.')
        } else if (!willTipUseCard && !walletCoversTip) {
          setTipError(
            "No saved card and your Tago credit can't cover this tip. Add a card or top up to send.",
          )
        } else {
          try {
            const tipResp = await fetch(`/api/rides/${rideId}/tip`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({ tip_cents: tipCents }),
            })
            const tipBody = (await tipResp.json()) as {
              method?: 'card' | 'wallet'
              stripe_fee_cents?: number
              error?: { code?: string; message?: string }
            }
            if (!tipResp.ok && tipBody.error?.code !== 'ALREADY_TIPPED') {
              setTipError(
                friendlyTipError(tipBody.error?.code, tipBody.error?.message ?? 'Tip failed.'),
              )
            } else {
              resolvedTipResult = {
                method: tipBody.method ?? (willTipUseCard ? 'card' : 'wallet'),
                cents: tipCents,
                feeCents: tipBody.stripe_fee_cents,
              }
              // Wallet path drains rider balance — refresh profile so any
              // other open screen / next nav sees the new amount.
              void refreshProfile()
            }
          } catch {
            setTipError('Tip failed — network error. Your rating was saved.')
          }
        }
      }

      // 3. Commit to the thank-you state. Reveal info comes from the rate
      // response.
      if (rateBody.revealed && rateBody.other_rating) {
        setRevealed(true)
        setOtherRating(rateBody.other_rating)
      }
      if (resolvedTipResult) setTipResult(resolvedTipResult)
      setSubmitted(true)
    } catch {
      setRateError('Network error — try again.')
    } finally {
      setSubmitting(false)
    }
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

        {/* Payment status badge — role-aware framing (W-T1-P9). RIDER
            sees the literal status because they need the friction
            ("Payment failed") to be motivated to update their card.
            DRIVER never sees "PAYMENT FAILED" — they didn't fail
            anything; their work is done. Show neutral "Payment
            pending" in warning tone so the driver knows it's in
            flight without anxiety. Matches iOS `paymentStatusBadge`. */}
        {paymentStatus && paymentStatus !== 'paid' && (() => {
          const badge = isDriver
            ? { label: 'Payment pending', className: 'bg-warning/10 text-warning' }
            : paymentStatus === 'processing'
              ? { label: 'Payment processing', className: 'bg-warning/10 text-warning' }
              : paymentStatus === 'failed'
                ? { label: 'Payment failed', className: 'bg-danger/10 text-danger' }
                : { label: 'Payment pending', className: 'bg-gray-100 text-text-secondary' }
          return (
            <span
              data-testid="payment-status"
              className={`mt-1 rounded-full px-3 py-0.5 text-xs font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          )
        })()}

        {/* Driver "Settling with the rider" reassurance (W-T1-P9,
            matches iOS `driverPaymentPendingNote`). Driver always
            earns their fare — settlement is Tago's problem to chase.
            Hidden when payment is paid OR processing OR for the rider
            (the rider sees the dunning CTAs below instead). */}
        {isDriver && (paymentStatus === 'failed' || paymentStatus === 'pending') && (
          <div
            className="mt-3 mx-6 w-full max-w-md rounded-xl bg-warning/10 px-4 py-3"
            data-testid="driver-settling-note"
          >
            <div className="mb-1 flex items-center gap-1.5 text-text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-3.5 w-3.5 text-warning"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-xs font-bold">Settling with the rider</span>
            </div>
            <p className="text-xs text-text-secondary">
              You earned this fare. We&apos;re working with the rider&apos;s card to settle. You&apos;ll see this credited to your wallet within 48 hours.
            </p>
          </div>
        )}

        {/* Retry payment for rider when payment failed/pending */}
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
                  {/* Base fare row — currently $0.00 under the
                      current pricing policy. Surfaced explicitly so
                      riders + drivers always see the line item; if
                      we later flip it non-zero only the value
                      changes, not the layout. */}
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

      {/* ── Inline rating + tip section ────────────────────────────────────
          Sprint 2 W-T1-R1+R2 — replaces the old `/ride/rate/:id` page
          navigation. Single Submit fires /rate then (if applicable) /tip
          in sequence so the user only sees one loading spinner.
       */}
      <div className="mx-6 mt-4 rounded-2xl bg-white p-5 shadow-sm" data-testid="rate-section">
        {!submitted ? (
          <>
            <p className="mb-3 text-center text-sm font-semibold text-text-primary">
              How was your trip?
            </p>

            <div className="flex justify-center gap-1" data-testid="star-row">
              {[1, 2, 3, 4, 5].map((i) => (
                <StarButton
                  key={i}
                  index={i}
                  filled={i <= stars}
                  onClick={() => pickStars(i)}
                />
              ))}
            </div>

            {/* Tags */}
            {stars > 0 && (
              <div className="mt-4" data-testid="tags-section">
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  {isPositiveRating ? 'What went well?' : 'What could be improved?'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      data-testid={`tag-${tag}`}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        selectedTags.includes(tag)
                          ? isPositiveRating
                            ? 'border-success bg-success/10 text-success'
                            : 'border-danger bg-danger/10 text-danger'
                          : 'border-border text-text-secondary'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Comment — only for low ratings */}
            {stars > 0 && !isPositiveRating && (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us more (optional)"
                rows={3}
                data-testid="comment-input"
                className="mt-3 w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
              />
            )}

            {/* Tip — riders only, always rendered (so the rider sees
                the affordance regardless of star count, matching iOS).
                For a low rating the rider can simply leave "No tip"
                selected and the picker stays inert. */}
            {!isDriver && (
              <div className="mt-5 border-t border-border pt-4 space-y-3" data-testid="tip-picker">
                <p className="text-sm font-semibold text-text-primary">
                  Add a tip for {otherUser?.full_name?.split(' ')[0] ?? 'your driver'}?
                </p>

                {/* Payment-method row — always visible above the chips so
                    rider knows whether their card or wallet will be hit.
                    When the saved-card fetch resolved, displays brand
                    + last4 ("Visa •••• 4242") instead of generic copy. */}
                <button
                  type="button"
                  onClick={() => navigate('/payment/methods')}
                  data-testid="tip-method-row"
                  className="flex w-full items-center justify-between rounded-xl bg-surface px-3 py-2 text-left text-xs"
                >
                  <span className="text-text-secondary">
                    {defaultTipCard ? (
                      <>
                        Tip charged to{' '}
                        <span className="font-semibold text-text-primary">
                          {defaultTipCard.brand.charAt(0).toUpperCase() + defaultTipCard.brand.slice(1)} •••• {defaultTipCard.last4}
                        </span>
                      </>
                    ) : willTipUseCard ? (
                      <>Tip charged to <span className="font-semibold text-text-primary">your card</span></>
                    ) : walletBalanceCents > 0 ? (
                      <>Tip taken from your <span className="font-semibold text-text-primary">Tago credit</span></>
                    ) : (
                      <span className="text-danger">No card or wallet balance — add one to tip</span>
                    )}
                  </span>
                  <span className="text-primary font-medium">
                    {defaultTipCard || willTipUseCard ? 'Change' : 'Add card'}
                  </span>
                </button>

                {/* Chips — "No tip" + 3 fare-scaled + Custom */}
                <div className="grid grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => { setSelectedTipCents(null); setCustomTip(''); setTipError(null) }}
                    data-testid="tip-none"
                    aria-pressed={selectedTipCents == null}
                    className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                      selectedTipCents == null ? 'bg-primary text-white' : 'bg-surface text-text-primary'
                    }`}
                  >
                    No tip
                  </button>
                  {tipChips.map((chip) => {
                    const active = selectedTipCents === chip.cents
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => { setSelectedTipCents(chip.cents); setTipError(null) }}
                        data-testid={`tip-${chip.label}`}
                        aria-pressed={active}
                        className={`rounded-xl py-2 text-sm font-semibold transition-colors ${
                          active ? 'bg-primary text-white' : 'bg-surface text-text-primary'
                        }`}
                      >
                        <span className="block">{chip.label}</span>
                        {chip.subtitle && (
                          <span className={`block text-[10px] font-normal ${active ? 'text-white/80' : 'text-text-secondary'}`}>
                            {chip.subtitle}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => { setSelectedTipCents(-1); setTipError(null) }}
                    data-testid="tip-custom"
                    aria-pressed={selectedTipCents === -1}
                    className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                      selectedTipCents === -1 ? 'bg-primary text-white' : 'bg-surface text-text-primary'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {/* Custom amount input — live currency-formatted so the
                    rider sees "$5.00" as they type "5". Matches iOS
                    `customTipField` formatter. */}
                {selectedTipCents === -1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-text-secondary text-lg font-bold">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={customTip}
                      onChange={(e) => {
                        // Allow only digits and an optional decimal with up
                        // to 2 dp. Strip anything else live so the value
                        // always parses cleanly into a dollar amount.
                        const raw = e.target.value
                        const cleaned = raw.replace(/[^0-9.]/g, '')
                        const parts = cleaned.split('.')
                        const normalized = parts.length > 1
                          ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`
                          : cleaned
                        setCustomTip(normalized)
                        setTipError(null)
                      }}
                      onBlur={() => {
                        // On blur, snap to canonical "5.00" / "12.50" so
                        // the displayed value matches the total preview.
                        const n = parseFloat(customTip)
                        if (Number.isFinite(n) && n > 0) setCustomTip(n.toFixed(2))
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLInputElement).blur()
                        }
                      }}
                      placeholder="0.00"
                      data-testid="tip-custom-input"
                      className="flex-1 rounded-xl border border-border bg-white px-3 py-2 text-base font-semibold focus:border-primary focus:outline-none"
                    />
                  </div>
                )}

                {/* Total preview — sums fare + tip so the rider sees
                    the whole bill, not just the tip charge. Matches
                    iOS `totalWithTipText`. */}
                {tipCents != null && tipCents >= 100 && tipCents <= 2000 && (
                  <div className="rounded-xl bg-surface px-3 py-2 text-xs" data-testid="tip-total">
                    <div className="flex items-center justify-between text-text-secondary">
                      <span>Ride fare</span>
                      <span className="text-text-primary">{formatCents(fareCents)}</span>
                    </div>
                    <div className="flex items-center justify-between text-text-secondary">
                      <span>Tip</span>
                      <span className="text-text-primary">${(tipCents / 100).toFixed(2)}</span>
                    </div>
                    {willTipUseCard && tipFeeCents > 0 && (
                      <div className="flex items-center justify-between text-text-secondary">
                        <span>Processing fee</span>
                        <span className="text-text-primary">${(tipFeeCents / 100).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-semibold">
                      <span className="text-text-primary">Total</span>
                      <span className="text-text-primary">
                        ${((fareCents + tipCents + (willTipUseCard ? tipFeeCents : 0)) / 100).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-text-secondary">
                      {willTipUseCard
                        ? `Tip + fee charged to your card on file.`
                        : walletCoversTip
                          ? `Tip taken from your Tago credit (no fee).`
                          : `Add a card or top up your wallet to send this tip.`}
                    </p>
                  </div>
                )}

                {tipError && (
                  <p data-testid="tip-error" className="text-xs text-danger">{tipError}</p>
                )}
              </div>
            )}

            {rateError && (
              <p className="mt-3 text-center text-sm text-danger" data-testid="rating-error">{rateError}</p>
            )}
          </>
        ) : (
          // ── Submitted thank-you state ───────────────────────────────────
          <div className="text-center" data-testid="rate-submitted">
            <p className="text-base font-semibold text-text-primary mb-2">
              Thanks for your feedback!
            </p>
            {revealed && otherRating ? (
              <div data-testid="revealed-rating" className="mt-3 inline-flex flex-col items-center">
                <p className="text-xs text-text-secondary mb-1">
                  {otherUser?.full_name ?? 'Your match'} rated you
                </p>
                <div className="flex justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <MiniStar key={i} filled={i <= otherRating.stars} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-secondary" data-testid="waiting-reveal">
                Your rating is revealed once they rate you too.
              </p>
            )}
            {tipResult && (
              <p
                className="mt-3 text-xs text-success"
                data-testid="tip-method-confirm"
              >
                {tipResult.method === 'card'
                  ? (defaultTipCard
                      ? `Tip sent — $${((tipResult.cents + (tipResult.feeCents ?? 0)) / 100).toFixed(2)} charged to ${defaultTipCard.brand.charAt(0).toUpperCase() + defaultTipCard.brand.slice(1)} •••• ${defaultTipCard.last4}${tipResult.feeCents ? ` (incl. $${(tipResult.feeCents / 100).toFixed(2)} fee)` : ''}.`
                      : `Tip sent — $${((tipResult.cents + (tipResult.feeCents ?? 0)) / 100).toFixed(2)} charged to your saved card${tipResult.feeCents ? ` (incl. $${(tipResult.feeCents / 100).toFixed(2)} fee)` : ''}.`)
                  : `Tip sent — $${(tipResult.cents / 100).toFixed(2)} taken from your Tago credit.`}
              </p>
            )}
            {tipError && !tipResult && (
              // Rating succeeded but the tip leg failed (e.g. card decline,
              // no payment method). Surface it so the user knows the tip
              // didn't send and can revisit via the wallet / cards pages.
              <p
                className="mt-3 text-xs text-danger"
                data-testid="tip-error-post-submit"
              >
                {tipError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      <div className="mt-auto space-y-3 px-6 pb-8 pt-6">
        {!submitted && (() => {
          const hasTip = tipCents != null && tipCents > 0
          const submitLabel = submitting
            ? 'Submitting…'
            : stars > 0 && hasTip
              ? 'Submit rating + tip'
              : stars > 0
                ? 'Submit rating'
                : hasTip
                  ? 'Send tip'
                  : 'Submit'
          return (
            <PrimaryButton
              onClick={() => { void handleSubmitRatingAndTip() }}
              className="w-full"
              disabled={submitting || (stars === 0 && !hasTip)}
              data-testid="submit-rating"
            >
              {submitLabel}
            </PrimaryButton>
          )
        })()}

        <button
          onClick={goHome}
          className="w-full rounded-2xl border border-border py-3 text-sm font-medium text-text-secondary"
          data-testid="done-button"
        >
          {/* Copy swap matches iOS — pre-submit "Maybe later" softens
              the dismiss when the rating still has value to capture;
              post-submit "Done" closes out the completed flow. */}
          {submitted ? 'Done' : 'Maybe later'}
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
