import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { env } from '@/lib/env'
import {
  useAdminLive,
  useAdminForceCancelRide,
  useAdminReassignRide,
  type LiveActiveRide,
  type LiveEvent,
  type LatLng,
  type StuckReason,
  type ActiveRideStatus,
  type OnlineDriver,
  type RecentUser,
} from '@/hooks/useAdminLive'
import { useAdminSendPush } from '@/hooks/useAdminUsers'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.7 / 1.7b — live ops console.
 *
 * Left (2/3): Google Map plotting every in-progress ride.
 * Right (1/3): event feed of the last 60 minutes.
 * Bottom: active-rides table (status / rider / driver / route / last
 * ping / fare / stuck-flag).
 *
 * 1.7b adds micro-management:
 *   - Filter pills: All / Stuck only / per-status
 *   - Click a row or marker → right drawer with ride detail + actions:
 *     force-cancel, push rider, push driver, deep-link to user profiles
 *   - Stuck-ride flags (server-computed) tinted red on the map + table
 *   - Includes `requested` status rides so ops can see + act on rides
 *     stuck without a driver
 */

const DEFAULT_CENTER: LatLng = { lat: 38.5449, lng: -121.7405 } // Davis, CA
const DEFAULT_ZOOM = 12

type FilterMode = 'all' | 'stuck' | ActiveRideStatus

const FILTER_TABS: ReadonlyArray<{ id: FilterMode; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'stuck', label: 'Stuck only' },
  { id: 'requested', label: 'Awaiting driver' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'coordinating', label: 'Coordinating' },
  { id: 'active', label: 'Active' },
]

