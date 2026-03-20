import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import BottomSheet from '@/components/ui/BottomSheet'
import RideBoardSearchBar from './RideBoardSearchBar'
import RideBoardCard from './RideBoardCard'
import RideBoardConfirmSheet from './RideBoardConfirmSheet'
import RideBoardEmptyState from './RideBoardEmptyState'
import PostRideFAB from './PostRideFAB'
import { formatDays, formatTime, SHORT_DAYS } from './boardHelpers'
import type { ScheduledRide, TabFilter } from './boardTypes'
import type { DriverRoutine } from '@/types/database'

// ── Component ─────────────────────────────────────────────────────────────────

interface RideBoardProps {
  'data-testid'?: string
}

export default function RideBoard({ 'data-testid': testId }: RideBoardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const isDriver = useAuthStore((s) => s.isDriver)

  const fromTab = (location.state as { fromTab?: string } | null)?.fromTab
  const activeNavTab = fromTab === 'drive' ? 'drive' as const : fromTab === 'home' ? 'home' as const : isDriver ? 'drive' as const : 'home' as const
  const postAsDriver = activeNavTab === 'drive'

  const [rides, setRides] = useState<ScheduledRide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [confirmRide, setConfirmRide] = useState<ScheduledRide | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null)

  // Routines sheet state
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

  // ── Client-side search filtering ────────────────────────────────────────────
  const filteredRides = useMemo(() => {
    if (!searchQuery.trim()) return rides
    const q = searchQuery.toLowerCase()
    return rides.filter(
      (r) =>
        r.dest_address.toLowerCase().includes(q) ||
        r.origin_address.toLowerCase().includes(q),
    )
  }, [rides, searchQuery])

  const driverCount = filteredRides.filter((r) => r.mode === 'driver').length
  const riderCount = filteredRides.filter((r) => r.mode === 'rider').length

  // ── Geolocation ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        },
        () => { /* non-fatal */ },
        { enableHighAccuracy: false, timeout: 5000 },
      )
    }
  }, [])

  // ── Send ride request ───────────────────────────────────────────────────────
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

      const isDriverPost = confirmRide.mode === 'driver'
      setRides((prev) => prev.map((r) => r.id === confirmRide.id ? { ...r, already_requested: true } : r))
      setSuccessMessage(isDriverPost ? 'Request sent! They\'ll see it in their notifications.' : 'Offer sent! They\'ll see it in their notifications.')
      setConfirmRide(null)
      setRequestingId(null)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setRequestError('Network error — please try again.')
      setRequestingId(null)
      setConfirmRide(null)
    }
  }, [confirmRide])

  // ── Delete own schedule ─────────────────────────────────────────────────────
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

  // ── Open messages for confirmed ride ────────────────────────────────────────
  const handleOpenMessages = useCallback((ride: ScheduledRide) => {
    navigate(`/ride/messaging/${ride.ride_id}`, {
      state: {
        destination: {
          placeId: '',
          mainText: ride.dest_address,
          secondaryText: '',
        },
      },
    })
  }, [navigate])

  // ── Routines ────────────────────────────────────────────────────────────────
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
    setEditTime(time.slice(0, 5))
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

  // ── Fetch rides ─────────────────────────────────────────────────────────────
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

  // Realtime + visibility
  useEffect(() => {
    if (!profile?.id) return

    const channel = supabase
      .channel(`board-page:${profile.id}`)
      .on('broadcast', { event: 'ride_status_changed' }, () => { void fetchRides() })
      .on('broadcast', { event: 'ride_cancelled' }, () => { void fetchRides() })
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/schedule/sync-routines', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (resp.ok) {
        const body = (await resp.json()) as { synced: number }
        if (body.synced > 0) void fetchRides()
      }
    } catch { /* non-fatal */ }
  }, [fetchRoutines, fetchRides])

  const postRideUrl = postAsDriver ? '/schedule/driver' : '/schedule/rider'

  const tabClass = (t: TabFilter) => [
    'flex-1 py-2 text-xs font-semibold rounded-full transition-colors',
    tab === t
      ? 'bg-primary text-white'
      : 'bg-white text-text-secondary border border-border',
  ].join(' ')

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      data-testid={testId ?? 'ride-board'}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="bg-white border-b border-border px-4 pb-3 shadow-sm"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        {/* Top row: back + title + overflow menu */}
        <div className="flex items-center justify-between mb-3">
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

          <h1 className="text-lg font-bold text-text-primary">Ride Board</h1>

          <button
            data-testid="my-routines-button"
            onClick={() => { void handleOpenRoutines() }}
            aria-label="My routines"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-text-primary" aria-hidden="true">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        </div>

        {/* Search bar */}
        <RideBoardSearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
        />

        {/* Filter tabs */}
        <div className="flex gap-2 mt-3">
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

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-danger text-sm mb-3">{error}</p>
            <button onClick={() => void fetchRides()} className="text-primary text-sm font-semibold">
              Try again
            </button>
          </div>
        )}

        {!loading && !error && filteredRides.length === 0 && (
          <RideBoardEmptyState
            searchQuery={searchQuery}
            onPostRide={() => navigate(postRideUrl)}
          />
        )}

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

        {!loading && !error && filteredRides.length > 0 && (
          <div className="space-y-3">
            {filteredRides.map((ride) => (
              <RideBoardCard
                key={ride.id}
                ride={ride}
                isOwn={ride.user_id === profile?.id}
                deletingId={deletingId}
                onRequestClick={(r) => { setConfirmRide(r); setRequestError(null) }}
                onDeleteClick={(id) => { void handleDeleteSchedule(id) }}
                onOpenMessages={handleOpenMessages}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Confirm sheet ─────────────────────────────────────────────────── */}
      <RideBoardConfirmSheet
        ride={confirmRide}
        isRequesting={requestingId === confirmRide?.id}
        onConfirm={() => { void handleConfirmRequest() }}
        onCancel={() => setConfirmRide(null)}
      />

      {/* ── Post Ride FAB ─────────────────────────────────────────────────── */}
      <PostRideFAB onClick={() => navigate(postRideUrl)} />

      {/* ── My Routines sheet ─────────────────────────────────────────────── */}
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
              onClick={() => { setRoutinesOpen(false); navigate(postRideUrl) }}
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

        {/* Edit routine form */}
        {editingRoutine && (
          <div className="space-y-4" data-testid="edit-routine-form">
            <button
              onClick={() => setEditingRoutine(null)}
              className="text-xs text-primary font-semibold"
            >
              &larr; Back to list
            </button>

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

      {/* ── Bottom navigation ─────────────────────────────────────────────── */}
      <BottomNav activeTab={activeNavTab} />
    </div>
  )
}
