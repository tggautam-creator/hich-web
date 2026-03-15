import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'
import { colors } from '@/lib/tokens'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { MAP_ID, DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/mapConstants'
import BottomNav from '@/components/ui/BottomNav'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverHomePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GPS_INTERVAL_MS = 10_000

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverHomePage({ 'data-testid': testId }: DriverHomePageProps) {
  const profile = useAuthStore((s) => s.profile)
  const navigate = useNavigate()

  const [center, setCenter] = useState(DEFAULT_CENTER)
  const [hasGps, setHasGps] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [activeRideCount, setActiveRideCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const latestCoordsRef = useRef(DEFAULT_CENTER)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      },
      { onConflict: 'user_id' },
    )
  }, [profile?.id])

  // ── Watch GPS + poll location to server ───────────────────────────────────
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setCenter({ lat, lng })
        setHasGps(true)
        latestCoordsRef.current = { lat, lng }
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
  }, [isOnline, postLocation])

  const handleCameraChange = useCallback((ev: { detail: { center: { lat: number; lng: number }; zoom: number } }) => {
    void ev
  }, [])

  function handleToggleOnline() {
    setIsOnline((prev) => !prev)
  }

  const apiKey = env.GOOGLE_MAPS_KEY ?? ''

  return (
    <div
      data-testid={testId ?? 'driver-home-page'}
      className="relative h-dvh w-full overflow-hidden font-sans"
    >
      {/* ── Full-screen map ────────────────────────────────────────────────── */}
      <APIProvider apiKey={apiKey}>
        <Map
          data-testid="map-container"
          mapId={MAP_ID}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          center={center}
          zoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI
          className="h-full w-full"
          onCameraChanged={handleCameraChange}
        >
          {hasGps && (
            <AdvancedMarker position={center} title="Driver location">
              <div
                data-testid="green-dot-marker"
                className="h-5 w-5 rounded-full border-[3px] border-white shadow-md"
                style={{ backgroundColor: colors.success }}
              />
            </AdvancedMarker>
          )}
        </Map>
      </APIProvider>

      {/* ── Slim frosted top bar ──────────────────────────────────────────── */}
      <div
        data-testid="top-bar"
        className="absolute left-0 right-0 top-0 z-[1000] bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
      >
        {/* Online/offline pill toggle */}
        <button
          data-testid="online-toggle"
          onClick={handleToggleOnline}
          className={[
            'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
            isOnline
              ? 'bg-success/10 text-success'
              : 'bg-border/50 text-text-secondary',
          ].join(' ')}
        >
          <span
            className={[
              'h-2 w-2 rounded-full',
              isOnline ? 'bg-success' : 'bg-text-secondary',
            ].join(' ')}
          />
          {isOnline ? 'Online' : 'Offline'}
        </button>

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

      {/* ── Active ride banner ──────────────────────────────────────────────── */}
      {activeRideCount > 0 && (
        <button
          data-testid="active-ride-banner"
          onClick={() => navigate('/rides')}
          className="absolute left-4 right-4 z-[1000] rounded-2xl bg-primary px-4 py-3 shadow-lg flex items-center gap-3 active:opacity-90 transition-opacity"
          style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 9.5rem)' }}
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

      {/* ── Ride Board button ──────────────────────────────────────────────── */}
      <div
        className="absolute left-0 right-0 z-[1000] px-4 flex justify-center"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        <button
          data-testid="ride-board-button"
          onClick={() => { navigate('/rides/board', { state: { fromTab: 'drive' } }) }}
          className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 shadow-lg border border-border active:scale-95 transition-transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-sm font-semibold text-text-primary">Ride Board</span>
        </button>
      </div>

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}
