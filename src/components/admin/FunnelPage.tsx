import { useEffect, useState } from 'react'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import {
  useAdminFunnel,
  useAdminStuckUsers,
  type FunnelMode,
  type FunnelRange,
  type FunnelStep,
} from '@/hooks/useAdminFunnel'
import InfoTooltip from './InfoTooltip'

const STEP_INFO: Record<FunnelStep, string> = {
  signed_up:
    'Every user in the filtered cohort. The starting point of the funnel — by definition everyone reaches this step, so there are no users "stuck" here.',
  verified_email:
    'Users whose Supabase auth.users.email_confirmed_at is set (they clicked the confirmation link in their email or entered the OTP code). Stuck here = signed up but never confirmed.',
  completed_profile:
    'Users whose public.users.onboarding_completed=true (full name, phone, DOB, etc. all filled in — the whole onboarding flow finished). Stuck here = verified email but never finished onboarding.',
  payment_or_vehicle:
    'How many users are actually ready to use Tago. A rider needs a card on file to be charged — without it they can\'t request a ride. A driver needs at least one registered vehicle — without it they can\'t accept rides. This step asks: "did the user clear the one bar they need before Tago is usable for them?" For mode=Both, the user is judged by what their role (is_driver) requires.',
  completed_first_ride:
    'How many users have actually finished a ride end-to-end (request → match → pickup → second QR scan → payment processed). For riders, that\'s a ride where they were the rider; for drivers, where they were the driver. Computed by: COUNT(DISTINCT user) such that there exists a row in `rides` with status="completed" and rider_id=user (riders) or driver_id=user (drivers). This is the bottom of the funnel — the closer it is to "Signed up", the better Tago converts signups into real value.',
}

/**
 * Slice 1.2 — User funnel breakdown page.
 *
 * Layout:
 *   - Filter row: date range pills + mode pills
 *   - Funnel: vertical stack of bars (one per step), bar width = % of top
 *     - Click a bar → drawer with the list of users stuck at that step
 *
 * Data: useAdminFunnel(range, mode) — 5-min React Query cache
 *       useAdminStuckUsers(step, ...) — fires only when the drawer is open
 */
