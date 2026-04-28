import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import BottomSheet from '@/components/ui/BottomSheet'
import RideBoardSearchBar from './RideBoardSearchBar'
import RideBoardCard from './RideBoardCard'
import RideBoardConfirmSheet from './RideBoardConfirmSheet'
import type { RequestEnrichment } from './RideBoardConfirmSheet'
import RideBoardEmptyState from './RideBoardEmptyState'
import PostRideFAB from './PostRideFAB'
import RideBoardFilterSheet from './RideBoardFilterSheet'
import { DEFAULT_FILTERS, countActiveFilters, type RideBoardFilters } from './boardFilters'
import { formatDays, formatDate, formatTime, formatTripSchedule, SHORT_DAYS } from './boardHelpers'
import type { ScheduledRide, TabFilter } from './boardTypes'
import type { DriverRoutine } from '@/types/database'
import { haversineMetres } from '@/lib/geo'
import { estimateScheduleFare } from '@/lib/fareEstimate'

// Same-metro radius for "Near me". Cities routinely span 20-30 km across, so
// a tighter corridor would exclude a poster living in the same town as the
// viewer. This is an MVP heuristic — once we have real city boundaries we
// can swap to a proper geocode-based city match.
const NEAR_ME_RADIUS_METRES = 30_000

function toIsoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface RideBoardProps {
  'data-testid'?: string
}

interface PendingRideRequestState {
  schedule_id: string
  enrichment: RequestEnrichment
}

