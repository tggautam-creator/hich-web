import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import type { Ride, User, Vehicle } from '@/types/database'
import type { PlaceSuggestion } from '@/lib/places'
import { useAuthStore } from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MessagingWindowProps {
  'data-testid'?: string
}

interface LocationState {
  destination?: PlaceSuggestion
  destinationLat?: number
  destinationLng?: number
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

const MAP_ID = '8cb10228438378796542e8f0'

// ── Component ─────────────────────────────────────────────────────────────────

export default function MessagingWindow({ 'data-testid': testId }: MessagingWindowProps) {
  const { rideId } = useParams<{ rideId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null
  const profile = useAuthStore((s) => s.profile)
  const currentUserId = profile?.id ?? null

  const [ride, setRide] = useState<Ride | null>(null)
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

  // Map pin dropper state
  const [pinMode, setPinMode] = useState<PinMode | null>(null)
  const [pinLat, setPinLat] = useState<number | null>(null)
  const [pinLng, setPinLng] = useState<number | null>(null)
  const [pinNote, setPinNote] = useState('')
  const [submittingPin, setSubmittingPin] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  // Location acceptance state
  const [acceptingLocation, setAcceptingLocation] = useState<string | null>(null) // 'pickup' or 'dropoff'

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isRider = currentUserId === ride?.rider_id
  const pickupConfirmed = ride?.pickup_confirmed ?? false
  const dropoffConfirmed = ride?.dropoff_confirmed ?? false
  const bothConfirmed = pickupConfirmed && dropoffConfirmed

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
            .single()
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
        if (newMsg.type === 'pickup_suggestion' || newMsg.type === 'dropoff_suggestion' || newMsg.type === 'location_accepted') {
          supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
            if (data) setRide(data)
          })
        }
      })
      .on('broadcast', { event: 'ride_cancelled' }, () => {
        setRideCancelled(true)
      })
      .on('broadcast', { event: 'locations_confirmed' }, () => {
        // Refresh ride data to get updated confirmed flags
        supabase.from('rides').select('*').eq('id', rideId).single().then(({ data }) => {
          if (data) setRide(data)
        })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [rideId])

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
          if (data) setRide(data)
        })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, rideId])

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
      }
    } catch {
      // non-fatal
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
  const latestDropoffProposal = [...messages].reverse().find((m) => m.type === 'dropoff_suggestion')

  const pickupProposedByOther = latestPickupProposal &&
    (latestPickupProposal.meta as Record<string, unknown> | null)?.proposed_by !== currentUserId
  const dropoffProposedByOther = latestDropoffProposal &&
    (latestDropoffProposal.meta as Record<string, unknown> | null)?.proposed_by !== currentUserId

  // ── Open pin dropper (start from previous proposal, ride data, or GPS) ──
  const openPinDropper = useCallback((mode: PinMode) => {
    setPinMode(mode)
    setPinNote('')

    // 1. Check latest proposal message meta for coordinates (most up-to-date)
    const latestProposal = mode === 'pickup' ? latestPickupProposal : latestDropoffProposal
    const proposalMeta = latestProposal?.meta as { lat?: number; lng?: number } | null
    if (proposalMeta?.lat != null && proposalMeta?.lng != null) {
      setPinLat(proposalMeta.lat)
      setPinLng(proposalMeta.lng)
      return
    }

    // 2. Check ride data for existing point
    if (mode === 'pickup' && ride?.pickup_point) {
      setPinLat(ride.pickup_point.coordinates[1])
      setPinLng(ride.pickup_point.coordinates[0])
      return
    }
    if (mode === 'dropoff' && ride?.dropoff_point) {
      setPinLat(ride.dropoff_point.coordinates[1])
      setPinLng(ride.dropoff_point.coordinates[0])
      return
    }
    if (mode === 'dropoff' && ride?.destination) {
      setPinLat(ride.destination.coordinates[1])
      setPinLng(ride.destination.coordinates[0])
      return
    }

    // 3. Fall back to ride origin
    if (ride?.origin) {
      setPinLat(ride.origin.coordinates[1])
      setPinLng(ride.origin.coordinates[0])
      return
    }

    // 4. Last resort — use GPS, but set a default immediately so pin dropper renders
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
        <button type="button" onClick={() => navigate(isRider ? '/home/rider' : '/home/driver', { replace: true })} className="rounded-xl bg-primary px-6 py-3 font-semibold text-white">
          Back to Home
        </button>
      </div>
    )
  }

  if (rideCancelled) {
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
          className="mt-2 rounded-xl bg-primary px-8 py-3 font-semibold text-white"
        >
          Back to My Rides
        </button>
      </div>
    )
  }

  // ── Pin dropper overlay ─────────────────────────────────────────────────
  if (pinMode && pinLat != null && pinLng != null) {
    return (
      <div data-testid={testId ?? 'messaging-window'} className="flex h-dvh flex-col bg-white font-sans overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 border-b border-border bg-white z-10 shrink-0"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
        >
          <button
            data-testid="pin-back-button"
            onClick={() => setPinMode(null)}
            className="p-1 shrink-0 text-text-primary active:opacity-60"
            aria-label="Cancel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 5-7 7 7 7" />
            </svg>
          </button>
          <h2 className="text-sm font-bold text-text-primary">
            {pinMode === 'pickup' ? 'Suggest Pickup Point' : 'Suggest Dropoff Point'}
          </h2>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <Map
            mapId={MAP_ID}
            defaultCenter={{ lat: pinLat, lng: pinLng }}
            defaultZoom={16}
            gestureHandling="greedy"
            disableDefaultUI
            className="h-full w-full"
            onClick={(e) => {
              const latLng = e.detail.latLng
              if (latLng) {
                setPinLat(latLng.lat)
                setPinLng(latLng.lng)
              }
            }}
          >
            <AdvancedMarker
              position={{ lat: pinLat, lng: pinLng }}
              title={pinMode === 'pickup' ? 'Pickup' : 'Dropoff'}
              draggable
              onDragEnd={(e) => {
                const pos = e.latLng
                if (pos) {
                  setPinLat(pos.lat())
                  setPinLng(pos.lng())
                }
              }}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white shadow-lg text-sm font-bold text-white ${pinMode === 'pickup' ? 'bg-green-500' : 'bg-red-500'}`}>
                {pinMode === 'pickup' ? 'P' : 'D'}
              </div>
            </AdvancedMarker>
          </Map>

          {/* Instruction overlay */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
            <p className="text-xs font-medium text-text-primary">Tap the map to move the pin</p>
          </div>
        </div>

        {/* Bottom panel */}
        <div
          className="px-4 pt-3 pb-4 border-t border-border bg-white space-y-3 shrink-0"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
        >
          <input
            data-testid="pin-note-input"
            type="text"
            value={pinNote}
            onChange={(e) => setPinNote(e.target.value)}
            placeholder={pinMode === 'pickup' ? 'Add a note (e.g. "By the fountain")' : 'Location name (optional)'}
            className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {pinError && (
            <p className="text-sm text-danger text-center" role="alert">{pinError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setPinMode(null); setPinError(null) }}
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

      {/* ── Header (fixed) ─────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 border-b border-border bg-white z-10 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
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
              navigate('/rides', { replace: true })
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

        <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${bothConfirmed ? 'text-success bg-success/10' : 'text-warning bg-warning/10'}`}>
          {bothConfirmed ? 'Confirmed' : 'Negotiating'}
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

      {/* ── Location status bar ─────────────────────────────────────────────── */}
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

      {/* ── Other party info card ────────────────────────────────────────── */}
      {otherUser && (
        <div data-testid="other-user-info" className="px-4 py-3 bg-white border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            {otherUser.avatar_url ? (
              <img src={otherUser.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                {otherUser.full_name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">
                {otherUser.full_name ?? (isRider ? 'Driver' : 'Rider')}
              </p>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                {otherUser.rating_avg != null && (
                  <span>&#x2B50; {otherUser.rating_avg.toFixed(1)}</span>
                )}
                {otherUser.rating_count > 0 && (
                  <span>({otherUser.rating_count} {otherUser.rating_count === 1 ? 'ride' : 'rides'})</span>
                )}
                {(!otherUser.rating_count || otherUser.rating_count === 0) && (
                  <span className="text-warning">New user</span>
                )}
              </div>
            </div>

            {/* Vehicle badge — shown when other party is the driver */}
            {otherVehicle && (
              <div data-testid="vehicle-badge" className="shrink-0 text-right">
                <p className="text-xs font-semibold text-text-primary">
                  {otherVehicle.color} {otherVehicle.make}
                </p>
                <p className="text-sm font-bold text-primary tracking-wide">
                  {otherVehicle.plate}
                </p>
              </div>
            )}
          </div>

          {/* Full vehicle details row */}
          {otherVehicle && (
            <div data-testid="vehicle-details" className="mt-2 flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
              <span className="text-lg">&#x1F697;</span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-primary">
                  {otherVehicle.color} {otherVehicle.make} {otherVehicle.model}
                </p>
                <p className="text-xs text-text-secondary">
                  Plate: <span className="font-bold text-primary">{otherVehicle.plate}</span>
                </p>
              </div>
            </div>
          )}
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

      {/* ── Messages area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="messages-list">
        {messages.length === 0 && (
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

          // ── Special message: pickup_suggestion ──
          if (msg.type === 'pickup_suggestion') {
            const meta = msg.meta as { lat?: number; lng?: number; note?: string | null; proposed_by?: string } | null
            const hasLocation = meta?.lat != null && meta?.lng != null
            const isLatestPickup = msg.id === latestPickupProposal?.id
            const canAccept = isLatestPickup && pickupProposedByOther && !pickupConfirmed
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={!hasLocation}
                    onClick={() => {
                      if (hasLocation) {
                        window.open(`https://www.google.com/maps/search/?api=1&query=${meta.lat},${meta.lng}`, '_blank', 'noopener')
                      }
                    }}
                    className="w-full max-w-[85%] rounded-2xl border border-success/30 bg-success/5 px-4 py-3 text-left active:bg-success/10 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-6 w-6 rounded-full bg-success/20 flex items-center justify-center">
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
                    {hasLocation && (
                      <p className="text-xs text-success font-medium mb-1">&#x1F4CD; Tap to view on map</p>
                    )}
                    {pickupConfirmed && isLatestPickup && (
                      <p className="text-xs text-success font-medium">&#x2713; Accepted</p>
                    )}
                    <p className="text-[10px] text-text-secondary">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                </div>
                {/* Accept / Counter Offer buttons for the other party */}
                {canAccept && (
                  <div className="flex gap-2 max-w-[85%] mx-auto">
                    <button
                      data-testid="accept-pickup-button"
                      onClick={() => { void handleAcceptLocation('pickup') }}
                      disabled={acceptingLocation === 'pickup'}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold text-white bg-success active:bg-success/90 disabled:opacity-50"
                    >
                      {acceptingLocation === 'pickup' ? 'Accepting...' : 'Accept Pickup'}
                    </button>
                    <button
                      data-testid="counter-pickup-button"
                      onClick={() => openPinDropper('pickup')}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold text-success bg-success/10 active:bg-success/20"
                    >
                      Counter Offer
                    </button>
                  </div>
                )}
              </div>
            )
          }

          // ── Special message: dropoff_suggestion ──
          if (msg.type === 'dropoff_suggestion') {
            const meta = msg.meta as { lat?: number; lng?: number; name?: string | null; proposed_by?: string } | null
            const hasLocation = meta?.lat != null && meta?.lng != null
            const isLatestDropoff = msg.id === latestDropoffProposal?.id
            const canAccept = isLatestDropoff && dropoffProposedByOther && !dropoffConfirmed
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="space-y-2">
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={!hasLocation}
                    onClick={() => {
                      if (hasLocation) {
                        window.open(`https://www.google.com/maps/search/?api=1&query=${meta.lat},${meta.lng}`, '_blank', 'noopener')
                      }
                    }}
                    className="w-full max-w-[85%] rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-left active:bg-primary/10 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 text-primary" aria-hidden="true">
                          <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </div>
                      <p className="text-xs font-semibold text-primary">
                        {isMine ? 'You suggested a dropoff point' : `${otherUser?.full_name ?? (isRider ? 'Driver' : 'Rider')} suggested a dropoff point`}
                      </p>
                    </div>
                    {meta?.name && (
                      <p className="text-xs text-text-primary font-medium mb-1">&#x1F4CD; {meta.name}</p>
                    )}
                    {!meta?.name && hasLocation && (
                      <p className="text-xs text-primary font-medium mb-1">&#x1F4CD; Tap to view on map</p>
                    )}
                    {dropoffConfirmed && isLatestDropoff && (
                      <p className="text-xs text-success font-medium">&#x2713; Accepted</p>
                    )}
                    <p className="text-[10px] text-text-secondary">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </button>
                </div>
                {/* Accept / Counter Offer buttons */}
                {canAccept && (
                  <div className="flex gap-2 max-w-[85%] mx-auto">
                    <button
                      data-testid="accept-dropoff-button"
                      onClick={() => { void handleAcceptLocation('dropoff') }}
                      disabled={acceptingLocation === 'dropoff'}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold text-white bg-primary active:bg-primary/90 disabled:opacity-50"
                    >
                      {acceptingLocation === 'dropoff' ? 'Accepting...' : 'Accept Dropoff'}
                    </button>
                    <button
                      data-testid="counter-dropoff-button"
                      onClick={() => openPinDropper('dropoff')}
                      className="flex-1 rounded-xl py-2 text-xs font-semibold text-primary bg-primary/10 active:bg-primary/20"
                    >
                      Counter Offer
                    </button>
                  </div>
                )}
              </div>
            )
          }

          // ── Special message: location_accepted ──
          if (msg.type === 'location_accepted') {
            const meta = msg.meta as { location_type?: string } | null
            const locType = meta?.location_type === 'dropoff' ? 'dropoff' : 'pickup'
            return (
              <div key={msg.id} data-testid={`message-${msg.id}`} className="flex justify-center">
                <div className="rounded-full bg-success/10 px-4 py-1.5">
                  <p className="text-xs font-medium text-success">&#x2713; {locType === 'pickup' ? 'Pickup' : 'Dropoff'} location accepted</p>
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
      {bothConfirmed && (
        <div className="px-4 py-3 border-t border-border bg-success/5 shrink-0">
          {ride.schedule_id ? (
            <>
              <p className="text-xs text-success text-center mb-2 font-semibold">
                Ride Confirmed! You'll be notified before your ride.
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
                Both locations confirmed! Navigate when ready.
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
            </>
          )}
        </div>
      )}

      {/* ── Location proposal buttons (when not both confirmed) ────────────── */}
      {/* Only show "Suggest" buttons when no proposal exists yet for that type.
          Once a proposal exists, inline Accept/Counter buttons handle it. */}
      {!bothConfirmed && (
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
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-text-primary bg-surface active:bg-border transition-colors"
              >
                Keep Ride
              </button>
              <button
                data-testid="cancel-modal-confirm"
                onClick={() => { void handleCancelRide() }}
                disabled={cancelling}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-white bg-danger active:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
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
          className="flex-1 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
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
