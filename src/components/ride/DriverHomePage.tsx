import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import DriverQrSheet from '@/components/ride/DriverQrSheet'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverHomePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CENTER: [number, number] = [38.5382, -121.7617]
const DEFAULT_ZOOM = 15
const GPS_INTERVAL_MS = 10_000

const DOT_STYLE = {
  fillColor:   '#10B981',
  fillOpacity: 1,
  color:       '#ffffff',
  weight:      3,
} as const

// ── MapCenterUpdater ──────────────────────────────────────────────────────────

function MapCenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap()

  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true })
  }, [map, center])

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriverHomePage({ 'data-testid': testId }: DriverHomePageProps) {
  const profile = useAuthStore((s) => s.profile)

  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER)
  const [hasGps, setHasGps] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [qrOpen, setQrOpen] = useState(false)
  const latestCoordsRef = useRef<[number, number]>(DEFAULT_CENTER)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Post GPS to driver_locations ──────────────────────────────────────────
  const postLocation = useCallback(async () => {
    if (!profile?.id) return
    const [lat, lng] = latestCoordsRef.current
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
        setCenter([lat, lng])
        setHasGps(true)
        latestCoordsRef.current = [lat, lng]
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

  function handleToggleOnline() {
    setIsOnline((prev) => !prev)
  }

  return (
    <div
      data-testid={testId ?? 'driver-home-page'}
      className="relative h-dvh w-full overflow-hidden font-sans"
    >
      {/* ── Full-screen map ────────────────────────────────────────────────── */}
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapCenterUpdater center={center} />
        {hasGps && (
          <CircleMarker center={center} radius={10} pathOptions={DOT_STYLE} />
        )}
      </MapContainer>

      {/* ── Slim frosted top bar ──────────────────────────────────────────── */}
      <div
        data-testid="top-bar"
        className="absolute left-0 right-0 top-0 z-[1000] bg-white/90 backdrop-blur-sm border-b border-border flex items-center px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)', paddingBottom: '0.75rem' }}
      >
        <button
          data-testid="hamburger-menu"
          aria-label="Open menu"
          className="p-1 text-text-primary active:opacity-60 transition-opacity"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <span className="flex-1 text-center font-bold text-lg text-success tracking-widest select-none">
          HICH DRIVER
        </span>

        <div className="w-8" aria-hidden="true" />
      </div>

      {/* ── Online/offline toggle + QR button row ────────────────────────── */}
      <div
        className="absolute left-0 right-0 z-[1000] px-4 flex gap-2 items-center"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        <button
          data-testid="online-toggle"
          onClick={handleToggleOnline}
          className={[
            'flex-1 rounded-2xl py-4 text-center text-lg font-bold shadow-lg transition-colors',
            isOnline
              ? 'bg-success text-white'
              : 'bg-white text-text-secondary border border-border',
          ].join(' ')}
        >
          {isOnline ? '🟢 Online — Receiving Rides' : '⏸ Offline — Tap to go online'}
        </button>

        {/* QR code button */}
        <button
          data-testid="qr-button"
          onClick={() => { setQrOpen(true) }}
          aria-label="Show QR code"
          className="w-14 h-14 rounded-2xl bg-white shadow-lg flex items-center justify-center shrink-0 active:scale-95 transition-transform border border-border"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-text-primary" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="4" height="4" rx="0.5" />
            <line x1="21" y1="14" x2="21" y2="21" />
            <line x1="14" y1="21" x2="21" y2="21" />
          </svg>
        </button>
      </div>

      {/* ── QR Sheet ──────────────────────────────────────────────────────── */}
      <DriverQrSheet
        isOpen={qrOpen}
        onClose={() => { setQrOpen(false) }}
        driverId={profile?.id ?? ''}
      />

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab="drive" />
    </div>
  )
}
