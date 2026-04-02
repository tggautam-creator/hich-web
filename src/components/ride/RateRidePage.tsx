import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
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
