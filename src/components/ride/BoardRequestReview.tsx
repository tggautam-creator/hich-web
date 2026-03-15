import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { Ride, User } from '@/types/database'

interface BoardRequestReviewProps {
  'data-testid'?: string
}

export default function BoardRequestReview({
  'data-testid': testId = 'board-request-review',
}: BoardRequestReviewProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const isDriver = useAuthStore((s) => s.isDriver)

  const [ride, setRide] = useState<Ride | null>(null)
  const [otherUser, setOtherUser] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const currentUserId = profile?.id ?? null

  // Determine if the poster is the driver or rider in this ride
  const posterIsDriver = currentUserId === ride?.driver_id

  // ── Fetch ride + requester info ──────────────────────────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate(isDriver ? '/home/driver' : '/home/rider', { replace: true })
      return
    }

    async function fetchData() {
      const { data: rideData, error: rideErr } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId as string)
        .single()

      if (rideErr || !rideData) {
        setError('Could not load ride details')
        setLoading(false)
        return
      }

      setRide(rideData)

      // Determine the other party (the requester)
      const otherId = profile?.id === rideData.rider_id
        ? rideData.driver_id
        : rideData.rider_id

      if (otherId) {
        const { data: userData } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .eq('id', otherId)
          .single()

        if (userData) setOtherUser(userData)
      }

      setLoading(false)
    }

    void fetchData()
  }, [rideId, navigate, profile?.id, isDriver])

  // ── Decline ────────────────────────────────────────────────────────────────
  const handleDecline = useCallback(async () => {
    if (!rideId || submitting) return
    setSubmitting(true)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      await fetch('/api/schedule/decline-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })
    } catch {
      // non-fatal — navigate away regardless
    }

    navigate(isDriver ? '/home/driver' : '/home/rider', { replace: true })
  }, [rideId, submitting, navigate, isDriver])

  // ── Accept ─────────────────────────────────────────────────────────────────
  async function handleAccept() {
    if (!rideId || submitting) return
    setSubmitting(true)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/api/schedule/accept-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to accept')
        setSubmitting(false)
        return
      }

      navigate(`/ride/messaging/${rideId}`, { replace: true })
    } catch {
      setError('Network error — could not accept')
      setSubmitting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error || !ride) {
    return (
      <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'Ride not found'}</p>
        <button
          type="button"
          onClick={() => navigate(isDriver ? '/home/driver' : '/home/rider', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white"
        >
          Back to Home
        </button>
      </div>
    )
  }

  const initial = otherUser?.full_name?.[0]?.toUpperCase() ?? '?'
  const otherRating = otherUser?.rating_avg?.toFixed(1) ?? '–'
  const otherRideCount = otherUser?.rating_count ?? 0

  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col bg-surface font-sans">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-b border-border px-4 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            data-testid="back-button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-text-secondary"
          >
            ← Back
          </button>
        </div>

        <h1 className="mt-3 text-lg font-bold text-text-primary text-center">
          {posterIsDriver ? 'Ride Request' : 'Ride Offer'}
        </h1>
        <p className="mt-1 text-sm text-text-secondary text-center">
          {posterIsDriver
            ? `${otherUser?.full_name ?? 'Someone'} wants to join your ride`
            : `${otherUser?.full_name ?? 'Someone'} offered to drive you`}
        </p>
      </div>

      {/* ── Requester card ──────────────────────────────────────────────────── */}
      <div className="mx-4 mt-4 rounded-2xl bg-white p-4 shadow-sm" data-testid="requester-card">
        <div className="flex items-center gap-3">
          {otherUser?.avatar_url ? (
            <img
              src={otherUser.avatar_url}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xl">
              {initial}
            </div>
          )}
          <div className="flex-1">
            <p className="font-semibold text-text-primary text-base" data-testid="requester-name">
              {otherUser?.full_name ?? (posterIsDriver ? 'Rider' : 'Driver')}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-warning">★</span>
              <span className="text-sm text-text-secondary" data-testid="requester-rating">
                {otherRating}
              </span>
              <span className="text-xs text-text-secondary">
                ({otherRideCount} rides)
              </span>
            </div>
          </div>
          <div className={[
            'px-3 py-1.5 rounded-full text-xs font-semibold',
            posterIsDriver ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success',
          ].join(' ')}>
            {posterIsDriver ? 'Rider' : 'Driver'}
          </div>
        </div>
      </div>

      {/* ── Route info ──────────────────────────────────────────────────────── */}
      <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-xs text-text-secondary font-semibold uppercase tracking-wider mb-3">Ride Details</p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">📍</span>
            <p className="text-sm text-text-primary">{ride.destination_name ?? 'Destination TBD'}</p>
          </div>
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div className="mt-auto px-4 pb-8 pt-4">
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={submitting}
          className="mb-3 w-full rounded-2xl bg-success py-3.5 text-center font-semibold text-white active:opacity-90 disabled:opacity-50"
          data-testid="accept-button"
        >
          {submitting ? 'Accepting…' : posterIsDriver ? 'Accept Rider' : 'Accept Ride'}
        </button>
        <button
          type="button"
          onClick={() => void handleDecline()}
          disabled={submitting}
          className="w-full rounded-2xl border-2 border-danger py-3 text-center font-semibold text-danger active:bg-danger active:text-white disabled:opacity-50"
          data-testid="decline-button"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
