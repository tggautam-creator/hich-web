import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { haversineMetres } from '@/lib/geo'
import { reverseGeocode } from '@/lib/geocode'
import { formatDate, formatTime } from '@/components/schedule/boardHelpers'
import type { Ride, User } from '@/types/database'

interface ScheduleInfo {
  origin_address: string
  dest_address: string
  route_name: string
  trip_date: string
  trip_time: string
  time_type: 'departure' | 'arrival'
}

interface BoardRequestReviewProps {
  'data-testid'?: string
}

/** Convert metres to a human string */
function formatDistance(metres: number): string {
  const miles = metres / 1609.34
  if (miles < 0.1) return 'on your route'
  return `${miles.toFixed(1)} mi from your route`
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
  const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pickupAddress, setPickupAddress] = useState<string | null>(null)

  const currentUserId = profile?.id ?? null

  // Determine if the poster is the driver or rider in this ride
  const posterIsDriver = currentUserId === ride?.driver_id

  // Compute distance from driver's destination to rider's requested destination
  const distanceInfo = useMemo(() => {
    if (!ride?.requester_destination) return null
    // For board rides, driver_destination may be null — fall back to ride.destination
    const driverGeo = ride.driver_destination ?? ride.destination
    if (!driverGeo) return null
    const riderCoords = ride.requester_destination.coordinates
    const driverCoords = driverGeo.coordinates
    // GeoJSON is [lng, lat]
    const metres = haversineMetres(
      riderCoords[1], riderCoords[0],
      driverCoords[1], driverCoords[0],
    )
    return { metres, label: formatDistance(metres) }
  }, [ride?.requester_destination, ride?.driver_destination, ride?.destination])

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

      // Fetch linked schedule for full route/date/time info
      if (rideData.schedule_id) {
        const { data: schedData } = await supabase
          .from('ride_schedules')
          .select('origin_address, dest_address, route_name, trip_date, trip_time, time_type')
          .eq('id', rideData.schedule_id)
          .single()

        if (schedData) setScheduleInfo(schedData as ScheduleInfo)
      }

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

      // Reverse-geocode rider pickup point for display
      const origin = rideData.origin as { coordinates: [number, number] } | null
      if (origin) {
        void reverseGeocode(origin.coordinates[1], origin.coordinates[0]).then((addr) => {
          if (addr) setPickupAddress(addr)
        })
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

  // ── Counter (accept + navigate to dropoff selection) ─────────────────────
  async function handleCounter() {
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

      // Navigate to dropoff selection with location context
      // For board rides, driver_destination may be null — fall back to ride.destination
      // (which is the driver's schedule destination set during request creation)
      const driverDest = ride?.driver_destination?.coordinates ?? ride?.destination?.coordinates
      const riderDest = ride?.requester_destination?.coordinates
      const pickup = ride?.origin?.coordinates

      navigate(`/ride/dropoff/${rideId}`, {
        replace: true,
        state: {
          ...(driverDest ? { driverDestLat: driverDest[1], driverDestLng: driverDest[0] } : {}),
          driverDestName: scheduleInfo?.dest_address ?? ride?.destination_name ?? '',
          ...(riderDest ? { riderDestLat: riderDest[1], riderDestLng: riderDest[0] } : {}),
          riderDestName: ride?.requester_destination_name ?? null,
          riderName: otherUser?.full_name ?? null,
          ...(pickup ? { pickupLat: pickup[1], pickupLng: pickup[0] } : {}),
        },
      })
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

      <div className="flex-1 overflow-y-auto pb-4">
        {/* ── Requester card ──────────────────────────────────────────────── */}
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

        {/* ── Rider context (destination, note, pickup) ───────────────────── */}
        {posterIsDriver && (
          <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="rider-context">
            <p className="text-xs text-text-secondary font-semibold uppercase tracking-wider mb-3">Rider Details</p>

            {/* Rider pickup location */}
            {ride.origin && (
              <div className="flex items-start gap-2 mb-3" data-testid="rider-pickup">
                <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-success/10">
                  <span className="text-success text-xs">●</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary font-medium">Pickup</p>
                  <p className="text-sm text-text-primary">
                    {pickupAddress ?? 'Rider\'s current location'}
                  </p>
                </div>
              </div>
            )}

            {/* Rider destination */}
            <div className="flex items-start gap-2 mb-3" data-testid="rider-destination">
              <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger/10">
                <span className="text-danger text-xs">●</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-secondary font-medium">Destination</p>
                {ride.destination_flexible ? (
                  <div className="mt-1 flex items-center gap-1.5 rounded-xl bg-primary/5 border border-primary/15 px-2.5 py-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <p className="text-xs text-primary font-medium" data-testid="destination-flexible-badge">Flexible — will discuss in chat</p>
                  </div>
                ) : ride.requester_destination_name ? (
                  <p className="text-sm text-text-primary" data-testid="destination-name">{ride.requester_destination_name}</p>
                ) : (
                  <p className="text-sm text-text-secondary italic">Not specified</p>
                )}
              </div>
            </div>

            {/* Distance from route */}
            {distanceInfo && (
              <div className="flex items-center gap-2 mb-3 rounded-xl bg-surface px-3 py-2" data-testid="distance-info">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <p className="text-xs text-text-secondary">{distanceInfo.label}</p>
              </div>
            )}

            {/* Rider note */}
            {ride.requester_note && (
              <div className="rounded-xl bg-surface border border-border/50 px-3 py-2.5" data-testid="rider-note">
                <p className="text-xs text-text-secondary font-medium mb-1">Note from rider</p>
                <p className="text-sm text-text-primary">{ride.requester_note}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Route info ──────────────────────────────────────────────────── */}
        <div className="mx-4 mt-3 rounded-2xl bg-white p-4 shadow-sm" data-testid="ride-details">
          <p className="text-xs text-text-secondary font-semibold uppercase tracking-wider mb-3">
            {posterIsDriver ? 'Your Posted Route' : 'Ride Details'}
          </p>

          {scheduleInfo?.route_name && (
            <p className="text-sm font-semibold text-text-primary mb-3">{scheduleInfo.route_name}</p>
          )}

          <div className="space-y-1.5 mb-3">
            <div className="flex items-start gap-2">
              <span className="text-success mt-0.5 text-sm">●</span>
              <p className="text-sm text-text-primary">{scheduleInfo?.origin_address ?? 'Origin TBD'}</p>
            </div>
            <div className="ml-[5px] h-3 border-l border-dashed border-text-secondary/30" />
            <div className="flex items-start gap-2">
              <span className="text-danger mt-0.5 text-sm">●</span>
              <p className="text-sm text-text-primary">{scheduleInfo?.dest_address ?? ride.destination_name ?? 'Destination TBD'}</p>
            </div>
          </div>

          {(scheduleInfo?.trip_date ?? ride.trip_date) && (
            <div className="flex items-center gap-3 text-xs text-text-secondary">
              <span>{formatDate(scheduleInfo?.trip_date ?? ride.trip_date ?? '')}</span>
              {(scheduleInfo?.trip_time ?? ride.trip_time) && (
                <span>
                  {scheduleInfo?.time_type === 'arrival' ? 'Arrives' : 'Departs'}{' '}
                  {formatTime(scheduleInfo?.trip_time ?? ride.trip_time ?? '')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ─────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-t border-border px-4 pt-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 2rem)' }}
      >
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={submitting}
          className="mb-2.5 w-full rounded-2xl bg-success py-3.5 text-center font-semibold text-white active:opacity-90 disabled:opacity-50"
          data-testid="accept-button"
        >
          {submitting ? 'Accepting…' : posterIsDriver ? 'Accept Rider' : 'Accept Ride'}
        </button>

        {/* Counter button — only for drivers who can suggest a transit drop-off */}
        {posterIsDriver && (
          <button
            type="button"
            onClick={() => void handleCounter()}
            disabled={submitting}
            className="mb-2.5 w-full rounded-2xl border-2 border-primary py-3 text-center font-semibold text-primary active:bg-primary active:text-white disabled:opacity-50"
            data-testid="counter-button"
          >
            Suggest Drop-off
          </button>
        )}

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
