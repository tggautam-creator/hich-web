import { useEffect } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAdminOverview } from '@/hooks/useAdminOverview'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import { colors } from '@/lib/tokens'

/**
 * Admin Overview dashboard (Slice 1.1).
 *
 * 12 KPI cards in a 4×3 grid + 3 charts (daily signups, daily
 * completed rides, top email domains). One round-trip to
 * `/api/admin/metrics/overview`, cached 5 min via React Query.
 *
 * Each KPI card carries a `data-testid` of the form `kpi-<key>` so
 * future tests / drill-down navigation can target them by key.
 */
export default function AdminHomePage() {
  const { data, error, isLoading, isFetching, refetch } = useAdminOverview()

  // PostHog: "who looked at the dashboard when" per ADMIN_PLAN.md.
  // Fires once per mount, not per refetch — refetches are cache
  // invalidations, not net-new views.
  useEffect(() => {
    trackEvent('admin_overview_loaded')
  }, [])

  if (isLoading) {
    return (
      <div
        data-testid="admin-overview-loading"
        className="flex h-64 items-center justify-center text-sm text-text-secondary"
      >
        Loading dashboard…
      </div>
    )
  }

  if (error) {
    const msg =
      error instanceof AdminApiException
        ? `${error.code}: ${error.message}`
        : (error as Error).message
    return (
      <div
        data-testid="admin-overview-error"
        className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
      >
        Failed to load dashboard — {msg}
        <button
          type="button"
          onClick={() => { void refetch() }}
          className="ml-3 underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const k = data.kpis
  const generated = new Date(data.generated_at)

  return (
    <div data-testid="admin-home" className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Overview</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Snapshot of how Tago is doing right now. Numbers refresh on
            every visit (cached 5 minutes).
          </p>
        </div>
        <div className="text-right text-xs text-text-secondary">
          <div>Generated {generated.toLocaleTimeString()}</div>
          {isFetching && <div className="text-primary">Refreshing…</div>}
        </div>
      </div>

      {/* ── 12 KPI cards (4×3) ─────────────────────────────────────── */}
      <div
        data-testid="admin-overview-kpi-grid"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <KpiCard
          testid="kpi-total-users"
          title="Total users"
          value={fmtNumber(k.total_users)}
        />
        <KpiCard
          testid="kpi-new-signups-today"
          title="New signups today"
          value={fmtNumber(k.new_signups_today)}
        />
        <TripleKpiCard
          testid="kpi-active-users"
          title="Active users"
          rows={[
            { label: 'DAU', value: fmtNumber(k.active_users.dau) },
            { label: 'WAU', value: fmtNumber(k.active_users.wau) },
            { label: 'MAU', value: fmtNumber(k.active_users.mau) },
          ]}
        />
        <KpiCard
          testid="kpi-active-rides-now"
          title="Active rides now"
          value={fmtNumber(k.active_rides_now)}
          accent={k.active_rides_now > 0 ? 'success' : undefined}
        />
        <KpiCard
          testid="kpi-rides-completed-today"
          title="Rides completed today"
          value={fmtNumber(k.rides_completed_today)}
        />
        <KpiCard
          testid="kpi-revenue-this-week"
          title="Revenue this week"
          value={fmtCents(k.revenue_this_week_cents)}
        />
        <KpiCard
          testid="kpi-ios-install-rate"
          title="iOS install rate"
          value={fmtPercent(k.ios_install_rate)}
          subtitle={
            k.ios_install_rate === null
              ? 'No platform-tagged tokens yet'
              : undefined
          }
        />
        <KpiCard
          testid="kpi-driver-activation-rate"
          title="Driver activation"
          value={fmtPercent(k.driver_activation_rate)}
          subtitle="drivers w/ ≥1 completed ride"
        />
        <KpiCard
          testid="kpi-rider-activation-rate"
          title="Rider activation"
          value={fmtPercent(k.rider_activation_rate)}
          subtitle="users w/ ≥1 completed ride"
        />
        <KpiCard
          testid="kpi-retention-7d"
          title="7-day retention"
          value={fmtPercent(k.retention_7d)}
          subtitle="active in last 7d / signed up ≥7d ago"
        />
        <KpiCard
          testid="kpi-avg-ride-fare"
          title="Avg ride fare"
          value={fmtCents(k.avg_ride_fare_cents)}
        />
        <KpiCard
          testid="kpi-avg-driver-rating"
          title="Avg driver rating"
          value={fmtRating(k.avg_driver_rating)}
        />
      </div>

      {/* ── 3 charts ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          testid="chart-signups-14d"
          title="Daily signups (last 14 days)"
        >
          <DailyBarChart data={data.charts.signups_14d} fill={colors.primary} />
        </ChartCard>
        <ChartCard
          testid="chart-completed-rides-14d"
          title="Completed rides (last 14 days)"
        >
          <DailyBarChart
            data={data.charts.completed_rides_14d}
            fill={colors.success}
          />
        </ChartCard>
        <ChartCard
          testid="chart-top-email-domains"
          title="Top 10 email domains"
          className="lg:col-span-2"
        >
          <TopDomainsChart data={data.charts.top_email_domains} />
        </ChartCard>
      </div>
    </div>
  )
}

// ── KPI cards ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  testid: string
  title: string
  value: string
  subtitle?: string
  accent?: 'success' | 'warning' | 'danger'
}

function KpiCard({ testid, title, value, subtitle, accent }: KpiCardProps) {
  const accentClass =
    accent === 'success'
      ? 'text-success'
      : accent === 'warning'
        ? 'text-warning'
        : accent === 'danger'
          ? 'text-danger'
          : 'text-text-primary'
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-border bg-white p-4"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {title}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accentClass}`}>{value}</div>
      {subtitle && (
        <div className="mt-1 text-[11px] text-text-secondary">{subtitle}</div>
      )}
    </div>
  )
}

interface TripleKpiCardProps {
  testid: string
  title: string
  rows: Array<{ label: string; value: string }>
}

function TripleKpiCard({ testid, title, rows }: TripleKpiCardProps) {
  return (
    <div
      data-testid={testid}
      className="rounded-2xl border border-border bg-white p-4"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {title}
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between">
            <span className="text-xs text-text-secondary">{row.label}</span>
            <span className="text-xl font-semibold text-text-primary">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── charts ───────────────────────────────────────────────────────────────────

interface ChartCardProps {
  testid: string
  title: string
  className?: string
  children: React.ReactNode
}

function ChartCard({ testid, title, className = '', children }: ChartCardProps) {
  return (
    <div
      data-testid={testid}
      className={`rounded-2xl border border-border bg-white p-4 ${className}`}
    >
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-3 h-64">{children}</div>
    </div>
  )
}

interface DailyPoint { date: string; count: number }

function DailyBarChart({ data, fill }: { data: DailyPoint[]; fill: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
        <XAxis
          dataKey="date"
          tickFormatter={(d: string) => d.slice(5)}
          tick={{ fontSize: 11, fill: colors.textSecondary }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: colors.textSecondary }}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            borderColor: colors.border,
            fontSize: 12,
          }}
          labelStyle={{ color: colors.textPrimary }}
        />
        <Bar dataKey="count" fill={fill} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface DomainPoint { domain: string; count: number }

function TopDomainsChart({ data }: { data: DomainPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-secondary">
        No users yet.
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 0, right: 16, left: 16, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: colors.textSecondary }}
        />
        <YAxis
          type="category"
          dataKey="domain"
          width={140}
          tick={{ fontSize: 11, fill: colors.textPrimary }}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            borderColor: colors.border,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ display: 'none' }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.domain} fill={colors.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── formatters ───────────────────────────────────────────────────────────────

const numberFmt = new Intl.NumberFormat('en-US')
const moneyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function fmtNumber(n: number): string {
  return numberFmt.format(n)
}

function fmtCents(cents: number | null): string {
  if (cents === null) return '—'
  return moneyFmt.format(cents / 100)
}

function fmtPercent(rate: number | null): string {
  if (rate === null) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function fmtRating(r: number | null): string {
  if (r === null) return '—'
  return `${r.toFixed(2)} ★`
}

