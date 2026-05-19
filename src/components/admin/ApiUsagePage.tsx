import { useEffect } from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { trackEvent } from '@/lib/analytics'
import { useAdminApiUsage, type ServiceUsage } from '@/hooks/useAdminApiUsage'
import InfoTooltip from './InfoTooltip'

/**
 * 2026-05-19 — `/admin/api-usage`.
 *
 * One row per external service (Resend, FCM, Google Maps family).
 * Each row shows: today's count vs daily quota, 30-day rolling count
 * vs monthly quota, and a tiny sparkline of the last 30 days of calls.
 *
 * Data is server-side instrumented via `server/lib/apiUsage.ts` —
 * every wrapped call increments `api_usage_daily`. The endpoint reads
 * + rolls up; this page renders.
 *
 * Stripe is intentionally NOT instrumented yet — its 100/sec rate
 * limit is way above our usage. See the "Why isn't Stripe here?"
 * note at the bottom.
 */
export default function ApiUsagePage() {
  const { data, isLoading, error } = useAdminApiUsage()

  useEffect(() => {
    trackEvent('admin_api_usage_loaded')
  }, [])

  return (
    <div data-testid="admin-api-usage" className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary">API Usage</h1>
          <InfoTooltip
            testid="api-usage-info"
            text="Per-service usage counters for every external API Tago talks to. Server-side instrumented: every wrapped call increments api_usage_daily. Quotas are hard-coded from each provider's pricing page; update server/lib/apiUsage.ts when you change plans."
            align="left"
          />
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          How close we are to each provider's quota. Refreshes every 60 seconds.
          {data && (
            <span className="ml-2 text-text-secondary">
              · As of {new Date(data.as_of).toLocaleString()}
            </span>
          )}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border bg-white"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          Couldn't load usage. {error.message}
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.services.map((svc) => {
            const trend = data.trend.find((t) => t.service === svc.service)?.days ?? []
            return <ServiceRow key={svc.service} svc={svc} trend={trend} />
          })}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-white p-4 text-xs text-text-secondary">
        <strong className="text-text-primary">Why isn't Stripe here?</strong>{' '}
        Stripe rate-limits at 100 req/sec which we're nowhere near. The 8+
        Stripe call sites across the codebase made inline instrumentation
        expensive to maintain. If we ever start hitting Stripe limits, we'll
        add a thin proxy around the SDK client and surface it here.
      </div>
    </div>
  )
}

function ServiceRow({
  svc,
  trend,
}: {
  svc: ServiceUsage
  trend: { date: string; count: number }[]
}) {
  return (
    <div
      data-testid={`api-usage-row-${svc.service}`}
      className="rounded-2xl border border-border bg-white p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-base font-semibold text-text-primary">{svc.label}</div>
            {svc.daily_pct != null && svc.daily_pct >= 0.8 && (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                ⚠ near limit
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-text-secondary">{svc.notes}</div>
        </div>
        <div className="shrink-0 h-12 w-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line
                type="monotone"
                dataKey="count"
                stroke="#0066ff"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UsageBar
          label="Today"
          count={svc.today}
          quota={svc.daily_quota}
          pct={svc.daily_pct}
        />
        <UsageBar
          label="Last 30 days"
          count={svc.monthly}
          quota={svc.monthly_quota}
          pct={svc.monthly_pct}
        />
      </div>
    </div>
  )
}

function UsageBar({
  label,
  count,
  quota,
  pct,
}: {
  label: string
  count: number
  quota: number | null
  pct: number | null
}) {
  const pctRounded = pct != null ? Math.min(100, Math.round(pct * 100)) : null
  const barColor = pctRounded == null
    ? 'bg-text-secondary/30'
    : pctRounded >= 90
      ? 'bg-danger'
      : pctRounded >= 70
        ? 'bg-warning'
        : 'bg-success'
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        <span className="text-text-primary">
          {count.toLocaleString()}
          {quota != null && (
            <span className="text-text-secondary"> / {quota.toLocaleString()}</span>
          )}
          {pctRounded != null && (
            <span className="ml-2 text-text-secondary">({pctRounded}%)</span>
          )}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface">
        {pctRounded != null ? (
          <div
            className={['h-full transition-all', barColor].join(' ')}
            style={{ width: `${pctRounded}%` }}
          />
        ) : (
          <div className="h-full w-full bg-text-secondary/15" />
        )}
      </div>
    </div>
  )
}
