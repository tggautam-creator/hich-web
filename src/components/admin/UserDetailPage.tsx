import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminUserDetail, type AdminUserOverview } from '@/hooks/useAdminUsers'
import { AdminApiException } from '@/lib/admin/api'
import { trackEvent } from '@/lib/analytics'
import InfoTooltip from './InfoTooltip'

/**
 * Slice 1.3a — /admin/users/:id.
 *
 * Header + 6-tab layout. Only the Overview tab is populated in this
 * slice; Rides / Wallet / Notifications / Devices / Admin Actions
 * are stubbed with "Coming in 1.3b" placeholders so the navigation
 * shape is locked even though the data isn't wired yet.
 */
type TabKey =
  | 'overview'
  | 'rides'
  | 'wallet'
  | 'notifications'
  | 'devices'
  | 'actions'

const TABS: Array<{ key: TabKey; label: string; comingSoon?: boolean }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'rides', label: 'Rides', comingSoon: true },
  { key: 'wallet', label: 'Wallet', comingSoon: true },
  { key: 'notifications', label: 'Notifications', comingSoon: true },
  { key: 'devices', label: 'Devices', comingSoon: true },
  { key: 'actions', label: 'Admin Actions', comingSoon: true },
]

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<TabKey>('overview')

  useEffect(() => {
    if (id) trackEvent('admin_user_detail_loaded', { user_id: id })
  }, [id])

  const { data, isLoading, error } = useAdminUserDetail(id)

  if (isLoading) {
    return (
      <div
        data-testid="user-detail-loading"
        className="flex h-64 items-center justify-center text-sm text-text-secondary"
      >
        Loading user…
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
        data-testid="user-detail-error"
        className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger"
      >
        Failed to load user — {msg}{' '}
        <Link to="/admin/users" className="ml-2 underline">
          ← Back to users
        </Link>
      </div>
    )
  }

  if (!data) return null

  return (
    <div data-testid="user-detail" className="space-y-6">
      {/* ── Breadcrumb ──────────────────────────────────────────────── */}
      <Link
        to="/admin/users"
        className="inline-block text-xs text-text-secondary hover:text-text-primary"
      >
        ← Users
      </Link>

      {/* ── Header card ─────────────────────────────────────────────── */}
      <Header data={data} />

      {/* ── Tab strip ───────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            const active = t.key === tab
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`user-tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={[
                  'relative -mb-px px-4 py-2 text-sm font-medium border-b-2',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                ].join(' ')}
              >
                {t.label}
                {t.comingSoon && (
                  <span className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                    soon
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ── Tab body ────────────────────────────────────────────────── */}
      {tab === 'overview' && <OverviewTab data={data} />}
      {tab !== 'overview' && <ComingSoon tabKey={tab} />}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ data }: { data: AdminUserOverview }) {
  const u = data.user
  const initials = (u.full_name ?? u.email)
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="rounded-2xl border border-border bg-white p-6">
      <div className="flex items-start gap-4">
        <Avatar url={u.avatar_url} initials={initials} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-xl font-bold text-text-primary">
              {u.full_name ?? '(no name)'}
            </h1>
            <Badge label={u.is_driver ? 'driver' : 'rider'} />
            {u.is_admin && <Badge label="admin" tone="primary" />}
          </div>
          <div className="mt-0.5 truncate text-sm text-text-secondary">
            {u.email}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            <span>{data.university}</span>
            <span>·</span>
            <span>Signed up {fmtDate(u.created_at)}</span>
            {u.last_active_at && (
              <>
                <span>·</span>
                <span>Last active {fmtDate(u.last_active_at)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ url, initials }: { url: string | null; initials: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-16 w-16 rounded-full object-cover border border-border"
      />
    )
  }
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-lg font-bold text-primary">
      {initials || '?'}
    </div>
  )
}

