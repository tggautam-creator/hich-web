import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import type { Ride, User, Vehicle } from '@/types/database'
import { trackEvent } from '@/lib/analytics'
import { searchPlaces, getPlaceCoordinates } from '@/lib/places'
import type { PlaceSuggestion } from '@/lib/places'
import { useAuthStore } from '@/stores/authStore'
import TransitInfo from '@/components/ride/TransitInfo'
import DriverDestinationCard from '@/components/ride/DriverDestinationCard'
import TransitSuggestionCard, { TransitSuggestionPicker } from '@/components/ride/TransitSuggestionCard'
import type { TransitDropoffSuggestion } from '@/components/ride/TransitSuggestionCard'
import { MAP_ID } from '@/lib/mapConstants'
import { MapBoundsFitter, RoutePolyline } from '@/components/map/RoutePreview'
import { getDirectionsByLatLng } from '@/lib/directions'
import { isScheduledRideApproaching, formatScheduledRideTime, getMinutesUntilRide } from '@/lib/datetime'
import { calculateFare, formatCents } from '@/lib/fare'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MessagingWindowProps {
  'data-testid'?: string
}

interface LocationState {
  destination?: PlaceSuggestion
  destinationLat?: number
  destinationLng?: number
  driverDestinationSet?: boolean
  autoOpenPickup?: boolean
}

interface ChatMessage {
  id: string
  ride_id: string
  sender_id: string
  content: string
  type: string
  meta: Record<string, unknown> | null
  created_at: string
}

type PinMode = 'pickup' | 'dropoff'

/** Data for the full-screen map overlay */
interface MapOverlayData {
  type: 'pickup' | 'dropoff'
  points: Array<{ lat: number; lng: number; label: string; color: string }>
  polyline?: string | null
  walkPolyline?: string | null
}

