import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { MAP_ID, DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/mapConstants'
import BottomNav from '@/components/ui/BottomNav'
import PwaInstallBanner from '@/components/ui/PwaInstallBanner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverHomePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GPS_INTERVAL_MS = 30_000

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverHomePage({ 'data-testid': testId }: DriverHomePageProps) {
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const navigate = useNavigate()

  const [center, setCenter] = useState(DEFAULT_CENTER)
  const [hasGps, setHasGps] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [activeRideCount, setActiveRideCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [statusToast, setStatusToast] = useState<string | null>(null)
  const [userPanned, setUserPanned] = useState(false)

  const hasBank = profile?.stripe_onboarding_complete === true
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestCoordsRef = useRef(DEFAULT_CENTER)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)

  // Fetch active ride count + unread notifications
  useEffect(() => {
    async function fetchCounts() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const [ridesResp, notifResp] = await Promise.all([
          fetch('/api/rides/active', { headers: { Authorization: `Bearer ${session.access_token}` } }),
          fetch('/api/notifications/unread-count', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        ])
        if (ridesResp.ok) {
          const body = (await ridesResp.json()) as { rides: unknown[] }
          setActiveRideCount(body.rides.length)
        }
        if (notifResp.ok) {
          const body = (await notifResp.json()) as { count: number }
          setUnreadCount(body.count)
        }
      } catch {
        // non-fatal
      }
    }
    void fetchCounts()
  }, [])

  // ── Post GPS to driver_locations ──────────────────────────────────────────
  const postLocation = useCallback(async () => {
    if (!profile?.id) return
    const { lat, lng } = latestCoordsRef.current
    await supabase.from('driver_locations').upsert(
      {
        user_id: profile.id,
        location: { type: 'Point', coordinates: [lng, lat] },
        recorded_at: new Date().toISOString(),
        is_online: isOnline,
      },
      { onConflict: 'user_id' },
    )
  }, [profile?.id, isOnline])

  // ── Watch GPS + poll location to server ───────────────────────────────────
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const newLocation = { lat, lng }
        setCenter(newLocation)
        setHasGps(true)
        latestCoordsRef.current = newLocation

        // Only pan map if user hasn't manually panned
        if (!userPanned && mapRef.current) {
          mapRef.current.panTo(newLocation)
        }
      },
      () => { /* denied */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    )

    // Post location every 10s while online
    if (isOnline) {
      // Post immediately once
      void postLocation()
      gpsIntervalRef.current = setInterval(() => {
        void postLocation()
      }, GPS_INTERVAL_MS)
    }

    return () => {
      navigator.geolocation.clearWatch(watchId)
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
    }
  }, [isOnline, postLocation, userPanned])

  const handleCameraChange = useCallback((ev: { detail: { center: { lat: number; lng: number }; zoom: number }; map: google.maps.Map }) => {
    // Capture map instance
    if (!mapRef.current && ev.map) {
      mapRef.current = ev.map
    }
  }, [])

  function showToast(message: string) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setStatusToast(message)
    toastTimeoutRef.current = setTimeout(() => setStatusToast(null), 3000)
  }

  // ── Stripe return handler ──────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('stripe_return') !== '1') return
    async function completeOnboarding() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetch('/api/connect/onboard/complete', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        await refreshProfile()
      } catch {
        // non-fatal
      }
    }
    void completeOnboarding()
    // Remove query param
    searchParams.delete('stripe_return')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams, refreshProfile])

  async function handleToggleOnline() {
    if (!hasBank) {
      showToast('Tip: Set up your payout method to receive earnings')
    }
    const next = !isOnline
    setIsOnline(next)

    showToast(
      next
        ? 'You are now online — ride requests will appear here'
        : 'You are now offline — you won\'t receive ride requests',
    )

    // Persist to driver_locations so the server filters offline drivers
    if (profile?.id) {
      await supabase.from('driver_locations').upsert(
        {
          user_id: profile.id,
          is_online: next,
          location: { type: 'Point', coordinates: [latestCoordsRef.current.lng, latestCoordsRef.current.lat] },
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
    }
  }

  const apiKey = env.GOOGLE_MAPS_KEY ?? ''

  return (
    <div
      data-testid={testId ?? 'driver-home-page'}
      className="relative h-dvh w-full overflow-hidden font-sans"
    >
      {/* ── PWA install banner ──────────────────────────────────────────── */}
      <PwaInstallBanner />

      {/* ── Full-screen map ────────────────────────────────────────────────── */}
      <APIProvider apiKey={apiKey}>
        <Map
          data-testid="map-container"
          mapId={MAP_ID}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI
          className="h-full w-full"
          onCameraChanged={handleCameraChange}
          onDragstart={() => setUserPanned(true)}
        >
          {hasGps && (
            <AdvancedMarker position={center} title="Driver location">
              <div data-testid="green-dot-marker" className="relative flex items-center justify-center">
                <span className="absolute h-6 w-6 rounded-full bg-success/30 animate-ping" />
                <span className="relative h-3 w-3 rounded-full bg-success border-2 border-white shadow-md" />
              </div>
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>

      {/* ── Re-center button (shown when user panned away) ──────────────────── */}
      {userPanned && hasGps && (
        <button
          data-testid="recenter-button"
          onClick={() => {
            setUserPanned(false)
            if (mapRef.current) {
              mapRef.current.panTo(latestCoordsRef.current)
            }
          }}
          aria-label="Re-center to my location"
          className="absolute right-4 z-[1000] h-10 w-10 rounded-full bg-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          style={{ top: 'calc(max(env(safe-area-inset-top), 0.75rem) + 4rem)' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      )}

      {/* ── Slim frosted top bar ──────────────────────────────────────────── */}
      <div
        data-testid="top-bar"
        className="absolute left-0 right-0 top-0 z-[1000] bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        {/* Status indicator (non-interactive — toggle is the big button below) */}
        <div
          data-testid="online-indicator"
          className={[
            'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
            isOnline
              ? 'bg-success/10 text-success'
              : 'bg-border/50 text-text-secondary',
          ].join(' ')}
        >
          <span
            className={[
              'h-2 w-2 rounded-full',
              isOnline ? 'bg-success animate-pulse' : 'bg-text-secondary',
            ].join(' ')}
          />
          {isOnline ? 'Online' : 'Offline'}
        </div>

        <span className="font-bold text-sm text-text-primary tracking-wider select-none">
          HICH DRIVER
        </span>

        <button
          data-testid="notifications-bell"
          onClick={() => navigate('/notifications')}
          aria-label="Notifications"
          className="relative p-1 text-text-primary active:opacity-60 transition-opacity"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Status toast ────────────────────────────────────────────────── */}
      {statusToast && (
        <div
          data-testid="status-toast"
          className={[
            'absolute left-4 right-4 z-[1100] rounded-2xl px-4 py-3 shadow-lg text-sm font-medium text-center transition-all animate-slide-down',
            isOnline
              ? 'bg-success text-white'
              : 'bg-text-primary text-white',
          ].join(' ')}
          style={{ top: 'calc(max(env(safe-area-inset-top), 0.75rem) + 4rem)' }}
        >
          {statusToast}
        </div>
      )}

      {/* ── Bottom card stack ──────────────────────────────────────────── */}
      <div
        className="absolute left-0 right-0 z-[1000] px-4 flex flex-col gap-3"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        {activeRideCount > 0 && (
          <button
            data-testid="active-ride-banner"
            onClick={() => navigate('/rides')}
            className="w-full rounded-2xl bg-primary px-4 py-3 shadow-lg flex items-center gap-3 active:opacity-90 transition-opacity"
          >
            <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">{activeRideCount}</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-white">
                {activeRideCount === 1 ? 'You have an active ride' : `You have ${activeRideCount} active rides`}
              </p>
              <p className="text-xs text-white/70">Tap to view</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-white/70 shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* ── Bank setup banner ──────────────────────────────────────────── */}
        {!hasBank && (
          <div
            data-testid="bank-setup-banner"
            className="w-full bg-white rounded-2xl shadow-lg px-4 py-4 flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-warning" aria-hidden="true">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                  <path d="M6 14h.01" />
                  <path d="M10 14h4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">Set up payouts to get paid</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  Connect a bank account or debit card to receive earnings for every ride.
                </p>
              </div>
            </div>
            <button
              data-testid="setup-bank-button"
              onClick={() => { navigate('/stripe/payouts') }}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white active:opacity-90 transition-opacity"
            >
              Set Up Payouts
            </button>
          </div>
        )}

        {/* ── Online/Offline toggle ──────────────────────────────────────── */}
        <button
          data-testid="online-toggle"
          onClick={() => { void handleToggleOnline() }}
          className={[
            'w-full rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all',
            isOnline
              ? 'bg-white border-2 border-success'
              : 'bg-white border border-border',
          ].join(' ')}
        >
          <span className={[
            'relative flex h-3 w-3 shrink-0',
          ].join(' ')}>
            {isOnline && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />}
            <span className={['relative inline-flex h-3 w-3 rounded-full', isOnline ? 'bg-success' : 'bg-text-secondary'].join(' ')} />
          </span>

          <span className={['flex-1 text-sm font-semibold text-left', isOnline ? 'text-success' : 'text-text-secondary'].join(' ')}>
            {isOnline ? 'Online — receiving rides' : 'Offline — tap to go online'}
          </span>

          {/* Mini toggle switch */}
          <div className={['relative h-6 w-10 rounded-full shrink-0 transition-colors', isOnline ? 'bg-success' : 'bg-border'].join(' ')}>
            <div className={['absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', isOnline ? 'translate-x-4' : 'translate-x-0.5'].join(' ')} />
          </div>
        </button>

        {/* ── Ride Board card ────────────────────────────────────────────── */}
        <button
          data-testid="ride-board-button"
          onClick={() => { navigate('/rides/board', { state: { fromTab: 'drive' } }) }}
          aria-label="Browse ride board"
          className="w-full bg-white rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
        >
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <span className="flex-1 text-sm font-semibold text-text-primary text-left">
            Browse ride requests
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}