function Badge({
  label,
  tone = 'secondary',
}: {
  label: string
  tone?: 'primary' | 'secondary' | 'success' | 'danger'
}) {
  const cls =
    tone === 'primary'
      ? 'bg-primary-light text-primary'
      : tone === 'success'
        ? 'bg-success/10 text-success'
        : tone === 'danger'
          ? 'bg-danger/10 text-danger'
          : 'bg-surface text-text-secondary'
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${cls}`}
    >
      {label}
    </span>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: AdminUserOverview }) {
  const u = data.user
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card
        testid="overview-profile"
        title="Profile"
        info="Core columns from public.users. Phone-verified means the user completed the SMS OTP. Onboarding-completed means they finished the full sign-up flow (name, phone, DOB, photo)."
        rows={[
          { label: 'Email verified', value: data.email_verified ? 'Yes' : 'No', tone: data.email_verified ? 'success' : 'danger' },
          { label: 'Phone', value: u.phone ?? '—' },
          { label: 'Date of birth', value: u.date_of_birth ?? '—' },
          { label: 'Onboarding complete', value: u.onboarding_completed ? 'Yes' : 'No', tone: u.onboarding_completed ? 'success' : 'danger' },
          { label: 'Is admin', value: u.is_admin ? 'Yes' : 'No' },
          { label: 'University', value: data.university },
          { label: 'User ID', value: u.id, mono: true },
        ]}
      />

      <Card
        testid="overview-financial"
        title="Financial"
        info="Wallet balance is in cents on the DB; shown here in dollars. Stripe customer means they're set up to pay (riders need this). Stripe Connect means they're set up to receive payouts (drivers need this)."
        rows={[
          { label: 'Wallet balance', value: fmtCents(u.wallet_balance) },
          { label: 'Default payment method', value: u.default_payment_method_id ?? '—', mono: !!u.default_payment_method_id },
          { label: 'Stripe Connect account', value: u.stripe_account_id ?? '—', mono: !!u.stripe_account_id },
          { label: 'Connect onboarding done', value: u.stripe_onboarding_complete ? 'Yes' : 'No', tone: u.stripe_onboarding_complete ? 'success' : undefined },
        ]}
      />

      <Card
        testid="overview-activity"
        title="Activity"
        info="Counts derived from rides + ride_schedules. 'Routines' is the number of ride_schedules rows this user posted (driver routes or rider needs)."
        rows={[
          { label: 'Total rides', value: String(data.rides_count) },
          { label: 'Completed rides', value: String(data.rides_completed_count) },
          { label: 'Routines / schedules', value: String(data.routines_count) },
          { label: 'Rating (avg)', value: u.rating_avg !== null ? `${u.rating_avg.toFixed(2)} ★` : '—' },
          { label: 'Rating (count)', value: String(u.rating_count) },
        ]}
      />

      <Card
        testid="overview-vehicle"
        title="Vehicle"
        info="The most recent non-deleted row from the vehicles table for this user. Drivers must have at least one to accept rides. Rider-only accounts have no vehicle."
        rows={
          data.vehicle
            ? [
                { label: 'Make / model', value: `${data.vehicle.make} ${data.vehicle.model}` },
                { label: 'Year', value: String(data.vehicle.year) },
                { label: 'Color', value: data.vehicle.color },
                { label: 'License plate', value: data.vehicle.plate, mono: true },
                { label: 'Vehicle ID', value: data.vehicle.id, mono: true },
              ]
            : [{ label: 'Vehicle', value: 'No active vehicle on file', tone: 'danger' }]
        }
      />
    </div>
  )
}

interface CardRow {
  label: string
  value: string
  mono?: boolean
  tone?: 'success' | 'danger'
}

function Card({
  testid,
  title,
  info,
  rows,
}: {
  testid: string
  title: string
  info: string
  rows: CardRow[]
}) {
  return (
    <div
      data-testid={testid}
      className="relative rounded-2xl border border-border bg-white p-5"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <InfoTooltip testid={`${testid}-info`} text={info} align="left" />
      </div>
      <dl className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[140px_1fr] items-baseline gap-3 text-xs"
          >
            <dt className="text-text-secondary">{row.label}</dt>
            <dd
              className={[
                row.mono ? 'font-mono text-[11px]' : '',
                row.tone === 'success'
                  ? 'text-success font-medium'
                  : row.tone === 'danger'
                    ? 'text-danger font-medium'
                    : 'text-text-primary',
                'break-all',
              ].join(' ')}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── Coming-soon stub for the 5 deferred tabs ─────────────────────────────────

function ComingSoon({ tabKey }: { tabKey: Exclude<TabKey, 'overview'> }) {
  const label = TABS.find((t) => t.key === tabKey)?.label ?? tabKey
  return (
    <div
      data-testid={`tab-${tabKey}-stub`}
      className="rounded-2xl border border-dashed border-border bg-white p-8 text-center"
    >
      <div className="text-sm font-semibold text-text-primary">
        {label} tab — coming in Slice 1.3b
      </div>
      <p className="mt-1.5 text-xs text-text-secondary max-w-md mx-auto">
        {tabKey === 'rides' && 'Will show every ride this user was on (rider or driver), paginated, each clickable through to ride detail.'}
        {tabKey === 'wallet' && 'Will show the wallet balance, full transaction history, and pending Stripe transfers.'}
        {tabKey === 'notifications' && 'Will show every push / email / in-app notification sent to this user with delivery + open status.'}
        {tabKey === 'devices' && 'Will list the push_tokens rows: platform, last seen, app version. Wired once the platform-write iOS update ships.'}
        {tabKey === 'actions' && 'Will host the write surfaces: send custom push, grant wallet credit, refund a ride, suspend account, force-reset password, override onboarding_completed. Every action audit-logged.'}
      </p>
    </div>
  )
}

// ── formatters ──────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

function fmtDate(iso: string): string {
  return dateFmt.format(new Date(iso))
}

function fmtCents(cents: number): string {
  return moneyFmt.format(cents / 100)
}
