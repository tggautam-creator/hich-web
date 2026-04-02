import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import type { Ride, User } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompletedRide {
  ride: Ride
  rider: Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg'>
  rated: boolean
}

interface DriverMultiSummaryFlowProps {
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverMultiSummaryFlow({
  'data-testid': testId = 'driver-multi-summary',
}: DriverMultiSummaryFlowProps) {
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const currentUserId = profile?.id ?? null

  const [completedRides, setCompletedRides] = useState<CompletedRide[]>([])
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState(0) // index into completedRides
  const [ratingStars, setRatingStars] = useState(0)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [phase, setPhase] = useState<'summary' | 'rate'>('summary')

  // ── Fetch completed rides ───────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!scheduleId || !currentUserId) return

    const { data: rides } = await supabase
      .from('rides')
      .select('*')
      .eq('schedule_id', scheduleId)
      .eq('status', 'completed')
      .or('driver_id.eq.' + currentUserId)
      .order('ended_at', { ascending: true })

    if (!rides || rides.length === 0) {
      setLoading(false)
      return
    }

    const riderIds = rides.map((r) => r.rider_id).filter(Boolean) as string[]
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, rating_avg')
      .in('id', [...new Set(riderIds)])

    const userLookup: Record<string, Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg'>> = {}
    for (const u of users ?? []) {
      userLookup[u.id] = u
    }

    // Check which rides have been rated by the driver
    const { data: ratings } = await supabase
      .from('ride_ratings')
      .select('ride_id')
      .in('ride_id', rides.map((r) => r.id))
      .eq('rater_id', currentUserId)

    const ratedRideIds = new Set((ratings ?? []).map((r: { ride_id: string }) => r.ride_id))

    const items: CompletedRide[] = rides
      .filter((r) => r.rider_id)
      .map((r) => ({
        ride: r,
        rider: userLookup[r.rider_id!] ?? { id: r.rider_id!, full_name: 'Rider', avatar_url: null, rating_avg: null },
        rated: ratedRideIds.has(r.id),
      }))

    setCompletedRides(items)

    // Skip to first unrated ride
    const firstUnrated = items.findIndex((i) => !i.rated)
    if (firstUnrated >= 0) {
      setCurrentStep(firstUnrated)
      setPhase('summary')
    } else {
      // All rated — show final summary
      setCurrentStep(items.length)
    }

    setLoading(false)
  }, [scheduleId, currentUserId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // ── Submit rating ─────────────────────────────────────────────────────
  const handleRate = useCallback(async () => {
    const current = completedRides[currentStep]
    if (!current || ratingStars < 1 || submittingRating) return

    setSubmittingRating(true)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    await fetch(`/api/rides/${current.ride.id}/rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: JSON.stringify({ stars: ratingStars }),
    })

    setSubmittingRating(false)
    setRatingStars(0)

    // Move to next ride or finish
    const next = currentStep + 1
    if (next < completedRides.length) {
      setCurrentStep(next)
      setPhase('summary')
    } else {
      setCurrentStep(completedRides.length) // final summary
    }
  }, [completedRides, currentStep, ratingStars, submittingRating])

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (completedRides.length === 0) {
    return (
      <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-text-secondary">No completed rides found</p>
        <button
          type="button"
          onClick={() => navigate('/home/driver', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
        >
          Back to Home
        </button>
      </div>
    )
  }

  // ── Final summary (all rated) ─────────────────────────────────────────
  if (currentStep >= completedRides.length) {
    const totalEarned = completedRides.reduce((sum, cr) => {
      const fare = cr.ride.fare_cents ?? 0
      const platformFee = Math.round(fare * 0.15)
      return sum + (fare - platformFee)
    }, 0)

    return (
      <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm w-full max-w-sm text-center">
          <div className="text-4xl mb-3">🎉</div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Trip Complete!</h2>
          <p className="text-sm text-text-secondary mb-4">
            You completed {completedRides.length} rides this trip
          </p>

          <div className="rounded-2xl bg-success/5 p-4 mb-4">
            <p className="text-xs text-text-secondary">Total Earnings</p>
            <p className="text-2xl font-bold text-success">{formatCents(totalEarned)}</p>
          </div>

          {/* Per-rider breakdown */}
          <div className="space-y-2 mb-6">
            {completedRides.map((cr) => {
              const fare = cr.ride.fare_cents ?? 0
              const earned = fare - Math.round(fare * 0.15)
              return (
                <div key={cr.ride.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2">
                  <span className="text-sm text-text-primary">{cr.rider.full_name}</span>
                  <span className="text-sm font-semibold text-success">{formatCents(earned)}</span>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => navigate('/home/driver', { replace: true })}
            className="w-full rounded-2xl bg-primary py-3 font-semibold text-white"
            data-testid="done-button"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Current ride summary / rating ────────────────────────────────────
  const current = completedRides[currentStep]!
  const fare = current.ride.fare_cents ?? 0
  const platformFee = Math.round(fare * 0.15)
  const driverEarns = fare - platformFee
  const initial = current.rider.full_name?.[0]?.toUpperCase() ?? '?'

  if (phase === 'summary') {
    return (
      <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm w-full max-w-sm">
          {/* Progress */}
          <p className="text-xs text-text-secondary text-center mb-4">
            Ride {currentStep + 1} of {completedRides.length}
          </p>

          {/* Rider info */}
          <div className="flex items-center gap-3 mb-4">
            {current.rider.avatar_url ? (
              <img src={current.rider.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
                {initial}
              </div>
            )}
            <div>
              <p className="font-semibold text-text-primary">{current.rider.full_name}</p>
              {current.rider.rating_avg != null && (
                <p className="text-xs text-text-secondary">★ {current.rider.rating_avg.toFixed(1)}</p>
              )}
            </div>
          </div>

          {/* Fare breakdown */}
          <div className="rounded-2xl bg-surface p-4 space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Ride fare</span>
              <span className="text-text-primary">{formatCents(fare)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Platform fee (15%)</span>
              <span className="text-danger">-{formatCents(platformFee)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-sm font-bold">
              <span className="text-text-primary">You earned</span>
              <span className="text-success">{formatCents(driverEarns)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (current.rated) {
                // Skip rating, move to next
                const next = currentStep + 1
                if (next < completedRides.length) {
                  setCurrentStep(next)
                } else {
                  setCurrentStep(completedRides.length)
                }
              } else {
                setPhase('rate')
              }
            }}
            className="w-full rounded-2xl bg-primary py-3 font-semibold text-white"
            data-testid="continue-button"
          >
            {current.rated ? 'Next' : 'Rate Rider'}
          </button>
        </div>
      </div>
    )
  }

  // ── Rate phase ────────────────────────────────────────────────────────
  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6">
      <div className="rounded-3xl bg-white p-6 shadow-sm w-full max-w-sm text-center">
        <p className="text-xs text-text-secondary mb-2">
          Ride {currentStep + 1} of {completedRides.length}
        </p>
        <h2 className="text-lg font-bold text-text-primary mb-1">Rate {current.rider.full_name}</h2>
        <p className="text-sm text-text-secondary mb-6">How was your experience?</p>

        {/* Stars */}
        <div className="flex justify-center gap-3 mb-6">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRatingStars(star)}
              className={`text-3xl transition-transform ${star <= ratingStars ? 'text-warning scale-110' : 'text-border'}`}
              data-testid={`star-${star}`}
            >
              ★
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void handleRate()}
          disabled={ratingStars < 1 || submittingRating}
          className="w-full rounded-2xl bg-primary py-3 font-semibold text-white disabled:opacity-50"
          data-testid="submit-rating-button"
        >
          {submittingRating ? 'Submitting…' : 'Submit Rating'}
        </button>
      </div>
    </div>
  )
}
