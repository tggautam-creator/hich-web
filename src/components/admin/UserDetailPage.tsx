import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAdminUserDetail,
  useAdminUserRides,
  useAdminUserWallet,
  useAdminUserNotifications,
  useAdminUserDevices,
  type AdminUserOverview,
} from '@/hooks/useAdminUsers'
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
  { key: 'rides', label: 'Rides' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'devices', label: 'Devices' },
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
      {tab === 'rides' && id && <RidesTab userId={id} active={tab === 'rides'} />}
      {tab === 'wallet' && id && <WalletTab userId={id} active={tab === 'wallet'} />}
      {tab === 'notifications' && id && (
        <NotificationsTab userId={id} active={tab === 'notifications'} />
      )}
      {tab === 'devices' && id && <DevicesTab userId={id} active={tab === 'devices'} />}
      {tab === 'actions' && <ComingSoon tabKey="actions" />}
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

// ── Coming-soon stub (only Admin Actions tab now) ───────────────────────────

function ComingSoon({ tabKey }: { tabKey: Exclude<TabKey, 'overview'> }) {
  const label = TABS.find((t) => t.key === tabKey)?.label ?? tabKey
  return (
    <div
      data-testid={`tab-${tabKey}-stub`}
      className="rounded-2xl border border-dashed border-border bg-white p-8 text-center"
    >
      <div className="text-sm font-semibold text-text-primary">
        {label} tab — coming in Slice 1.3c
      </div>
      <p className="mt-1.5 text-xs text-text-secondary max-w-md mx-auto">
        Write surfaces: send custom push, grant wallet credit, refund a ride,
        suspend account, force-reset password, override onboarding_completed.
        Every action is audit-logged.
      </p>
    </div>
  )
}

// ── Rides tab ────────────────────────────────────────────────────────────────

