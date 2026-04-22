import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import DriverQrSheet from '@/components/ride/DriverQrSheet'
import { haversineMetres } from '@/lib/geo'
import { formatCents } from '@/lib/fare'
import { trackEvent } from '@/lib/analytics'
import type { Ride, User } from '@/types/database'

// Threshold before surfacing the "GPS weak" banner. 3 consecutive misses at
// 10s cadence = 30s of silence — matches what the fare-distance integrator
// considers a meaningful gap.
const GPS_WEAK_THRESHOLD = 3

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderInfo extends Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> {
  ride: Ride
}

interface DriverMultiRidePageProps {
  'data-testid'?: string
}

const RIDER_COLORS = ['#22C55E', '#4F46E5'] as const // green, blue

function statusLabel(status: string): string {
  switch (status) {
    case 'coordinating': case 'accepted': case 'requested': return 'Waiting'
    case 'active': return 'In car'
    case 'completed': return 'Dropped off'
    case 'cancelled': case 'expired': return 'Cancelled'
    default: return status
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'coordinating': case 'accepted': case 'requested': return 'bg-warning/10 text-warning'
    case 'active': return 'bg-success/10 text-success'
    case 'completed': return 'bg-primary/10 text-primary'
    default: return 'bg-border text-text-secondary'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverMultiRidePage({
  'data-testid': testId = 'driver-multi-ride',
}: DriverMultiRidePageProps) {
  const { scheduleId } = useParams<{ scheduleId: string }>()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [riders, setRiders] = useState<RiderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)

  // Driver GPS
  const [driverLat, setDriverLat] = useState<number | null>(null)
  const [driverLng, setDriverLng] = useState<number | null>(null)

  // GPS ping health — R.8. Count consecutive ping failures so the UI can
  // surface a "GPS weak" banner and we emit a PostHog signal once.
  const [gpsWeak, setGpsWeak] = useState(false)
  const pingFailStreakRef = useRef(0)
  const weakEventEmittedRef = useRef(false)

  const currentUserId = profile?.id ?? null

  // ── Fetch all rides for this schedule ─────────────────────────────────────
  const fetchRides = useCallback(async () => {
    if (!scheduleId || !currentUserId) return

    const { data: rides, error: ridesErr } = await supabase
      .from('rides')
      .select('*')
      .eq('schedule_id', scheduleId)
      .or('driver_id.eq.' + currentUserId + ',rider_id.eq.' + currentUserId)
      .in('status', ['requested', 'accepted', 'coordinating', 'active', 'completed'])
      .order('created_at', { ascending: true })

    if (ridesErr || !rides) {
      setError('Could not load rides')
      setLoading(false)
      return
    }

    // Fetch rider info for each ride
    const riderIds = rides.map((r) => r.rider_id).filter(Boolean) as string[]
    const uniqueRiderIds = [...new Set(riderIds)]

    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, rating_avg, rating_count')
      .in('id', uniqueRiderIds)

    const userLookup: Record<string, { id: string; full_name: string | null; avatar_url: string | null; rating_avg: number | null; rating_count: number }> = {}
    for (const u of users ?? []) {
      userLookup[u.id] = u
    }

    const riderInfos: RiderInfo[] = rides
      .filter((r) => r.rider_id && r.rider_id !== currentUserId)
      .map((r) => {
        const user = userLookup[r.rider_id!]
        return {
          id: user?.id ?? r.rider_id!,
          full_name: user?.full_name ?? 'Rider',
          avatar_url: user?.avatar_url ?? null,
          rating_avg: user?.rating_avg ?? null,
          rating_count: user?.rating_count ?? 0,
          ride: r,
        }
      })

    // Sort by optimal pickup: closest first (haversine from driver GPS)
    if (driverLat != null && driverLng != null) {
      riderInfos.sort((a, b) => {
        const aOrigin = a.ride.origin as { coordinates: [number, number] } | null
        const bOrigin = b.ride.origin as { coordinates: [number, number] } | null
        if (!aOrigin || !bOrigin) return 0
        const aDist = haversineMetres(driverLat, driverLng, aOrigin.coordinates[1], aOrigin.coordinates[0])
        const bDist = haversineMetres(driverLat, driverLng, bOrigin.coordinates[1], bOrigin.coordinates[0])
        return aDist - bDist
      })
    }

    setRiders(riderInfos)
    setLoading(false)
  }, [scheduleId, currentUserId, driverLat, driverLng])

  useEffect(() => {
    void fetchRides()
  }, [fetchRides])

  // ── Driver GPS ────────────────────────────────────────────────────────────
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setDriverLat(pos.coords.latitude)
        setDriverLng(pos.coords.longitude)
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ── Realtime: listen for ride updates ────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return

    const ch = supabase.channel(`driver-active:${currentUserId}`)
      .on('broadcast', { event: 'rider_ride_ended' }, () => {
        void fetchRides()
      })
      .on('broadcast', { event: 'ride_started' }, () => {
        void fetchRides()
      })
      .subscribe()

    // Also listen on the main rider channel for full ride_ended
    const ch2 = supabase.channel(`rider:${currentUserId}:multi`)
      .on('broadcast', { event: 'ride_ended' }, () => {
        void fetchRides()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(ch)
      void supabase.removeChannel(ch2)
    }
  }, [currentUserId, fetchRides])

  // ── Poll for status changes ──────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => { void fetchRides() }, 10_000)
    return () => clearInterval(interval)
  }, [fetchRides])

  // ── Send GPS pings for all active rides (fare distance tracking) ────────
  useEffect(() => {
    const activeRideIds = riders
      .filter((r) => r.ride.status === 'active')
      .map((r) => r.ride.id)

    if (activeRideIds.length === 0 || driverLat === null || driverLng === null) return

    const sendPings = async () => {
      if (driverLat === null || driverLng === null) return
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const results = await Promise.all(activeRideIds.map((id) =>
        fetch(`/api/rides/${id}/gps-ping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ lat: driverLat, lng: driverLng }),
        })
          .then((r) => r.ok)
          .catch(() => false),
      ))

      const allFailed = results.length > 0 && results.every((ok) => !ok)
      if (allFailed) {
        pingFailStreakRef.current += 1
        if (pingFailStreakRef.current >= GPS_WEAK_THRESHOLD && !weakEventEmittedRef.current) {
          weakEventEmittedRef.current = true
          trackEvent('gps_ping_failed', {
            schedule_id: scheduleId,
            consecutive_failures: pingFailStreakRef.current,
            active_ride_count: activeRideIds.length,
          })
          setGpsWeak(true)
        }
      } else {
        pingFailStreakRef.current = 0
        if (weakEventEmittedRef.current) {
          weakEventEmittedRef.current = false
          setGpsWeak(false)
        }
      }
    }

    void sendPings()
    const interval = setInterval(() => { void sendPings() }, 10_000)
    return () => clearInterval(interval)
  }, [riders, driverLat, driverLng, scheduleId])

  // ── Derive summary stats ─────────────────────────────────────────────────
  const activeRiders = riders.filter((r) => r.ride.status === 'active')
  const waitingRiders = riders.filter((r) => ['coordinating', 'accepted', 'requested'].includes(r.ride.status))
  const completedRiders = riders.filter((r) => r.ride.status === 'completed')
  const allDone = riders.length > 0 && activeRiders.length === 0 && waitingRiders.length === 0

  // Navigate to multi-summary when all rides are done
  useEffect(() => {
    if (allDone && completedRiders.length > 0 && scheduleId) {
      navigate(`/ride/multi-summary/${scheduleId}`, { replace: true })
    }
  }, [allDone, completedRiders.length, scheduleId, navigate])

  // ── Loading / Error ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error || riders.length === 0) {
    return (
      <div data-testid={testId} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'No rides found'}</p>
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

  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col bg-surface font-sans">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-b border-border px-4 pb-3 z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 rounded-full active:bg-surface"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-text-primary flex-1">Multi-Rider Trip</h1>
          <span className="text-xs font-semibold text-text-secondary">
            {activeRiders.length} active · {waitingRiders.length} waiting · {completedRiders.length} done
          </span>
        </div>
        {gpsWeak && (
          <div
            role="status"
            data-testid="gps-weak-banner"
            className="mt-2 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
              <path d="M12 18h.01" /><path d="M5 12.55a11 11 0 0 1 14 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            </svg>
            <span>GPS weak — fare distance tracking may be affected. Check signal.</span>
          </div>
        )}
      </div>

      {/* ── Rider cards ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <p className="text-xs text-text-secondary font-semibold uppercase tracking-wider">
          Pickup Order (closest first)
        </p>

        {riders.map((r, i) => {
          const initial = r.full_name?.[0]?.toUpperCase() ?? '?'
          const color = RIDER_COLORS[i % RIDER_COLORS.length]
          const fare = r.ride.fare_cents

          return (
            <div
              key={r.ride.id}
              data-testid="rider-card"
              className="rounded-2xl bg-white p-3.5 shadow-sm"
            >
              <div className="flex items-center gap-3">
                {/* Order number */}
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white font-bold text-xs shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {i + 1}
                </div>

                {/* Avatar */}
                {r.avatar_url ? (
                  <img src={r.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {initial}
                  </div>
                )}

                {/* Name + rating */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary text-sm truncate">{r.full_name}</p>
                  {r.rating_avg != null && (
                    <p className="text-xs text-text-secondary">★ {r.rating_avg.toFixed(1)}</p>
                  )}
                </div>

                {/* Status badge */}
                <div className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusColor(r.ride.status)}`}>
                  {statusLabel(r.ride.status)}
                </div>
              </div>

              {/* Pickup + destination info */}
              <div className="mt-2 pl-10 space-y-0.5">
                {/* Confirmed pickup from chat */}
                {r.ride.pickup_confirmed ? (
                  <p className="text-xs text-success font-medium truncate">
                    ✓ Pickup{r.ride.pickup_note ? `: ${r.ride.pickup_note}` : ' confirmed'}
                  </p>
                ) : r.ride.pickup_point ? (
                  <p className="text-xs text-warning font-medium truncate">
                    Pickup proposed (not confirmed)
                  </p>
                ) : null}

                {/* Destination */}
                {r.ride.requester_destination_name ? (
                  <p className="text-xs text-text-secondary truncate">→ {r.ride.requester_destination_name}</p>
                ) : r.ride.destination_flexible ? (
                  <p className="text-xs text-primary">Flexible destination</p>
                ) : null}

                {r.ride.status === 'completed' && fare != null && (
                  <p className="text-xs font-semibold text-success mt-1">Earned {formatCents(fare)}</p>
                )}

                {r.ride.requester_note && (
                  <p className="text-xs text-text-secondary mt-1 italic">&ldquo;{r.ride.requester_note}&rdquo;</p>
                )}
              </div>

              {/* Action buttons per rider */}
              <div className="mt-2.5 pl-10 flex gap-2">
                {r.ride.status === 'requested' ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/ride/board-review/${r.ride.id}`)}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold text-primary bg-primary/5 active:bg-primary/10"
                    data-testid="review-request-button"
                  >
                    Review Request
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(`/ride/messaging/${r.ride.id}`)}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold text-primary bg-primary/5 active:bg-primary/10"
                    data-testid="chat-rider-button"
                  >
                    Chat
                  </button>
                )}
                {(r.ride.status === 'coordinating' || r.ride.status === 'accepted') && (
                  <button
                    type="button"
                    onClick={() => {
                      // Prefer confirmed pickup_point from chat, fall back to rider's origin
                      const pickup = (r.ride.pickup_point ?? r.ride.origin) as { coordinates: [number, number] } | null
                      if (pickup) {
                        const [lng, lat] = pickup.coordinates
                        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank')
                      }
                    }}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold text-white bg-success active:bg-success/90"
                    data-testid="navigate-rider-button"
                  >
                    {r.ride.pickup_confirmed ? 'Navigate to Pickup ✓' : 'Navigate to Pickup'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Bottom actions ──────────────────────────────────────────────────── */}
      <div
        className="bg-white border-t border-border px-4 pt-3 flex gap-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        {riders.length > 1 && (
          <button
            type="button"
            onClick={() => navigate(`/ride/group-chat/${scheduleId}`)}
            className="flex-1 rounded-2xl border-2 border-primary py-3 text-center text-sm font-semibold text-primary active:bg-primary/5"
            data-testid="group-chat-button"
          >
            Group Chat
          </button>
        )}
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="flex-1 rounded-2xl bg-primary py-3 text-center text-sm font-semibold text-white active:bg-primary/90"
          data-testid="show-qr-button"
        >
          Show QR Code
        </button>
      </div>

      {/* QR Sheet */}
      <DriverQrSheet
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        driverId={currentUserId ?? ''}
      />
    </div>
  )
}