export default function RideBoard({ 'data-testid': testId }: RideBoardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const isDriver = useAuthStore((s) => s.isDriver)

  const fromTab = (location.state as { fromTab?: string } | null)?.fromTab
  const pendingRequestState = (location.state as { confirmState?: PendingRideRequestState } | null)?.confirmState ?? null
  const activeNavTab = fromTab === 'drive' ? 'drive' as const : fromTab === 'home' ? 'home' as const : isDriver ? 'drive' as const : 'home' as const
  const postAsDriver = activeNavTab === 'drive'

  const [rides, setRides] = useState<ScheduledRide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const defaultTab: TabFilter = activeNavTab === 'drive' ? 'riders' : 'drivers'
  const [tab, setTab] = useState<TabFilter>(defaultTab)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<RideBoardFilters>(DEFAULT_FILTERS)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)

  const [detailRide, setDetailRide] = useState<ScheduledRide | null>(null)
  const [confirmRide, setConfirmRide] = useState<ScheduledRide | null>(null)
  const [confirmInitialEnrichment, setConfirmInitialEnrichment] = useState<RequestEnrichment | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [withdrawingRideId, setWithdrawingRideId] = useState<string | null>(null)
  const [editingSeats, setEditingSeats] = useState(false)
  const [seatEditValue, setSeatEditValue] = useState(1)
  const [savingSeats, setSavingSeats] = useState(false)
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)

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
  const [restoredPendingRequest, setRestoredPendingRequest] = useState(false)

  // ── Client-side filtering (search + time window + seat count) ──────────────
  const filteredRides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const today = toIsoDay(new Date())
    const weekEnd = new Date()
    weekEnd.setDate(weekEnd.getDate() + 7)
    const weekEndStr = toIsoDay(weekEnd)

    return rides.filter((r) => {
      if (q && !r.dest_address.toLowerCase().includes(q) && !r.origin_address.toLowerCase().includes(q)) {
        return false
      }
      if (filters.time === 'today' && r.trip_date !== today) return false
      if (filters.time === 'week' && (r.trip_date < today || r.trip_date > weekEndStr)) return false
      if (filters.time === 'custom' && filters.customDate && r.trip_date !== filters.customDate) return false
      // Seat filter only narrows driver posts; rider posts pass through unchanged.
      if (filters.seats === '2plus' && r.mode === 'driver' && (r.available_seats ?? 0) < 2) return false
      return true
    })
  }, [rides, searchQuery, filters])

  // Posts whose origin is within ~30 km of the viewer — i.e. roughly same
  // metro area. Applies to BOTH driver and rider posts. Uses the generic
  // origin_lat/lng columns added in migration 048, falling back to the
  // legacy driver_origin_* fields for older rows.
  const nearbyRideIds = useMemo(() => {
    const loc = userLocation
    const result = new Set<string>()
    if (!loc) return result
    for (const r of filteredRides) {
      const oLat = r.origin_lat ?? r.driver_origin_lat
      const oLng = r.origin_lng ?? r.driver_origin_lng
      if (oLat == null || oLng == null) continue
      const dist = haversineMetres(loc.lat, loc.lng, oLat, oLng)
      if (dist <= NEAR_ME_RADIUS_METRES) result.add(r.id)
    }
    return result
  }, [filteredRides, userLocation])

  // Apply near-me filter + sort on top of search/time/seats filter.
  const visibleRides = useMemo(() => {
    let arr = filteredRides
    if (filters.nearMeOnly) {
      arr = arr.filter((r) => nearbyRideIds.has(r.id))
    }

    const cmp = (a: ScheduledRide, b: ScheduledRide): number => {
      if (filters.sort === 'nearest' && userLocation) {
        const distOf = (r: ScheduledRide) => {
          const oLat = r.origin_lat ?? r.driver_origin_lat
          const oLng = r.origin_lng ?? r.driver_origin_lng
          if (oLat == null || oLng == null) return Number.POSITIVE_INFINITY
          return haversineMetres(userLocation.lat, userLocation.lng, oLat, oLng)
        }
        return distOf(a) - distOf(b)
      }
      // Default: recently posted
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    }

    return [...arr].sort(cmp)
  }, [filteredRides, filters.nearMeOnly, filters.sort, nearbyRideIds, userLocation])

  const driverCount = visibleRides.filter((r) => r.mode === 'driver').length
  const riderCount = visibleRides.filter((r) => r.mode === 'rider').length
  const activeFilterCount = countActiveFilters(filters)

  // ── Geolocation ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          userLocationRef.current = loc
          setUserLocation(loc)
        },
        () => { /* non-fatal */ },
        { enableHighAccuracy: false, timeout: 5000 },
      )
    }
  }, [])

  const handleStartRequest = useCallback((ride: ScheduledRide) => {
    if (ride.mode === 'rider' && !isDriver) {
      navigate('/become-driver')
      return
    }

    setConfirmRide(ride)
    setConfirmInitialEnrichment(null)
    setRequestError(null)
  }, [isDriver, navigate])

  // ── Send ride request ───────────────────────────────────────────────────────
  const handleConfirmRequest = useCallback(async (enrichment?: RequestEnrichment) => {
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
      // Use rider's explicit pickup location from enrichment, fall back to GPS
      const originLat = enrichment?.pickup_lat ?? loc?.lat
      const originLng = enrichment?.pickup_lng ?? loc?.lng
      // Wallet-first parity (C4): pass the high end of the local fare
      // estimate so server can let wallet-only riders through when balance
      // covers the worst-case fare.
      const fareEst = estimateScheduleFare(confirmRide)
      const estimatedFareCents = fareEst?.high_cents ?? null
      const resp = await fetch('/api/schedule/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          schedule_id: confirmRide.id,
          ...(originLat != null && originLng != null ? { origin_lat: originLat, origin_lng: originLng } : {}),
          origin_name: enrichment?.pickup_name ?? null,
          ...(estimatedFareCents != null ? { estimated_fare_cents: estimatedFareCents } : {}),
          ...(enrichment ? {
            destination_lat: enrichment.destination_lat,
            destination_lng: enrichment.destination_lng,
            destination_name: enrichment.destination_name,
            destination_flexible: enrichment.destination_flexible,
            note: enrichment.note,
            dropoff_at_driver_destination: enrichment.dropoff_at_driver_destination,
          } : {}),
        }),
      })

      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { code?: string; message?: string } }
        if (body.error?.code === 'NO_PAYMENT_METHOD') {
          // Requester is the rider (driver-post): redirect to /payment/add and
          // restore the confirmation state when they come back.
          setRequestingId(null)
          setConfirmRide(null)
          setConfirmInitialEnrichment(null)
          navigate('/payment/add', {
            state: {
              returnTo: '/rides/board',
              fromTab: activeNavTab,
              confirmState: {
                schedule_id: confirmRide.id,
                enrichment: enrichment ?? { destination_flexible: false },
              },
            },
          })
          return
        }
        // RIDER_NO_PAYMENT_METHOD: the *poster* of a rider-post lacks a card.
        // Adding our own card here wouldn't fix anything — surface the message
        // inline so the driver can pick a different post. (Should be rare now
        // that schedule creation enforces the card; the trigger is the safety
        // net for older rows.)
        setRequestError(body.error?.message ?? 'Failed to send request')
        setRequestingId(null)
        setConfirmRide(null)
        setConfirmInitialEnrichment(null)
        return
      }

      const isDriverPost = confirmRide.mode === 'driver'
      setRides((prev) => prev.map((r) => r.id === confirmRide.id ? { ...r, already_requested: true } : r))
      setSuccessMessage(isDriverPost ? 'Request sent! They\'ll see it in their notifications.' : 'Offer sent! They\'ll see it in their notifications.')
      setConfirmRide(null)
      setConfirmInitialEnrichment(null)
      setRequestingId(null)
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setRequestError('Network error — please try again.')
      setRequestingId(null)
      setConfirmRide(null)
      setConfirmInitialEnrichment(null)
    }
  }, [confirmRide, navigate, activeNavTab])

  useEffect(() => {
    if (restoredPendingRequest || !pendingRequestState || loading) return

    const matchedRide = rides.find((r) => r.id === pendingRequestState.schedule_id)
    if (!matchedRide) return

    setConfirmRide(matchedRide)
    setConfirmInitialEnrichment(pendingRequestState.enrichment)
    setRestoredPendingRequest(true)
  }, [pendingRequestState, loading, rides, navigate, restoredPendingRequest])

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

  // ── Update seats on own schedule ────────────────────────────────────────────
  const handleSaveSeats = useCallback(async (scheduleId: string, seats: number) => {
    setSavingSeats(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch(`/api/schedule/${scheduleId}/seats`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ available_seats: seats }),
      })
      if (resp.ok) {
        setRides((prev) => prev.map((r) => r.id === scheduleId ? { ...r, available_seats: seats } : r))
        setDetailRide((prev) => prev ? { ...prev, available_seats: seats } : prev)
        setEditingSeats(false)
        setSuccessMessage('Seats updated.')
        setTimeout(() => setSuccessMessage(null), 3000)
      } else {
        const body = (await resp.json()) as { error?: { message?: string } }
        setRequestError(body.error?.message ?? 'Failed to update seats')
      }
    } catch {
      setRequestError('Network error — please try again.')
    } finally {
      setSavingSeats(false)
    }
  }, [])

  // ── Withdraw pending board request ──────────────────────────────────────────
  const handleWithdrawRequest = useCallback(async (rideId: string) => {
    setWithdrawingRideId(rideId)
    setRequestError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setRequestError('Not authenticated')
        return
      }
      const resp = await fetch('/api/schedule/withdraw-board', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ ride_id: rideId }),
      })
      if (!resp.ok) {
        const body = (await resp.json()) as { error?: { message?: string } }
        setRequestError(body.error?.message ?? 'Failed to withdraw')
        return
      }
      setRides((prev) => prev.map((r) => r.ride_id === rideId ? { ...r, already_requested: false, ride_status: null, ride_id: null } : r))
      setSuccessMessage('Request withdrawn.')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch {
      setRequestError('Network error — please try again.')
    } finally {
      setWithdrawingRideId(null)
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
      // Send the user's local clock so the server filters in the same timezone
      // the user posted in. Without this, the server's UTC "today" can be a
      // day ahead of the user's local date, and same-day posts get dropped
      // by the .gte('trip_date', today) filter.
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const hh = String(now.getHours()).padStart(2, '0')
      const mi = String(now.getMinutes()).padStart(2, '0')
      const ss = String(now.getSeconds()).padStart(2, '0')
      params.set('client_date', `${yyyy}-${mm}-${dd}`)
      params.set('client_now', `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`)
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
      // Send the user's local "today" so routine→board generation seeds the
      // right calendar dates and day-of-week, regardless of server timezone.
      const now = new Date()
      const clientDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const resp = await fetch('/api/schedule/sync-routines', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client_date: clientDate }),
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

        {/* Tabs row + Filters button */}
        <div className="flex items-center gap-2 mt-3">
          <div className="flex gap-2 flex-1 min-w-0">
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
          <button
            type="button"
            data-testid="open-filter-sheet"
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Filters and sort"
            className={[
              'relative flex h-9 items-center gap-1.5 rounded-full border px-3 shrink-0 transition-colors',
              activeFilterCount > 0
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-text-primary border-border',
            ].join(' ')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="10" y1="18" x2="14" y2="18" />
            </svg>
            <span className="text-xs font-semibold">
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </span>
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

        {!loading && !error && visibleRides.length === 0 && (
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

        {!loading && !error && visibleRides.length > 0 && (
          <div className="space-y-3">
            {visibleRides.map((ride) => (
              <RideBoardCard
                key={ride.id}
                ride={ride}
                isOwn={ride.user_id === profile?.id}
                isNearby={nearbyRideIds.has(ride.id)}
                deletingId={deletingId}
                withdrawingRideId={withdrawingRideId}
                onCardClick={(r) => { setDetailRide(r) }}
                onRequestClick={(r) => { void handleStartRequest(r) }}
                onDeleteClick={(id) => { void handleDeleteSchedule(id) }}
                onOpenMessages={handleOpenMessages}
                onWithdrawClick={(rideId) => { void handleWithdrawRequest(rideId) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Ride detail sheet ────────────────────────────────────────────── */}
      <BottomSheet
        isOpen={detailRide !== null}
        onClose={() => { setDetailRide(null); setEditingSeats(false) }}
        title="Ride Details"
        data-testid="ride-detail-sheet"
      >
        {detailRide && (() => {
          const dr = detailRide
          const isDriverPost = dr.mode === 'driver'
          const poster = dr.poster
          const isOwn = dr.user_id === profile?.id
          return (
            <div className="space-y-4">
              {/* Poster profile */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-surface flex items-center justify-center overflow-hidden shrink-0">
                  {poster?.avatar_url ? (
                    <img src={poster.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 text-text-secondary" aria-hidden="true">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {isOwn ? 'You' : poster?.full_name ?? 'Unknown'}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={[
                      'text-xs font-semibold px-2 py-0.5 rounded-full',
                      isDriverPost ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
                    ].join(' ')}>
                      {isDriverPost ? 'Driver' : 'Rider'}
                    </span>
                    {poster?.rating_avg != null && (
                      <span className="text-xs text-text-secondary">★ {poster.rating_avg.toFixed(1)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Route */}
              <div className="rounded-2xl bg-surface p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0 mt-1.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">From</p>
                    <p data-testid="detail-origin" className="text-sm font-medium text-text-primary">{dr.origin_address}</p>
                  </div>
                </div>
                <div className="ml-[4.5px] h-4 border-l border-dashed border-text-secondary/30" />
                <div className="flex items-start gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0 mt-1.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">To</p>
                    <p data-testid="detail-dest" className="text-sm font-medium text-text-primary">{dr.dest_address}</p>
                  </div>
                </div>
              </div>

              {/* Date, time, direction */}
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {formatDate(dr.trip_date)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  {formatTripSchedule({ trip_time: dr.trip_time, time_type: dr.time_type, time_flexible: dr.time_flexible })}
                </span>
                {dr.direction_type === 'roundtrip' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                    Roundtrip
                  </span>
                )}
              </div>

              {/* Seats & note */}
              {(dr.available_seats != null || dr.note) && (
                <div className="space-y-2">
                  {dr.available_seats != null && (
                    <div className="flex items-center gap-2 text-sm text-text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary" aria-hidden="true">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span data-testid="detail-seats">{dr.available_seats} {dr.available_seats === 1 ? 'seat' : 'seats'} available</span>
                    </div>
                  )}
                  {dr.note && (
                    <div className="flex items-start gap-2 text-sm text-text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0 mt-0.5" aria-hidden="true">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <p data-testid="detail-note" className="text-text-secondary">{dr.note}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Action button */}
              {!isOwn && !dr.already_requested && isDriverPost && dr.available_seats != null && dr.available_seats <= 0 && (
                <div
                  data-testid="detail-full-badge"
                  className="w-full rounded-2xl py-3 text-center text-sm font-semibold bg-border/50 text-text-secondary"
                >
                  Full — No Seats Available
                </div>
              )}
              {!isOwn && !dr.already_requested && !(isDriverPost && dr.available_seats != null && dr.available_seats <= 0) && (
                <button
                  data-testid="detail-request-button"
                  onClick={() => {
                    setDetailRide(null)
                    void handleStartRequest(dr)
                  }}
                  className={[
                    'w-full rounded-2xl py-3 text-sm font-semibold text-white active:opacity-80',
                    isDriverPost ? 'bg-success' : 'bg-primary',
                  ].join(' ')}
                >
                  {isDriverPost ? 'Request This Ride' : 'Offer to Drive'}
                </button>
              )}

              {!isOwn && dr.already_requested && (dr.ride_status === 'coordinating' || dr.ride_status === 'accepted') && dr.ride_id && (
                <button
                  data-testid="detail-messages-button"
                  onClick={() => { setDetailRide(null); handleOpenMessages(dr) }}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-primary bg-primary/10 active:bg-primary/20"
                >
                  Open Messages
                </button>
              )}

              {!isOwn && dr.already_requested && dr.ride_status !== 'coordinating' && dr.ride_status !== 'accepted' && (
                <div className="space-y-2">
                  <div className="w-full rounded-2xl py-3 text-center text-sm font-semibold bg-surface text-text-secondary">
                    Request Sent
                  </div>
                  {dr.ride_id && (
                    <button
                      data-testid="detail-withdraw-button"
                      disabled={withdrawingRideId === dr.ride_id}
                      onClick={() => { setDetailRide(null); if (dr.ride_id) void handleWithdrawRequest(dr.ride_id) }}
                      className="w-full rounded-2xl py-3 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
                    >
                      {withdrawingRideId === dr.ride_id ? 'Withdrawing…' : 'Withdraw Request'}
                    </button>
                  )}
                </div>
              )}

              {isOwn && !editingSeats && (
                <button
                  data-testid="detail-edit-seats-button"
                  onClick={() => { setSeatEditValue(dr.available_seats ?? 1); setEditingSeats(true) }}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-primary bg-primary/10 active:bg-primary/20"
                >
                  Edit Seats ({dr.available_seats ?? 0} available)
                </button>
              )}

              {isOwn && editingSeats && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-text-primary text-center">How many seats are available?</p>
                  <div className="flex items-center justify-center gap-6">
                    <button
                      onClick={() => setSeatEditValue((v) => Math.max(0, v - 1))}
                      className="h-10 w-10 rounded-full bg-border text-xl font-bold text-text-primary flex items-center justify-center active:opacity-70"
                    >−</button>
                    <span className="text-2xl font-bold text-text-primary w-6 text-center">{seatEditValue}</span>
                    <button
                      onClick={() => setSeatEditValue((v) => Math.min(8, v + 1))}
                      className="h-10 w-10 rounded-full bg-border text-xl font-bold text-text-primary flex items-center justify-center active:opacity-70"
                    >+</button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingSeats(false)}
                      className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-text-secondary bg-border active:opacity-70"
                    >Cancel</button>
                    <button
                      data-testid="detail-save-seats-button"
                      disabled={savingSeats}
                      onClick={() => { void handleSaveSeats(dr.id, seatEditValue) }}
                      className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-white bg-primary active:opacity-80 disabled:opacity-50"
                    >{savingSeats ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}

              {isOwn && !editingSeats && (
                <button
                  data-testid="detail-delete-button"
                  disabled={deletingId === dr.id}
                  onClick={() => { setDetailRide(null); void handleDeleteSchedule(dr.id) }}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 disabled:opacity-50"
                >
                  {deletingId === dr.id ? 'Deleting…' : 'Delete This Ride'}
                </button>
              )}
            </div>
          )
        })()}
      </BottomSheet>

      {/* ── Confirm sheet ─────────────────────────────────────────────────── */}
      <RideBoardConfirmSheet
        ride={confirmRide}
        isRequesting={requestingId === confirmRide?.id}
        initialEnrichment={confirmInitialEnrichment}
        onConfirm={(enrichment) => { void handleConfirmRequest(enrichment) }}
        onCancel={() => { setConfirmRide(null); setConfirmInitialEnrichment(null) }}
      />

      {/* ── Filter + sort sheet ───────────────────────────────────────────── */}
      <RideBoardFilterSheet
        isOpen={filterSheetOpen}
        filters={filters}
        hasUserLocation={userLocation != null}
        showSeatsFilter={tab !== 'riders'}
        onApply={setFilters}
        onClose={() => setFilterSheetOpen(false)}
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