/** Full-screen interactive map overlay — shows all markers, route polylines, zoomable */
function ProposalMapOverlay({ data, onClose }: { data: MapOverlayData; onClose: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // Trigger slide-up animation on next frame
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 250)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col transition-transform duration-250 ease-out"
      style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      data-testid="proposal-map-overlay"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface" style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}>
        <button onClick={handleClose} className="h-8 w-8 rounded-full bg-surface-alt flex items-center justify-center" data-testid="overlay-close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-text-primary" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold text-text-primary">
          {data.type === 'pickup' ? 'Pickup Location' : 'Dropoff Location'}
        </h2>
      </div>
      {/* Map */}
      <div className="flex-1">
        <Map
          mapId={MAP_ID}
          defaultCenter={data.points[0] ? { lat: data.points[0].lat, lng: data.points[0].lng } : { lat: 38.54, lng: -121.75 }}
          defaultZoom={15}
          gestureHandling="auto"
          disableDefaultUI={false}
          className="w-full h-full"
        >
          {data.points.map((pt, i) => (
            <AdvancedMarker key={i} position={{ lat: pt.lat, lng: pt.lng }}>
              <div className="flex flex-col items-center">
                <svg width="32" height="42" viewBox="0 0 36 48" aria-hidden="true">
                  <path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 16.2 28.8 17.4 30 .36.36.84.36 1.2 0C19.8 46.8 36 30.6 36 18 36 8.06 27.94 0 18 0z" fill={pt.color} />
                  <circle cx="18" cy="18" r="7" fill="white" />
                </svg>
                <span className="mt-0.5 text-[10px] font-bold text-text-primary bg-white/90 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                  {pt.label}
                </span>
              </div>
            </AdvancedMarker>
          ))}
          {data.polyline && (
            <RoutePolyline encodedPath={data.polyline} color="#6366F1" weight={4} fitBounds={false} />
          )}
          {data.walkPolyline && (
            <RoutePolyline encodedPath={data.walkPolyline} color="#8B5CF6" weight={3} fitBounds={false} />
          )}
          <MapBoundsFitter points={data.points.map(p => ({ lat: p.lat, lng: p.lng }))} />
        </Map>
      </div>
      {/* Legend */}
      <div className="px-4 py-3 border-t border-border bg-surface flex flex-wrap gap-3">
        {data.points.map((pt, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pt.color }} />
            <span className="text-xs text-text-primary font-medium">{pt.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Text-based pickup proposal card — replaces mini map with readable info + View on Map */
function PickupProposalCard({
  pickupName, originLat, originLng, pickupLat, pickupLng, isRider, driverId,
  destLat, destLng, originalFareCents, onViewMap,
}: {
  pickupName?: string | null; originLat: number; originLng: number; pickupLat: number; pickupLng: number
  isRider: boolean; driverId?: string | null
  destLat?: number | null; destLng?: number | null; originalFareCents?: number | null
  onViewMap: (data: MapOverlayData) => void
}) {
  const [walkMin, setWalkMin] = useState<number | null>(null)
  const [walkPolyline, setWalkPolyline] = useState<string | null>(null)
  const [driveMin, setDriveMin] = useState<number | null>(null)
  const [estimatedFare, setEstimatedFare] = useState<number | null>(null)

  useEffect(() => {
    void getDirectionsByLatLng(originLat, originLng, pickupLat, pickupLng, 'WALK').then((result) => {
      if (result) {
        setWalkMin(Math.max(1, Math.round(result.duration_min)))
        setWalkPolyline(result.polyline)
      }
    })
  }, [originLat, originLng, pickupLat, pickupLng])

  useEffect(() => {
    if (!driverId) return
    void (async () => {
      const { data } = await supabase.from('driver_locations').select('location').eq('user_id', driverId).single()
      if (data?.location) {
        const loc = data.location as unknown as { coordinates: [number, number] }
        void getDirectionsByLatLng(loc.coordinates[1], loc.coordinates[0], pickupLat, pickupLng).then((r) => {
          if (r) setDriveMin(Math.max(1, Math.round(r.duration_min)))
        })
      }
    })()
  }, [driverId, pickupLat, pickupLng])

  useEffect(() => {
    if (destLat == null || destLng == null) return
    void getDirectionsByLatLng(pickupLat, pickupLng, destLat, destLng).then((result) => {
      if (result) {
        const fare = calculateFare(result.distance_km, result.duration_min)
        setEstimatedFare(fare.fare_cents)
      }
    })
  }, [pickupLat, pickupLng, destLat, destLng])

  const handleViewMap = () => {
    onViewMap({
      type: 'pickup',
      points: [
        { lat: originLat, lng: originLng, label: 'Your Location', color: '#6366F1' },
        { lat: pickupLat, lng: pickupLng, label: 'Pickup', color: '#22C55E' },
      ],
      walkPolyline,
    })
  }

  return (
    <div className="rounded-lg bg-surface/60 p-2.5 mb-1.5">
      {pickupName && (
        <p className="text-xs font-semibold text-text-primary mb-1.5 truncate">{pickupName}</p>
      )}
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#6366F1] shrink-0" />
          <span className="text-text-primary font-medium">
            {isRider ? 'Your walk' : "Rider's walk"}
            {walkMin != null ? ` · ${walkMin} min` : ' · calculating…'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
          <span className="text-text-primary font-medium">
            Driver to pickup{driveMin != null ? ` · ${driveMin} min` : ' · calculating…'}
          </span>
        </div>
        {estimatedFare != null && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/50 mt-1">
            <span className="inline-block w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
            <span className="text-text-primary font-medium">
              Fare · {formatCents(estimatedFare)}
              {originalFareCents != null && originalFareCents !== estimatedFare && (
                <span className={estimatedFare < originalFareCents ? ' text-success' : ' text-danger'}>
                  {' '}({estimatedFare < originalFareCents ? '−' : '+'}{formatCents(Math.abs(estimatedFare - originalFareCents))})
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      <button
        onClick={handleViewMap}
        className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-1.5 text-xs font-semibold text-primary active:bg-primary/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        View on Map
      </button>
    </div>
  )
}

/** Text-based dropoff proposal card — replaces mini map with readable info + View on Map */
function DropoffProposalCard({
  dropoffName, pickupLat, pickupLng, dropoffLat, dropoffLng,
  riderDestLat, riderDestLng, riderDestName, onViewMap,
}: {
  dropoffName?: string | null; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number
  riderDestLat?: number | null; riderDestLng?: number | null; riderDestName?: string | null
  onViewMap: (data: MapOverlayData) => void
}) {
  const [routeInfo, setRouteInfo] = useState<{ distance_km: number; duration_min: number; fare_cents: number; polyline: string } | null>(null)

  useEffect(() => {
    void getDirectionsByLatLng(pickupLat, pickupLng, dropoffLat, dropoffLng).then((result) => {
      if (result) {
        const fare = calculateFare(result.distance_km, result.duration_min)
        setRouteInfo({
          distance_km: result.distance_km,
          duration_min: result.duration_min,
          fare_cents: fare.fare_cents,
          polyline: result.polyline,
        })
      }
    })
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng])

  const handleViewMap = () => {
    const points: MapOverlayData['points'] = [
      { lat: pickupLat, lng: pickupLng, label: 'Pickup', color: '#22C55E' },
      { lat: dropoffLat, lng: dropoffLng, label: 'Dropoff', color: '#EF4444' },
    ]
    if (riderDestLat != null && riderDestLng != null) {
      points.push({ lat: riderDestLat, lng: riderDestLng, label: riderDestName ?? 'Final Destination', color: '#6366F1' })
    }
    onViewMap({ type: 'dropoff', points, polyline: routeInfo?.polyline })
  }

  return (
    <div className="rounded-lg bg-surface/60 p-2.5 mb-1.5">
      {dropoffName && (
        <p className="text-xs font-semibold text-text-primary mb-1.5 truncate">{dropoffName}</p>
      )}
      {routeInfo ? (
        <div className="flex items-center gap-3 text-[11px] mb-1.5">
          <span className="font-medium text-text-primary">
            {Math.round(routeInfo.duration_min)} min
          </span>
          <span className="text-text-secondary">&middot;</span>
          <span className="font-medium text-text-primary">
            {(routeInfo.distance_km * 0.621371).toFixed(1)} mi
          </span>
          <span className="text-text-secondary">&middot;</span>
          <span className="font-semibold text-success">
            {formatCents(routeInfo.fare_cents)}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1.5">
          <div className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
          <span className="text-[11px] text-text-secondary">Calculating route...</span>
        </div>
      )}
      {riderDestName && (
        <p className="text-[10px] text-text-secondary mb-1.5 truncate">
          Rider&apos;s destination: {riderDestName}
        </p>
      )}
      <button
        onClick={handleViewMap}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-1.5 text-xs font-semibold text-primary active:bg-primary/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        View on Map
      </button>
    </div>
  )
}

function isMissedScheduledRide(ride: Ride | null): boolean {
  if (!ride || ride.status !== 'cancelled' || !ride.schedule_id || ride.started_at) {
    return false
  }

  const minutesUntilRide = getMinutesUntilRide(ride)
  return minutesUntilRide != null && minutesUntilRide < 0
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MessagingWindow({ 'data-testid': testId }: MessagingWindowProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const profile = useAuthStore((s) => s.profile)
  const currentUserId = profile?.id ?? null

  const [ride, setRide] = useState<Ride | null>(null)
  const rideRef = useRef<Ride | null>(null)

  // Rider's original destination — captured on first load before a dropoff proposal
  // could overwrite ride.destination. Falls back to location state.
  const [riderDestLat, setRiderDestLat] = useState<number | null>(state?.destinationLat ?? null)
  const [riderDestLng, setRiderDestLng] = useState<number | null>(state?.destinationLng ?? null)
  const riderDestCapturedRef = useRef(state?.destinationLat != null)
  const [otherUser, setOtherUser] = useState<Pick<User, 'id' | 'full_name' | 'avatar_url' | 'rating_avg' | 'rating_count'> | null>(null)
  const [otherVehicle, setOtherVehicle] = useState<Pick<Vehicle, 'color' | 'plate' | 'make' | 'model'> | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rideCancelled, setRideCancelled] = useState(false)
  const [cancelModal, setCancelModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [driverCancelledModal, setDriverCancelledModal] = useState(false)

  // Auto-open pickup pin dropper for board rides after acceptance
  const [pickupRequired, setPickupRequired] = useState(false)
  const autoPickupFiredRef = useRef(false)

  // Time-based state for scheduled rides
  const [isRideApproaching, setIsRideApproaching] = useState(false)
  const [minutesUntilRide, setMinutesUntilRide] = useState<number | null>(null)

  // Map pin dropper state
  const [mapOverlay, setMapOverlay] = useState<MapOverlayData | null>(null)
  const [pinMode, setPinMode] = useState<PinMode | null>(null)
  const [pinLat, setPinLat] = useState<number | null>(null)
  const [pinLng, setPinLng] = useState<number | null>(null)
  const [pinNote, setPinNote] = useState('')
  const [submittingPin, setSubmittingPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  // Pin dropper address search state
  const [pinSearchQuery, setPinSearchQuery] = useState('')
  const [pinSearchResults, setPinSearchResults] = useState<PlaceSuggestion[]>([])
  const [pinSearching, setPinSearching] = useState(false)
  const pinSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinSearchMovedRef = useRef(false) // tracks whether pin moved due to search (triggers map pan)

  // Pin dropper route info state
  const [pinRouteInfo, setPinRouteInfo] = useState<{ distance_km: number; duration_min: number; fare_cents: number; polyline: string } | null>(null)
  const [pinRouteLoading, setPinRouteLoading] = useState(false)
  const pinRouteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // For pickup mode: additional drive route from pickup → destination
  const [pinDriveInfo, setPinDriveInfo] = useState<{ distance_km: number; duration_min: number; fare_cents: number; polyline: string } | null>(null)

  // Pin dropper map ref — used to pan map when search selects a location
  const PIN_DROPPER_MAP_ID = 'pin-dropper-map'
  const pinDropperMap = useMap(PIN_DROPPER_MAP_ID)

  // Location acceptance state
  const [acceptingLocation, setAcceptingLocation] = useState<string | null>(null) // 'pickup' or 'dropoff'

  // Transit dropoff suggestion state (driver side)
  const [transitSuggestions, setTransitSuggestions] = useState<TransitDropoffSuggestion[]>([])
  const [transitSuggestionPicked, setTransitSuggestionPicked] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isRider = currentUserId === ride?.rider_id
  rideRef.current = ride
  const pickupConfirmed = ride?.pickup_confirmed ?? false
  const dropoffConfirmed = ride?.dropoff_confirmed ?? false
  const bothConfirmed = pickupConfirmed && dropoffConfirmed

  // Driver destination flow is active — hide suggest buttons until it's done
  const driverDestFlowActive = !isRider && !dropoffConfirmed && !state?.driverDestinationSet && (
    !(ride as Record<string, unknown> | null)?.['driver_destination']
    || (transitSuggestions.length > 0 && !transitSuggestionPicked)
  )

  // Rider-side: driver has set a destination but hasn't picked a drop-off station yet
  const hasTransitDropoffMsg = messages.some(m => m.type === 'transit_dropoff_suggestion')
  const driverSelectingDropoff = isRider && !dropoffConfirmed && !hasTransitDropoffMsg && (
    !!(ride as Record<string, unknown> | null)?.['driver_destination']
  )

  // ── Scroll to bottom when messages change ────────────────────────────────
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // ── Fetch ride + other party info + existing messages ────────────────────
  useEffect(() => {
    if (!rideId) {
      navigate('/home/rider', { replace: true })
      return
    }

    async function fetchData() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

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

      // Capture rider's original destination (before dropoff proposals overwrite it)
      if (!riderDestCapturedRef.current && rideData.destination) {
        const dest = rideData.destination as { type: string; coordinates: [number, number] }
        setRiderDestLat(dest.coordinates[1])
        setRiderDestLng(dest.coordinates[0])
        riderDestCapturedRef.current = true
      }

      const otherId = session.user.id === rideData.rider_id
        ? rideData.driver_id
        : rideData.rider_id

      if (otherId) {
        const { data: userData } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, rating_avg, rating_count')
          .eq('id', otherId)
          .single()

        if (userData) setOtherUser(userData)

        // If the other party is the driver, fetch their vehicle info
        const otherIsDriver = otherId === rideData.driver_id
        if (otherIsDriver) {
          const { data: vehicleData } = await supabase
            .from('vehicles')
            .select('color, plate, make, model')
            .eq('user_id', otherId)
            .eq('is_active', true)
            .maybeSingle()
          if (vehicleData) setOtherVehicle(vehicleData)
        }
      }

      try {
        const resp = await fetch(`/api/messages/${rideId as string}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (resp.ok) {
          const body = (await resp.json()) as { messages: ChatMessage[] }
          setMessages(body.messages ?? [])
        }
      } catch {
        // non-fatal
      }

      setLoading(false)
    }

    void fetchData()
  }, [rideId, navigate])

  // ── Check if scheduled ride is approaching (15 min before) ───────────────
  useEffect(() => {
    const checkRideApproaching = () => {
      setIsRideApproaching(isScheduledRideApproaching(ride, 30, 120))
      setMinutesUntilRide(getMinutesUntilRide(ride))
    }

    // Check immediately
    checkRideApproaching()

    // Then check every minute
    const interval = setInterval(checkRideApproaching, 60000)

    return () => {
      clearInterval(interval)
    }
  }, [ride])

  // ── Subscribe to new messages + cancellation + location confirmations ───
  useEffect(() => {
    if (!rideId) return

    const channel = supabase
      .channel(`chat:${rideId}`)
      .on('broadcast', { event: 'new_message' }, (msg) => {
        const newMsg = msg.payload as ChatMessage
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev
          return [...prev, newMsg]
        })
        // Refresh ride data when a location proposal arrives (updates pickup_point/dropoff_point)
        if (newMsg.type === 'pickup_suggestion' || newMsg.type === 'dropoff_suggestion' || newMsg.type === 'location_accepted' || newMsg.type === 'transit_dropoff_suggestion') {
          supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
            if (data) setRide(data)
          })
        }
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        setRideCancelled(true)
      })
      .on('broadcast', { event: 'driver_cancelled' }, () => {
        // Driver cancelled but ride is re-queued — show modal with options
        if (isRider && rideId) {
          setDriverCancelledModal(true)
        }
      })
      .on('broadcast', { event: 'locations_confirmed' }, () => {
        // Refresh ride data to get updated confirmed flags
        supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
          if (data) setRide(data)
        })
      })
      .on('broadcast', { event: 'transit_suggestions' }, (msg) => {
        const payload = msg.payload as { suggestions?: TransitDropoffSuggestion[]; auto_detected?: boolean }
        if (payload.suggestions) {
          setTransitSuggestions(payload.suggestions)
          // Refresh ride data so driver_destination check updates (especially for auto-detected)
          if (payload.auto_detected) {
            void supabase.from('rides').select('*').eq('id', rideId as string).single().then(({ data }) => {
              if (data) setRide(data)
            })
          }
        }
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [rideId, isRider, navigate, state?.destination, state?.destinationLat, state?.destinationLng])

  // ── Listen for location confirmations on user channels ──────────────────
  useEffect(() => {
    if (!currentUserId || !rideId) return

    const channel = supabase
      .channel(`msg-driver:${currentUserId}`)
      .on('broadcast', { event: 'details_accepted' }, () => {
        supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
          if (data) setRide(data)
        })
      })
      .on('broadcast', { event: 'locations_confirmed' }, () => {
        supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
          if (data) {
            setRide(data)
            // Auto-navigate to pickup page for non-scheduled rides
            if (!data.schedule_id) {
              navigate(
                isRider
                  ? `/ride/pickup-rider/${rideId}`
                  : `/ride/pickup-driver/${rideId}`,
                { replace: true },
              )
            }
          }
        })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, isRider, navigate, rideId])

  // ── Polling fallback for ride status + missed messages ──────────────
  useEffect(() => {
    if (!rideId) return

    const interval = setInterval(() => {
      // 1. Poll ride status
      void supabase
        .from('rides')
        .select('status, driver_id')
        .eq('id', rideId)
        .single()
        .then(({ data }) => {
          if (!data) return

          if (data.status === 'cancelled') {
            setRideCancelled(true)
            clearInterval(interval)
            return
          }

          // Driver cancelled & ride re-queued — show modal
          if (data.status === 'requested' && isRider) {
            setDriverCancelledModal(true)
            clearInterval(interval)
          }
        })

      // 2. Re-fetch messages to catch any missed by Realtime
      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          const resp = await fetch(`/api/messages/${rideId}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (resp.ok) {
            const body = (await resp.json()) as { messages: ChatMessage[] }
            const fresh = body.messages ?? []
            setMessages((prev) => {
              if (fresh.length > prev.length) return fresh
              return prev
            })
          }
        } catch {
          // non-fatal
        }
      })()
    }, 12_000)

    return () => clearInterval(interval)
  }, [rideId, isRider, navigate, state?.destination, state?.destinationLat, state?.destinationLng])

  // ── Send text message ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !rideId || sending) return
    setSending(true)
    setSendError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setSendError('Not authenticated')
        return
      }

      const resp = await fetch(`/api/messages/${rideId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ content: inputText.trim() }),
      })

      if (resp.ok) {
        const body = (await resp.json()) as { message: ChatMessage }
        setMessages((prev) => {
          if (prev.some((m) => m.id === body.message.id)) return prev
          return [...prev, body.message]
        })
        setInputText('')
        inputRef.current?.focus()
      } else {
        setSendError('Failed to send message')
      }
    } catch {
      setSendError('Network error — message not sent')
    } finally {
      setSending(false)
    }
  }, [inputText, rideId, sending])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  // ── Submit location proposal (pickup or dropoff) ───────────────────────
  const handleSubmitProposal = useCallback(async () => {
    if (!rideId || !pinMode || pinLat == null || pinLng == null || submittingPin) return
    setSubmittingPin(true)
    setPinError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setPinError('Not signed in. Please refresh and try again.')
        return
      }

      const endpoint = pinMode === 'pickup'
        ? `/api/rides/${rideId}/pickup-point`
        : `/api/rides/${rideId}/dropoff-point`

      const body = pinMode === 'pickup'
        ? { lat: pinLat, lng: pinLng, note: pinNote.trim() || undefined }
        : { lat: pinLat, lng: pinLng, name: pinNote.trim() || undefined }

      const resp = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })

      if (resp.ok) {
        setPinMode(null)
        setPinNote('')
        setPinLat(null)
        setPinLng(null)
        setPinError(null)
        setPickupRequired(false)
        // Refresh ride data and messages
        const { data: updated } = await supabase.from('rides').select('*').eq('id', rideId).single()
        if (updated) setRide(updated)
        // Re-fetch messages so the proposal appears in chat immediately
        const msgsResp = await fetch(`/api/messages/${rideId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (msgsResp.ok) {
          const msgsBody = (await msgsResp.json()) as { messages: ChatMessage[] }
          setMessages(msgsBody.messages ?? [])
        }
      } else {
        const errBody = await resp.json().catch(() => null) as { error?: { message?: string } } | null
        const msg = errBody?.error?.message ?? `Server error (${resp.status})`
        // eslint-disable-next-line no-console
        console.error('[MessagingWindow] proposal failed:', resp.status, msg)
        setPinError(msg)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MessagingWindow] proposal error:', err)
      setPinError('Network error. Please try again.')
    } finally {
      setSubmittingPin(false)
    }
  }, [rideId, pinMode, pinLat, pinLng, pinNote, submittingPin])

  // ── Accept a location proposal ──────────────────────────────────────────
  const handleAcceptLocation = useCallback(async (locationType: 'pickup' | 'dropoff') => {
    if (!rideId || acceptingLocation) return
    setAcceptingLocation(locationType)
    setSendError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/rides/${rideId}/accept-location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ location_type: locationType }),
      })

      if (resp.ok) {
        trackEvent(locationType === 'dropoff' ? 'dropoff_accepted' : 'pickup_accepted', { ride_id: rideId })
        const body = (await resp.json()) as { both_confirmed: boolean }
        // Refresh ride data
        const { data: updated } = await supabase.from('rides').select('*').eq('id', rideId).single()
        if (updated) setRide(updated)

        // If both confirmed on a search ride, auto-navigate
        if (body.both_confirmed && !ride?.schedule_id) {
          navigate(
            isRider ? `/ride/pickup-rider/${rideId}` : `/ride/pickup-driver/${rideId}`,
            { replace: true },
          )
        }
      } else {
        const errBody = await resp.json().catch(() => null) as { error?: { message?: string } } | null
        const msg = errBody?.error?.message ?? `Failed to accept ${locationType} (${resp.status})`
        // eslint-disable-next-line no-console
        console.error('[MessagingWindow] accept-location failed:', resp.status, msg)
        setSendError(msg)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MessagingWindow] accept-location error:', err)
      setSendError(`Could not accept ${locationType} — please try again`)
    } finally {
      setAcceptingLocation(null)
    }
  }, [rideId, acceptingLocation, ride?.schedule_id, isRider, navigate])

  // ── Cancel ride ─────────────────────────────────────────────────────────
  const handleCancelRide = useCallback(async () => {
    if (!rideId || cancelling) return
    setCancelling(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const resp = await fetch(`/api/rides/${rideId}/cancel`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (resp.ok) {
        navigate('/rides', { replace: true })
      }
    } catch {
      // non-fatal
    } finally {
      setCancelling(false)
      setCancelModal(false)
    }
  }, [rideId, cancelling, navigate])

  // ── Determine latest proposals per type ─────────────────────────────────
  const latestPickupProposal = [...messages].reverse().find((m) => m.type === 'pickup_suggestion')
  const latestDropoffProposal = [...messages].reverse().find((m) => m.type === 'dropoff_suggestion' || m.type === 'transit_dropoff_suggestion')

  const pickupProposedByOther = latestPickupProposal &&
    (latestPickupProposal.meta as Record<string, unknown> | null)?.proposed_by !== currentUserId
  const dropoffProposedByOther = latestDropoffProposal &&
    (latestDropoffProposal.meta as Record<string, unknown> | null)?.proposed_by !== currentUserId

  // ── Open pin dropper ────────────────────────────────────────────────────
  // Pickup: start near rider's address (origin). User drags to fine-tune.
  // Dropoff: start at last proposed dropoff (or rider destination). User adjusts.
  const openPinDropper = useCallback((mode: PinMode) => {
    setPinMode(mode)
    setPinNote('')
    setPinRouteInfo(null)
    setPinDriveInfo(null)
    setPinSearchQuery('')
    setPinSearchResults([])

    if (mode === 'pickup') {
      // Pickup: pin starts near rider's address
      // 1. If there's an existing pickup proposal, start there (user is countering)
      const proposalMeta = latestPickupProposal?.meta as { lat?: number; lng?: number } | null
      if (proposalMeta?.lat != null && proposalMeta?.lng != null) {
        setPinLat(proposalMeta.lat)
        setPinLng(proposalMeta.lng)
        return
      }
      // 2. Existing pickup point on ride
      if (ride?.pickup_point) {
        setPinLat(ride.pickup_point.coordinates[1])
        setPinLng(ride.pickup_point.coordinates[0])
        return
      }
      // 3. Rider's origin — the natural starting point for pickup
      if (ride?.origin) {
        setPinLat(ride.origin.coordinates[1])
        setPinLng(ride.origin.coordinates[0])
        return
      }
    } else {
      // Dropoff: pin starts at last proposed dropoff location
      // 1. Latest dropoff proposal (what the other party suggested)
      const proposalMeta = latestDropoffProposal?.meta as { lat?: number; lng?: number } | null
      if (proposalMeta?.lat != null && proposalMeta?.lng != null) {
        setPinLat(proposalMeta.lat)
        setPinLng(proposalMeta.lng)
        return
      }
      // 2. Existing dropoff point on ride
      if (ride?.dropoff_point) {
        setPinLat(ride.dropoff_point.coordinates[1])
        setPinLng(ride.dropoff_point.coordinates[0])
        return
      }
      // 3. Rider's destination
      if (ride?.destination) {
        setPinLat(ride.destination.coordinates[1])
        setPinLng(ride.destination.coordinates[0])
        return
      }
    }

    // Last resort — GPS or Davis default
    setPinLat(38.54)
    setPinLng(-121.76)
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setPinLat(pos.coords.latitude); setPinLng(pos.coords.longitude) },
        () => { /* keep default */ },
        { enableHighAccuracy: true, timeout: 5000 },
      )
    }
  }, [ride, latestPickupProposal, latestDropoffProposal])

  // ── Auto-open pickup pin dropper for board rides after acceptance ────────
  useEffect(() => {
    if (
      autoPickupFiredRef.current ||
      loading ||
      !ride ||
      !state?.autoOpenPickup ||
      !ride.schedule_id
    ) return

    // Only auto-open if no pickup has been proposed yet
    const hasPickup = messages.some((m) => m.type === 'pickup_suggestion')
    if (hasPickup) return

    autoPickupFiredRef.current = true
    setPickupRequired(true)
    openPinDropper('pickup')

    // Clear navigation state so refresh doesn't re-trigger
    navigate(location.pathname, { replace: true, state: null })
  }, [loading, ride, state?.autoOpenPickup, messages, openPinDropper, navigate, location.pathname])

  // ── Pin dropper: debounced address search ─────────────────────────────────
  const handlePinSearch = useCallback((query: string) => {
    setPinSearchQuery(query)
    if (pinSearchTimer.current) clearTimeout(pinSearchTimer.current)
    if (!query.trim()) {
      setPinSearchResults([])
      return
    }
    setPinSearching(true)
    pinSearchTimer.current = setTimeout(() => {
      void searchPlaces(query).then((results) => {
        setPinSearchResults(results)
        setPinSearching(false)
      })
    }, 300)
  }, [])

  // ── Pin dropper: select a search result ───────────────────────────────────
  const handlePinSearchSelect = useCallback(async (suggestion: PlaceSuggestion) => {
    setPinSearchQuery(suggestion.mainText)
    setPinSearchResults([])
    setPinNote(suggestion.mainText)
    if (suggestion.lat != null && suggestion.lng != null) {
      pinSearchMovedRef.current = true
      setPinLat(suggestion.lat)
      setPinLng(suggestion.lng)
      pinDropperMap?.panTo({ lat: suggestion.lat, lng: suggestion.lng })
    } else {
      const coords = await getPlaceCoordinates(suggestion.placeId)
      if (coords) {
        pinSearchMovedRef.current = true
        setPinLat(coords.lat)
        setPinLng(coords.lng)
        pinDropperMap?.panTo({ lat: coords.lat, lng: coords.lng })
      }
    }
  }, [pinDropperMap])

  // ── Pin dropper: fetch route info when pin moves ──────────────────────────
  useEffect(() => {
    if (!pinMode || pinLat == null || pinLng == null) return

    const originCoords = ride?.origin?.coordinates
    const pickupCoords = ride?.pickup_point?.coordinates
    const destCoords = ride?.destination?.coordinates
    const rDestLat = riderDestLat ?? destCoords?.[1] ?? null
    const rDestLng = riderDestLng ?? destCoords?.[0] ?? null

    let routeOriginLat: number | null = null
    let routeOriginLng: number | null = null

    if (pinMode === 'dropoff') {
      // For dropoff: route from pickup point (or origin) to proposed dropoff
      if (pickupCoords) {
        routeOriginLat = pickupCoords[1]
        routeOriginLng = pickupCoords[0]
      } else if (originCoords) {
        routeOriginLat = originCoords[1]
        routeOriginLng = originCoords[0]
      }
    } else {
      // For pickup: walk route from rider origin to proposed pickup
      if (originCoords) {
        routeOriginLat = originCoords[1]
        routeOriginLng = originCoords[0]
      }
    }

    if (routeOriginLat == null || routeOriginLng == null) return

    if (pinRouteTimer.current) clearTimeout(pinRouteTimer.current)
    setPinRouteLoading(true)

    const oLat = routeOriginLat
    const oLng = routeOriginLng
    const dLat = pinLat
    const dLng = pinLng
    const mode = pinMode

    pinRouteTimer.current = setTimeout(() => {
      const walkOrDrive = mode === 'pickup' ? 'WALK' as const : 'DRIVE' as const

      // Primary route: origin → pin (walk for pickup, drive for dropoff)
      const primaryPromise = getDirectionsByLatLng(oLat, oLng, dLat, dLng, walkOrDrive).then((result) => {
        if (result) {
          const fare = calculateFare(result.distance_km, result.duration_min)
          setPinRouteInfo({
            distance_km: result.distance_km,
            duration_min: result.duration_min,
            fare_cents: fare.fare_cents,
            polyline: result.polyline,
          })
        }
      })

      // For pickup mode: also fetch drive route from proposed pickup → destination (for fare estimate)
      const drivePromise = mode === 'pickup' && rDestLat != null && rDestLng != null
        ? getDirectionsByLatLng(dLat, dLng, rDestLat, rDestLng, 'DRIVE').then((result) => {
            if (result) {
              const fare = calculateFare(result.distance_km, result.duration_min)
              setPinDriveInfo({
                distance_km: result.distance_km,
                duration_min: result.duration_min,
                fare_cents: fare.fare_cents,
                polyline: result.polyline,
              })
            } else {
              setPinDriveInfo(null)
            }
          })
        : Promise.resolve(setPinDriveInfo(null))

      void Promise.all([primaryPromise, drivePromise]).then(() => setPinRouteLoading(false))
    }, 500)

    return () => {
      if (pinRouteTimer.current) clearTimeout(pinRouteTimer.current)
    }
  }, [pinMode, pinLat, pinLng, ride?.pickup_point?.coordinates, ride?.origin?.coordinates, ride?.destination?.coordinates, riderDestLat, riderDestLng])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!ride) {
    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <p className="text-center text-danger" data-testid="error-message">{error ?? 'Ride not found'}</p>
        <button type="button" onClick={() => navigate(isRider ? '/home/rider' : '/home/driver', { replace: true })} className="rounded-2xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  const missedScheduledRide = isMissedScheduledRide(ride)

  if (rideCancelled && !missedScheduledRide) {
    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <div className="h-16 w-16 rounded-full bg-danger/10 flex items-center justify-center mb-2">
          <span className="text-3xl">&#x274C;</span>
        </div>
        <h2 className="text-lg font-bold text-text-primary">Ride Cancelled</h2>
        <p className="text-sm text-text-secondary text-center">
          The {isRider ? 'driver' : 'rider'} has cancelled this ride.
        </p>
        <button
          type="button"
          data-testid="cancelled-go-rides"
          onClick={() => navigate('/rides', { replace: true })}
          className="mt-2 rounded-2xl bg-primary px-8 py-3 font-semibold text-white"
        >
          Back to My Rides
        </button>
      </div>
    )
  }

  // ── Ride Missed — scheduled ride passed its trip time without starting ───
  if (missedScheduledRide) {
    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6">
        <div className="h-16 w-16 rounded-full bg-warning/10 flex items-center justify-center mb-2">
          <span className="text-3xl">&#x23F0;</span>
        </div>
        <h2 className="text-lg font-bold text-text-primary">Ride Missed</h2>
        <p className="text-sm text-text-secondary text-center">
          This scheduled ride was not started and has expired.
        </p>
        <button
          type="button"
          data-testid="missed-go-rides"
          onClick={() => navigate('/rides', { replace: true })}
          className="mt-2 rounded-2xl bg-primary px-8 py-3 font-semibold text-white"
        >
          Back to My Rides
        </button>
      </div>
    )
  }

  // ── Pin dropper overlay ─────────────────────────────────────────────────
  if (pinMode && pinLat != null && pinLng != null) {
    const riderDestName = ride?.destination_name ?? null

    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 border-b border-border bg-white z-10 shrink-0"
          style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
        >
          {!(pickupRequired && pinMode === 'pickup') && (
            <button
              data-testid="pin-back-button"
              onClick={() => { setPinMode(null); setPinSearchQuery(''); setPinSearchResults([]); setPinRouteInfo(null) }}
              className="p-1 shrink-0 text-text-primary active:opacity-60"
              aria-label="Cancel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="m12 5-7 7 7 7" />
              </svg>
            </button>
          )}
          <h2 className="text-sm font-bold text-text-primary">
            {pinMode === 'pickup' ? 'Suggest Pickup Point' : 'Suggest Dropoff Point'}
          </h2>
        </div>

        {/* Map — focused on the pin location only, no zoom-out */}
        <div className="flex-1 relative">
          <Map
            id={PIN_DROPPER_MAP_ID}
            mapId={MAP_ID}
            defaultCenter={{ lat: pinLat, lng: pinLng }}
            defaultZoom={16}
            gestureHandling="greedy"
            disableDefaultUI
            className="absolute inset-0"
            onClick={(e) => {
              const latLng = e.detail.latLng
              if (latLng) {
                setPinLat(latLng.lat)
                setPinLng(latLng.lng)
                setPinSearchResults([])
              }
            }}
          >
            {/* Draggable teardrop pin — the only marker on the map */}
            <AdvancedMarker
              position={{ lat: pinLat, lng: pinLng }}
              title={pinMode === 'pickup' ? 'Drag to set pickup' : 'Drag to set dropoff'}
              draggable
              onDragEnd={(e) => {
                const pos = e.latLng
                if (pos) {
                  setPinLat(pos.lat())
                  setPinLng(pos.lng())
                }
              }}
            >
              {/* Map pin — proper teardrop SVG */}
              <div className="flex flex-col items-center" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
                <svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 16.2 28.8 17.4 30 .36.36.84.36 1.2 0C19.8 46.8 36 30.6 36 18 36 8.06 27.94 0 18 0z" fill={pinMode === 'pickup' ? '#22C55E' : '#EF4444'} />
                  <circle cx="18" cy="18" r="7" fill="white" />
                </svg>
              </div>
            </AdvancedMarker>
          </Map>

          {/* Instruction overlay */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-lg">
            <p className="text-[11px] font-medium text-text-primary">Tap map or search to set location</p>
          </div>
        </div>

        {/* Route info card */}
        <div className="px-4 pt-2.5 border-t border-border bg-white shrink-0">
          {pinRouteLoading && !pinRouteInfo && (
            <div className="flex items-center gap-2 py-1.5">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-text-secondary">Calculating route...</span>
            </div>
          )}
          {pinRouteInfo && (
            <div className="space-y-1.5 pb-1">
              {/* Pickup mode: show walk to pickup + drive to destination */}
              {pinMode === 'pickup' ? (
                <>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#6366F1] shrink-0" />
                    <span className="text-text-primary font-medium">
                      Walk to pickup &middot; {Math.round(pinRouteInfo.duration_min)} min
                    </span>
                  </div>
                  {pinDriveInfo && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="inline-block w-2 h-2 rounded-full bg-success shrink-0" />
                      <span className="text-text-primary font-medium">
                        Drive to destination &middot; {Math.round(pinDriveInfo.duration_min)} min &middot; {(pinDriveInfo.distance_km * 0.621371).toFixed(1)} mi
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] pt-0.5 border-t border-border/50">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#F59E0B] shrink-0" />
                    <span className="text-text-primary font-semibold">
                      Est. fare &middot; {formatCents(pinDriveInfo?.fare_cents ?? pinRouteInfo.fare_cents)}
                    </span>
                  </div>
                </>
              ) : (
                /* Dropoff mode: show single drive route */
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1 text-text-primary font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-primary" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {Math.round(pinRouteInfo.duration_min)} min
                  </span>
                  <span className="flex items-center gap-1 text-text-primary font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-primary" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {(pinRouteInfo.distance_km * 0.621371).toFixed(1)} mi
                  </span>
                  <span className="flex items-center gap-1 text-text-primary font-semibold">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-success" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    {formatCents(pinRouteInfo.fare_cents)}
                  </span>
                </div>
              )}
              {riderDestName && (
                <p className="text-[11px] text-text-secondary truncate">
                  Rider&apos;s destination: {riderDestName}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Transit info for dropoff mode */}
        {pinMode === 'dropoff' && riderDestLat != null && riderDestLng != null && (
          <div className="px-4 pt-1 border-t border-border/50 bg-white shrink-0">
            <TransitInfo
              dropoffLat={pinLat}
              dropoffLng={pinLng}
              destLat={riderDestLat}
              destLng={riderDestLng}
              data-testid="pin-dropper-transit-info"
            />
          </div>
        )}

        {/* Bottom panel */}
        <div
          className="px-4 pt-3 pb-4 border-t border-border bg-white space-y-3 shrink-0"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        >
          <div className="relative z-20">
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                data-testid="pin-search-input"
                type="text"
                value={pinSearchQuery}
                onChange={(e) => handlePinSearch(e.target.value)}
                placeholder="Search an address..."
                className="w-full rounded-2xl border border-border bg-surface pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="off"
              />
              {pinSearchQuery && (
                <button
                  onClick={() => { setPinSearchQuery(''); setPinSearchResults([]) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-text-secondary active:opacity-60"
                  aria-label="Clear search"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Search results dropdown */}
            {pinSearchResults.length > 0 && (
              <div className="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-xl border border-border shadow-lg max-h-48 overflow-y-auto z-30">
                {pinSearchResults.map((s) => (
                  <button
                    key={s.placeId}
                    data-testid={`pin-search-result-${s.placeId}`}
                    onClick={() => { void handlePinSearchSelect(s) }}
                    className="w-full text-left px-4 py-3 border-b border-border/50 last:border-b-0 active:bg-surface transition-colors"
                  >
                    <p className="text-sm font-medium text-text-primary truncate">{s.mainText}</p>
                    <p className="text-xs text-text-secondary truncate">{s.secondaryText}</p>
                  </button>
                ))}
              </div>
            )}
            {pinSearching && pinSearchQuery.trim() && pinSearchResults.length === 0 && (
              <div className="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-xl border border-border shadow-lg px-4 py-3 z-30">
                <p className="text-xs text-text-secondary">Searching...</p>
              </div>
            )}
          </div>

          <input
            data-testid="pin-note-input"
            type="text"
            value={pinNote}
            onChange={(e) => setPinNote(e.target.value)}
            placeholder={pinMode === 'pickup' ? 'Add a note (e.g. "By the fountain")' : 'Location name (optional)'}
            className="w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {pinError && (
            <p className="text-sm text-danger text-center" role="alert">{pinError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setPinMode(null); setPinError(null); setPinSearchQuery(''); setPinSearchResults([]); setPinRouteInfo(null) }}
              className="flex-1 rounded-2xl py-3 text-sm font-semibold text-text-secondary bg-surface active:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              data-testid="pin-submit-button"
              onClick={() => { void handleSubmitProposal() }}
              disabled={submittingPin}
              className={`flex-1 rounded-2xl py-3 text-sm font-semibold text-white active:opacity-90 disabled:opacity-50 transition-colors ${pinMode === 'pickup' ? 'bg-success' : 'bg-primary'}`}
            >
              {submittingPin ? 'Sending...' : `Suggest ${pinMode === 'pickup' ? 'Pickup' : 'Dropoff'}`}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main messaging view ─────────────────────────────────────────────────
  return (
    <div data-testid={testId ?? 'messaging-window'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">

      {/* ── Full-screen map overlay ──────────────────────────────────────── */}
      {mapOverlay && (
        <ProposalMapOverlay data={mapOverlay} onClose={() => setMapOverlay(null)} />
      )}

      {/* ── Header (fixed) ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white z-10 shrink-0"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <button
          data-testid="back-button"
          onClick={() => {
            const status = ride?.status
            if (status === 'active') {
              navigate(isRider ? `/ride/active-rider/${rideId as string}` : `/ride/active-driver/${rideId as string}`, { replace: true })
            } else if (status === 'coordinating' && !ride?.schedule_id) {
              navigate(isRider ? `/ride/pickup-rider/${rideId as string}` : `/ride/pickup-driver/${rideId as string}`, { replace: true })
            } else {
              // For accepted/requested: go to My Rides (preserving history so user can come back)
              navigate('/rides')
            }
          }}
          className="p-1 shrink-0 text-text-primary active:opacity-60"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M19 12H5" />
            <path d="m12 5-7 7 7 7" />
          </svg>
        </button>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
            {otherUser?.full_name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p data-testid="other-user-name" className="text-sm font-semibold text-text-primary truncate">
              {otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')}
            </p>
            {otherUser?.rating_avg != null && (
              <p className="text-xs text-text-secondary">&#x2B50; {otherUser.rating_avg.toFixed(1)}</p>
            )}
          </div>
        </div>

        <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
          ride.status === 'active' ? 'text-success bg-success/10' :
          bothConfirmed ? 'text-success bg-success/10' : 'text-warning bg-warning/10'
        }`}>
          {ride.status === 'active' ? 'In Progress' : bothConfirmed ? 'Confirmed' : 'Negotiating'}
        </span>

        {/* Cancel ride button in header — visible before ride is active */}
        {ride.status !== 'active' && ride.status !== 'completed' && ride.status !== 'cancelled' && (
          <button
            data-testid="header-cancel-button"
            onClick={() => setCancelModal(true)}
            className="ml-1 p-1.5 shrink-0 text-danger active:opacity-60"
            aria-label="Cancel ride"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Location status bar (hidden during active ride) ────────────────── */}
      {ride.status !== 'active' && ride.status !== 'completed' && ride.status !== 'cancelled' && (
      <div className="px-4 py-2 bg-surface border-b border-border flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${pickupConfirmed ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-xs text-text-secondary">Pickup</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dropoffConfirmed ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-xs text-text-secondary">Dropoff</span>
        </div>
        {bothConfirmed && (
          <span className="ml-auto text-xs font-medium text-success">Both locations agreed!</span>
        )}
      </div>
      )}

      {/* ── Ride in progress banner ─────────────────────────────────────────── */}
      {ride.status === 'active' && (
        <div className="px-4 py-2 bg-success/10 border-b border-border text-center shrink-0">
          <span className="text-xs font-semibold text-success tracking-wider">RIDE IN PROGRESS</span>
        </div>
      )}

      {/* ── Driver selecting dropoff banner (rider only) ──────────────────── */}
      {driverSelectingDropoff && ride.status !== 'active' && ride.status !== 'completed' && ride.status !== 'cancelled' && (
        <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/10 flex items-center gap-2.5 shrink-0" data-testid="driver-selecting-dropoff-banner">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
          <p className="text-xs text-text-primary">
            <span className="font-semibold">{otherUser?.full_name ?? 'Driver'}</span>
            {' '}is choosing a drop-off point&hellip;
          </p>
        </div>
      )}

      {/* ── Pending pickup banner — compact: label + buttons only ─── */}
      {!pickupConfirmed && pickupProposedByOther && latestPickupProposal && (
        <div data-testid="pickup-proposal-banner" className="px-4 py-2.5 bg-success/10 border-b border-success/20 shrink-0">
          <p className="text-xs font-semibold text-success mb-2">
            {otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')} suggested a pickup point
          </p>
          <div className="flex gap-2">
            <button
              data-testid="banner-accept-pickup"
              onClick={() => { void handleAcceptLocation('pickup') }}
              disabled={acceptingLocation === 'pickup'}
              className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-white bg-success active:bg-success/90 disabled:opacity-50 transition-colors"
            >
              {acceptingLocation === 'pickup' ? 'Accepting...' : 'Accept Pickup'}
            </button>
            <button
              data-testid="banner-counter-pickup"
              onClick={() => openPinDropper('pickup')}
              className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-success bg-success/10 border border-success/30 active:bg-success/20 transition-colors"
            >
              Counter Offer
            </button>
          </div>
        </div>
      )}

      {/* ── Pending dropoff banner — compact: label + buttons only ─── */}
      {!dropoffConfirmed && dropoffProposedByOther && latestDropoffProposal && (() => {
        const meta = latestDropoffProposal.meta as { name?: string } | null
        const dropoffName = meta?.name ? String(meta.name) : null
        return (
          <div data-testid="dropoff-proposal-banner" className="px-4 py-2.5 bg-primary/10 border-b border-primary/20 shrink-0">
            <p className="text-xs font-semibold text-primary mb-1">
              {otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')} suggested a dropoff
              {dropoffName && <span className="text-text-primary font-medium"> — {dropoffName}</span>}
            </p>
            <div className="flex gap-2">
              <button
                data-testid="banner-accept-dropoff"
                onClick={() => { void handleAcceptLocation('dropoff') }}
                disabled={acceptingLocation === 'dropoff'}
                className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-white bg-primary active:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {acceptingLocation === 'dropoff' ? 'Accepting...' : 'Accept Dropoff'}
              </button>
              <button
                data-testid="banner-counter-dropoff"
                onClick={() => openPinDropper('dropoff')}
                className="flex-1 rounded-2xl py-2.5 text-sm font-semibold text-primary bg-primary/10 border border-primary/30 active:bg-primary/20 transition-colors"
              >
                Counter Offer
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── Vehicle info bar (rider side only — no duplicate name) ──────── */}
      {otherVehicle && (
        <div data-testid="vehicle-details" className="px-4 py-2 bg-white border-b border-border flex items-center gap-2.5 shrink-0">
          <span className="text-base">&#x1F697;</span>
          <p className="text-xs font-medium text-text-primary">
            {otherVehicle.color} {otherVehicle.make} {otherVehicle.model}
          </p>
          <p data-testid="vehicle-badge" className="ml-auto text-xs font-bold text-primary tracking-wide">
            {otherVehicle.plate}
          </p>
        </div>
      )}

      {/* ── Destination info banner ────────────────────────────────────────── */}
      {state?.destination && (
        <div className="px-4 py-2.5 bg-surface border-b border-border flex items-center gap-2 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-primary" aria-hidden="true">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <p data-testid="destination-name" className="text-xs font-medium text-text-primary truncate">
            {state.destination.mainText}
          </p>
        </div>
      )}

      {/* ── Schedule banner ────────────────────────────────────────────────── */}
      {!state?.destination && ride?.schedule_id && (ride.destination_name ?? ride.trip_date) && (
        <div data-testid="schedule-banner" className="px-4 py-2.5 bg-primary/5 border-b border-border space-y-1 shrink-0">
          {ride.destination_name && (
            <div className="flex items-center gap-2">
              <span className="text-danger text-xs">&#x25CF;</span>
              <p className="text-xs font-medium text-text-primary truncate">{ride.destination_name}</p>
            </div>
          )}
          {(ride.trip_date ?? ride.trip_time) && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              {ride.trip_date && (
                <span>{new Date(ride.trip_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              )}
              {ride.trip_time && (
                <span>{(() => { const [h, m] = ride.trip_time.split(':').map(Number); if (h === undefined || m === undefined) return ride.trip_time; return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` })()}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Driver destination + transit suggestion cards (driver only) ─── */}
      {!isRider && ride && !(ride as Record<string, unknown>)['driver_destination'] && !dropoffConfirmed && !state?.driverDestinationSet && (
        ride.status === 'accepted' || ride.status === 'coordinating' || ride.status === 'requested'
      ) && (
        <DriverDestinationCard
          rideId={rideId as string}
          driverId={currentUserId as string}
          onSuggestionsReceived={(suggestions) => {
            setTransitSuggestions(suggestions)
            void supabase.from('rides').select('*').eq('id', rideId as string).single().then(({ data }) => {
              if (data) setRide(data)
            })
          }}
        />
      )}

      {/* Transit suggestion picker (driver picks a station) */}
      {!isRider && transitSuggestions.length > 0 && !transitSuggestionPicked && !dropoffConfirmed && (
        <TransitSuggestionPicker
          rideId={rideId as string}
          suggestions={transitSuggestions}
          driverRoutePolyline={(ride as Record<string, unknown>)['driver_route_polyline'] as string | null ?? null}
          pickupLat={ride.origin?.coordinates?.[1] ?? null}
          pickupLng={ride.origin?.coordinates?.[0] ?? null}
          riderDestLat={riderDestLat}
          riderDestLng={riderDestLng}
          riderDestName={ride.destination_name ?? null}
          driverDestLat={((ride as Record<string, unknown>)['driver_destination'] as { coordinates?: [number, number] } | null)?.coordinates?.[1] ?? null}
          driverDestLng={((ride as Record<string, unknown>)['driver_destination'] as { coordinates?: [number, number] } | null)?.coordinates?.[0] ?? null}
          driverDestName={(ride as Record<string, unknown>)['driver_destination_name'] as string | null ?? null}
          onPicked={() => {
            setTransitSuggestionPicked(true)
            setTransitSuggestions([])
          }}
        />
      )}

      {/* ── Messages area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="messages-list">
        {messages.length === 0 && !driverDestFlowActive && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary">Coordinate your ride</p>
            <p className="text-xs text-text-secondary mt-1">
              Suggest pickup and dropoff locations to get started
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isMine = msg.sender_id === currentUserId

          // ── Special message: pickup_suggestion — rich card with map + route info ──
          if (msg.type === 'pickup_suggestion') {
            const meta = msg.meta as { lat?: number; lng?: number; note?: string | null; proposed_by?: string } | null
            const hasLocation = meta?.lat != null && meta?.lng != null
            const isLatestPickup = msg.id === latestPickupProposal?.id
            const canAccept = isLatestPickup && pickupProposedByOther && !pickupConfirmed
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <div className="w-full max-w-[85%] rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-6 w-6 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-success" aria-hidden="true">
                          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-success">
                        {isMine ? 'You suggested a pickup point' : `${otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')} suggested a pickup point`}
                      </p>
                    </div>
                    {meta?.note && (
                      <p className="text-xs text-text-secondary mb-2">&quot;{meta.note}&quot;</p>
                    )}
                    {/* Route info card + View on Map */}
                    {hasLocation && ride?.origin && (
                      <PickupProposalCard
                        originLat={(ride.origin as { coordinates: [number, number] }).coordinates[1]}
                        originLng={(ride.origin as { coordinates: [number, number] }).coordinates[0]}
                        pickupLat={meta.lat as number}
                        pickupLng={meta.lng as number}
                        isRider={isRider}
                        driverId={ride.driver_id}
                        destLat={ride.destination ? (ride.destination as { coordinates: [number, number] }).coordinates[1] : null}
                        destLng={ride.destination ? (ride.destination as { coordinates: [number, number] }).coordinates[0] : null}
                        originalFareCents={ride.fare_cents}
                        onViewMap={setMapOverlay}
                      />
                    )}
                    {pickupConfirmed && isLatestPickup && (
                      <p className="text-xs text-success font-medium mt-1">&#x2713; Accepted</p>
                    )}
                    <p className="text-[10px] text-text-secondary mt-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                {/* Accept / Counter Offer buttons for the other party */}
                {canAccept && (
                  <div className="flex gap-2 max-w-[85%] mx-auto">
                    <button
                      data-testid="accept-pickup-button"
                      onClick={() => { void handleAcceptLocation('pickup') }}
                      disabled={acceptingLocation === 'pickup'}
                      className="flex-1 rounded-2xl py-2 text-xs font-semibold text-white bg-success active:bg-success/90 disabled:opacity-50"
                    >
                      {acceptingLocation === 'pickup' ? 'Accepting...' : 'Accept Pickup'}
                    </button>
                    <button
                      data-testid="counter-pickup-button"
                      onClick={() => openPinDropper('pickup')}
                      className="flex-1 rounded-2xl py-2 text-xs font-semibold text-success bg-success/10 active:bg-success/20"
                    >
                      Counter Offer
                    </button>
                  </div>
                )}
              </div>
            )
          }

          // ── Special message: dropoff_suggestion — rich card with map + route info ──
          if (msg.type === 'dropoff_suggestion') {
            const meta = msg.meta as { lat?: number; lng?: number; name?: string | null; proposed_by?: string } | null
            const hasLocation = meta?.lat != null && meta?.lng != null
            const isLatestDropoff = msg.id === latestDropoffProposal?.id
            const canAccept = isLatestDropoff && dropoffProposedByOther && !dropoffConfirmed
            const pLat = ride?.pickup_point?.coordinates?.[1] ?? ride?.origin?.coordinates?.[1]
            const pLng = ride?.pickup_point?.coordinates?.[0] ?? ride?.origin?.coordinates?.[0]
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <div className="w-full max-w-[85%] rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-primary" aria-hidden="true">
                          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-primary">
                        {isMine ? 'You suggested a dropoff point' : `${otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')} suggested a dropoff point`}
                      </p>
                    </div>
                    {/* Route info card + View on Map */}
                    {hasLocation && pLat != null && pLng != null && (
                      <DropoffProposalCard
                        dropoffName={meta?.name}
                        pickupLat={pLat}
                        pickupLng={pLng}
                        dropoffLat={meta.lat as number}
                        dropoffLng={meta.lng as number}
                        riderDestLat={riderDestLat}
                        riderDestLng={riderDestLng}
                        riderDestName={ride?.destination_name}
                        onViewMap={setMapOverlay}
                      />
                    )}

                    {/* Transit options from dropoff (rider only) */}
                    {isRider && hasLocation && riderDestLat != null && riderDestLng != null && (
                      <TransitInfo
                        dropoffLat={meta.lat as number}
                        dropoffLng={meta.lng as number}
                        destLat={riderDestLat}
                        destLng={riderDestLng}
                        data-testid={`msg-transit-info-${msg.id}`}
                      />
                    )}
                    {dropoffConfirmed && isLatestDropoff && (
                      <p className="text-xs text-success font-medium mt-1">&#x2713; Accepted</p>
                    )}
                    <p className="text-[10px] text-text-secondary mt-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                {/* Accept / Counter Offer buttons */}
                {canAccept && (
                  <div className="flex gap-2 max-w-[85%] mx-auto">
                    <button
                      data-testid="accept-dropoff-button"
                      onClick={() => { void handleAcceptLocation('dropoff') }}
                      disabled={acceptingLocation === 'dropoff'}
                      className="flex-1 rounded-2xl py-2 text-xs font-semibold text-white bg-primary active:bg-primary/90 disabled:opacity-50"
                    >
                      {acceptingLocation === 'dropoff' ? 'Accepting...' : 'Accept Dropoff'}
                    </button>
                    <button
                      data-testid="counter-dropoff-button"
                      onClick={() => openPinDropper('dropoff')}
                      className="flex-1 rounded-2xl py-2 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20"
                    >
                      Counter Offer
                    </button>
                  </div>
                )}
              </div>
            )
          }

          // ── Special message: transit_dropoff_suggestion ──
          if (msg.type === 'transit_dropoff_suggestion') {
            const meta = msg.meta as {
              station_name?: string
              station_lat?: number
              station_lng?: number
              station_address?: string
              transit_options?: Array<{ type: string; icon: string; line_name: string; departure_stop?: string; arrival_stop?: string; duration_minutes?: number; walk_minutes: number; total_minutes: number }>
              walk_to_station_minutes?: number
              transit_to_dest_minutes?: number
              total_rider_minutes?: number
              proposed_by?: string
              transit_polyline?: string | null
              rider_progress_pct?: number | null
              ride_with_driver_minutes?: number | null
              full_transit_minutes?: number | null
              pickup_lat?: number | null
              pickup_lng?: number | null
              rider_dest_lat?: number | null
              rider_dest_lng?: number | null
              rider_dest_name?: string | null
              driver_dest_lat?: number | null
              driver_dest_lng?: number | null
              driver_dest_name?: string | null
              driver_route_polyline?: string | null
            } | null
            const isLatestDropoff = msg.id === latestDropoffProposal?.id
            const canAcceptTransit = isLatestDropoff && dropoffProposedByOther && !dropoffConfirmed
            const suggestion = meta ? {
              station_name: meta.station_name ?? 'Transit Station',
              station_lat: meta.station_lat ?? 0,
              station_lng: meta.station_lng ?? 0,
              station_place_id: '',
              station_address: meta.station_address ?? '',
              transit_options: meta.transit_options ?? [],
              walk_to_station_minutes: meta.walk_to_station_minutes ?? 0,
              driver_detour_minutes: 0,
              transit_to_dest_minutes: meta.transit_to_dest_minutes ?? 0,
              total_rider_minutes: meta.total_rider_minutes ?? 0,
              ride_with_driver_minutes: meta.ride_with_driver_minutes ?? undefined,
              full_transit_minutes: meta.full_transit_minutes ?? undefined,
              rider_progress_pct: meta.rider_progress_pct ?? undefined,
              transit_polyline: meta.transit_polyline ?? null,
            } : null

            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <div className="w-full max-w-[85%]">
                    {suggestion && (
                      <TransitSuggestionCard
                        suggestion={suggestion}
                        isRider={isRider}
                        onAccept={canAcceptTransit ? () => { void handleAcceptLocation('dropoff') } : undefined}
                        onCounter={canAcceptTransit ? () => openPinDropper('dropoff') : undefined}
                        transitPolyline={meta?.transit_polyline ?? null}
                        pickupLat={meta?.pickup_lat ?? null}
                        pickupLng={meta?.pickup_lng ?? null}
                        riderDestLat={meta?.rider_dest_lat ?? null}
                        riderDestLng={meta?.rider_dest_lng ?? null}
                        riderDestName={meta?.rider_dest_name ?? null}
                        driverDestLat={meta?.driver_dest_lat ?? null}
                        driverDestLng={meta?.driver_dest_lng ?? null}
                        driverDestName={meta?.driver_dest_name ?? null}
                        driverRoutePolyline={meta?.driver_route_polyline ?? null}
                        data-testid={`transit-suggestion-${msg.id}`}
                      />
                    )}
                    {dropoffConfirmed && isLatestDropoff && (
                      <p className="text-xs text-success font-medium mt-1">&#x2713; Accepted</p>
                    )}
                    <p className="text-[10px] text-text-secondary mt-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            )
          }

          // ── Special message: location_accepted — full journey card ──
          if (msg.type === 'location_accepted') {
            const meta = msg.meta as { location_type?: string; lat?: number; lng?: number; name?: string } | null
            const locType = meta?.location_type === 'dropoff' ? 'dropoff' : 'pickup'
            const acceptedLat = meta?.lat
            const acceptedLng = meta?.lng
            const acceptedName = meta?.name

            // For dropoff acceptance: show route info from pickup to accepted dropoff
            const pLat = ride?.pickup_point?.coordinates?.[1] ?? ride?.origin?.coordinates?.[1]
            const pLng = ride?.pickup_point?.coordinates?.[0] ?? ride?.origin?.coordinates?.[0]
            const showRouteCard = locType === 'dropoff' && acceptedLat != null && acceptedLng != null && pLat != null && pLng != null

            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <div className="w-full max-w-[85%] rounded-2xl border border-success/30 bg-success/5 px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-6 w-6 rounded-full bg-success/20 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5 text-success" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-success">
                        {locType === 'pickup' ? 'Pickup' : 'Dropoff'} Confirmed
                      </p>
                    </div>
                    {acceptedName && (
                      <p className="text-xs font-medium text-text-primary mb-2">&#x1F4CD; {acceptedName}</p>
                    )}

                    {/* Route info card for dropoff acceptance */}
                    {showRouteCard && (
                      <DropoffProposalCard
                        dropoffName={acceptedName}
                        pickupLat={pLat}
                        pickupLng={pLng}
                        dropoffLat={acceptedLat}
                        dropoffLng={acceptedLng}
                        riderDestLat={riderDestLat}
                        riderDestLng={riderDestLng}
                        riderDestName={ride?.destination_name}
                        onViewMap={setMapOverlay}
                      />
                    )}

                    {/* Transit info for dropoff acceptance (rider only) */}
                    {locType === 'dropoff' && isRider && acceptedLat != null && acceptedLng != null && riderDestLat != null && riderDestLng != null && (
                      <TransitInfo
                        dropoffLat={acceptedLat}
                        dropoffLng={acceptedLng}
                        destLat={riderDestLat}
                        destLng={riderDestLng}
                        data-testid={`accepted-transit-info-${msg.id}`}
                      />
                    )}

                    <p className="text-[10px] text-text-secondary mt-1">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            )
          }

          // ── Special message: details_accepted (legacy) ──
          if (msg.type === 'details_accepted') {
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="flex justify-center">
                <div className="rounded-full bg-success/10 px-4 py-1.5">
                  <p className="text-xs font-medium text-success">&#x2713; Ride details accepted</p>
                </div>
              </div>
            )
          }

          // ── Regular text message ──
          return (
            <div
              key={msg.id}
              data-testid={`message-${msg.id}`}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                  isMine
                    ? 'bg-primary text-white rounded-br-md'
                    : 'bg-surface text-text-primary rounded-bl-md'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                <p className={`text-[10px] mt-1 ${isMine ? 'text-white/70' : 'text-text-secondary'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Both confirmed: Navigate or Ride Confirmed ─────────────────────── */}
      {bothConfirmed && ride.status !== 'active' && ride.status !== 'completed' && ride.status !== 'cancelled' && (
        <div className="px-4 py-3 border-t border-border bg-success/5 shrink-0">
          {ride.schedule_id && !isRideApproaching ? (
            <>
              <p className="text-xs text-success text-center mb-2 font-semibold">
                Ride Confirmed! {formatScheduledRideTime(ride) ? `Scheduled for ${formatScheduledRideTime(ride)}.` : "You'll be notified before your ride."}
              </p>
              <div className="flex gap-2">
                <button
                  data-testid="cancel-ride-button"
                  onClick={() => setCancelModal(true)}
                  className="flex-1 rounded-2xl py-3 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 transition-colors"
                >
                  Cancel Ride
                </button>
                <button
                  data-testid="back-to-rides-button"
                  onClick={() => navigate('/rides', { replace: true })}
                  className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white bg-success active:bg-success/90 transition-colors"
                >
                  My Rides
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-success text-center mb-2 font-semibold">
                {ride.schedule_id && minutesUntilRide != null
                  ? minutesUntilRide > 0
                    ? `Your ride is in ${minutesUntilRide} min! Navigate to pickup.`
                    : 'Your ride time has arrived! Navigate to pickup now.'
                  : 'Both locations confirmed! Navigate when ready.'}
              </p>
              <div className="flex gap-2">
                <button
                  data-testid="cancel-ride-button"
                  onClick={() => setCancelModal(true)}
                  className="flex-1 rounded-2xl py-3 text-sm font-semibold text-danger bg-danger/10 active:bg-danger/20 transition-colors"
                >
                  Cancel Ride
                </button>
                <button
                  data-testid="navigate-to-pickup-button"
                  onClick={() => {
                    navigate(
                      isRider
                        ? `/ride/pickup-rider/${rideId as string}`
                        : `/ride/pickup-driver/${rideId as string}`,
                      { replace: true },
                    )
                  }}
                  className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white bg-success active:bg-success/90 transition-colors"
                >
                  Navigate to Pickup
                </button>
              </div>
              <div className="flex justify-center gap-3 mt-2">
                <button
                  data-testid="change-pickup-confirmed"
                  onClick={() => openPinDropper('pickup')}
                  className="text-[10px] text-text-secondary underline active:opacity-60"
                >
                  Change pickup
                </button>
                <button
                  data-testid="change-dropoff-confirmed"
                  onClick={() => openPinDropper('dropoff')}
                  className="text-[10px] text-text-secondary underline active:opacity-60"
                >
                  Change dropoff
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Location proposal buttons (when not both confirmed) ────────────── */}
      {/* Only show "Suggest" buttons when no proposal exists yet for that type.
          Once a proposal exists, inline Accept/Counter buttons handle it.
          Hide while the driver destination / transit suggestion flow is active
          so the buttons don't overlap — they appear after the driver finishes. */}
      {!bothConfirmed && !driverDestFlowActive && ride.status !== 'active' && ride.status !== 'completed' && ride.status !== 'cancelled' && (
        <div className="px-4 py-2.5 border-t border-border bg-surface flex gap-2 shrink-0">
          {pickupConfirmed ? (
            <div className="flex-1 rounded-2xl py-2.5 text-center text-xs font-semibold text-success bg-success/10">
              &#x2713; Pickup Set
            </div>
          ) : !latestPickupProposal ? (
            <button
              data-testid="suggest-pickup-button"
              onClick={() => openPinDropper('pickup')}
              className="flex-1 rounded-2xl py-2.5 text-xs font-semibold text-white bg-success active:bg-success/90 transition-colors"
            >
              &#x1F4CD; Suggest Pickup
            </button>
          ) : (
            <div className="flex-1 rounded-2xl py-2.5 text-center text-xs font-semibold text-warning bg-warning/10">
              Pickup pending
            </div>
          )}
          {dropoffConfirmed ? (
            <div className="flex-1 rounded-2xl py-2.5 text-center text-xs font-semibold text-success bg-success/10">
              &#x2713; Dropoff Set
            </div>
          ) : driverSelectingDropoff ? (
            <div className="flex-1 rounded-2xl py-2.5 text-center text-xs font-semibold text-primary bg-primary/5 flex items-center justify-center gap-1.5">
              <div className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
              Driver choosing&hellip;
            </div>
          ) : !latestDropoffProposal ? (
            <button
              data-testid="suggest-dropoff-button"
              onClick={() => openPinDropper('dropoff')}
              className="flex-1 rounded-2xl py-2.5 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20 transition-colors"
            >
              &#x1F4CD; Suggest Dropoff
            </button>
          ) : (
            <div className="flex-1 rounded-2xl py-2.5 text-center text-xs font-semibold text-warning bg-warning/10">
              Dropoff pending
            </div>
          )}
        </div>
      )}

      {/* ── Send error ─────────────────────────────────────────────────────── */}
      {sendError && (
        <div className="px-4 py-1.5 bg-danger/10 shrink-0">
          <p className="text-xs text-danger text-center">{sendError}</p>
        </div>
      )}

      {/* ── Cancel confirmation modal ────────────────────────────────────── */}
      {cancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-text-primary text-center mb-2">Cancel Ride?</h3>
            <p className="text-sm text-text-secondary text-center mb-5">
              This will cancel the ride and notify the {isRider ? 'driver' : 'rider'}. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                data-testid="cancel-modal-keep"
                onClick={() => setCancelModal(false)}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold text-text-primary bg-surface active:bg-border transition-colors"
              >
                Keep Ride
              </button>
              <button
                data-testid="cancel-modal-confirm"
                onClick={() => { void handleCancelRide() }}
                disabled={cancelling}
                className="flex-1 rounded-2xl py-3 text-sm font-semibold text-white bg-danger active:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Driver cancelled modal — rider chooses to find another or cancel ── */}
      {driverCancelledModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-6 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex justify-center">
              <div className="h-14 w-14 rounded-full bg-warning/10 flex items-center justify-center">
                <span className="text-2xl">&#x26A0;&#xFE0F;</span>
              </div>
            </div>
            <h3 className="text-lg font-bold text-text-primary text-center">Driver Cancelled</h3>
            <p className="text-sm text-text-secondary text-center">
              Your driver has cancelled. Other drivers may still be available.
            </p>
            <button
              data-testid="back-to-waiting"
              onClick={() => {
                const origin = rideRef.current?.origin as { coordinates: number[] } | null | undefined
                navigate('/ride/waiting', {
                  replace: true,
                  state: {
                    rideId,
                    destination: state?.destination,
                    destinationLat: state?.destinationLat,
                    destinationLng: state?.destinationLng,
                    originLat: origin?.coordinates?.[1],
                    originLng: origin?.coordinates?.[0],
                  },
                })
              }}
              className="w-full rounded-2xl py-3 text-sm font-semibold text-white bg-primary active:bg-primary/90 transition-colors"
            >
              Find Another Driver
            </button>
            <button
              data-testid="cancel-ride-from-modal"
              onClick={() => {
                void (async () => {
                  const { data: { session } } = await supabase.auth.getSession()
                  if (session) {
                    await fetch(`/api/rides/${rideId}/cancel`, {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${session.access_token}` },
                    })
                  }
                  navigate('/home/rider', { replace: true })
                })()
              }}
              className="w-full rounded-2xl py-3 text-sm font-semibold text-danger border-2 border-danger/30 active:bg-danger/5 transition-colors"
            >
              Cancel Ride
            </button>
          </div>
        </div>
      )}

      {/* ── Input bar ──────────────────────────────────────────────────────── */}
      <div
        className="border-t border-border bg-white px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <input
          ref={inputRef}
          data-testid="chat-input"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-base text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          data-testid="send-button"
          onClick={() => { void handleSend() }}
          disabled={!inputText.trim() || sending}
          className="h-10 w-10 rounded-full bg-primary text-white flex items-center justify-center shrink-0 active:bg-primary-dark disabled:opacity-40 transition-colors"
          aria-label="Send message"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
