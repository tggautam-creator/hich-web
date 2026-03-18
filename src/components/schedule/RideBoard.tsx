import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import BottomSheet from '@/components/ui/BottomSheet'
import type { DriverRoutine } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideBoardProps {
  'data-testid'?: string
}

interface Poster {
  id: string
  full_name: string | null
  avatar_url: string | null
  rating_avg: number | null
  is_driver: boolean
}

interface ScheduledRide {
  id: string
  user_id: string
  mode: 'driver' | 'rider'
  route_name: string
  origin_address: string
  dest_address: string
  direction_type: 'one_way' | 'roundtrip'
  trip_date: string
  time_type: 'departure' | 'arrival'
  trip_time: string
  created_at: string
  poster: Poster | null
  relevance_score?: number
  already_requested?: boolean
  ride_status?: string | null
  ride_id?: string | null
}

type TabFilter = 'all' | 'drivers' | 'riders'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format "2026-03-15" → "Mar 15" */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Format "14:30:00" → "2:30 PM" */
function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  if (h === undefined || m === undefined) return timeStr
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Format day_of_week array → "Mon, Wed, Fri" */
function formatDays(days: number[]): string {
  return [...days].sort((a, b) => a - b).map((d) => SHORT_DAYS[d] ?? '?').join(', ')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RideBoard({ 'data-testid': testId }: RideBoardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const isDriver = useAuthStore((s) => s.isDriver)

  // Determine which tab context we came from (rider home = 'home', driver home = 'drive')
  const fromTab = (location.state as { fromTab?: string } | null)?.fromTab
  const activeNavTab = fromTab === 'drive' ? 'drive' as const : fromTab === 'home' ? 'home' as const : isDriver ? 'drive' as const : 'home' as const
  // For "Post Ride" — use the context: if came from home tab, post as rider; from drive tab, post as driver
  const postAsDriver = activeNavTab === 'drive'

  const [rides, setRides] = useState<ScheduledRide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabFilter>('all')

  // Confirmation sheet state
  const [confirmRide, setConfirmRide] = useState<ScheduledRide | null>(null)

  // Success banner
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null)

  // ── Routines sheet state ─────────────────────────────────────────────────
  const [routinesOpen, setRoutinesOpen] = useState(false)
  const [routines, setRoutines] = useState<DriverRoutine[]>([])
  const [routinesLoading, setRoutinesLoading] = useState(false)
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<DriverRoutine | null>(null)
  const [editName, setEditName] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editTimeType, setEditTimeType] = useState<'departure' | 'arrival'>('departure')
  const [editDays, setEditDays] = useState<number[]>([])
  const [editSaving, setEditSaving] = useState(false)

  // Get user's location for relevance sorting + ride creation
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        },
        () => { /* location not available — non-fatal */ },
        { enableHighAccuracy: false, timeout: 5000 },
      )
    }
  }, [])

  // ── Send ride request ──────────────────────────────────────────────────────
  const handleConfirmRequest = useCallback(async () => {
    if (!confirmRide) return
    setRequestingId(confirmRide.id)
    setRequestError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setRequestError('Not authenticated')
        setRequestingId(null)
        return
      }

      const loc = userLocationRef.current
      const resp = await fetch('/api/schedule/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          schedule_id: confirmRide.id,
          ...(loc ? { origin_lat: loc.lat, origin_lng: loc.lng } : {}),
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { message?: string } }
        setRequestError(body.error?.message ?? 'Failed to send request')
        setRequestingId(null)
        setConfirmRide(null)
        return
      }

      // Success — mark as already_requested locally, show confirmation
      const isDriverPost = confirmRide.mode === 'driver'
      setRides((prev) => prev.map((r) => r.id === confirmRide.id ? { ...r, already_requested: true } : r))
      setSuccessMessage(isDriverPost ? 'Request sent! They\'ll see it in their notifications.' : 'Offer sent! They\'ll see it in their notifications.')
      setConfirmRide(null)
      setRequestingId(null)

      // Auto-dismiss success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setRequestError('Network error — please try again.')
      setRequestingId(null)
      setConfirmRide(null)
    }
  }, [confirmRide])

  // ── Delete own schedule ───────────────────────────────────────────────────
  const handleDeleteSchedule = useCallback(async (scheduleId: string) => {
    setDeletingId(scheduleId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/schedule/${scheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (resp.ok) {
        setRides((prev) => prev.filter((r) => r.id !== scheduleId))
        setSuccessMessage('Schedule deleted.')
        setTimeout(() => setSuccessMessage(null), 3000)
      } else {
        const body = (await resp.json()) as { error?: { message?: string } }
        setRequestError(body.error?.message ?? 'Failed to delete')
      }
    } catch {
      setRequestError('Network error — please try again.')
    } finally {
      setDeletingId(null)
    }
  }, [])

  // ── Routines: fetch ────────────────────────────────────────────────────────
  const fetchRoutines = useCallback(async () => {
    if (!profile?.id) return
    setRoutinesLoading(true)
    const { data, error: err } = await supabase
      .from('driver_routines')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (!err && data) setRoutines(data as unknown as DriverRoutine[])
    setRoutinesLoading(false)
  }, [profile?.id])

  const handleDeleteRoutine = useCallback(async (id: string) => {
    setDeletingRoutineId(id)
    await supabase.from('driver_routines').update({ is_active: false }).eq('id', id)
    setRoutines((prev) => prev.filter((r) => r.id !== id))
    setDeletingRoutineId(null)
  }, [])

  const handleStartEdit = useCallback((routine: DriverRoutine) => {
    setEditingRoutine(routine)
    setEditName(routine.route_name)
    const time = routine.departure_time ?? routine.arrival_time ?? ''
    setEditTime(time.slice(0, 5)) // "HH:MM:SS" → "HH:MM"
    setEditTimeType(routine.departure_time ? 'departure' : 'arrival')
    setEditDays([...routine.day_of_week])
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingRoutine || !editName.trim() || !editTime || editDays.length === 0) return
    setEditSaving(true)
    const { error: err } = await supabase
      .from('driver_routines')
      .update({
        route_name: editName.trim(),
        day_of_week: editDays,
        departure_time: editTimeType === 'departure' ? `${editTime}:00` : null,
        arrival_time: editTimeType === 'arrival' ? `${editTime}:00` : null,
      })
      .eq('id', editingRoutine.id)
    if (!err) {
      setRoutines((prev) =>
        prev.map((r) =>
          r.id === editingRoutine.id
            ? { ...r, route_name: editName.trim(), day_of_week: editDays, departure_time: editTimeType === 'departure' ? `${editTime}:00` : null, arrival_time: editTimeType === 'arrival' ? `${editTime}:00` : null }
            : r,
        ),
      )
      setEditingRoutine(null)
    }
    setEditSaving(false)
  }, [editingRoutine, editName, editTime, editTimeType, editDays])

  const toggleEditDay = useCallback((day: number) => {
    setEditDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])
  }, [])

  // ── Fetch rides ────────────────────────────────────────────────────────────
  const fetchRides = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setLoading(false)
        return
      }
      const modeParam = tab === 'drivers' ? 'driver' : tab === 'riders' ? 'rider' : ''
      const params = new URLSearchParams()
      if (modeParam) params.set('mode', modeParam)
      const loc = userLocationRef.current
      if (loc) {
        params.set('lat', String(loc.lat))
        params.set('lng', String(loc.lng))
      }
      const qs = params.toString()
      const url = qs ? `/api/schedule/board?${qs}` : '/api/schedule/board'
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        setError('Failed to load rides')
        setLoading(false)
        return
      }
      const body = (await resp.json()) as { rides: ScheduledRide[] }
      setRides(body.rides)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void fetchRides()
  }, [fetchRides])

  // Realtime: refresh board when ride status changes or on tab focus
  useEffect(() => {
    if (!profile?.id) return

    const channel = supabase
      .channel(`board-page:${profile.id}`)
      .on('broadcast', { event: 'ride_status_changed' }, () => {
        void fetchRides()
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        void fetchRides()
      })
      .subscribe()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchRides()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [profile?.id, fetchRides])

  const handleOpenRoutines = useCallback(async () => {
    setRoutinesOpen(true)
    void fetchRoutines()

    // Sync routine → board entries in the background
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/schedule/sync-routines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        const body = (await resp.json()) as { synced: number }
        if (body.synced > 0) {
          void fetchRides()
        }
      }
    } catch {
      // non-fatal
    }
  }, [fetchRoutines, fetchRides])

  const tabClass = (t: TabFilter) => [
    'flex-1 py-2.5 text-sm font-semibold rounded-2xl transition-colors',
    tab === t
      ? 'bg-primary text-white'
      : 'bg-white text-text-secondary border border-border',
  ].join(' ')

  // Count rides by type for tab badges
  const driverCount = rides.filter(r => r.mode === 'driver').length
  const riderCount  = rides.filter(r => r.mode === 'rider').length

  // ── Main board view ────────────────────────────────────────────────────────
  return (
    <div
      data-testid={testId ?? 'ride-board'}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-b border-border px-4 pb-3 shadow-sm"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <button
            data-testid="back-button"
            onClick={() => { navigate(-1) }}
            aria-label="Go back"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-primary" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-text-primary">Ride Board</h1>
            <p className="text-xs text-text-secondary">Find or post rides with other students</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-2">
          <button
            data-testid="post-ride-button"
            onClick={() => navigate(postAsDriver ? '/schedule/driver' : '/schedule/rider')}
            className="flex-1 py-2.5 bg-primary text-white text-sm font-semibold rounded-2xl active:opacity-80"
          >
            + Post Ride
          </button>
          <button
            data-testid="my-routines-button"
            onClick={handleOpenRoutines}
            className="flex-1 py-2.5 bg-white text-text-primary text-sm font-semibold rounded-2xl border border-border active:bg-surface"
          >
            My Routines
          </button>
        </div>

        {/* ── Filter tabs with counts ─────────────────────────────────────── */}
        <div className="flex gap-2 mt-2">
          <button data-testid="tab-all" onClick={() => setTab('all')} className={tabClass('all')}>
            All
          </button>
          <button data-testid="tab-drivers" onClick={() => setTab('drivers')} className={tabClass('drivers')}>
            Drivers{!loading && driverCount > 0 ? ` (${driverCount})` : ''}
          </button>
          <button data-testid="tab-riders" onClick={() => setTab('riders')} className={tabClass('riders')}>
            Riders{!loading && riderCount > 0 ? ` (${riderCount})` : ''}
          </button>
        </div>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      {!loading && !error && rides.length > 0 && (
        <div className="flex items-center justify-center gap-5 px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-success" />
            <span className="text-xs text-text-secondary">Offering a ride</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-primary" />
            <span className="text-xs text-text-secondary">Looking for a ride</span>
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-danger text-sm mb-3">{error}</p>
            <button
              onClick={() => void fetchRides()}
              className="text-primary text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && rides.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🚗</p>
            <p className="text-text-secondary text-sm mb-4">
              No rides posted yet. Be the first!
            </p>
            <button
              data-testid="empty-post-button"
              onClick={() => navigate(postAsDriver ? '/schedule/driver' : '/schedule/rider')}
              className="px-6 py-3 bg-primary text-white font-semibold rounded-2xl"
            >
              Post a Ride
            </button>
          </div>
        )}

        {/* Success banner */}
        {successMessage && (
          <div className="mb-3 rounded-2xl bg-success/10 px-4 py-3 text-center" data-testid="success-message">
            <p className="text-sm text-success font-medium">{successMessage}</p>
          </div>
        )}

        {requestError && (
          <div className="mb-3 rounded-2xl bg-danger/10 px-4 py-3 text-center">
            <p className="text-sm text-danger" data-testid="request-error">{requestError}</p>
          </div>
        )}

        {!loading && !error && rides.length > 0 && (
          <div className="space-y-3">
            {rides.map((ride) => {
              const isOwn = ride.user_id === profile?.id
              const poster = ride.poster
              const initial = poster?.full_name?.[0]?.toUpperCase() ?? '?'
              const isDriverPost = ride.mode === 'driver'

              return (
                <div
                  key={ride.id}
                  data-testid="ride-card"
                  className={[
                    'rounded-2xl bg-white p-4 shadow-sm border overflow-hidden relative',
                    isDriverPost ? 'border-success/30' : 'border-primary/30',
                  ].join(' ')}
                >
                  {/* Colored left accent bar */}
                  <div
                    className={[
                      'absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl',
                      isDriverPost ? 'bg-success' : 'bg-primary',
                    ].join(' ')}
                  />

                  {/* Top row: poster info + mode badge */}
                  <div className="flex items-center justify-between mb-3 pl-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={[
                        'h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0',
                        isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
                      ].join(' ')}>
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">
                          {isOwn ? 'You' : poster?.full_name ?? 'Unknown'}
                        </p>
                        {poster?.rating_avg != null && (
                          <p className="text-xs text-text-secondary">★ {poster.rating_avg.toFixed(1)}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={[
                        'text-xs font-semibold px-3 py-1.5 rounded-full',
                        isDriverPost
                          ? 'bg-success/10 text-success'
                          : 'bg-primary/10 text-primary',
                      ].join(' ')}
                    >
                      {isDriverPost ? 'Offering Ride' : 'Needs Ride'}
                    </span>
                  </div>

                  {/* Route */}
                  <div className="mb-3 space-y-1.5 pl-2">
                    <div className="flex items-start gap-2">
                      <span className="text-success mt-0.5 text-sm">●</span>
                      <p className="text-sm text-text-primary truncate">{ride.origin_address}</p>
                    </div>
                    <div className="ml-[5px] h-3 border-l border-dashed border-text-secondary/30" />
                    <div className="flex items-start gap-2">
                      <span className="text-danger mt-0.5 text-sm">●</span>
                      <p className="text-sm text-text-primary truncate">{ride.dest_address}</p>
                    </div>
                  </div>

                  {/* Date/time + direction */}
                  <div className="flex items-center gap-3 text-xs text-text-secondary pl-2">
                    <span>{formatDate(ride.trip_date)}</span>
                    <span>{ride.time_type === 'departure' ? 'Departs' : 'Arrives'} {formatTime(ride.trip_time)}</span>
                    {ride.direction_type === 'roundtrip' && <span>Roundtrip</span>}
                  </div>

                  {/* Action button — depends on ride state */}
                  {!isOwn && !ride.already_requested && (
                    <button
                      data-testid="contact-button"
                      onClick={() => { setConfirmRide(ride); setRequestError(null) }}
                      className={[
                        'mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold text-white active:opacity-80',
                        isDriverPost ? 'bg-success' : 'bg-primary',
                      ].join(' ')}
                    >
                      {isDriverPost ? 'Request This Ride' : 'Offer to Drive'}
                    </button>
                  )}

                  {!isOwn && ride.already_requested && (ride.ride_status === 'coordinating' || ride.ride_status === 'accepted') && ride.ride_id && (
                    <div className="mt-3 space-y-2">
                      <div className="w-full rounded-2xl py-2 text-center text-sm font-semibold bg-success/10 text-success" data-testid="ride-confirmed-badge">
                        Ride Confirmed
                      </div>
                      <button
                        data-testid="open-messages-button"
                        onClick={() => {
                          navigate(`/ride/messaging/${ride.ride_id}`, {
                            state: {
                              destination: {
                                placeId: '',
                                mainText: ride.dest_address,
                                secondaryText: '',
                              },
                            },
                          })
                        }}
                        className="w-full rounded-2xl py-2.5 text-sm font-semibold text-primary bg-primary/10 active:bg-primary/20"
                      >
                        Open Messages
                      </button>
                    </div>
                  )}

                  {!isOwn && ride.already_requested && ride.ride_status !== 'coordinating' && ride.ride_status !== 'accepted' && (
                    <div className="mt-3 w-full rounded-2xl py-2.5 text-center text-sm font-semibold bg-surface text-text-secondary" data-testid="already-requested-badge">
                      Request Sent
                    </div>
                  )}

                  {isOwn && (
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-text-secondary italic">Your posted ride</p>
                      <button
                        data-testid="delete-schedule-button"
                        disabled={deletingId === ride.id}
                        onClick={() => { void handleDeleteSchedule(ride.id) }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
                      >
                        {deletingId === ride.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Confirmation bottom sheet ──────────────────────────────────────── */}
      {confirmRide && (() => {
        const sched = confirmRide
        const isDriverPost = sched.mode === 'driver'
        const poster = sched.poster
        const initial = poster?.full_name?.[0]?.toUpperCase() ?? '?'

        return (
          <>
            {/* Backdrop */}
            <div
              data-testid="confirm-backdrop"
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setConfirmRide(null)}
            />

            {/* Sheet */}
            <div
              data-testid="confirm-sheet"
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white shadow-xl"
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="h-1.5 w-12 rounded-full bg-border" />
              </div>

              <div className="px-5 pb-4">
                {/* Title */}
                <h3 className="text-lg font-bold text-text-primary text-center mb-4">
                  {isDriverPost ? 'Request This Ride?' : 'Offer to Drive?'}
                </h3>

                {/* Poster info */}
                <div className="flex items-center gap-3 mb-4">
                  <div className={[
                    'h-12 w-12 rounded-full flex items-center justify-center font-bold text-lg',
                    isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
                  ].join(' ')}>
                    {initial}
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">{poster?.full_name ?? 'Unknown'}</p>
                    {poster?.rating_avg != null && (
                      <p className="text-sm text-text-secondary">★ {poster.rating_avg.toFixed(1)}</p>
                    )}
                  </div>
                  <span className={[
                    'ml-auto text-xs font-semibold px-3 py-1.5 rounded-full',
                    isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
                  ].join(' ')}>
                    {isDriverPost ? 'Driver' : 'Rider'}
                  </span>
                </div>

                {/* Route */}
                <div className="rounded-2xl bg-surface p-3 mb-4 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <span className="text-success mt-0.5 text-sm">●</span>
                    <p className="text-sm text-text-primary">{sched.origin_address}</p>
                  </div>
                  <div className="ml-[5px] h-3 border-l border-dashed border-text-secondary/30" />
                  <div className="flex items-start gap-2">
                    <span className="text-danger mt-0.5 text-sm">●</span>
                    <p className="text-sm text-text-primary">{sched.dest_address}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-secondary pt-2">
                    <span>{formatDate(sched.trip_date)}</span>
                    <span>{sched.time_type === 'departure' ? 'Departs' : 'Arrives'} {formatTime(sched.trip_time)}</span>
                  </div>
                </div>

                {/* Info text */}
                <p className="text-xs text-text-secondary text-center mb-4">
                  {isDriverPost
                    ? 'Your request will be sent to the driver. They\'ll see it in their notifications.'
                    : 'Your offer will be sent to the rider. They\'ll see it in their notifications.'}
                </p>

                {/* Buttons */}
                <button
                  data-testid="confirm-send-button"
                  disabled={requestingId === sched.id}
                  onClick={() => { void handleConfirmRequest() }}
                  className={[
                    'mb-3 w-full rounded-2xl py-3.5 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50',
                    isDriverPost ? 'bg-success' : 'bg-primary',
                  ].join(' ')}
                >
                  {requestingId === sched.id
                    ? 'Sending…'
                    : isDriverPost ? 'Send Request' : 'Send Offer'}
                </button>
                <button
                  data-testid="confirm-cancel-button"
                  onClick={() => setConfirmRide(null)}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-text-secondary active:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── My Routines sheet ──────────────────────────────────────────────── */}
      <BottomSheet
        isOpen={routinesOpen}
        onClose={() => { setRoutinesOpen(false); setEditingRoutine(null) }}
        title="My Routines"
        data-testid="routines-sheet"
      >
        {routinesLoading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
          </div>
        )}

        {!routinesLoading && routines.length === 0 && (
          <div className="text-center py-8">
            <p className="text-text-secondary text-sm mb-3">No routines set up yet.</p>
            <button
              onClick={() => { setRoutinesOpen(false); navigate(postAsDriver ? '/schedule/driver' : '/schedule/rider') }}
              className="text-primary text-sm font-semibold"
            >
              Create a Routine
            </button>
          </div>
        )}

        {!routinesLoading && routines.length > 0 && !editingRoutine && (
          <div className="space-y-3">
            {routines.map((routine) => {
              const time = routine.departure_time ?? routine.arrival_time ?? ''
              const timeLabel = routine.departure_time ? 'Departs' : 'Arrives'
              return (
                <div
                  key={routine.id}
                  data-testid="routine-card"
                  className="rounded-2xl border border-border bg-white p-3"
                >
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-sm text-text-primary">{routine.route_name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${routine.direction_type === 'roundtrip' ? 'bg-primary/10 text-primary' : 'bg-surface text-text-secondary'}`}>
                      {routine.direction_type === 'roundtrip' ? 'Roundtrip' : 'One way'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mb-1">
                    {formatDays(routine.day_of_week)} &middot; {timeLabel} {time ? formatTime(time) : '–'}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      data-testid="edit-routine-button"
                      onClick={() => handleStartEdit(routine)}
                      className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20"
                    >
                      Edit
                    </button>
                    <button
                      data-testid="delete-routine-button"
                      disabled={deletingRoutineId === routine.id}
                      onClick={() => { void handleDeleteRoutine(routine.id) }}
                      className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
                    >
                      {deletingRoutineId === routine.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Edit routine form ────────────────────────────────────────── */}
        {editingRoutine && (
          <div className="space-y-4" data-testid="edit-routine-form">
            <button
              onClick={() => setEditingRoutine(null)}
              className="text-xs text-primary font-semibold"
            >
              &larr; Back to list
            </button>

            {/* Route name */}
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">Route Name</label>
              <input
                data-testid="edit-route-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-2xl border border-border px-3 py-2 text-base text-text-primary focus:border-primary focus:outline-none"
              />
            </div>

            {/* Days */}
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-2">Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {SHORT_DAYS.map((name, i) => (
                  <button
                    key={i}
                    data-testid={`edit-day-${i}`}
                    onClick={() => toggleEditDay(i)}
                    className={[
                      'h-9 w-9 rounded-full text-xs font-semibold transition-colors',
                      editDays.includes(i)
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-secondary border border-border',
                    ].join(' ')}
                  >
                    {name.charAt(0)}
                  </button>
                ))}
              </div>
            </div>

            {/* Time type toggle */}
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-2">Time</label>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setEditTimeType('departure')}
                  className={`flex-1 py-2 rounded-2xl text-xs font-semibold transition-colors ${editTimeType === 'departure' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'}`}
                >
                  Departure
                </button>
                <button
                  onClick={() => setEditTimeType('arrival')}
                  className={`flex-1 py-2 rounded-2xl text-xs font-semibold transition-colors ${editTimeType === 'arrival' ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border'}`}
                >
                  Arrival
                </button>
              </div>
              <input
                data-testid="edit-time-input"
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-full rounded-2xl border border-border px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
              />
            </div>

            {/* Save */}
            <button
              data-testid="save-routine-button"
              disabled={editSaving || !editName.trim() || !editTime || editDays.length === 0}
              onClick={() => { void handleSaveEdit() }}
              className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </BottomSheet>

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab={activeNavTab} />
    </div>
  )
}