export default function FunnelPage() {
  const [range, setRange] = useState<FunnelRange>('30d')
  const [mode, setMode] = useState<FunnelMode>('both')
  const [selectedStep, setSelectedStep] = useState<FunnelStep | null>(null)

  useEffect(() => {
    trackEvent('admin_funnel_loaded')
  }, [])

  const { data, error, isLoading, isFetching } = useAdminFunnel(range, mode)

  if (isLoading && !data) {
    return (
      <div
        data-testid="admin-funnel-loading"
        className="flex h-64 items-center justify-center text-sm text-text-secondary"
      >
        Loading funnel…
      </div>
    )
  }

  if (error && !data) {
    const msg =
      error instanceof AdminApiException
        ? `${error.code}: ${error.message}`
        : (error as Error).message
    return (
      <div
        data-testid="admin-funnel-error"
        className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
      >
        Failed to load funnel — {msg}
      </div>
    )
  }

  if (!data) return null

  const top = data.steps[0]?.count ?? 0

  return (
    <div data-testid="admin-funnel" className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">User funnel</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Where users drop off between signup and their first completed ride.
            Click any step to see who's stuck there.
          </p>
        </div>
        <div className="text-right text-xs text-text-secondary">
          <div>{data.total_in_cohort} users in cohort</div>
          {isFetching && <div className="text-primary">Refreshing…</div>}
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <PillGroup<FunnelRange>
          testid="funnel-range"
          label="Range"
          value={range}
          options={[
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: 'all', label: 'All time' },
          ]}
          onChange={setRange}
        />
        <PillGroup<FunnelMode>
          testid="funnel-mode"
          label="Mode"
          value={mode}
          options={[
            { value: 'both', label: 'Both' },
            { value: 'rider', label: 'Riders' },
            { value: 'driver', label: 'Drivers' },
          ]}
          onChange={setMode}
        />
      </div>

      {/* ── Funnel bars ─────────────────────────────────────────────── */}
      <div data-testid="funnel-steps" className="space-y-3">
        {data.steps.map((step, idx) => {
          const widthPct = top > 0 ? Math.max(8, (step.count / top) * 100) : 0
          const isFirst = idx === 0
          const dropFromPrev = step.drop_off_from_previous_pct
          return (
            <div
              key={step.key}
              data-testid={`funnel-step-${step.key}`}
              className="relative rounded-2xl border border-border bg-white p-4"
            >
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">
                    {idx + 1}. {step.label}
                  </div>
                  <InfoTooltip
                    testid={`funnel-step-${step.key}-info`}
                    text={STEP_INFO[step.key]}
                    align="left"
                  />
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-bold text-text-primary">
                    {step.count.toLocaleString('en-US')}
                  </span>
                  {dropFromPrev !== null && dropFromPrev > 0 && (
                    <span className="text-xs text-danger">
                      −{dropFromPrev.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 h-3 w-full rounded-full bg-surface overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              {!isFirst && (
                <button
                  type="button"
                  data-testid={`funnel-step-${step.key}-drill`}
                  onClick={() => setSelectedStep(step.key)}
                  className="mt-3 text-xs font-medium text-primary hover:underline"
                >
                  See who's stuck here →
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Drill-down drawer ───────────────────────────────────────── */}
      {selectedStep && (
        <StuckUsersDrawer
          step={selectedStep}
          range={range}
          mode={mode}
          onClose={() => setSelectedStep(null)}
        />
      )}
    </div>
  )
}

// ── filter pill group ────────────────────────────────────────────────────────

interface PillOption<T extends string> { value: T; label: string }
interface PillGroupProps<T extends string> {
  testid: string
  label: string
  value: T
  options: PillOption<T>[]
  onChange: (v: T) => void
}

function PillGroup<T extends string>({
  testid,
  label,
  value,
  options,
  onChange,
}: PillGroupProps<T>) {
  return (
    <div data-testid={testid} className="flex items-center gap-2">
      <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              data-testid={`${testid}-${opt.value}`}
              onClick={() => onChange(opt.value)}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                active
                  ? 'bg-primary-light text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── stuck-users drawer ──────────────────────────────────────────────────────

interface StuckDrawerProps {
  step: FunnelStep
  range: FunnelRange
  mode: FunnelMode
  onClose: () => void
}

function StuckUsersDrawer({ step, range, mode, onClose }: StuckDrawerProps) {
  const { data, isFetching, error } = useAdminStuckUsers({ step, range, mode })

  return (
    <div
      data-testid="funnel-drawer"
      className="fixed inset-0 z-50 flex justify-end"
    >
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="relative h-full w-full max-w-lg bg-white shadow-xl flex flex-col"
        role="dialog"
        aria-label="Users stuck at funnel step"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              Stuck at
            </div>
            <div className="text-base font-semibold text-text-primary">
              {humanStep(step)}
            </div>
            {data && (
              <div className="text-xs text-text-secondary mt-0.5">
                {data.total} user{data.total === 1 ? '' : 's'} · {humanMode(mode)} · {humanRange(range)}
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid="funnel-drawer-close"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
          >
            Close
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          {isFetching && !data && (
            <div className="p-6 text-sm text-text-secondary">Loading…</div>
          )}
          {error && (
            <div className="p-6 text-sm text-danger">
              Failed to load users —{' '}
              {error instanceof AdminApiException
                ? error.message
                : (error as Error).message}
            </div>
          )}
          {data && data.users.length === 0 && (
            <div className="p-6 text-sm text-text-secondary">
              No users stuck at this step.
            </div>
          )}
          {data && data.users.length > 0 && (
            <ul data-testid="funnel-drawer-list" className="divide-y divide-border">
              {data.users.map((u) => (
                <li
                  key={u.id}
                  data-testid={`stuck-user-${u.id}`}
                  className="px-5 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text-primary">
                        {u.full_name ?? u.email}
                      </div>
                      <div className="truncate text-xs text-text-secondary">
                        {u.email}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-text-secondary">
                        {u.is_driver ? 'driver' : 'rider'}
                      </div>
                      <div className="text-xs text-text-secondary">
                        {u.days_since_signup}d ago
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}

function humanStep(step: FunnelStep): string {
  switch (step) {
    case 'signed_up': return 'Signed up'
    case 'verified_email': return 'Verified email'
    case 'completed_profile': return 'Completed profile'
    case 'payment_or_vehicle': return 'Added payment method / vehicle'
    case 'completed_first_ride': return 'Completed first ride'
  }
}

function humanMode(mode: FunnelMode): string {
  return mode === 'both' ? 'all users' : `${mode}s`
}

function humanRange(range: FunnelRange): string {
  switch (range) {
    case '7d': return 'last 7 days'
    case '30d': return 'last 30 days'
    case '90d': return 'last 90 days'
    case 'all': return 'all time'
  }
}