function RidesTab({ userId, active }: { userId: string; active: boolean }) {
  const [page, setPage] = useState(0)
  const limit = 25
  const { data, error, isLoading } = useAdminUserRides({
    userId,
    enabled: active,
    limit,
    offset: page * limit,
  })
  if (isLoading && !data) return <TabLoading />
  if (error) return <TabError error={error} />
  if (!data) return null
  if (data.rides.length === 0)
    return <EmptyState text="This user hasn't been on any rides yet." />
  return (
    <div data-testid="tab-rides" className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Origin → Destination</th>
              <th className="px-4 py-2.5 text-right">Fare</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.rides.map((r) => (
              <tr
                key={r.id}
                data-testid={`ride-row-${r.id}`}
                className="hover:bg-surface"
              >
                <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                  {fmtDateTime(r.created_at)}
                </td>
                <td className="px-4 py-3 text-text-secondary">{r.role}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-text-primary">
                  <div className="truncate">{r.origin_name ?? '—'}</div>
                  <div className="truncate text-xs text-text-secondary">
                    → {r.destination_name ?? '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-text-primary">
                  {r.fare_cents !== null ? fmtCents(r.fare_cents) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total={data.total}
        limit={limit}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </div>
  )
}

// ── Wallet tab ───────────────────────────────────────────────────────────────

function WalletTab({ userId, active }: { userId: string; active: boolean }) {
  const [page, setPage] = useState(0)
  const limit = 25
  const { data, error, isLoading } = useAdminUserWallet({
    userId,
    enabled: active,
    limit,
    offset: page * limit,
  })
  if (isLoading && !data) return <TabLoading />
  if (error) return <TabError error={error} />
  if (!data) return null
  return (
    <div data-testid="tab-wallet" className="space-y-4">
      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Wallet balance</h2>
          <InfoTooltip
            text="Stored in cents on users.wallet_balance, displayed here in dollars. Updated atomically via wallet_apply_delta. Negative balances are possible (e.g. after a refund clawback) — flag those."
            align="left"
          />
        </div>
        <div
          className={[
            'mt-2 text-3xl font-bold',
            data.wallet_balance_cents < 0 ? 'text-danger' : 'text-text-primary',
          ].join(' ')}
        >
          {fmtCents(data.wallet_balance_cents)}
        </div>
      </div>

      {data.transactions.length === 0 ? (
        <EmptyState text="No wallet transactions yet." />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.transactions.map((t) => (
                  <tr
                    key={t.id}
                    data-testid={`wallet-row-${t.id}`}
                    className="hover:bg-surface"
                  >
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                      {fmtDateTime(t.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
                        {t.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-primary">
                      <div>{t.description ?? '—'}</div>
                      {(t.pm_brand ?? t.pm_wallet) && (
                        <div className="text-xs text-text-secondary">
                          via {t.pm_wallet ?? t.pm_brand}
                          {t.pm_last4 && ` •••• ${t.pm_last4}`}
                        </div>
                      )}
                      {t.transfer_id && (
                        <div className="font-mono text-[10px] text-text-secondary">
                          {t.transfer_id}
                          {t.transfer_paid_at ? ' · paid' : ' · pending'}
                        </div>
                      )}
                    </td>
                    <td
                      className={[
                        'px-4 py-3 text-right font-medium whitespace-nowrap',
                        t.amount_cents >= 0 ? 'text-success' : 'text-danger',
                      ].join(' ')}
                    >
                      {t.amount_cents >= 0 ? '+' : ''}
                      {fmtCents(t.amount_cents)}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary whitespace-nowrap">
                      {fmtCents(t.balance_after_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={data.total}
            limit={limit}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </>
      )}
    </div>
  )
}

// ── Notifications tab ────────────────────────────────────────────────────────

function NotificationsTab({ userId, active }: { userId: string; active: boolean }) {
  const [page, setPage] = useState(0)
  const limit = 25
  const { data, error, isLoading } = useAdminUserNotifications({
    userId,
    enabled: active,
    limit,
    offset: page * limit,
  })
  if (isLoading && !data) return <TabLoading />
  if (error) return <TabError error={error} />
  if (!data) return null
  if (data.notifications.length === 0)
    return <EmptyState text="No notifications sent to this user yet." />
  return (
    <div data-testid="tab-notifications" className="space-y-4">
      <div className="rounded-2xl border border-border bg-white">
        <ul className="divide-y divide-border">
          {data.notifications.map((n) => (
            <li
              key={n.id}
              data-testid={`notif-row-${n.id}`}
              className="px-5 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
                      {n.type}
                    </span>
                    <span className="text-sm font-semibold text-text-primary truncate">
                      {n.title}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-text-secondary line-clamp-2">
                    {n.body}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-text-secondary">
                  <div>{fmtDateTime(n.created_at)}</div>
                  <div className={n.is_read ? 'text-text-secondary' : 'text-primary font-medium'}>
                    {n.is_read ? 'read' : 'unread'}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Pagination
        page={page}
        total={data.total}
        limit={limit}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
      <p className="text-xs text-text-secondary">
        Delivery + open status will land in a follow-up once the notifications
        table tracks `delivered_at` / `opened_at` columns.
      </p>
    </div>
  )
}

// ── Devices tab ──────────────────────────────────────────────────────────────

function DevicesTab({ userId, active }: { userId: string; active: boolean }) {
  const { data, error, isLoading } = useAdminUserDevices({ userId, enabled: active })
  if (isLoading && !data) return <TabLoading />
  if (error) return <TabError error={error} />
  if (!data) return null
  if (data.devices.length === 0)
    return <EmptyState text="No push tokens registered for this user." />
  return (
    <div data-testid="tab-devices" className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              <th className="px-4 py-2.5">Platform</th>
              <th className="px-4 py-2.5">Token suffix</th>
              <th className="px-4 py-2.5">Registered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.devices.map((d) => (
              <tr
                key={d.id}
                data-testid={`device-row-${d.id}`}
                className="hover:bg-surface"
              >
                <td className="px-4 py-3">
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
                    {d.platform ?? 'unknown'}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-text-primary">
                  …{d.token_suffix}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {fmtDateTime(d.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-secondary">
        Last-seen + app-version land once those columns are added to
        `push_tokens` and the clients start writing them.
      </p>
    </div>
  )
}

// ── shared tab atoms ─────────────────────────────────────────────────────────

function TabLoading() {
  return (
    <div className="flex h-32 items-center justify-center text-sm text-text-secondary">
      Loading…
    </div>
  )
}

function TabError({ error }: { error: unknown }) {
  const msg =
    error instanceof AdminApiException
      ? `${error.code}: ${error.message}`
      : (error as Error).message
  return (
    <div className="rounded-2xl border border-danger bg-white p-5 text-sm text-danger">
      Failed to load — {msg}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-8 text-center text-sm text-text-secondary">
      {text}
    </div>
  )
}

function Pagination({
  page,
  total,
  limit,
  onPrev,
  onNext,
}: {
  page: number
  total: number
  limit: number
  onPrev: () => void
  onNext: () => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  if (total <= limit) return null
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        disabled={page === 0}
        onClick={onPrev}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
      >
        ← Previous
      </button>
      <span className="text-xs text-text-secondary">
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page + 1 >= totalPages}
        onClick={onNext}
        className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-text-primary disabled:opacity-40 hover:bg-surface"
      >
        Next →
      </button>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'completed' ? 'bg-success/10 text-success'
      : status === 'cancelled' || status === 'expired' ? 'bg-danger/10 text-danger'
      : status === 'active' || status === 'accepted' || status === 'coordinating' ? 'bg-primary-light text-primary'
      : 'bg-surface text-text-secondary'
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${tone}`}>
      {status}
    </span>
  )
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
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
