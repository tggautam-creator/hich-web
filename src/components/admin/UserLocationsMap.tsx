import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker, InfoWindow } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'
import {
  useAdminUserLocations,
  type AdminUserLocation,
} from '@/hooks/useAdminUserLocations'

/**
 * 2026-05-20 — dashboard map showing every user's last known location
 * over the past 30 days. Distinct from /admin/live (real-time ops):
 * this is "where do we have users overall" at a glance.
 *
 * Click a pin → InfoWindow with name + last-seen relative time + a
 * link into the user detail page. Truncated at 1000 markers
 * server-side; if we hit that, a small warning chip surfaces in the
 * top-right corner.
 */

const DEFAULT_CENTER = { lat: 38.5449, lng: -121.7405 } // UC Davis-ish
const DEFAULT_ZOOM = 10

export default function UserLocationsMap() {
  const apiKey = env.GOOGLE_MAPS_KEY ?? ''
  const mapId = env.GOOGLE_MAP_ID ?? undefined
  const { data, isLoading, error } = useAdminUserLocations(30)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Auto-center on the cluster of returned points. If no points or
  // only one, fall back to a reasonable default.
  const center = useMemo(() => {
    const locs = data?.locations ?? []
    if (locs.length === 0) return DEFAULT_CENTER
    let sumLat = 0
    let sumLng = 0
    for (const l of locs) {
      sumLat += l.lat
      sumLng += l.lng
    }
    return { lat: sumLat / locs.length, lng: sumLng / locs.length }
  }, [data])

  const selected = useMemo(
    () => data?.locations.find((l) => l.user_id === selectedId) ?? null,
    [data, selectedId],
  )

  if (!apiKey) {
    return (
      <div className="rounded-2xl border border-border bg-white p-4 text-sm text-text-secondary">
        Google Maps key not configured. Set <code>VITE_GOOGLE_MAPS_KEY</code> in env to enable the dashboard map.
      </div>
    )
  }

  return (
    <section
      data-testid="user-locations-map"
      className="rounded-2xl border border-border bg-white overflow-hidden relative h-[420px]"
    >
      <div className="absolute top-3 left-3 z-10 rounded-lg border border-border bg-white/95 px-3 py-2 text-xs shadow-sm">
        <div className="font-semibold text-text-primary">
          Users · last 30 days
        </div>
        {data ? (
          <div className="text-text-secondary mt-0.5">
            {data.locations.length.toLocaleString()} pins
            {data.truncated && (
              <span className="ml-1 text-warning">(capped at 1k)</span>
            )}
          </div>
        ) : isLoading ? (
          <div className="text-text-secondary mt-0.5">Loading…</div>
        ) : error ? (
          <div className="text-danger mt-0.5">Couldn't load.</div>
        ) : null}
      </div>

      <APIProvider apiKey={apiKey}>
        <Map
          data-testid="user-locations-google-map"
          mapId={mapId}
          defaultCenter={center}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI={false}
          className="h-full w-full"
        >
          {(data?.locations ?? []).map((u) => (
            <UserDot
              key={u.user_id}
              user={u}
              onClick={() => setSelectedId(u.user_id)}
            />
          ))}
          {selected && (
            <InfoWindow
              position={{ lat: selected.lat, lng: selected.lng }}
              onCloseClick={() => setSelectedId(null)}
              pixelOffset={[0, -14]}
            >
              <div className="text-xs text-text-primary min-w-[180px]">
                <div className="font-semibold">
                  {selected.name || selected.email || selected.user_id.slice(0, 8)}
                </div>
                {selected.email && (
                  <div className="text-text-secondary truncate">{selected.email}</div>
                )}
                <div className="mt-1 text-text-secondary">
                  {selected.is_driver ? 'Driver' : 'Rider'} · last seen{' '}
                  {timeAgo(selected.last_known_at)}
                </div>
                <Link
                  to={`/admin/users/${selected.user_id}`}
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  Open profile →
                </Link>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </section>
  )
}

/**
 * Smaller dot for users — colors differentiate driver (green) from
 * rider (blue) so density-based usage patterns are visible at a
 * glance. Fade-by-recency would be cleaner but the server window is
 * already 30d-bounded, so every dot is "kinda fresh."
 */
function UserDot({
  user,
  onClick,
}: {
  user: AdminUserLocation
  onClick: () => void
}) {
  const fill = user.is_driver ? '#22c55e' : '#3b82f6'
  return (
    <AdvancedMarker
      position={{ lat: user.lat, lng: user.lng }}
      onClick={onClick}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: fill,
          border: '2px solid white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
        aria-label={user.name ?? user.email ?? user.user_id}
      />
    </AdvancedMarker>
  )
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
