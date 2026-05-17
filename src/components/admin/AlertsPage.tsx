import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  useAdminAlerts,
  type StuckRideAlert,
  type PaymentAlert,
  type NegativeWalletAlert,
  type SuspensionAlert,
  type AlertCategory,
} from '@/hooks/useAdminAlerts'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.9 — operational alerts panel.
 *
 * Single page that aggregates every category of "needs attention"
 * signal in Tago: stuck rides, failed payments, unpaid completed
 * rides (webhook drift), negative-balance wallets, recent
 * suspensions. Each section is collapsible-by-emptiness — if a
 * category has zero items it collapses to a one-line "all clear"
 * marker so the page stays scannable.
 *
 * Polling at 30s (paused when tab loses focus) — frequent enough to
 * catch issues without burning round trips on a tab nobody's
 * watching. Stuck-ride detection mirrors /admin/live exactly.
 */

export default function AlertsPage() {
  const alerts = useAdminAlerts()
  const data = alerts.data

  const total = data?.total_count ?? 0

  return (
    <div data-testid="admin-alerts-page" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">Alerts</h1>
          <InfoTooltip
            testid="alerts-page-info"
            text="Things that need ops attention right now: stuck rides, payment failures, drivers in the red, and a 24h window of recent suspensions. Polls every 30 seconds while this tab is open."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {alerts.isLoading ? (
            'Loading…'
          ) : total === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
              all clear
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                {total} active alert{total === 1 ? '' : 's'}
              </span>
              {data?.generated_at && (
                <span className="ml-2 text-xs text-text-tertiary">
                  · last fetched {timeAgo(data.generated_at)} ago
                </span>
              )}
            </>
          )}
        </p>
      </div>

      <StuckRidesCard category={data?.stuck_rides} loading={alerts.isLoading} />
      <FailedPaymentsCard category={data?.failed_payments} loading={alerts.isLoading} />
      <UnpaidCompletedCard category={data?.unpaid_completed} loading={alerts.isLoading} />
      <NegativeWalletsCard category={data?.negative_wallets} loading={alerts.isLoading} />
      <RecentSuspensionsCard category={data?.recent_suspensions} loading={alerts.isLoading} />
    </div>
  )
}

// ── Stuck rides ──────────────────────────────────────────────────────────────

