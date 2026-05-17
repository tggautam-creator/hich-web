import { useMemo } from 'react'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'
import { useAdminLive, type LiveActiveRide, type LiveEvent, type LatLng } from '@/hooks/useAdminLive'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.7 — live ops console.
 *
 * Map (left, 2/3 width): plots every in-progress ride. Each ride
 * contributes up to two pins — the driver's most recent GPS (blue dot)
 * and the rider's pickup (orange square). Empty when no rides are
 * active.
 *
 * Event feed (right, 1/3 width): rolling list of ride lifecycle events
 * from the last 60 minutes, newest first.
 *
 * Polls /api/admin/live/snapshot every 10s while the tab is focused.
 */

const DEFAULT_CENTER: LatLng = { lat: 38.5449, lng: -121.7405 } // Davis, CA
const DEFAULT_ZOOM = 12

export default function LiveOpsPage() {
  const live = useAdminLive()
  const apiKey = env.GOOGLE_MAPS_KEY ?? ''
  const mapId = env.GOOGLE_MAP_ID ?? undefined

  const snapshot = live.data
  const activeRides = useMemo(() => snapshot?.active_rides ?? [], [snapshot])
  const events = useMemo(() => snapshot?.events ?? [], [snapshot])

  const center = useMemo<LatLng>(() => {
    const first = activeRides.find((r) => r.last_driver_gps ?? r.pickup_point ?? r.origin)
    return (
      first?.last_driver_gps ??
      first?.pickup_point ??
      first?.origin ??
      DEFAULT_CENTER
    )
  }, [activeRides])

  return (
    <div data-testid="admin-live-page" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Live ops</h1>
          <InfoTooltip
            testid="live-page-info"
            text="Every ride that's currently in progress (accepted / coordinating / active) plus the last 60 minutes of lifecycle events. Refreshes every 10s while this tab is open."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {snapshot
            ? `${activeRides.length} active ride${activeRides.length === 1 ? '' : 's'} · ${events.length} event${events.length === 1 ? '' : 's'} in the last hour`
            : 'Loading…'}
          {snapshot?.generated_at && (
            <span className="ml-2 text-xs text-text-tertiary">
              · last fetched {timeAgo(snapshot.generated_at)} ago
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Map (left, 2 cols) ─────────────────────────────────────── */}
        <section
          data-testid="live-map-pane"
          className="lg:col-span-2 rounded-2xl border border-border bg-white overflow-hidden h-[640px] relative"
        >
          {apiKey ? (
            <APIProvider apiKey={apiKey}>
              <Map
                data-testid="live-map"
                mapId={mapId}
                defaultCenter={center}
                defaultZoom={DEFAULT_ZOOM}
                gestureHandling="greedy"
                disableDefaultUI={false}
                className="h-full w-full"
              >
                {activeRides.map((ride) => (
                  <RideMarkers key={ride.id} ride={ride} />
                ))}
              </Map>
            </APIProvider>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-text-secondary">
              Google Maps key not configured.
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-white/95 px-3 py-2 text-xs text-text-secondary shadow-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span>Driver GPS</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
              <span>Rider pickup</span>
            </div>
          </div>
        </section>

        {/* ── Event feed (right, 1 col) ──────────────────────────────── */}
        <section
          data-testid="live-event-feed"
          className="rounded-2xl border border-border bg-white overflow-hidden flex flex-col h-[640px]"
        >
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Recent events</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Last 60 minutes
            </p>
          </header>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {live.isLoading ? (
              <div className="p-4 text-sm text-text-secondary">Loading…</div>
            ) : events.length === 0 ? (
              <div className="p-4 text-sm text-text-secondary">
                Nothing in the last hour.
              </div>
            ) : (
              events.map((ev, i) => <EventRow key={`${ev.ride_id}-${ev.kind}-${i}`} event={ev} />)
            )}
          </div>
          {snapshot?.events_truncated && (
            <footer className="px-4 py-2 border-t border-border text-xs text-warning">
              Feed truncated — more than 100 events in the window.
            </footer>
          )}
        </section>
      </div>

      {/* Active rides table — keeps the map's context queryable without
          having to mouse over every marker. */}
      <section
        data-testid="live-active-table"
        className="rounded-2xl border border-border bg-white overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            Active rides ({activeRides.length})
          </h2>
          {snapshot?.active_truncated && (
            <span className="text-xs text-warning">
              Truncated — more than 200 active rides
            </span>
          )}
        </header>
        {activeRides.length === 0 ? (
          <div className="p-4 text-sm text-text-secondary">
            No active rides right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left">
                <tr className="text-xs uppercase tracking-wide text-text-secondary">
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Rider</th>
                  <th className="px-4 py-2 font-medium">Driver</th>
                  <th className="px-4 py-2 font-medium">Route</th>
                  <th className="px-4 py-2 font-medium">Last driver ping</th>
                  <th className="px-4 py-2 font-medium">Fare</th>
                </tr>
              </thead>
              <tbody>
                {activeRides.map((ride) => (
                  <tr key={ride.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      <StatusChip status={ride.status} />
                    </td>
                    <td className="px-4 py-2 text-text-primary">
                      {ride.rider_name ?? <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-4 py-2 text-text-primary">
                      {ride.driver_name ?? <span className="text-text-tertiary">unassigned</span>}
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      <div className="truncate max-w-xs">
                        {ride.origin_name ?? '—'}
                      </div>
                      <div className="truncate max-w-xs text-text-tertiary">
                        → {ride.destination_name ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {ride.last_driver_ping_at ? timeAgo(ride.last_driver_ping_at) + ' ago' : '—'}
                    </td>
                    <td className="px-4 py-2 text-text-primary">
                      {ride.fare_cents != null ? formatCents(ride.fare_cents) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function RideMarkers({ ride }: { ride: LiveActiveRide }) {
  const driver = ride.last_driver_gps
  const pickup = ride.pickup_point ?? ride.origin
  return (
    <>
      {driver && (
        <AdvancedMarker position={driver} title={`Driver: ${ride.driver_name ?? 'unassigned'}`}>
          <div className="relative flex items-center justify-center">
            <span className="absolute h-5 w-5 rounded-full bg-primary/30 animate-ping" />
            <span className="relative h-3 w-3 rounded-full bg-primary border-2 border-white shadow-md" />
          </div>
        </AdvancedMarker>
      )}
      {pickup && (
        <AdvancedMarker position={pickup} title={`Pickup for ${ride.rider_name ?? 'rider'}`}>
          <div className="h-3 w-3 rounded-sm bg-warning border border-white shadow-sm" />
        </AdvancedMarker>
      )}
    </>
  )
}

function EventRow({ event }: { event: LiveEvent }) {
  const meta = EVENT_META[event.kind]
  const who = event.driver_name && event.kind !== 'created'
    ? `${event.rider_name ?? 'rider'} · ${event.driver_name}`
    : (event.rider_name ?? 'rider')
  return (
    <div className="px-4 py-2.5 flex items-start gap-3">
      <span
        className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${meta.dot}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${meta.text}`}>{meta.label}</span>
          <span className="text-xs text-text-tertiary">{timeAgo(event.at)} ago</span>
        </div>
        <p className="text-sm text-text-primary truncate">{who}</p>
        {event.fare_cents != null && event.kind === 'completed' && (
          <p className="text-xs text-text-secondary">{formatCents(event.fare_cents)}</p>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: LiveActiveRide['status'] }) {
  const map: Record<LiveActiveRide['status'], string> = {
    accepted: 'bg-primary-light text-primary',
    coordinating: 'bg-warning/15 text-warning',
    active: 'bg-success/15 text-success',
  }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  )
}

const EVENT_META: Record<LiveEvent['kind'], { label: string; dot: string; text: string }> = {
  created: { label: 'CREATED', dot: 'bg-primary', text: 'text-primary' },
  accepted: { label: 'ACCEPTED', dot: 'bg-primary', text: 'text-primary' },
  started: { label: 'STARTED', dot: 'bg-success', text: 'text-success' },
  completed: { label: 'COMPLETED', dot: 'bg-success', text: 'text-success' },
  cancelled: { label: 'CANCELLED', dot: 'bg-danger', text: 'text-danger' },
}

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}
