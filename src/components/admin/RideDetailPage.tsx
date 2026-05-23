import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  useAdminRideDetail,
  type AdminRideDetailResponse,
  type AdminRideMessage,
  type AdminRidePayment,
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_280px]">
        <ContextColumn
          rider={data.rider}
          driver={data.driver}
          vehicle={data.vehicle}
          schedule={data.schedule}
          fareCents={data.ride.fare_cents as number | null}
          paymentStatus={data.ride.payment_status as string | null}
          pickupConfirmed={data.ride.pickup_confirmed as boolean | null}
          dropoffConfirmed={data.ride.dropoff_confirmed as boolean | null}
          pickupNote={data.ride.pickup_note as string | null}
          startedAt={data.ride.started_at as string | null}
          endedAt={data.ride.ended_at as string | null}
        />
        <ThreadColumn
          messages={data.messages}
          payment={data.payment}
          rider={data.rider}
          driver={data.driver}
        />
        <ActionsColumn
          rideId={data.ride.id}
          rider={data.rider}
          driver={data.driver}
          reports={data.reports}
        />
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
  rider,
  driver,
  vehicle,
  schedule,
  fareCents,
  paymentStatus,
  pickupConfirmed,
  dropoffConfirmed,
  pickupNote,
  startedAt,
  endedAt,
}: {
  rider: AdminRideUser | null
  driver: AdminRideUser | null
  vehicle: AdminRideVehicle | null
  schedule: AdminRideSchedule | null
  fareCents: number | null
  paymentStatus: string | null
  pickupConfirmed: boolean | null
  dropoffConfirmed: boolean | null
  pickupNote: string | null
  startedAt: string | null
  endedAt: string | null
}) {
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

      <Card title="Fare + payment" testid="ride-payment">
        <dl className="text-xs text-text-primary space-y-1">
          <Row label="Fare" value={fareCents != null ? `$${(fareCents / 100).toFixed(2)}` : '—'} />
          <Row label="Status" value={paymentStatus ?? '—'} tone={paymentTone(paymentStatus)} />
        </dl>
      </Card>

      <Card title="Pickup / dropoff" testid="ride-flags">
        <dl className="text-xs text-text-primary space-y-1">
          <Row label="Pickup confirmed" value={boolPill(pickupConfirmed)} />
          <Row label="Dropoff confirmed" value={boolPill(dropoffConfirmed)} />
          {pickupNote && <Row label="Pickup note" value={pickupNote} />}
          {startedAt && <Row label="Started" value={fmtDateTime(startedAt)} />}
          {endedAt && <Row label="Ended" value={fmtDateTime(endedAt)} />}
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

function ThreadColumn({
  messages,
  payment,
  rider,
  driver,
}: {
  messages: AdminRideMessage[]
  payment: AdminRidePayment[]
  rider: AdminRideUser | null
  driver: AdminRideUser | null
}) {
  const items: TimelineItem[] = [
    ...messages.map<TimelineItem>((row) => ({ kind: 'message', row, ts: row.created_at })),
    ...payment.map<TimelineItem>((row) => ({ kind: 'payment', row, ts: row.created_at })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  return (
    <div className="space-y-4">
      <Card title={`Thread (${messages.length} messages · ${payment.length} payment events)`} testid="ride-thread">
        {items.length === 0 ? (
          <NeutralRow text="No messages or payments yet." />
        ) : (
          <ul className="space-y-3">
            {items.map((item) =>
              item.kind === 'message' ? (
                <MessageBubble
                  key={`msg-${item.row.id}`}
                  message={item.row}
                  rider={rider}
                  driver={driver}
                />
              ) : (
                <PaymentEntry key={`pay-${item.row.id}`} row={item.row} />
              ),
            )}
          </ul>
        )}
      </Card>
    </div>
  )
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
        <div className="max-w-[90%] rounded-xl border border-border bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
            <span>{message.type.replace(/_/g, ' ')}</span>
            <span>· {senderName}</span>
            <span>· {fmtDateTime(message.created_at)}</span>
          </div>
          {message.content && (
            <p className="mt-1 text-xs text-text-primary whitespace-pre-wrap">
              {message.content}
            </p>
          )}
          {message.meta && (
            <pre className="mt-1.5 text-[10px] text-text-secondary bg-white border border-border rounded px-2 py-1.5 overflow-x-auto">
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
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
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
        <p className="whitespace-pre-wrap">{message.content}</p>
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
  rider,
  driver,
  reports,
}: {
  rideId: string
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

      <Card title="Cross-links" testid="ride-actions">
        <p className="text-[11px] text-text-secondary mb-2">
          Refunds + suspensions live on the user detail page. Use the
          links below to jump straight there with context.
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