function StuckRidesCard({
  category,
  loading,
}: {
  category?: AlertCategory<StuckRideAlert>
  loading: boolean
}) {
  return (
    <SectionCard
      testid="alerts-stuck-rides"
      title="Stuck rides"
      tooltip="Active rides Tago can't progress on its own (no driver match, GPS gone stale, coordinating too long, ride running long). Click 'Open in Live ops' to act on them in the drawer."
      category={category}
      loading={loading}
      tone="danger"
      footer={
        category && category.count > 0 ? (
          <Link
            to="/admin/live"
            className="text-sm font-medium text-primary hover:underline"
          >
            Open in Live ops →
          </Link>
        ) : null
      }
    >
      {category && category.items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-2 font-medium">Reason</th>
              <th className="px-4 py-2 font-medium">Stuck for</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Rider</th>
              <th className="px-4 py-2 font-medium">Driver</th>
              <th className="px-4 py-2 font-medium">Fare</th>
            </tr>
          </thead>
          <tbody>
            {category.items.map((r) => (
              <tr key={r.ride_id} className="border-t border-border">
                <td className="px-4 py-2 text-danger font-medium">{STUCK_LABELS[r.stuck_reason]}</td>
                <td className="px-4 py-2 text-text-secondary">{humanMs(r.stuck_for_ms)}</td>
                <td className="px-4 py-2">
                  <span className="text-xs rounded-full bg-surface px-2 py-0.5 text-text-secondary">
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-text-primary">
                  <Link to={`/admin/users/${r.rider_id}`} className="hover:underline">
                    {r.rider_name ?? r.rider_id.slice(0, 8) + '…'}
                  </Link>
                </td>
                <td className="px-4 py-2 text-text-primary">
                  {r.driver_id ? (
                    <Link to={`/admin/users/${r.driver_id}`} className="hover:underline">
                      {r.driver_name ?? r.driver_id.slice(0, 8) + '…'}
                    </Link>
                  ) : (
                    <span className="text-text-tertiary italic">unassigned</span>
                  )}
                </td>
                <td className="px-4 py-2 text-text-primary">{formatCents(r.fare_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

const STUCK_LABELS: Record<StuckRideAlert['stuck_reason'], string> = {
  awaiting_driver: 'No driver yet',
  coordinating_long: 'Slow coordination',
  driver_gps_stale: 'Driver GPS stale',
  ride_long: 'Ride running long',
}

// ── Failed + unpaid payment cards (share table) ──────────────────────────────

function FailedPaymentsCard({
  category,
  loading,
}: {
  category?: AlertCategory<PaymentAlert>
  loading: boolean
}) {
  return (
    <SectionCard
      testid="alerts-failed-payments"
      title="Failed payments"
      tooltip="Rides where Stripe came back with a charge failure (payment_status='failed'). The driver hasn't been paid for these. Investigate and either retry the charge or issue a refund + write-off."
      category={category}
      loading={loading}
      tone="danger"
    >
      {category && category.items.length > 0 && <PaymentAlertsTable rows={category.items} />}
    </SectionCard>
  )
}

function UnpaidCompletedCard({
  category,
  loading,
}: {
  category?: AlertCategory<PaymentAlert>
  loading: boolean
}) {
  return (
    <SectionCard
      testid="alerts-unpaid-completed"
      title="Unpaid completed rides"
      tooltip="Rides that completed but Stripe's webhook never marked them paid (or refunded) after 10 min. Usually means a webhook event was dropped or the charge is still pending. Sample the rider's profile to see what's blocking — they may need to retry payment."
      category={category}
      loading={loading}
      tone="warning"
    >
      {category && category.items.length > 0 && <PaymentAlertsTable rows={category.items} />}
    </SectionCard>
  )
}

function PaymentAlertsTable({ rows }: { rows: PaymentAlert[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-text-secondary">
        <tr>
          <th className="px-4 py-2 font-medium">Ended</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Rider</th>
          <th className="px-4 py-2 font-medium">Driver</th>
          <th className="px-4 py-2 font-medium">Fare</th>
          <th className="px-4 py-2 font-medium">Ride</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ride_id} className="border-t border-border">
            <td className="px-4 py-2 text-text-secondary whitespace-nowrap">
              {r.ended_at ? new Date(r.ended_at).toLocaleString() : '—'}
            </td>
            <td className="px-4 py-2">
              <span className="text-xs rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                {r.payment_status ?? '(null)'}
              </span>
            </td>
            <td className="px-4 py-2 text-text-primary">
              <Link to={`/admin/users/${r.rider_id}`} className="hover:underline">
                {r.rider_name ?? r.rider_id.slice(0, 8) + '…'}
              </Link>
            </td>
            <td className="px-4 py-2 text-text-primary">
              {r.driver_id ? (
                <Link to={`/admin/users/${r.driver_id}`} className="hover:underline">
                  {r.driver_name ?? r.driver_id.slice(0, 8) + '…'}
                </Link>
              ) : (
                <span className="text-text-tertiary italic">—</span>
              )}
            </td>
            <td className="px-4 py-2 text-text-primary">{formatCents(r.fare_cents)}</td>
            <td className="px-4 py-2 text-xs font-mono text-text-tertiary">{r.ride_id.slice(0, 8)}…</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Negative wallets ─────────────────────────────────────────────────────────

function NegativeWalletsCard({
  category,
  loading,
}: {
  category?: AlertCategory<NegativeWalletAlert>
  loading: boolean
}) {
  return (
    <SectionCard
      testid="alerts-negative-wallets"
      title="Negative wallets"
      tooltip="Users whose wallet_balance went negative — usually a driver pushed into overdraft by an admin refund (Slice 1.3e allows this with the override flag). They'll work it off via future rides or you can grant them credit to zero it out."
      category={category}
      loading={loading}
      tone="warning"
    >
      {category && category.items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Wallet balance</th>
              <th className="px-4 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {category.items.map((u) => (
              <tr key={u.user_id} className="border-t border-border">
                <td className="px-4 py-2 text-text-primary">
                  <Link to={`/admin/users/${u.user_id}`} className="hover:underline">
                    {u.name ?? u.email ?? u.user_id.slice(0, 8) + '…'}
                  </Link>
                </td>
                <td className="px-4 py-2 text-text-secondary">{u.is_driver ? 'driver' : 'rider'}</td>
                <td className="px-4 py-2 text-danger font-semibold">{formatCents(u.wallet_balance_cents)}</td>
                <td className="px-4 py-2">
                  <Link
                    to={`/admin/users/${u.user_id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open profile →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

// ── Recent suspensions ───────────────────────────────────────────────────────

function RecentSuspensionsCard({
  category,
  loading,
}: {
  category?: AlertCategory<SuspensionAlert>
  loading: boolean
}) {
  return (
    <SectionCard
      testid="alerts-recent-suspensions"
      title="Recent suspensions (24h)"
      tooltip="Users suspended in the last 24 hours. Pure visibility — no action recommended. Useful to know who's on the bench when investigating complaints."
      category={category}
      loading={loading}
      tone="neutral"
    >
      {category && category.items.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {category.items.map((u) => (
              <tr key={u.user_id} className="border-t border-border">
                <td className="px-4 py-2 text-text-primary">
                  <Link to={`/admin/users/${u.user_id}`} className="hover:underline">
                    {u.name ?? u.email ?? u.user_id.slice(0, 8) + '…'}
                  </Link>
                </td>
                <td className="px-4 py-2 text-text-secondary whitespace-nowrap">
                  {timeAgo(u.suspended_at)} ago
                </td>
                <td className="px-4 py-2 text-text-primary truncate max-w-md">
                  {u.suspended_reason ?? <span className="text-text-tertiary italic">no reason given</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  )
}

// ── Shared section shell ─────────────────────────────────────────────────────

function SectionCard({
  testid,
  title,
  tooltip,
  category,
  loading,
  tone,
  children,
  footer,
}: {
  testid: string
  title: string
  tooltip: string
  category?: AlertCategory<unknown>
  loading: boolean
  tone: 'danger' | 'warning' | 'neutral'
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  const isEmpty = category !== undefined && category.count === 0

  const toneTextClass = useMemo(() => {
    if (isEmpty) return 'text-success'
    if (tone === 'danger') return 'text-danger'
    if (tone === 'warning') return 'text-warning'
    return 'text-text-secondary'
  }, [isEmpty, tone])

  const toneBgClass = useMemo(() => {
    if (isEmpty) return 'bg-success/10'
    if (tone === 'danger') return 'bg-danger/10'
    if (tone === 'warning') return 'bg-warning/10'
    return 'bg-surface'
  }, [isEmpty, tone])

  return (
    <section
      data-testid={testid}
      className="rounded-2xl border border-border bg-white overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <InfoTooltip testid={`${testid}-info`} text={tooltip} />
          {category && (
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${toneBgClass} ${toneTextClass}`}
            >
              {isEmpty ? 'clear' : category.count}
            </span>
          )}
          {category?.truncated && (
            <span className="text-xs text-text-tertiary">(showing first 50)</span>
          )}
        </div>
        {footer}
      </header>
      {loading ? (
        <div className="p-4 text-sm text-text-secondary">Loading…</div>
      ) : isEmpty ? (
        <div className="p-4 text-sm text-success">All clear here.</div>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatCents(c: number | null): string {
  if (c === null || c === undefined) return '—'
  const sign = c < 0 ? '−' : ''
  return `${sign}$${(Math.abs(c) / 100).toFixed(2)}`
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
