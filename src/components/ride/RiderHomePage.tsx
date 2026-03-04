import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import { reverseGeocode } from '@/lib/geocode'
import BottomNav from '@/components/ui/BottomNav'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderHomePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CENTER: [number, number] = [38.5382, -121.7617]
const DEFAULT_ZOOM = 15

const DOT_STYLE = {
  fillColor:   '#2563EB',
  fillOpacity: 1,
  color:       '#ffffff',
  weight:      3,
} as const

// ── MapCenterUpdater ──────────────────────────────────────────────────────────

interface MapCenterUpdaterProps {
  center: [number, number]
}

function MapCenterUpdater({ center }: MapCenterUpdaterProps) {
  const map = useMap()

  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true })
  }, [map, center])

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RiderHomePage({ 'data-testid': testId }: RiderHomePageProps) {
  const navigate = useNavigate()

  const [center,       setCenter]       = useState<[number, number]>(DEFAULT_CENTER)
  const [hasGps,       setHasGps]       = useState(false)
  const [locationName, setLocationName] = useState('Current Location')
  const gpsFixedRef = useRef(false)

  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setCenter([lat, lng])
        setHasGps(true)
        // Reverse-geocode only on the first GPS fix
        if (!gpsFixedRef.current) {
          gpsFixedRef.current = true
          void reverseGeocode(lat, lng).then(setLocationName)
        }
      },
      () => { /* denied */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    )
    return () => { navigator.geolocation.clearWatch(watchId) }
  }, [])

  return (
    <div
      data-testid={testId ?? 'rider-home-page'}
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

      {/* ── Slim frosted top bar — hamburger + wordmark ─────────────────────── */}
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

        <span className="flex-1 text-center font-bold text-lg text-primary tracking-widest select-none">
          HICH
        </span>

        <div className="w-8" aria-hidden="true" />
      </div>

      {/* ── From / Where-to card + Schedule button ──────────────────────────── */}
      <div
        className="absolute left-0 right-0 z-[1000] px-4 flex gap-2 items-start"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        {/* Two-line location card */}
        <button
          data-testid="search-bar"
          onClick={() => { navigate('/ride/search', { state: { locationName } }) }}
          aria-label="Search for a destination"
          className="flex-1 bg-white rounded-2xl shadow-lg px-4 py-3 text-left active:scale-[0.99] transition-transform"
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

        {/* Schedule — fixed square */}
        <button
          data-testid="schedule-button"
          onClick={() => { navigate('/schedule') }}
          aria-label="View schedule"
          className="bg-white rounded-2xl shadow-lg w-12 h-12 flex items-center justify-center shrink-0 self-center active:scale-[0.99] transition-transform"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-text-secondary" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {/* ── Bottom navigation ──────────────────────────────────────────────── */}
      <BottomNav activeTab="home" />
    </div>
  )
}
