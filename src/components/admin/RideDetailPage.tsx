import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAdminCancelRide,
  useAdminRefundRideById,
  useAdminRideDetail,
  type AdminRideAuditRow,
  type AdminRideDetail,
  type AdminRideDetailResponse,
  type AdminRideMessage,
  type AdminRidePayment,
  type AdminRideRating,
  type AdminRideReportLink,
  type AdminRideSchedule,
  type AdminRideStatus,
  type AdminRideUser,
  type AdminRideVehicle,
} from '@/hooks/useAdminRides'
import { AdminApiException } from '@/lib/admin/api'
import { supabase } from '@/lib/supabase'

/**
 * 2026-05-23 — admin-side ride detail at `/admin/rides/:id`.
 *
 * Three-column layout mirroring the reports detail page:
 *   - Left   : rider + driver mini-cards, ride metadata, payment summary
 *   - Center : chronological timeline that interleaves chat messages,
 *              system events (pickup_suggestion / dropoff_suggestion
 *              / accept messages), and wallet transactions. Reads top-
 *              to-bottom in event order.
 *   - Right  : cross-links to associated reports, both user detail
 *              pages, and a copy-id helper.
 *
 * Read-only — force-cancel / refund still live on the user detail
 * page; this page links across.
 */

const STATUS_LABEL: Record<AdminRideStatus, string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  coordinating: 'Coordinating',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const STATUS_TONE: Record<AdminRideStatus, string> = {
  requested: 'bg-surface text-text-secondary border-border',
  accepted: 'bg-primary/15 text-primary border-primary/30',
  coordinating: 'bg-primary/15 text-primary border-primary/30',
  active: 'bg-success/15 text-success border-success/30',
  completed: 'bg-surface text-text-secondary border-border',
  cancelled: 'bg-danger/10 text-danger border-danger/30',
}

/**
 * 2026-05-23 — Ride statuses where new activity is still possible.
 * Subscribed-to channels are torn down once the ride flips out of
 * these states so completed/cancelled rides don't keep an idle
 * realtime connection open.
 */
const LIVE_STATUSES: ReadonlySet<AdminRideStatus> = new Set([
  'requested',
  'accepted',
  'coordinating',
  'active',
])

