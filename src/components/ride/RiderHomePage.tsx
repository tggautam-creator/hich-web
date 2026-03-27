import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'

import { supabase } from '@/lib/supabase'
import { reverseGeocode } from '@/lib/geocode'
import BottomNav from '@/components/ui/BottomNav'
import { MAP_ID, DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/mapConstants'
import SpotlightOverlay from '@/components/onboarding/SpotlightOverlay'
import { useOnboardingStore } from '@/stores/onboardingStore'
import PwaInstallBanner from '@/components/ui/PwaInstallBanner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderHomePageProps {
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RiderHomePage({ 'data-testid': testId }: RiderHomePageProps) {
  const navigate = useNavigate()
  const hasSeenWalkthrough = useOnboardingStore((s) => s.hasSeenWalkthrough)

  const [center,       setCenter]       = useState(DEFAULT_CENTER)
  const [hasGps,       setHasGps]       = useState(false)
  const [locationName, setLocationName] = useState('Current Location')
  const [activeRideCount, setActiveRideCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [userPanned, setUserPanned] = useState(false)
  const gpsFixedRef = useRef(false)
  const gpsLocationRef = useRef(DEFAULT_CENTER)
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

  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const newLocation = { lat, lng }
        gpsLocationRef.current = newLocation
        setCenter(newLocation)
        setHasGps(true)

        // Only pan map if user hasn't manually panned
        if (!userPanned && mapRef.current) {
          mapRef.current.panTo(newLocation)
        }

        // Reverse-geocode only on the first GPS fix
        if (!gpsFixedRef.current) {
          gpsFixedRef.current = true
          void reverseGeocode(lat, lng).then(setLocationName)
        }
      },
      () => { /* geolocation denied or unavailable */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    )
    return () => { navigator.geolocation.clearWatch(watchId) }
  }, [userPanned])

  const handleCameraChange = useCallback((ev: { detail: { center: { lat: number; lng: number }; zoom: number }; map: google.maps.Map }) => {
    // Capture map instance
    if (!mapRef.current && ev.map) {
      mapRef.current = ev.map
    }
  }, [])

  const apiKey = env.GOOGLE_MAPS_KEY ?? ''

  return (
    <div
      data-testid={testId ?? 'rider-home-page'}
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
            <AdvancedMarker position={center} title="You are here">
              <div data-testid="blue-dot-marker" className="relative flex items-center justify-center">
                <span className="absolute h-6 w-6 rounded-full bg-primary/30 animate-ping" />
                <span className="relative h-3 w-3 rounded-full bg-primary border-2 border-white shadow-md" />
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
              mapRef.current.panTo(gpsLocationRef.current)
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

      {/* ── Slim frosted top bar — wordmark + notifications ────────────────── */}
      <div
        data-testid="top-bar"
        className="absolute left-0 right-0 top-0 z-[1000] bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <span className="font-bold text-lg text-primary tracking-widest select-none">
          HICH
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

      {/* ── Stacked: active ride banner + search + ride board cards ────── */}
      <div
        className="absolute left-0 right-0 z-[1000] px-4 flex flex-col gap-2"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        {/* Active ride banner — stacks above search card naturally */}
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
        {/* Full-width search card */}
        <button
          data-testid="search-bar"
          onClick={() => { navigate('/ride/search', { state: { locationName, originLat: center.lat, originLng: center.lng } }) }}
          aria-label="Search for a destination"
          className="w-full bg-white rounded-2xl shadow-lg px-4 py-3 text-left active:scale-[0.99] transition-transform"
        >
          {/* From line */}
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
            <span
              data-testid="from-label"
              className="text-sm text-text-secondary truncate"
            >
              From &middot; {locationName}
            </span>
          </div>

          {/* Dotted connector */}
          <div className="ml-[4.5px] h-4 border-l border-dashed border-text-secondary/30" />

          {/* Where to? */}
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
            <span className="text-base font-medium text-text-primary">
              Where to?
            </span>
          </div>
        </button>

        {/* Full-width ride board button */}
        <button
          data-testid="ride-board-button"
          onClick={() => { navigate('/rides/board', { state: { fromTab: 'home' } }) }}
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
            Browse upcoming rides
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-secondary shrink-0" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab="home" />

      {/* ── Spotlight walkthrough for new users ──────────────────────────── */}
      {!hasSeenWalkthrough && <SpotlightOverlay />}
    </div>
  )
}