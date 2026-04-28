import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
import { estimateStripeFee } from '@/lib/fare'
import type { Ride, User } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateRidePageProps {
  'data-testid'?: string
}

// ── Tag options ───────────────────────────────────────────────────────────────

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

// ── Star component ────────────────────────────────────────────────────────────

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
        className={`h-10 w-10 ${filled ? 'text-warning' : 'text-border'}`}
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function RateRidePage({ 'data-testid': testId }: RateRidePageProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [ride, setRide] = useState<Ride | null>(null)
  const [otherUser, setOtherUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const [stars, setStars] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [otherRating, setOtherRating] = useState<{ stars: number; tags: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tip state — rider-only, shown after rating submitted.
  const [selectedTip, setSelectedTip] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
  const [tipping, setTipping] = useState(false)
  const [tipSent, setTipSent] = useState(false)
  const [tipError, setTipError] = useState<string | null>(null)
  // Captured from server response so post-send banner can be specific.
  const [tipResult, setTipResult] = useState<{ method: 'card' | 'wallet'; cents: number; feeCents?: number } | null>(null)

  // Effective tip cents from picker (preset chips → cents directly; -1 means
  // custom input which is in dollars; null means nothing selected yet).
  const tipCents = useMemo(() => {
    if (selectedTip == null) return null
    if (selectedTip === -1) {
      const dollars = parseFloat(customTip)
      if (!Number.isFinite(dollars)) return null
      return Math.round(dollars * 100)
    }
    return selectedTip
  }, [selectedTip, customTip])

  // Match server-side path-selection in tipPayment.ts: card-first if a
  // saved card is on file; otherwise wallet if it covers the tip.
  const hasCard = !!profile?.stripe_customer_id && !!profile?.default_payment_method_id
  const walletBalanceCents = profile?.wallet_balance ?? 0
  const willUseCard = hasCard
  const walletCovers = tipCents != null && walletBalanceCents >= tipCents
  const tipFeeCents = willUseCard && tipCents && tipCents > 0 ? estimateStripeFee(tipCents) : 0
  const tipTotalCents = (tipCents ?? 0) + (willUseCard ? tipFeeCents : 0)

  const isDriver = profile?.id === ride?.driver_id
  const isPositive = stars >= 4
  // Driver rates rider → show rider tags; Rider rates driver → show driver tags
  const availableTags = isDriver
    ? (isPositive ? RIDER_POSITIVE_TAGS : RIDER_ISSUE_TAGS)
    : (isPositive ? DRIVER_POSITIVE_TAGS : DRIVER_ISSUE_TAGS)

  // ── Fetch ride + other user ─────────────────────────────────────────────
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

      setLoading(false)
    }

    void load()
  }, [rideId, profile])

  // ── Reset tags when switching between positive/negative ─────────────────
  useEffect(() => {
    setSelectedTags([])
  }, [isPositive])

  // ── Toggle tag ──────────────────────────────────────────────────────────
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (stars === 0 || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Not authenticated'); setSubmitting(false); return }

      const resp = await fetch(`/api/rides/${rideId}/rate`, {
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

      const body = (await resp.json()) as {
        revealed?: boolean
        other_rating?: { stars: number; tags: string[] } | null
        error?: { message?: string }
      }

      if (!resp.ok) {
        setError(body.error?.message ?? 'Failed to submit rating')
        setSubmitting(false)
        return
      }

      setSubmitted(true)
      if (body.revealed && body.other_rating) {
        setRevealed(true)
        setOtherRating(body.other_rating)
      }
    } catch {
      setError('Network error — try again')
      setSubmitting(false)
    }
  }

  // ── Skip ────────────────────────────────────────────────────────────────
  const handleSkip = () => {
    navigate(isDriver ? '/home/driver' : '/home/rider', { replace: true })
  }

  // ── Send tip ────────────────────────────────────────────────────────────
  const handleSendTip = async () => {
    const cents = tipCents
    if (cents == null || !Number.isFinite(cents) || cents < 100 || cents > 2000) {
      setTipError('Enter between $1 and $20')
      return
    }
    setTipping(true)
    setTipError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setTipError('Not authenticated'); setTipping(false); return }
      const resp = await fetch(`/api/rides/${rideId}/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tip_cents: cents }),
      })
      const body = (await resp.json()) as {
        method?: 'card' | 'wallet'
        stripe_fee_cents?: number
        error?: { message?: string }
      }
      if (!resp.ok) {
        setTipError(body.error?.message ?? 'Tip failed')
        setTipping(false)
        return
      }
      setTipResult({
        method: body.method ?? (willUseCard ? 'card' : 'wallet'),
        cents,
        feeCents: body.stripe_fee_cents,
      })
      setTipSent(true)
      // Wallet path drains the rider's balance — refresh so any other
      // open screen (or the next nav) sees the new amount immediately.
      void refreshProfile()
    } catch {
      setTipError('Network error — try again')
    } finally {
      setTipping(false)
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface" data-testid={testId ?? 'rate-ride'}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  // ── Submitted state ─────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface px-6" data-testid={testId ?? 'rate-ride'}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success">
          <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-text-primary">Thanks for your feedback!</h2>

        {revealed && otherRating ? (
          <div className="rounded-2xl bg-white p-5 shadow-sm text-center" data-testid="revealed-rating">
            <p className="text-sm text-text-secondary mb-2">
              {otherUser?.full_name ?? 'Your match'} rated you
            </p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg
                  key={i}
                  className={`h-6 w-6 ${i <= otherRating.stars ? 'text-warning' : 'text-border'}`}
                  fill={i <= otherRating.stars ? 'currentColor' : 'none'}
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
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary" data-testid="waiting-reveal">
            Your rating will be revealed once they rate you too.
          </p>
        )}

        {/* Tip picker — riders only, when they gave a positive rating.
            Hidden entirely after a successful tip (replaced by confirmation). */}
        {!isDriver && stars >= 4 && (
          tipSent ? (
            <div
              className="w-full max-w-xs rounded-2xl bg-success/10 border border-success/20 px-4 py-3 text-center animate-reveal-up motion-reduce:animate-none"
              data-testid="tip-confirmation"
            >
              <p className="text-sm font-semibold text-success">
                Tip sent — {otherUser?.full_name ?? 'Your driver'} will see it.
              </p>
              {tipResult && (
                <p className="mt-1 text-xs text-success/80" data-testid="tip-method-confirm">
                  {tipResult.method === 'card'
                    ? `Charged $${((tipResult.cents + (tipResult.feeCents ?? 0)) / 100).toFixed(2)} to your card${tipResult.feeCents ? ` (incl. $${(tipResult.feeCents / 100).toFixed(2)} fee)` : ''}`
                    : `$${(tipResult.cents / 100).toFixed(2)} deducted from your wallet`}
                </p>
              )}
            </div>
          ) : (
            <div
              className="w-full max-w-xs rounded-2xl bg-white shadow-sm p-4 space-y-3"
              data-testid="tip-picker"
            >
              <p className="text-sm font-semibold text-text-primary text-center">
                Add a tip for {otherUser?.full_name ?? 'your driver'}?
              </p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '$1', cents: 100 },
                  { label: '$2', cents: 200 },
                  { label: '$5', cents: 500 },
                  { label: 'Custom', cents: -1 },
                ].map(({ label, cents }) => {
                  const active = selectedTip === cents
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setSelectedTip(cents); setTipError(null) }}
                      data-testid={`tip-${label.toLowerCase()}`}
                      // Slice 12: tab-keyboard users had no visible focus
                      // signal — `focus-visible` ring restores it without
                      // affecting mouse/touch users (which would otherwise
                      // see the ring on click).
                      aria-pressed={active}
                      aria-label={label === 'Custom' ? 'Custom tip amount' : `Tip ${label}`}
                      className={`rounded-xl py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                        active
                          ? 'bg-primary text-white'
                          : 'bg-surface text-text-primary'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {selectedTip === -1 && (
                <div className="flex items-center gap-2">
                  <span className="text-text-secondary">$</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    step="0.01"
                    inputMode="decimal"
                    enterKeyHint="done"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    onKeyDown={(e) => {
                      // Slice 11: tap "Done" / Enter on the iOS keyboard
                      // collapses it so the Send Tip button stays reachable.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur()
                      }
                    }}
                    placeholder="1 – 20"
                    data-testid="tip-custom-input"
                    className="flex-1 rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
              )}
              {/* Method preview — appears once a tip amount is picked so the
                  rider knows whether their card or wallet will be hit, and
                  exactly how much (incl. Stripe fee on the card path). */}
              {tipCents != null && tipCents >= 100 && tipCents <= 2000 && (
                <div
                  className="rounded-xl bg-surface px-3 py-2 text-xs text-text-secondary"
                  data-testid="tip-method-preview"
                >
                  {willUseCard ? (
                    <>
                      <p className="text-text-primary font-medium">
                        Charged to your card
                      </p>
                      <p className="mt-0.5">
                        ${(tipCents / 100).toFixed(2)} tip + ${(tipFeeCents / 100).toFixed(2)} processing fee
                        {' = '}
                        <span className="font-semibold">${(tipTotalCents / 100).toFixed(2)}</span>
                      </p>
                    </>
                  ) : walletCovers ? (
                    <p className="text-text-primary font-medium">
                      ${(tipCents / 100).toFixed(2)} from your wallet (no fee)
                    </p>
                  ) : (
                    <p className="text-danger">
                      Add a card or top up your wallet (${(walletBalanceCents / 100).toFixed(2)} available) to tip ${(tipCents / 100).toFixed(2)}
                    </p>
                  )}
                </div>
              )}
              {tipError && (
                <p data-testid="tip-error" className="text-xs text-danger text-center">{tipError}</p>
              )}
              <PrimaryButton
                onClick={() => { void handleSendTip() }}
                disabled={
                  selectedTip == null
                  || (selectedTip === -1 && !customTip)
                  || (tipCents != null && !willUseCard && !walletCovers)
                }
                isLoading={tipping}
                loadingLabel={willUseCard ? 'Charging card…' : 'Sending tip…'}
                className="w-full"
                data-testid="send-tip-button"
              >
                {tipCents != null && willUseCard
                  ? `Send $${(tipCents / 100).toFixed(2)} tip · $${(tipTotalCents / 100).toFixed(2)} charged`
                  : 'Send tip'}
              </PrimaryButton>
            </div>
          )
        )}

        <PrimaryButton
          onClick={handleSkip}
          className="w-full max-w-xs"
          data-testid="done-button"
        >
          Done
        </PrimaryButton>
      </div>
    )
  }

  // ── Main rating form ────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-surface" data-testid={testId ?? 'rate-ride'}>
      {/* Header */}
      <div className="flex flex-col items-center gap-3 px-6 pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
        {otherUser && (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary text-2xl font-bold">
            {otherUser.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
        )}
        <h1 className="text-xl font-bold text-text-primary">
          Rate your {isDriver ? 'rider' : 'driver'}
        </h1>
        {otherUser && (
          <p className="text-text-secondary">{otherUser.full_name}</p>
        )}
      </div>

      {/* Stars */}
      <div className="flex justify-center gap-2 py-4" data-testid="star-row">
        {[1, 2, 3, 4, 5].map((i) => (
          <StarButton
            key={i}
            index={i}
            filled={i <= stars}
            onClick={() => setStars(i)}
          />
        ))}
      </div>

      {/* Tags — only show after stars selected */}
      {stars > 0 && (
        <div className="px-6 py-2" data-testid="tags-section">
          <p className="mb-3 text-sm font-medium text-text-secondary">
            {isPositive ? 'What went well?' : 'What could be improved?'}
          </p>
          <div className="flex flex-wrap gap-2">
            {availableTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                data-testid={`tag-${tag}`}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selectedTags.includes(tag)
                    ? isPositive
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
      {stars > 0 && !isPositive && (
        <div className="px-6 py-3" data-testid="comment-section">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Tell us more (optional)"
            className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none"
            rows={3}
            data-testid="comment-input"
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="px-6 text-center text-sm text-danger" data-testid="rating-error">{error}</p>
      )}

      {/* Actions */}
      <div className="mt-auto space-y-3 px-6 pb-8 pt-6">
        <PrimaryButton
          onClick={handleSubmit}
          className="w-full"
          disabled={stars === 0 || submitting}
          data-testid="submit-button"
        >
          {submitting ? 'Submitting…' : 'Submit Rating'}
        </PrimaryButton>

        <button
          onClick={handleSkip}
          className="w-full text-center text-sm text-text-secondary"
          data-testid="skip-button"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