export default function RideDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error, refetch } = useAdminRideDetail(id)
  const qc = useQueryClient()
  const [lastDriverPing, setLastDriverPing] = useState<Date | null>(null)
  const status = data?.ride.status as AdminRideStatus | undefined
  const isLive = !!status && LIVE_STATUSES.has(status)

  // ── Realtime subscriptions (chat + driver GPS) ─────────────────────
  // Wires the admin detail page into the same broadcast channels iOS
  // + web ride pages use. New messages stream into the timeline via a
  // React Query setQueryData patch (no refetch needed). Driver GPS
  // pings only update a "Driver broadcasting" pulse indicator — we
  // don't render the actual location on this page (no map yet).
  //
  // Also polls the detail every 10s while live so status flips
  // (accepted → coordinating → active → completed/cancelled) auto-
  // refresh without the admin reloading. The polling stops when the
  // ride flips terminal.
  useEffect(() => {
    if (!id || !isLive) return

    const chatChannel = supabase
      .channel(`chat:${id}`)
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const msg = payload.payload as AdminRideMessage | null
        if (!msg?.id) return
        qc.setQueryData<AdminRideDetailResponse>(
          ['admin', 'rides', 'detail', id],
          (prev) => {
            if (!prev) return prev
            // De-dupe in case the message already arrived via the
            // 10s polling refetch racing the broadcast.
            if (prev.messages.some((m) => m.id === msg.id)) return prev
            return { ...prev, messages: [...prev.messages, msg] }
          },
        )
      })
      .subscribe()

    const locChannel = supabase
      .channel(`ride-location:${id}`)
      .on('broadcast', { event: 'driver_location' }, () => {
        setLastDriverPing(new Date())
      })
      .subscribe()

    const poll = window.setInterval(() => void refetch(), 10_000)

    return () => {
      void supabase.removeChannel(chatChannel)
      void supabase.removeChannel(locChannel)
      window.clearInterval(poll)
    }
  }, [id, isLive, qc, refetch])

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-text-secondary" data-testid="ride-detail-loading">
        Loading ride…
      </div>
    )
  }
  if (error) {
    const msg =
      error instanceof AdminApiException
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Failed to load ride.'
    return (
      <div className="p-6" data-testid="ride-detail-error">
        <p className="text-danger text-sm font-semibold">{msg}</p>
        <Link to="/admin/rides" className="text-xs text-primary hover:underline mt-2 inline-block">
          ← Back to rides
        </Link>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-6" data-testid="ride-detail">
      <Link
        to="/admin/rides"
        className="inline-block text-xs text-text-secondary hover:text-text-primary"
      >
        ← All rides
      </Link>

      <Header
        rideId={data.ride.id}
        status={data.ride.status}
        origin={data.ride.origin_name as string | null}
        destination={data.ride.destination_name as string | null}
        createdAt={data.ride.created_at as string}
        isLive={isLive}
        lastDriverPing={lastDriverPing}
      />

      {/* min-w-0 on every column so they can shrink below their
          children's intrinsic width — without it a long system-msg
          JSON pre or an unbroken URL in a chat bubble forces the
          1fr center cell wider than its track, pushing the 280px
          right cell past the viewport edge. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <ContextColumn
            ride={data.ride}
            rider={data.rider}
            driver={data.driver}
            vehicle={data.vehicle}
            schedule={data.schedule}
            payment={data.payment}
            ratings={data.ratings}
          />
        </div>
        <div className="min-w-0">
          <ThreadColumn
            messages={data.messages}
            payment={data.payment}
            auditLog={data.audit_log}
            rider={data.rider}
            driver={data.driver}
          />
        </div>
        <div className="min-w-0">
          <ActionsColumn
            rideId={data.ride.id}
            ride={data.ride}
            rider={data.rider}
            driver={data.driver}
            reports={data.reports}
          />
        </div>
      </div>
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────

function Header({
  rideId,
  status,
  origin,
  destination,
  createdAt,
  isLive,
  lastDriverPing,
}: {
  rideId: string
  status: AdminRideStatus
  origin: string | null
  destination: string | null
  createdAt: string
  isLive: boolean
  lastDriverPing: Date | null
}) {
  const driverPingFresh =
    lastDriverPing != null &&
    Date.now() - lastDriverPing.getTime() < 30_000
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span
          data-testid="ride-detail-status-pill"
          className={[
            'inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            STATUS_TONE[status],
          ].join(' ')}
        >
          {STATUS_LABEL[status]}
        </span>
        {isLive && (
          <span
            data-testid="ride-detail-live-pill"
            className="inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            title="Subscribed to chat + driver GPS broadcasts in realtime"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            Live
          </span>
        )}
        {driverPingFresh && (
          <span
            data-testid="ride-detail-driver-ping"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary"
            title={`Driver pinged at ${lastDriverPing?.toLocaleTimeString() ?? ''}`}
          >
            📍 Driver broadcasting
          </span>
        )}
        <span className="text-xs font-mono text-text-secondary">
          {rideId.slice(0, 8)}…
        </span>
      </div>
      <h1 className="mt-2 text-xl font-bold text-text-primary">
        {origin ?? '—'} → {destination ?? '—'}
      </h1>
      <p className="mt-1 text-xs text-text-secondary">
        Created {fmtDateTime(createdAt)}
      </p>
    </div>
  )
}

// ── Context (left) ───────────────────────────────────────────────────

function ContextColumn({
  ride,
  rider,
  driver,
  vehicle,
  schedule,
  payment,
  ratings,
}: {
  ride: AdminRideDetail
  rider: AdminRideUser | null
  driver: AdminRideUser | null
  vehicle: AdminRideVehicle | null
  schedule: AdminRideSchedule | null
  payment: AdminRidePayment[]
  ratings: AdminRideRating[]
}) {
  const fareCents = ride.fare_cents as number | null
  const paymentStatus = ride.payment_status as string | null
  const pickupConfirmed = ride.pickup_confirmed as boolean | null
  const dropoffConfirmed = ride.dropoff_confirmed as boolean | null
  const pickupNote = ride.pickup_note as string | null
  const startedAt = ride.started_at as string | null
  const endedAt = ride.ended_at as string | null
  const gpsDistanceMetres = ride.gps_distance_metres as number | null
  const autoEnded = ride.auto_ended as boolean | null
  const lastDriverLat = ride.last_driver_gps_lat as number | null
  const lastDriverLng = ride.last_driver_gps_lng as number | null
  const lastDriverPingAt = ride.last_driver_ping_at as string | null
  const lastRiderLat = ride.last_rider_gps_lat as number | null
  const lastRiderLng = ride.last_rider_gps_lng as number | null
  const lastRiderPingAt = ride.last_rider_ping_at as string | null

  // Derive tip from existing wallet_transactions list — `tip_debit` row
  // is the rider's outflow (-cents), `tip_credit` is the driver's inflow.
  // We display the absolute tip amount; sign isn't useful in the UI.
  const tipRow = payment.find((p) => p.kind === 'tip_debit')
  const tipCents = tipRow != null ? Math.abs(tipRow.amount_cents) : null

  return (
    <div className="space-y-4">
      <Card title="Rider" testid="ride-rider">
        {rider ? <UserMini user={rider} /> : <NeutralRow text="Unknown rider" />}
      </Card>

      <Card title="Driver" testid="ride-driver">
        {driver ? <UserMini user={driver} /> : <NeutralRow text="Unassigned" />}
      </Card>

      {vehicle && (
        <Card title="Vehicle" testid="ride-vehicle">
          <p className="text-sm text-text-primary">
            {vehicle.year ?? '—'} {vehicle.color ?? ''} {vehicle.make ?? ''} {vehicle.model ?? ''}
          </p>
          <p className="mt-0.5 text-[11px] font-mono text-text-secondary">
            {vehicle.plate ?? '—'}
          </p>
        </Card>
      )}

      {/* Trip stats — distance, duration, auto-ended flag, started/ended */}
      <Card title="Trip stats" testid="ride-trip-stats">
        <dl className="text-xs text-text-primary space-y-1">
          <Row
            label="Distance"
            value={fmtDistance(gpsDistanceMetres)}
            tone={gpsDistanceMetres != null && gpsDistanceMetres > 0 ? '' : 'text-text-secondary'}
          />
          <Row label="Duration" value={fmtDuration(startedAt, endedAt)} />
          <Row label="Started" value={fmtDateTime(startedAt) ?? '—'} />
          <Row label="Ended" value={fmtDateTime(endedAt) ?? '—'} />
          <Row
            label="Auto-ended"
            value={
              autoEnded === true ? (
                <span className="text-warning font-semibold">Yes</span>
              ) : autoEnded === false ? (
                <span className="text-text-secondary">No</span>
              ) : (
                '—'
              )
            }
          />
          {autoEnded === true && (
            <p className="pt-1 text-[10px] italic text-text-secondary">
              Auto-end fires when driver+rider GPS diverge by &gt;500m for 2+ min
              (forgotten-QR safety net). Exact reason isn&apos;t captured today —
              see migration plan to add `end_reason text`.
            </p>
          )}
        </dl>
      </Card>

      {/* Fare + payment — now includes tip line + per-CLAUDE.md note about
          missing breakdown */}
      <Card title="Fare + payment" testid="ride-payment">
        <dl className="text-xs text-text-primary space-y-1">
          <Row label="Fare" value={fmtMoneyCents(fareCents)} />
          {tipCents != null && (
            <Row
              label="Tip"
              value={<span className="text-success">{fmtMoneyCents(tipCents)}</span>}
            />
          )}
          <Row label="Status" value={paymentStatus ?? '—'} tone={paymentTone(paymentStatus)} />
        </dl>
        <p className="pt-2 text-[10px] italic text-text-secondary">
          Per-component breakdown (gas cost + time cost + gas price snapshot)
          isn&apos;t persisted on the ride today. The fare formula is in
          CLAUDE.md; admin can re-derive from distance + duration but exact
          numbers used at fare-set time are lost.
        </p>
      </Card>

      {/* Ratings — at most 2 rows: rider→driver, driver→rider */}
      <Card title={`Ratings · ${ratings.length}`} testid="ride-ratings">
        {ratings.length === 0 ? (
          <NeutralRow text="No ratings submitted yet." />
        ) : (
          <ul className="space-y-2.5">
            {ratings.map((r) => (
              <RatingRow key={r.id} rating={r} rider={rider} driver={driver} />
            ))}
          </ul>
        )}
      </Card>

      {/* GPS — last known per party, with Google Maps links */}
      <Card title="Last known GPS" testid="ride-gps">
        <dl className="text-xs text-text-primary space-y-2">
          <GpsRow
            label="Driver"
            lat={lastDriverLat}
            lng={lastDriverLng}
            pingAt={lastDriverPingAt}
          />
          <GpsRow
            label="Rider"
            lat={lastRiderLat}
            lng={lastRiderLng}
            pingAt={lastRiderPingAt}
          />
        </dl>
        <p className="pt-2 text-[10px] italic text-text-secondary">
          These are the most recent GPS pings — usually within seconds of the
          start/end QR scan but not the scan itself. Exact QR scan locations
          aren&apos;t captured today.
        </p>
      </Card>

      <Card title="Pickup / dropoff" testid="ride-flags">
        <dl className="text-xs text-text-primary space-y-1">
          <Row label="Pickup confirmed" value={boolPill(pickupConfirmed)} />
          <Row label="Dropoff confirmed" value={boolPill(dropoffConfirmed)} />
          {pickupNote && <Row label="Pickup note" value={pickupNote} />}
        </dl>
      </Card>

      {schedule && (
        <Card title="From board post" testid="ride-schedule">
          <p className="text-xs text-text-primary">
            <span className="font-semibold">
              {schedule.mode === 'driver' ? 'Driver post' : 'Rider post'}
            </span>
            {schedule.trip_date && (
              <span className="text-text-secondary"> · {schedule.trip_date}</span>
            )}
            {schedule.trip_time && (
              <span className="text-text-secondary"> · {schedule.trip_time}</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-text-secondary">
            {schedule.origin_address ?? '—'} → {schedule.dest_address ?? '—'}
          </p>
        </Card>
      )}
    </div>
  )
}

/**
 * One row of `Last known GPS`. Renders coords + relative time + a
 * Google Maps deep-link the admin can open in a new tab to eyeball
 * where the party physically was. Used for both driver and rider.
 */
function GpsRow({
  label,
  lat,
  lng,
  pingAt,
}: {
  label: string
  lat: number | null
  lng: number | null
  pingAt: string | null
}) {
  if (lat == null || lng == null) {
    return (
      <div>
        <dt className="text-[10px] uppercase tracking-wide text-text-secondary">
          {label}
        </dt>
        <dd className="text-xs text-text-secondary italic">No ping recorded.</dd>
      </div>
    )
  }
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-secondary">
        {label}
      </dt>
      <dd className="text-xs text-text-primary font-mono break-all">
        {lat.toFixed(5)}, {lng.toFixed(5)}
      </dd>
      <div className="mt-0.5 flex items-center gap-2 text-[11px]">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
          data-testid={`ride-gps-${label.toLowerCase()}-link`}
        >
          Open in Maps →
        </a>
        {pingAt && (
          <span className="text-text-secondary">
            · last ping {fmtRelative(pingAt)}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * One row in the Ratings card. Labels each rating as
 * "Rider rated driver" / "Driver rated rider" by checking which
 * party the rater_id matches.
 */
function RatingRow({
  rating,
  rider,
  driver,
}: {
  rating: AdminRideRating
  rider: AdminRideUser | null
  driver: AdminRideUser | null
}) {
  const direction = (() => {
    if (rider && rating.rater_id === rider.id) return 'Rider → Driver'
    if (driver && rating.rater_id === driver.id) return 'Driver → Rider'
    return 'Unknown direction'
  })()
  return (
    <li data-testid={`ride-rating-${rating.id}`} className="rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
          {direction}
        </p>
        <p className="text-sm font-bold text-warning">
          {'★'.repeat(rating.stars)}
          <span className="text-text-secondary/30">{'★'.repeat(5 - rating.stars)}</span>
        </p>
      </div>
      {rating.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rating.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white border border-border px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {rating.comment && (
        <p className="mt-1.5 text-xs text-text-primary whitespace-pre-wrap break-words">
          "{rating.comment}"
        </p>
      )}
      <p className="mt-1 text-[10px] text-text-secondary">{fmtDateTime(rating.created_at)}</p>
    </li>
  )
}

function UserMini({ user }: { user: AdminRideUser }) {
  return (
    <Link
      to={`/admin/users/${user.id}`}
      className="block rounded-xl border border-border bg-surface p-3 hover:border-primary hover:bg-primary/5 transition-colors"
      data-testid={`ride-user-link-${user.id}`}
    >
      <p className="text-sm font-semibold text-text-primary truncate">
        {user.full_name ?? '(no name)'}
      </p>
      {user.email && (
        <p className="text-[11px] text-text-secondary truncate">{user.email}</p>
      )}
      <div className="mt-1.5 flex gap-1.5">
        {user.is_driver && (
          <span className="rounded bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5">
            Driver
          </span>
        )}
        {user.suspended_at && (
          <span className="rounded bg-danger/10 text-danger text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5">
            Suspended
          </span>
        )}
      </div>
    </Link>
  )
}

// ── Thread (center) — chronological interleave ───────────────────────

type TimelineItem =
  | { kind: 'message'; row: AdminRideMessage; ts: string }
  | { kind: 'payment'; row: AdminRidePayment; ts: string }
  | { kind: 'audit'; row: AdminRideAuditRow; ts: string }

function ThreadColumn({
  messages,
  payment,
  auditLog,
  rider,
  driver,
}: {
  messages: AdminRideMessage[]
  payment: AdminRidePayment[]
  auditLog: AdminRideAuditRow[]
  rider: AdminRideUser | null
  driver: AdminRideUser | null
}) {
  const items: TimelineItem[] = [
    ...messages.map<TimelineItem>((row) => ({ kind: 'message', row, ts: row.created_at })),
    ...payment.map<TimelineItem>((row) => ({ kind: 'payment', row, ts: row.created_at })),
    ...auditLog.map<TimelineItem>((row) => ({ kind: 'audit', row, ts: row.created_at })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  return (
    <div className="space-y-4">
      <Card
        title={`Thread (${messages.length} messages · ${payment.length} payment · ${auditLog.length} state flips)`}
        testid="ride-thread"
      >
        {items.length === 0 ? (
          <NeutralRow text="No messages or payments yet." />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              if (item.kind === 'message') {
                return (
                  <MessageBubble
                    key={`msg-${item.row.id}`}
                    message={item.row}
                    rider={rider}
                    driver={driver}
                  />
                )
              }
              if (item.kind === 'payment') {
                return <PaymentEntry key={`pay-${item.row.id}`} row={item.row} />
              }
              return (
                <AuditEntry
                  key={`audit-${item.row.id}`}
                  row={item.row}
                  rider={rider}
                  driver={driver}
                />
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/**
 * 2026-05-23 — slim, centered, italic line that marks a rides-table
 * field flip (status, driver_id, pickup_confirmed, dropoff_confirmed,
 * payment_status, fare_cents). Distinct from message bubbles (which
 * are conversational) and payment entries (which are dollars) so the
 * eye triages it as "system event" at a glance.
 *
 * Actor resolution: changed_by maps to rider/driver when possible
 * (lets the admin see "Driver Alex confirmed pickup" vs "System
 * cancelled ride"). NULL changed_by = service-role update (most
 * common — the server lifecycle paths run as service role).
 */
function AuditEntry({
  row,
  rider,
  driver,
}: {
  row: AdminRideAuditRow
  rider: AdminRideUser | null
  driver: AdminRideUser | null
}) {
  const actorLabel = (() => {
    if (!row.changed_by) return 'System'
    if (rider && row.changed_by === rider.id) return rider.full_name ?? 'Rider'
    if (driver && row.changed_by === driver.id) return driver.full_name ?? 'Driver'
    return `Admin ${row.changed_by.slice(0, 8)}…`
  })()
  const summary = formatAuditSummary(row)
  return (
    <li data-testid={`ride-audit-${row.id}`} className="flex justify-center">
      <div className="flex items-center gap-2 text-[11px] text-text-secondary italic">
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-medium not-italic text-text-primary">{actorLabel}</span>
          {' '}{summary}{' '}
          <span className="text-text-secondary/80">· {fmtDateTime(row.created_at)}</span>
        </span>
        <span aria-hidden="true">·</span>
      </div>
    </li>
  )
}

function formatAuditSummary(row: AdminRideAuditRow): string {
  const from = row.old_value ?? '—'
  const to = row.new_value ?? '—'
  switch (row.field) {
    case 'status':
      return `flipped ride status ${from} → ${to}`
    case 'driver_id':
      if (!row.old_value && row.new_value) return 'assigned a driver'
      if (row.old_value && !row.new_value) return 'unassigned the driver'
      return `changed driver ${shortenId(from)} → ${shortenId(to)}`
    case 'pickup_confirmed':
      return to === 'true' ? 'confirmed pickup' : 'reverted pickup confirmation'
    case 'dropoff_confirmed':
      return to === 'true' ? 'confirmed dropoff' : 'reverted dropoff confirmation'
    case 'payment_status':
      return `payment ${from} → ${to}`
    case 'fare_cents': {
      const oldD = row.old_value ? `$${(parseInt(row.old_value, 10) / 100).toFixed(2)}` : '—'
      const newD = row.new_value ? `$${(parseInt(row.new_value, 10) / 100).toFixed(2)}` : '—'
      return `fare ${oldD} → ${newD}`
    }
    default:
      return `${row.field.replace(/_/g, ' ')} ${from} → ${to}`
  }
}

function shortenId(s: string): string {
  if (s === '—') return s
  return `${s.slice(0, 8)}…`
}

function MessageBubble({
  message,
  rider,
  driver,
}: {
  message: AdminRideMessage
  rider: AdminRideUser | null
  driver: AdminRideUser | null
}) {
  const isDriver = driver?.id === message.sender_id
  const senderName = isDriver
    ? driver?.full_name ?? 'Driver'
    : message.sender_id === rider?.id
      ? rider?.full_name ?? 'Rider'
      : 'System'

  // System-y message types (pickup_suggestion, dropoff_suggestion,
  // location_accepted, etc.) render as a centered grey card so
  // they're visually distinct from human chat.
  if (message.type !== 'text') {
    return (
      <li
        data-testid={`ride-msg-${message.id}`}
        className="flex justify-center"
      >
        <div className="max-w-[90%] min-w-0 rounded-xl border border-border bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
            <span>{message.type.replace(/_/g, ' ')}</span>
            <span>· {senderName}</span>
            <span>· {fmtDateTime(message.created_at)}</span>
          </div>
          {message.content && (
            <p className="mt-1 text-xs text-text-primary whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
          {message.meta && (
            <pre className="mt-1.5 max-w-full text-[10px] text-text-secondary bg-white border border-border rounded px-2 py-1.5 overflow-x-auto whitespace-pre">
              {JSON.stringify(message.meta, null, 2)}
            </pre>
          )}
        </div>
      </li>
    )
  }

  return (
    <li
      data-testid={`ride-msg-${message.id}`}
      className={['flex', isDriver ? 'justify-end' : 'justify-start'].join(' ')}
    >
      <div
        className={[
          'max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2 text-sm',
          isDriver
            ? 'rounded-br-md bg-primary text-white'
            : 'rounded-bl-md bg-surface text-text-primary',
        ].join(' ')}
      >
        <p
          className={[
            'mb-0.5 text-[10px] uppercase tracking-wide font-semibold',
            isDriver ? 'text-white/70' : 'text-text-secondary',
          ].join(' ')}
        >
          {senderName}
        </p>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p
          className={[
            'mt-1 text-[10px]',
            isDriver ? 'text-white/60' : 'text-text-secondary',
          ].join(' ')}
        >
          {fmtDateTime(message.created_at)}
        </p>
      </div>
    </li>
  )
}

function PaymentEntry({ row }: { row: AdminRidePayment }) {
  const amount = row.amount_cents
  const sign = amount >= 0 ? '+' : '−'
  const abs = Math.abs(amount)
  const dollars = `${sign}$${(abs / 100).toFixed(2)}`
  return (
    <li
      data-testid={`ride-payment-${row.id}`}
      className="flex justify-center"
    >
      <div className="flex items-center gap-2 text-[11px] text-text-secondary italic">
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-semibold not-italic text-text-primary">{row.kind}</span>
          {' '}
          <span className="font-mono text-text-primary not-italic">{dollars}</span>
          {row.payment_source && (
            <span className="text-text-secondary/80"> via {row.payment_source}</span>
          )}
          <span className="text-text-secondary/80"> · {fmtDateTime(row.created_at)}</span>
        </span>
        <span aria-hidden="true">·</span>
      </div>
    </li>
  )
}

// ── Actions (right) ──────────────────────────────────────────────────

function ActionsColumn({
  rideId,
  ride,
  rider,
  driver,
  reports,
}: {
  rideId: string
  ride: AdminRideDetail
  rider: AdminRideUser | null
  driver: AdminRideUser | null
  reports: AdminRideReportLink[]
}) {
  return (
    <div className="space-y-4">
      {reports.length > 0 && (
        <Card title={`Reports · ${reports.length}`} testid="ride-reports">
          <ul className="space-y-1.5">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/admin/reports/${r.id}`}
                  data-testid={`ride-report-link-${r.id}`}
                  className="block rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs hover:border-primary hover:bg-primary/5"
                >
                  <p className="font-semibold text-text-primary truncate">{r.title}</p>
                  <p className="text-[10px] text-text-secondary">
                    {r.severity} · {r.status}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 2026-05-23 — actions on the ride itself. Both endpoints
          existed already; this just surfaces them where the admin
          sees the problem so they don't have to bounce to user
          detail to act. Each action collapses its own reason
          collector inline (no modal) to keep the keyboard flow
          tight. */}
      <RideActionsCard ride={ride} />

      <Card title="Cross-links" testid="ride-actions">
        <p className="text-[11px] text-text-secondary mb-2">
          Suspend / wallet adjustments / push live on the user
          detail page. Use the links to jump there with context.
        </p>
        <div className="space-y-2">
          {rider && (
            <Link
              to={`/admin/users/${rider.id}`}
              data-testid="ride-action-rider-link"
              className="block rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:border-primary hover:bg-primary/5"
            >
              Open rider detail →
            </Link>
          )}
          {driver && (
            <Link
              to={`/admin/users/${driver.id}`}
              data-testid="ride-action-driver-link"
              className="block rounded-md border border-border bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:border-primary hover:bg-primary/5"
            >
              Open driver detail →
            </Link>
          )}
        </div>
      </Card>

      <Card title="Ride id" testid="ride-id-block">
        <p className="text-[10px] font-mono text-text-secondary break-all">{rideId}</p>
      </Card>
    </div>
  )
}

/**
 * Refund + Force-cancel actions on the ride detail page.
 *
 * Refund: gated to `status='completed' AND payment_status='paid'`
 * server-side. We mirror that gate client-side so the button
 * only appears (or stays disabled with explanation) when the
 * action would actually go through.
 *
 * Force-cancel: gated to non-terminal status. A completed ride
 * can't be force-cancelled (refund is the right tool there).
 *
 * Both actions collect a free-text reason inline (no modal). The
 * reason is required by the server (400 REASON_REQUIRED otherwise)
 * and gets written to the admin audit log so future-you can
 * reconstruct why the action happened.
 */
function RideActionsCard({ ride }: { ride: AdminRideDetail }) {
  const status = ride.status as AdminRideStatus
  const paymentStatus = ride.payment_status as string | null
  const fareCents = ride.fare_cents as number | null
  const terminal = status === 'completed' || status === 'cancelled'
  const refundable = status === 'completed' && paymentStatus === 'paid' && (fareCents ?? 0) > 0

  return (
    <Card title="Actions" testid="ride-actions-card">
      <div className="space-y-3">
        <RefundAction
          rideId={ride.id}
          enabled={refundable}
          fareCents={fareCents}
          status={status}
          paymentStatus={paymentStatus}
        />
        <CancelAction
          rideId={ride.id}
          enabled={!terminal}
          status={status}
        />
      </div>
    </Card>
  )
}

function RefundAction({
  rideId,
  enabled,
  fareCents,
  status,
  paymentStatus,
}: {
  rideId: string
  enabled: boolean
  fareCents: number | null
  status: AdminRideStatus
  paymentStatus: string | null
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [allowOverdraft, setAllowOverdraft] = useState(false)
  const m = useAdminRefundRideById(rideId)
  const fareLabel = fareCents != null ? `$${(fareCents / 100).toFixed(2)}` : '—'

  if (!enabled) {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-text-secondary">
        <p className="font-semibold text-text-primary mb-0.5">Refund</p>
        <p>
          Unavailable — ride is <span className="font-semibold">{status}</span>
          {paymentStatus ? ` (payment: ${paymentStatus})` : ''}. Only paid completed rides can be refunded.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="ride-action-refund-open"
        className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-bold text-warning hover:bg-warning/15"
      >
        Refund {fareLabel} →
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3" data-testid="ride-action-refund-form">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">
        Refund {fareLabel}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Reason (required) — e.g. driver no-show, double-charged…"
        data-testid="ride-action-refund-reason"
        className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/60 focus:border-warning focus:outline-none"
      />
      <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
        <input
          type="checkbox"
          checked={allowOverdraft}
          onChange={(e) => setAllowOverdraft(e.target.checked)}
          data-testid="ride-action-refund-overdraft"
          className="h-3 w-3 rounded border-border accent-warning"
        />
        Allow driver overdraft (debits driver even if their balance goes negative)
      </label>
      {m.isError && (
        <p data-testid="ride-action-refund-error" className="text-[11px] text-danger" role="alert">
          {m.error instanceof AdminApiException
            ? `${m.error.code}: ${m.error.message}`
            : m.error.message}
        </p>
      )}
      {m.isSuccess && (
        <p data-testid="ride-action-refund-success" className="text-[11px] font-semibold text-success">
          Refunded. Rider balance ${((m.data?.rider_balance_after_cents ?? 0) / 100).toFixed(2)}, driver ${((m.data?.driver_balance_after_cents ?? 0) / 100).toFixed(2)}.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setReason('')
            m.reset()
          }}
          className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={reason.trim().length === 0 || m.isPending || m.isSuccess}
          onClick={() => m.mutate({ reason: reason.trim(), allow_driver_overdraft: allowOverdraft })}
          data-testid="ride-action-refund-submit"
          className="flex-1 rounded-md bg-warning px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {m.isPending ? 'Refunding…' : m.isSuccess ? 'Done' : `Refund ${fareLabel}`}
        </button>
      </div>
    </div>
  )
}

function CancelAction({
  rideId,
  enabled,
  status,
}: {
  rideId: string
  enabled: boolean
  status: AdminRideStatus
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const m = useAdminCancelRide(rideId)

  if (!enabled) {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-text-secondary">
        <p className="font-semibold text-text-primary mb-0.5">Force cancel</p>
        <p>
          Unavailable — ride is already <span className="font-semibold">{status}</span>.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="ride-action-cancel-open"
        className="w-full rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs font-bold text-danger hover:bg-danger/10"
      >
        Force cancel ride →
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-danger/40 bg-danger/5 p-3" data-testid="ride-action-cancel-form">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">
        Force cancel ride
      </p>
      <p className="text-[11px] text-text-secondary">
        Flips status to <span className="font-semibold">cancelled</span> + notifies
        both parties. Payment status is NOT touched — refund separately if
        money already moved.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Reason (required) — e.g. driver vanished, rider unresponsive…"
        data-testid="ride-action-cancel-reason"
        className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary/60 focus:border-danger focus:outline-none"
      />
      {m.isError && (
        <p data-testid="ride-action-cancel-error" className="text-[11px] text-danger" role="alert">
          {m.error instanceof AdminApiException
            ? `${m.error.code}: ${m.error.message}`
            : m.error.message}
        </p>
      )}
      {m.isSuccess && (
        <p data-testid="ride-action-cancel-success" className="text-[11px] font-semibold text-success">
          Ride cancelled. Both parties notified.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setReason('')
            m.reset()
          }}
          className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={reason.trim().length === 0 || m.isPending || m.isSuccess}
          onClick={() => m.mutate({ reason: reason.trim() })}
          data-testid="ride-action-cancel-submit"
          className="flex-1 rounded-md bg-danger px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {m.isPending ? 'Cancelling…' : m.isSuccess ? 'Done' : 'Force cancel'}
        </button>
      </div>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────

function Card({
  title,
  children,
  testid,
}: {
  title: string
  children: React.ReactNode
  testid?: string
}) {
  return (
    <section
      data-testid={testid}
      className="rounded-2xl border border-border bg-white p-4"
    >
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-secondary">
        {title}
      </h2>
      {children}
    </section>
  )
}

function NeutralRow({ text }: { text: string }) {
  return <p className="text-sm text-text-secondary">{text}</p>
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</dt>
      <dd className={['text-xs text-right', tone ?? 'text-text-primary'].join(' ')}>{value}</dd>
    </div>
  )
}

function boolPill(v: boolean | null) {
  if (v == null) return '—'
  return v ? (
    <span className="text-success font-semibold">Yes</span>
  ) : (
    <span className="text-text-secondary">No</span>
  )
}

function paymentTone(status: string | null): string {
  if (status === 'paid') return 'text-success'
  if (status === 'failed' || status === 'refunded') return 'text-danger'
  if (status === 'pending' || status === 'processing') return 'text-warning'
  return 'text-text-secondary'
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtMoneyCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtDistance(metres: number | null | undefined): string {
  if (metres == null || metres <= 0) return '—'
  const miles = metres / 1609.344
  if (miles < 0.1) return `${Math.round(metres)} m`
  return `${miles.toFixed(2)} mi (${(metres / 1000).toFixed(2)} km)`
}

function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—'
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours}h ${remMin}m`
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return iso
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}