export default function LiveOpsPage() {
  const live = useAdminLive()
  const apiKey = env.GOOGLE_MAPS_KEY ?? ''
  const mapId = env.GOOGLE_MAP_ID ?? undefined

  const snapshot = live.data
  const allActive = useMemo(() => snapshot?.active_rides ?? [], [snapshot])
  const events = useMemo(() => snapshot?.events ?? [], [snapshot])
  const rawOnlineDrivers = useMemo(() => snapshot?.online_drivers ?? [], [snapshot])
  const rawRecentUsers = useMemo(() => snapshot?.recent_users ?? [], [snapshot])

  // 2026-05-19 — granular filters layered on top of the existing
  // toggles. The toggles control WHICH overlay shows; these refine
  // which dots WITHIN that overlay are visible.
  const [recentRoleFilter, setRecentRoleFilter] = useState<'all' | 'rider' | 'driver'>('all')
  const [universityFilter, setUniversityFilter] = useState('')

  const universityFilterLc = universityFilter.trim().toLowerCase()

  const onlineDrivers = useMemo(
    () =>
      rawOnlineDrivers.filter((d) => {
        if (!universityFilterLc) return true
        if (!d.email) return false
        const e = d.email.toLowerCase()
        return e.includes(`@${universityFilterLc}`) || e.endsWith(universityFilterLc)
      }),
    [rawOnlineDrivers, universityFilterLc],
  )
  const recentUsers = useMemo(() => {
    let users = rawRecentUsers
    if (recentRoleFilter === 'rider') users = users.filter((u) => !u.is_driver)
    else if (recentRoleFilter === 'driver') users = users.filter((u) => u.is_driver)
    if (universityFilterLc) {
      users = users.filter((u) => {
        if (!u.email) return false
        const e = u.email.toLowerCase()
        return e.includes(`@${universityFilterLc}`) || e.endsWith(universityFilterLc)
      })
    }
    return users
  }, [rawRecentUsers, recentRoleFilter, universityFilterLc])

  const activeUsers = useMemo(
    () => recentUsers.filter((u) => u.freshness === 'fresh'),
    [recentUsers],
  )
  const staleUsers = useMemo(
    () => recentUsers.filter((u) => u.freshness === 'stale'),
    [recentUsers],
  )
  const availableCount = snapshot?.available_driver_count ?? 0
  const snoozedCount = snapshot?.snoozed_driver_count ?? 0

  const [filter, setFilter] = useState<FilterMode>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  // Slice 1.11 — separate selection state for "all recent users" dots
  // (different drawer shape than online-driver drawer since recent
  // users may not have driver context).
  const [selectedRecentUserId, setSelectedRecentUserId] = useState<string | null>(null)
  const [showOnlineDrivers, setShowOnlineDrivers] = useState(true)
  // Slice 1.11 — overlay toggles for the new last_known_at user pings.
  // Independent of the online_drivers toggle so ops can pick any combo.
  const [showActiveUsers, setShowActiveUsers] = useState(true)
  const [showStaleUsers, setShowStaleUsers] = useState(false)
  const [search, setSearch] = useState('')

  const filteredActive = useMemo(() => {
    let rides = allActive
    if (filter === 'stuck') rides = rides.filter((r) => r.stuck_reason !== null)
    else if (filter !== 'all') rides = rides.filter((r) => r.status === filter)
    const q = search.trim().toLowerCase()
    if (q.length > 0) {
      rides = rides.filter((r) => {
        const rider = (r.rider_name ?? '').toLowerCase()
        const driver = (r.driver_name ?? '').toLowerCase()
        const origin = (r.origin_name ?? '').toLowerCase()
        const dest = (r.destination_name ?? '').toLowerCase()
        return (
          rider.includes(q) ||
          driver.includes(q) ||
          origin.includes(q) ||
          dest.includes(q)
        )
      })
    }
    return rides
  }, [allActive, filter, search])

  const selectedRide = useMemo(
    () => (selectedId ? allActive.find((r) => r.id === selectedId) ?? null : null),
    [allActive, selectedId],
  )

  const selectedDriver = useMemo(
    () => (selectedDriverId ? onlineDrivers.find((d) => d.user_id === selectedDriverId) ?? null : null),
    [onlineDrivers, selectedDriverId],
  )

  const selectedRecentUser = useMemo(
    () => (selectedRecentUserId ? recentUsers.find((u) => u.user_id === selectedRecentUserId) ?? null : null),
    [recentUsers, selectedRecentUserId],
  )

  const stuckCount = useMemo(
    () => allActive.filter((r) => r.stuck_reason !== null).length,
    [allActive],
  )

  const center = useMemo<LatLng>(() => {
    const first = filteredActive.find((r) => r.last_driver_gps ?? r.pickup_point ?? r.origin)
    return (
      first?.last_driver_gps ??
      first?.pickup_point ??
      first?.origin ??
      DEFAULT_CENTER
    )
  }, [filteredActive])

  return (
    <div data-testid="admin-live-page" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Live ops</h1>
          <InfoTooltip
            testid="live-page-info"
            text="Every ride that's currently in progress (requested / accepted / coordinating / active) plus the last 60 minutes of lifecycle events. Stuck rides are flagged in red — click any ride to act on it. Refreshes every 10s while this tab is open."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {snapshot ? (
            <>
              {allActive.length} active ride{allActive.length === 1 ? '' : 's'}
              {stuckCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                  {stuckCount} stuck
                </span>
              )}
              <span className="mx-2 text-text-tertiary">·</span>
              {events.length} event{events.length === 1 ? '' : 's'} in the last hour
            </>
          ) : 'Loading…'}
          {snapshot?.generated_at && (
            <span className="ml-2 text-xs text-text-tertiary">
              · last fetched {timeAgo(snapshot.generated_at)} ago
            </span>
          )}
        </p>
      </div>

      {/* KPI strip — at-a-glance supply / demand / signal counts */}
      <div data-testid="live-kpi-strip" className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          testid="kpi-active-rides"
          label="Active rides"
          value={allActive.length}
          tooltip="Rides currently in requested / accepted / coordinating / active. Same filter as the table below."
        />
        <KpiCard
          testid="kpi-stuck-rides"
          label="Stuck rides"
          value={stuckCount}
          tone={stuckCount > 0 ? 'danger' : 'neutral'}
          tooltip="Rides currently flagged by the stuck detector (no driver, slow coordination, GPS gone stale, ride running long)."
        />
        <KpiCard
          testid="kpi-online-drivers"
          label="Online drivers"
          value={availableCount}
          subValue={(() => {
            const parts: string[] = []
            if (onlineDrivers.length > availableCount) {
              parts.push(`${onlineDrivers.length - availableCount} on ride`)
            }
            const staleCount = onlineDrivers.filter((d) => d.ping_stale).length
            if (staleCount > 0) parts.push(`${staleCount} stale ping`)
            return parts.length > 0 ? parts.join(' · ') : undefined
          })()}
          tone={availableCount > 0 ? 'success' : 'neutral'}
          tooltip="Drivers with is_online=true who are still in the matcher's reach pool (the same 7-day window the cleanup cron uses — matches what the matcher actually pushes to). 'Stale ping' = GPS hasn't refreshed in 5+ min; the matcher still notifies them via the visible push, but the on-map dot may be at their last-known position."
        />
        <KpiCard
          testid="kpi-snoozed-drivers"
          label="Snoozed drivers"
          value={snoozedCount}
          tone="warning"
          tooltip="Drivers who tapped 'snooze' after declining a request — temporarily unreachable until snoozed_until expires."
        />
      </div>

      {/* Filter pills + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          data-testid="live-filter-pills"
          className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-white p-0.5"
        >
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.id
            const count =
              tab.id === 'all'
                ? allActive.length
                : tab.id === 'stuck'
                  ? stuckCount
                  : allActive.filter((r) => r.status === tab.id).length
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`live-filter-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? tab.id === 'stuck'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-primary-light text-primary'
                    : 'text-text-secondary hover:bg-surface',
                ].join(' ')}
              >
                {tab.label}
                <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-xs">
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <input
            data-testid="live-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rider, driver, or location…"
            className="w-full rounded-md border border-border bg-white px-3 py-1.5 pr-8 text-sm"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
            >
              ✕
            </button>
          )}
        </div>
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
                {filteredActive.map((ride) => (
                  <RideMarkers
                    key={ride.id}
                    ride={ride}
                    selected={selectedId === ride.id}
                    onClick={() => setSelectedId(ride.id)}
                  />
                ))}
                {showOnlineDrivers && onlineDrivers
                  // Skip drivers already drawn as the active-ride driver
                  // dot to avoid two markers on the same coords.
                  .filter((d) => !d.on_active_ride)
                  .map((d) => (
                    <OnlineDriverMarker
                      key={`online-${d.user_id}`}
                      driver={d}
                      onClick={() => setSelectedDriverId(d.user_id)}
                    />
                  ))}
                {/* Slice 1.11 — last_known_at user pings. Renders BENEATH the
                    online-driver dots conceptually (smaller, fainter) so the
                    map stays scannable. */}
                {showActiveUsers && activeUsers.map((u) => (
                  <RecentUserMarker
                    key={`user-fresh-${u.user_id}`}
                    user={u}
                    onClick={() => setSelectedRecentUserId(u.user_id)}
                  />
                ))}
                {showStaleUsers && staleUsers.map((u) => (
                  <RecentUserMarker
                    key={`user-stale-${u.user_id}`}
                    user={u}
                    onClick={() => setSelectedRecentUserId(u.user_id)}
                  />
                ))}
              </Map>
            </APIProvider>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-text-secondary">
              Google Maps key not configured.
            </div>
          )}

          {/* Show/hide toggles — top-right of map */}
          <div className="absolute top-3 right-3 rounded-lg border border-border bg-white/95 px-3 py-2 text-xs shadow-sm flex flex-col gap-1 min-w-[200px]">
            <div className="font-semibold uppercase tracking-wide text-text-tertiary text-[10px] mb-0.5">
              Show on map
            </div>
            <ToggleRow
              id="toggle-online-drivers"
              testid="toggle-online-drivers"
              checked={showOnlineDrivers}
              onChange={setShowOnlineDrivers}
              label="Online drivers"
              count={availableCount}
              tone="success"
            />
            <ToggleRow
              id="toggle-active-users"
              testid="toggle-active-users"
              checked={showActiveUsers}
              onChange={setShowActiveUsers}
              label="Active users (1h)"
              count={activeUsers.length}
              tone="primary"
            />
            <ToggleRow
              id="toggle-stale-users"
              testid="toggle-stale-users"
              checked={showStaleUsers}
              onChange={setShowStaleUsers}
              label="Stale users (1–24h)"
              count={staleUsers.length}
              tone="neutral"
            />

            {/* 2026-05-19 — granular filters on top of the show/hide
                 toggles. Role narrows which recent users surface;
                 university filter narrows everything by email domain. */}
            <div className="mt-2 border-t border-border pt-2">
              <div className="font-semibold uppercase tracking-wide text-text-tertiary text-[10px] mb-1">
                Filter
              </div>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-text-secondary">Role</span>
                <select
                  data-testid="live-filter-role"
                  value={recentRoleFilter}
                  onChange={(e) => setRecentRoleFilter(e.target.value as typeof recentRoleFilter)}
                  className="rounded border border-border bg-white px-1.5 py-0.5 text-[11px] focus:border-primary focus:outline-none"
                >
                  <option value="all">All</option>
                  <option value="rider">Riders only</option>
                  <option value="driver">Drivers only</option>
                </select>
              </label>
              <label className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-text-secondary">University</span>
                <input
                  data-testid="live-filter-university"
                  type="text"
                  value={universityFilter}
                  onChange={(e) => setUniversityFilter(e.target.value)}
                  placeholder="ucdavis.edu"
                  className="w-32 rounded border border-border bg-white px-1.5 py-0.5 text-[11px] focus:border-primary focus:outline-none"
                />
              </label>
              {(recentRoleFilter !== 'all' || universityFilter) && (
                <button
                  type="button"
                  data-testid="live-filter-clear"
                  onClick={() => {
                    setRecentRoleFilter('all')
                    setUniversityFilter('')
                  }}
                  className="mt-1 text-[10px] text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-white/95 px-3 py-2 text-xs text-text-secondary shadow-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span>Driver on ride</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
              <span>Rider pickup</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-danger" />
              <span>Stuck ride</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-success border border-white" />
              <span>Online driver (idle)</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-success/40 border border-warning" />
              <span>Online · stale ping</span>
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
              events.map((ev, i) => (
                <EventRow
                  key={`${ev.ride_id}-${ev.kind}-${i}`}
                  event={ev}
                  onClick={() => setSelectedId(ev.ride_id)}
                />
              ))
            )}
          </div>
          {snapshot?.events_truncated && (
            <footer className="px-4 py-2 border-t border-border text-xs text-warning">
              Feed truncated — more than 100 events in the window.
            </footer>
          )}
        </section>
      </div>

      {/* Active rides table */}
      <section
        data-testid="live-active-table"
        className="rounded-2xl border border-border bg-white overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">
            Active rides ({filteredActive.length}
            {filter !== 'all' && allActive.length !== filteredActive.length && (
              <span className="text-text-tertiary"> / {allActive.length}</span>
            )}
            )
          </h2>
          {snapshot?.active_truncated && (
            <span className="text-xs text-warning">
              Truncated — more than 200 active rides
            </span>
          )}
        </header>
        {filteredActive.length === 0 ? (
          <div className="p-4 text-sm text-text-secondary">
            No rides match the current filter.
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
                  <th className="px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredActive.map((ride) => (
                  <tr
                    key={ride.id}
                    className={[
                      'border-t border-border cursor-pointer hover:bg-surface/60 transition-colors',
                      selectedId === ride.id ? 'bg-primary-light/40' : '',
                      ride.stuck_reason ? 'bg-danger/5' : '',
                    ].join(' ')}
                    onClick={() => setSelectedId(ride.id)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <StatusChip status={ride.status} />
                        {ride.stuck_reason && (
                          <StuckChip reason={ride.stuck_reason} forMs={ride.stuck_for_ms} />
                        )}
                      </div>
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
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedId(ride.id)
                        }}
                      >
                        Manage →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedRide && (
        <LiveRideDrawer
          ride={selectedRide}
          availableDrivers={onlineDrivers.filter((d) => !d.on_active_ride)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {selectedDriver && (
        <OnlineDriverDrawer
          driver={selectedDriver}
          onClose={() => setSelectedDriverId(null)}
        />
      )}

      {selectedRecentUser && (
        <RecentUserDrawer
          user={selectedRecentUser}
          onClose={() => setSelectedRecentUserId(null)}
        />
      )}
    </div>
  )
}

// ── Map markers ──────────────────────────────────────────────────────────────

function RideMarkers({
  ride,
  selected,
  onClick,
}: {
  ride: LiveActiveRide
  selected: boolean
  onClick: () => void
}) {
  const driver = ride.last_driver_gps
  const pickup = ride.pickup_point ?? ride.origin
  const dotColor = ride.stuck_reason ? 'bg-danger' : 'bg-primary'
  const dotRing = ride.stuck_reason ? 'bg-danger/30' : 'bg-primary/30'
  return (
    <>
      {driver && (
        <AdvancedMarker
          position={driver}
          title={`Driver: ${ride.driver_name ?? 'unassigned'}`}
          onClick={onClick}
        >
          <div className="relative flex items-center justify-center">
            <span className={`absolute h-5 w-5 rounded-full ${dotRing} animate-ping`} />
            <span className={`relative h-3 w-3 rounded-full ${dotColor} border-2 ${selected ? 'border-primary' : 'border-white'} shadow-md`} />
          </div>
        </AdvancedMarker>
      )}
      {pickup && (
        <AdvancedMarker
          position={pickup}
          title={`Pickup for ${ride.rider_name ?? 'rider'}`}
          onClick={onClick}
        >
          <div className={`h-3 w-3 rounded-sm bg-warning border ${selected ? 'border-primary' : 'border-white'} shadow-sm`} />
        </AdvancedMarker>
      )}
    </>
  )
}

function RecentUserMarker({
  user,
  onClick,
}: {
  user: RecentUser
  onClick: () => void
}) {
  // Smaller + fainter than online-driver dots so the map remains
  // scannable when 100+ users are pinging. Color encodes role
  // (driver = blue, rider = gray) + freshness (fresh = saturated,
  // stale = pale). Click → drawer with profile + push composer.
  const isFresh = user.freshness === 'fresh'
  const colorClass = user.is_driver
    ? (isFresh ? 'bg-primary' : 'bg-primary/40')
    : (isFresh ? 'bg-text-secondary' : 'bg-text-tertiary/60')
  const ageLabel = relativeAge(user.last_known_at)
  return (
    <AdvancedMarker
      position={{ lat: user.lat, lng: user.lng }}
      title={`${user.name ?? user.email ?? user.user_id.slice(0, 8)} · ${user.is_driver ? 'driver' : 'rider'} · last seen ${ageLabel} ago`}
      onClick={onClick}
    >
      <div className={`h-2 w-2 rounded-full ${colorClass} border border-white shadow-sm cursor-pointer`} />
    </AdvancedMarker>
  )
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

function ToggleRow({
  id,
  testid,
  checked,
  onChange,
  label,
  count,
  tone,
}: {
  id: string
  testid: string
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  count: number
  tone: 'success' | 'primary' | 'neutral'
}) {
  const dotClass = tone === 'success' ? 'bg-success' : tone === 'primary' ? 'bg-primary' : 'bg-text-tertiary'
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer text-text-secondary">
      <input
        data-testid={testid}
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer"
      />
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span className="flex-1">{label}</span>
      <span className="text-text-tertiary">{count}</span>
    </label>
  )
}

function OnlineDriverMarker({
  driver,
  onClick,
}: {
  driver: OnlineDriver
  onClick: () => void
}) {
  // Small idle-green pulse — distinct from the active-ride driver's
  // primary-color marker. Stale-ping drivers (>5 min old) render
  // dimmer + no pulse, so admin can tell at a glance which dots
  // reflect current position vs a last-known-spot. Per Tarun's
  // matcher design, these drivers are STILL reachable via the
  // matcher Stage 1 fallback's visible push — we display them
  // because the matcher would notify them, not just because they
  // happen to be pinging.
  const stale = driver.ping_stale
  const tooltip =
    `${driver.name ?? driver.email ?? driver.user_id.slice(0, 8)} · pinged ${timeAgo(driver.last_ping_at)} ago` +
    (stale ? ' (stale — matcher still pushes)' : '')
  return (
    <AdvancedMarker
      position={{ lat: driver.lat, lng: driver.lng }}
      title={tooltip}
      onClick={onClick}
    >
      <div className="relative flex items-center justify-center cursor-pointer">
        {!stale && (
          <span className="absolute h-4 w-4 rounded-full bg-success/30 animate-ping" />
        )}
        <span
          className={`relative h-2.5 w-2.5 rounded-full border ${stale ? 'bg-success/40 border-warning' : 'bg-success border-white'} shadow-sm`}
        />
      </div>
    </AdvancedMarker>
  )
}

// ── Online driver drawer (click an online-driver dot on the map) ────────────

function OnlineDriverDrawer({
  driver,
  onClose,
}: {
  driver: OnlineDriver
  onClose: () => void
}) {
  const send = useAdminSendPush(driver.user_id)
  const [pushTitle, setPushTitle] = useState('Tago support')
  const [pushBody, setPushBody] = useState('Hi, this is Tago ops checking in. Is everything OK?')

  return (
    <div
      data-testid="online-driver-drawer"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border bg-white shadow-2xl overflow-y-auto"
    >
      <header className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-text-tertiary uppercase tracking-wide">Online driver</p>
          <h2 className="text-lg font-semibold text-text-primary truncate">
            {driver.name ?? driver.email ?? driver.user_id.slice(0, 8) + '…'}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            {driver.on_active_ride ? (
              <span className="inline-block rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
                on active ride
              </span>
            ) : (
              <span className="inline-block rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                idle · available
              </span>
            )}
            {driver.ping_stale && (
              <span className="inline-block rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                stale ping
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-surface"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="px-5 py-4 space-y-4">
        <section className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Email" value={driver.email ?? '—'} />
          <Field label="Last ping" value={timeAgo(driver.last_ping_at) + ' ago'} />
          <Field label="Latitude" value={driver.lat.toFixed(5)} />
          <Field label="Longitude" value={driver.lng.toFixed(5)} />
        </section>

        {driver.ping_stale && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
            GPS hasn't refreshed in {humanMs(driver.ping_age_ms)} — the matcher
            will still notify them via the visible push, but the on-map dot is
            their last-known position, not where they are now.
          </div>
        )}

        {/* ── Profile shortcut ────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Profile
          </h3>
          <Link
            to={`/admin/users/${driver.user_id}`}
            className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
          >
            Open driver profile →
          </Link>
        </section>

        {/* ── Quick push ──────────────────────────────────────────── */}
        <section className="rounded-lg border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Push this driver
          </h3>
          <input
            data-testid="online-driver-push-title"
            type="text"
            value={pushTitle}
            onChange={(e) => setPushTitle(e.target.value)}
            maxLength={120}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <textarea
            data-testid="online-driver-push-body"
            value={pushBody}
            onChange={(e) => setPushBody(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={send.isPending || !pushTitle.trim() || !pushBody.trim()}
              onClick={() =>
                send.mutate({
                  title: pushTitle.trim(),
                  body: pushBody.trim(),
                  reason: 'live-ops driver pin',
                })
              }
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {send.isPending ? 'Sending…' : 'Send push'}
            </button>
            {send.isSuccess && (
              <span className="text-xs text-success">
                Sent to {send.data.sent}/{send.data.total_tokens} devices
              </span>
            )}
            {send.isError && (
              <span className="text-xs text-danger truncate">{send.error.message}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Recent-user drawer (Slice 1.11) ─────────────────────────────────────────

function RecentUserDrawer({
  user,
  onClose,
}: {
  user: RecentUser
  onClose: () => void
}) {
  const send = useAdminSendPush(user.user_id)
  const [pushTitle, setPushTitle] = useState('Tago support')
  const [pushBody, setPushBody] = useState(
    `Hi, this is Tago ops checking in. Hope your day's going well!`,
  )

  const ageMs = Date.now() - new Date(user.last_known_at).getTime()
  const isStale = ageMs > 5 * 60 * 1000

  return (
    <div
      data-testid="recent-user-drawer"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border bg-white shadow-2xl overflow-y-auto"
    >
      <header className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-text-tertiary uppercase tracking-wide">
            {user.is_driver ? 'Driver' : 'Rider'}
          </p>
          <h2 className="text-lg font-semibold text-text-primary truncate">
            {user.name ?? user.email ?? user.user_id.slice(0, 8) + '…'}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${user.freshness === 'fresh' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}
            >
              {user.freshness === 'fresh' ? 'active · last hour' : 'stale · 1-24h ago'}
            </span>
            {isStale && (
              <span className="text-xs text-text-tertiary">
                pinged {relativeAge(user.last_known_at)} ago
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-surface"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="px-5 py-4 space-y-4">
        <section className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Email" value={user.email ?? '—'} />
          <Field label="Role" value={user.is_driver ? 'driver' : 'rider'} />
          <Field label="Last seen" value={relativeAge(user.last_known_at) + ' ago'} />
          <Field label="Coordinates" value={`${user.lat.toFixed(5)}, ${user.lng.toFixed(5)}`} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Profile
          </h3>
          <Link
            to={`/admin/users/${user.user_id}`}
            className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
          >
            Open user profile →
          </Link>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${user.lat},${user.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
          >
            Open in Google Maps ↗
          </a>
        </section>

        <section className="rounded-lg border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">Push this user</h3>
          <input
            data-testid="recent-user-push-title"
            type="text"
            value={pushTitle}
            onChange={(e) => setPushTitle(e.target.value)}
            maxLength={120}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <textarea
            data-testid="recent-user-push-body"
            value={pushBody}
            onChange={(e) => setPushBody(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={send.isPending || !pushTitle.trim() || !pushBody.trim()}
              onClick={() =>
                send.mutate({
                  title: pushTitle.trim(),
                  body: pushBody.trim(),
                  reason: 'live-ops user pin',
                })
              }
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {send.isPending ? 'Sending…' : 'Send push'}
            </button>
            {send.isSuccess && (
              <span className="text-xs text-success">
                Sent to {send.data.sent}/{send.data.total_tokens} devices
              </span>
            )}
            {send.isError && (
              <span className="text-xs text-danger truncate">{send.error.message}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── KPI strip card ───────────────────────────────────────────────────────────

function KpiCard({
  testid,
  label,
  value,
  subValue,
  tone = 'neutral',
  tooltip,
}: {
  testid: string
  label: string
  value: number
  subValue?: string
  tone?: 'neutral' | 'success' | 'danger' | 'warning'
  tooltip: string
}) {
  const toneClass =
    tone === 'success' ? 'text-success'
      : tone === 'danger' ? 'text-danger'
        : tone === 'warning' ? 'text-warning'
          : 'text-text-primary'
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-1"
    >
      <div className="flex items-center gap-1 text-xs text-text-secondary uppercase tracking-wide">
        {label}
        <InfoTooltip testid={`${testid}-info`} text={tooltip} />
      </div>
      <div className={`text-3xl font-bold ${toneClass}`}>{value}</div>
      {subValue && <div className="text-xs text-text-tertiary">{subValue}</div>}
    </div>
  )
}

// ── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event, onClick }: { event: LiveEvent; onClick: () => void }) {
  const meta = EVENT_META[event.kind]
  const who = event.driver_name && event.kind !== 'created'
    ? `${event.rider_name ?? 'rider'} · ${event.driver_name}`
    : (event.rider_name ?? 'rider')
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-surface/60 transition-colors"
    >
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
    </button>
  )
}

// ── Chips ────────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: ActiveRideStatus }) {
  const map: Record<ActiveRideStatus, string> = {
    requested: 'bg-surface text-text-secondary',
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

function StuckChip({ reason, forMs }: { reason: StuckReason; forMs: number | null }) {
  return (
    <span
      title={STUCK_LABELS[reason].long}
      className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger"
    >
      {STUCK_LABELS[reason].short}
      {forMs != null && <span className="opacity-70">· {humanMs(forMs)}</span>}
    </span>
  )
}

const STUCK_LABELS: Record<StuckReason, { short: string; long: string }> = {
  awaiting_driver: {
    short: 'No driver yet',
    long: 'Ride requested >5 min ago and no driver has accepted yet.',
  },
  coordinating_long: {
    short: 'Slow coordination',
    long: 'Ride has been in coordination for >5 minutes — driver and rider may not be meeting.',
  },
  driver_gps_stale: {
    short: 'Driver GPS stale',
    long: 'No driver GPS ping in the last 2 minutes — they may have lost signal or stopped the app.',
  },
  ride_long: {
    short: 'Ride running long',
    long: 'Ride has been active for >30 minutes — typical Tago rides are under 15.',
  },
}

const EVENT_META: Record<LiveEvent['kind'], { label: string; dot: string; text: string }> = {
  created: { label: 'CREATED', dot: 'bg-primary', text: 'text-primary' },
  accepted: { label: 'ACCEPTED', dot: 'bg-primary', text: 'text-primary' },
  started: { label: 'STARTED', dot: 'bg-success', text: 'text-success' },
  completed: { label: 'COMPLETED', dot: 'bg-success', text: 'text-success' },
  cancelled: { label: 'CANCELLED', dot: 'bg-danger', text: 'text-danger' },
}

// ── Drawer ──────────────────────────────────────────────────────────────────

function LiveRideDrawer({
  ride,
  availableDrivers,
  onClose,
}: {
  ride: LiveActiveRide
  availableDrivers: OnlineDriver[]
  onClose: () => void
}) {
  return (
    <div
      data-testid="live-ride-drawer"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border bg-white shadow-2xl overflow-y-auto"
    >
      <header className="sticky top-0 bg-white border-b border-border px-5 py-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-text-tertiary truncate">Ride {ride.id.slice(0, 8)}…</p>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <StatusChip status={ride.status} />
            {ride.stuck_reason && (
              <StuckChip reason={ride.stuck_reason} forMs={ride.stuck_for_ms} />
            )}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="rounded-md border border-border px-2 py-1 text-sm hover:bg-surface"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="px-5 py-4 space-y-4">
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Route</h3>
          <p className="text-sm text-text-primary">
            {ride.origin_name ?? '—'}{' '}
            <span className="text-text-tertiary">→</span>{' '}
            {ride.destination_name ?? '—'}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Rider" value={ride.rider_name ?? '—'} />
          <Field label="Driver" value={ride.driver_name ?? 'unassigned'} />
          <Field label="Fare" value={ride.fare_cents != null ? formatCents(ride.fare_cents) : '—'} />
          <Field label="Created" value={timeAgo(ride.created_at) + ' ago'} />
          <Field
            label="Driver ping"
            value={ride.last_driver_ping_at ? timeAgo(ride.last_driver_ping_at) + ' ago' : '—'}
          />
          <Field
            label="Rider ping"
            value={ride.last_rider_ping_at ? timeAgo(ride.last_rider_ping_at) + ' ago' : '—'}
          />
        </section>

        {/* ── Profile shortcuts ─────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Profiles
          </h3>
          <div className="flex flex-col gap-2">
            <Link
              to={`/admin/users/${ride.rider_id}`}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
            >
              Open rider profile →
            </Link>
            {ride.driver_id ? (
              <Link
                to={`/admin/users/${ride.driver_id}`}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-surface"
              >
                Open driver profile →
              </Link>
            ) : (
              <span className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-tertiary">
                No driver assigned yet
              </span>
            )}
          </div>
        </section>

        {/* ── Push to rider ─────────────────────────────────────────── */}
        <QuickPushCard
          targetUserId={ride.rider_id}
          targetLabel={ride.rider_name ?? 'rider'}
          ride={ride}
        />
        {ride.driver_id && (
          <QuickPushCard
            targetUserId={ride.driver_id}
            targetLabel={ride.driver_name ?? 'driver'}
            ride={ride}
          />
        )}

        <ReassignCard
          ride={ride}
          availableDrivers={availableDrivers}
          onReassigned={onClose}
        />

        <ForceCancelCard ride={ride} onCancelled={onClose} />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-text-tertiary uppercase tracking-wide">{label}</div>
      <div className="text-text-primary mt-0.5">{value}</div>
    </div>
  )
}

// ── Quick-push card (per party) ─────────────────────────────────────────────

function QuickPushCard({
  targetUserId,
  targetLabel,
  ride,
}: {
  targetUserId: string
  targetLabel: string
  ride: LiveActiveRide
}) {
  const send = useAdminSendPush(targetUserId)
  const [title, setTitle] = useState('Tago support')
  const [body, setBody] = useState(
    `Hi, this is Tago ops checking in on your ride to ${ride.destination_name ?? 'your destination'}. Is everything OK?`,
  )

  return (
    <section className="rounded-lg border border-border p-3 space-y-2">
      <h3 className="text-sm font-semibold text-text-primary">
        Push {targetLabel}
      </h3>
      <input
        data-testid={`quick-push-title-${targetUserId}`}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
      />
      <textarea
        data-testid={`quick-push-body-${targetUserId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={500}
        rows={3}
        className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={send.isPending || !title.trim() || !body.trim()}
          onClick={() => send.mutate({ title: title.trim(), body: body.trim(), reason: `live-ops ride ${ride.id.slice(0, 8)}` })}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {send.isPending ? 'Sending…' : 'Send push'}
        </button>
        {send.isSuccess && (
          <span className="text-xs text-success">
            Sent to {send.data.sent}/{send.data.total_tokens} devices
          </span>
        )}
        {send.isError && (
          <span className="text-xs text-danger truncate">{send.error.message}</span>
        )}
      </div>
    </section>
  )
}

// ── Force-cancel card ──────────────────────────────────────────────────────

// ── Reassign card (Slice 1.7f) ────────────────────────────────────────────

function ReassignCard({
  ride,
  availableDrivers,
  onReassigned,
}: {
  ride: LiveActiveRide
  availableDrivers: OnlineDriver[]
  onReassigned: () => void
}) {
  const reassign = useAdminReassignRide(ride.id)
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [reason, setReason] = useState('')
  const [expanded, setExpanded] = useState(false)

  // Only requested / accepted are eligible (mid-flight reassign would
  // need re-routing — same gate the server enforces).
  const eligible = ride.status === 'requested' || ride.status === 'accepted'
  // Don't list the current driver as a target — that'd just trigger
  // ALREADY_ASSIGNED from the server.
  const picks = availableDrivers.filter((d) => d.user_id !== ride.driver_id)

  if (!eligible) {
    return (
      <section className="rounded-lg border border-border p-3 space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">Reassign ride</h3>
        <p className="text-xs text-text-secondary">
          Only available while ride is requested or accepted (currently {ride.status}).
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-primary/40 bg-primary-light/40 p-3 space-y-2">
      <h3 className="text-sm font-semibold text-primary">Reassign to a different driver</h3>
      <p className="text-xs text-text-secondary">
        Hand this ride to a specific online driver. Both parties (and the previous
        driver, if any) get a push.
      </p>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
        >
          Reassign…
        </button>
      ) : (
        <>
          <label className="block text-xs font-medium text-text-secondary">
            Pick a driver (online + idle)
          </label>
          <select
            data-testid="reassign-driver-picker"
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          >
            <option value="">— select —</option>
            {picks.map((d) => (
              <option key={d.user_id} value={d.user_id}>
                {d.name ?? d.email ?? d.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
          {picks.length === 0 && (
            <p className="text-xs text-warning">
              No idle online drivers available right now.
            </p>
          )}
          <textarea
            data-testid="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you reassigning? (required)"
            rows={2}
            maxLength={500}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setExpanded(false); setSelectedDriverId(''); setReason('') }}
              className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface"
            >
              Never mind
            </button>
            <button
              type="button"
              disabled={reassign.isPending || !selectedDriverId || !reason.trim()}
              onClick={() =>
                reassign.mutate(
                  { new_driver_id: selectedDriverId, reason: reason.trim() },
                  { onSuccess: () => onReassigned() },
                )
              }
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {reassign.isPending ? 'Reassigning…' : 'Confirm reassign'}
            </button>
          </div>
          {reassign.isError && (
            <p className="text-xs text-danger">{reassign.error.message}</p>
          )}
        </>
      )}
    </section>
  )
}

function ForceCancelCard({
  ride,
  onCancelled,
}: {
  ride: LiveActiveRide
  onCancelled: () => void
}) {
  const cancel = useAdminForceCancelRide(ride.id)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="rounded-lg border border-danger/40 bg-danger/5 p-3 space-y-2">
      <h3 className="text-sm font-semibold text-danger">Force-cancel ride</h3>
      <p className="text-xs text-text-secondary">
        Ends the ride immediately and notifies both parties. Does not refund
        payment — handle that separately on the rider's profile.
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10"
        >
          Force-cancel…
        </button>
      ) : (
        <>
          <textarea
            data-testid="force-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you cancelling? (required)"
            rows={2}
            maxLength={500}
            className="w-full rounded-md border border-border px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setConfirming(false); setReason('') }}
              className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-surface"
            >
              Never mind
            </button>
            <button
              type="button"
              disabled={cancel.isPending || !reason.trim()}
              onClick={() =>
                cancel.mutate(
                  { reason: reason.trim() },
                  { onSuccess: () => onCancelled() },
                )
              }
              className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {cancel.isPending ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          </div>
          {cancel.isError && (
            <p className="text-xs text-danger">{cancel.error.message}</p>
          )}
        </>
      )}
    </section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  return humanMs(ms)
}

function humanMs(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}
