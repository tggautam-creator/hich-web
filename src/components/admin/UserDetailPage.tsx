import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useAdminUserDetail,
  useAdminUserRides,
  useAdminUserWallet,
  useAdminUserNotifications,
  useAdminUserDevices,
  useAdminUserAudit,
  useAdminSendPush,
  useAdminGrantCredit,
  useAdminOverrideOnboarding,
  useAdminStripeBalance,
  type AdminUserOverview,
  type AdminAuditRow,
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
  { key: 'actions', label: 'Admin Actions' },
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
      {tab === 'actions' && id && (
        <ActionsTab
          userId={id}
          currentOnboardingCompleted={data.user.onboarding_completed}
          targetEmail={data.user.email}
          active={tab === 'actions'}
        />
      )}
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

// ── Admin Actions tab ───────────────────────────────────────────────────────

function ActionsTab({
  userId,
  currentOnboardingCompleted,
  targetEmail,
  active,
}: {
  userId: string
  currentOnboardingCompleted: boolean
  targetEmail: string
  active: boolean
}) {
  return (
    <div data-testid="tab-actions" className="space-y-6">
      <div className="rounded-2xl border border-warning bg-warning/5 p-4 text-xs text-text-primary">
        <div className="font-semibold">⚠ Every action below writes an audit row.</div>
        <div className="mt-1 text-text-secondary">
          Suspend account, refund a ride, and force-reset password are
          deferred to Slice 1.3d. The three actions here are reversible
          (push is one-shot; credit can be negated; onboarding can be
          flipped back) — but please use them deliberately.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SendPushCard userId={userId} />
        <GrantCreditCard userId={userId} targetEmail={targetEmail} active={active} />
        <OverrideOnboardingCard
          userId={userId}
          current={currentOnboardingCompleted}
        />
      </div>

      <AuditList userId={userId} active={active} />
    </div>
  )
}

// ── Send push card ──────────────────────────────────────────────────────────

function SendPushCard({ userId }: { userId: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const m = useAdminSendPush(userId)
  const ok = title.trim().length > 0 && body.trim().length > 0

  return (
    <ActionCard
      testid="action-send-push"
      title="Send push notification"
      info="Delivers a one-off push to every device this user has registered with us (push_tokens). Bypasses the per-user notification preferences — use sparingly. Reason is optional but recorded in the audit log."
    >
      <Field
        label="Title"
        value={title}
        onChange={setTitle}
        placeholder="Heads up"
        maxLength={120}
      />
      <Field
        label="Body"
        value={body}
        onChange={setBody}
        placeholder="Quick note about your ride…"
        maxLength={500}
        multiline
      />
      <Field
        label="Reason (optional)"
        value={reason}
        onChange={setReason}
        placeholder="e.g. follow-up on support ticket #1234"
      />
      <ActionButton
        testid="action-send-push-submit"
        label="Send push"
        loading={m.isPending}
        disabled={!ok}
        onClick={() => {
          m.mutate(
            { title: title.trim(), body: body.trim(), reason: reason.trim() || undefined },
            {
              onSuccess: () => {
                setTitle('')
                setBody('')
                setReason('')
              },
            },
          )
        }}
      />
      <ActionResult mutation={m} successText={(d) => `Pushed to ${d.sent}/${d.total_tokens} devices`} />
    </ActionCard>
  )
}

// ── Grant credit card ───────────────────────────────────────────────────────

/**
 * Above this threshold the confirm dialog requires re-typing the dollar
 * amount. Tuned below the server-side `MAX_CREDIT_CENTS` cap ($50) so
 * grants in the upper half of the allowed range get an extra friction
 * step. Smaller grants (<$25) get the confirm dialog only.
 */
const LARGE_GRANT_CENTS = 25_00

function GrantCreditCard({
  userId,
  targetEmail,
  active,
}: {
  userId: string
  targetEmail: string
  active: boolean
}) {
  const [dollars, setDollars] = useState('')
  const [reason, setReason] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const m = useAdminGrantCredit(userId)
  const stripeBalance = useAdminStripeBalance(active)
  const cents = Math.round(parseFloat(dollars) * 100)
  const validAmount = Number.isFinite(cents) && cents !== 0
  const hasReason = reason.trim().length > 0
  const isCredit = cents > 0
  const isDebit = cents < 0

  // Client-side mirror of the server's hard-block. Disables the
  // submit button when the requested credit exceeds Stripe's available
  // balance. Doesn't apply to debits (negative amounts don't pull
  // from Stripe). Server still enforces — this is the UI early-warning.
  const exceedsBalance =
    isCredit &&
    stripeBalance.data !== undefined &&
    cents > stripeBalance.data.available_cents
  const ok = validAmount && hasReason && !exceedsBalance

  function handleSubmit() {
    setShowConfirm(true)
  }

  function handleConfirm() {
    m.mutate(
      { amount_cents: cents, reason: reason.trim() },
      {
        onSuccess: () => {
          setDollars('')
          setReason('')
          setShowConfirm(false)
        },
      },
    )
  }

  return (
    <>
      <ActionCard
        testid="action-credit"
        title="Grant wallet credit"
        info="Adjusts the user's wallet balance via wallet_apply_delta (the same atomic primitive every other wallet write uses). Positive credits the user; negative debits. Cap is $50 per action — larger grants require a code change after a deliberate review. Reason is required and shown to ops in the audit log. Positive credits are HARD-BLOCKED if they exceed Tago's Stripe platform balance — otherwise a phantom liability could fail at withdrawal time."
      >
        <Field
          label="Amount in dollars (negative to debit)"
          value={dollars}
          onChange={setDollars}
          placeholder="5.00"
          inputMode="decimal"
        />
        {dollars && !validAmount && (
          <p className="text-xs text-danger">Enter a nonzero dollar amount.</p>
        )}

        <StripeBalanceLine
          balance={stripeBalance.data}
          loading={stripeBalance.isLoading}
          error={stripeBalance.error}
          attemptedCents={isCredit ? cents : 0}
          exceedsBalance={exceedsBalance}
        />

        <Field
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="e.g. goodwill gesture for cancelled ride"
          maxLength={200}
        />
        <ActionButton
          testid="action-credit-submit"
          label={isCredit ? 'Credit wallet…' : isDebit ? 'Debit wallet…' : 'Apply'}
          loading={m.isPending}
          disabled={!ok}
          onClick={handleSubmit}
        />
        <ActionResult
          mutation={m}
          successText={(d) =>
            d.balance_after_cents !== null
              ? `Applied ${fmtCents(d.amount_cents)} → balance now ${fmtCents(d.balance_after_cents)}`
              : `Applied ${fmtCents(d.amount_cents)}`
          }
        />
      </ActionCard>

      {showConfirm && (
        <ConfirmCreditDialog
          targetEmail={targetEmail}
          amountCents={cents}
          reason={reason.trim()}
          requireRetype={Math.abs(cents) >= LARGE_GRANT_CENTS}
          submitting={m.isPending}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

// ── Stripe balance status line ──────────────────────────────────────────────

function StripeBalanceLine({
  balance,
  loading,
  error,
  attemptedCents,
  exceedsBalance,
}: {
  balance: { available_cents: number; pending_cents: number } | undefined
  loading: boolean
  error: unknown
  attemptedCents: number
  exceedsBalance: boolean
}) {
  if (loading && !balance) {
    return (
      <p data-testid="stripe-balance-loading" className="text-[11px] text-text-secondary">
        Checking Stripe platform balance…
      </p>
    )
  }
  if (error) {
    return (
      <p data-testid="stripe-balance-error" className="text-[11px] text-danger">
        Couldn't load Stripe balance — credit will be hard-blocked server-side.
      </p>
    )
  }
  if (!balance) return null
  return (
    <div data-testid="stripe-balance" className="text-[11px]">
      <span className="text-text-secondary">Available Stripe balance: </span>
      <span className="font-semibold text-text-primary">
        {fmtCents(balance.available_cents)}
      </span>
      {balance.pending_cents > 0 && (
        <span className="text-text-secondary">
          {' '}
          (+ {fmtCents(balance.pending_cents)} pending)
        </span>
      )}
      {exceedsBalance && (
        <div className="mt-1 rounded-md border border-danger bg-danger/5 px-2 py-1 text-danger">
          ⚠ This grant ({fmtCents(attemptedCents)}) exceeds the available Stripe
          balance. The server will refuse it — top up Stripe first, or grant a
          smaller amount.
        </div>
      )}
    </div>
  )
}

// ── Confirm dialog ──────────────────────────────────────────────────────────

function ConfirmCreditDialog({
  targetEmail,
  amountCents,
  reason,
  requireRetype,
  submitting,
  onCancel,
  onConfirm,
}: {
  targetEmail: string
  amountCents: number
  reason: string
  requireRetype: boolean
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [retype, setRetype] = useState('')
  const expectedDollarString = (Math.abs(amountCents) / 100).toFixed(2)
  // Allow ±-prefixed and missing-zero variants ("5", "5.0", "5.00").
  // Compare against the canonical 2-decimal form for safety.
  const retypeMatch = parseFloat(retype.replace(/[^\d.]/g, '')).toFixed(2) === expectedDollarString
  const okToConfirm = !requireRetype || retypeMatch
  const isCredit = amountCents > 0

  return (
    <div
      data-testid="confirm-credit-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-label="Confirm wallet adjustment"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl"
      >
        <div className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          {isCredit ? 'Confirm credit' : 'Confirm debit'}
        </div>

        <div className="mt-3 text-center">
          <div
            className={[
              'text-4xl font-bold',
              isCredit ? 'text-success' : 'text-danger',
            ].join(' ')}
          >
            {isCredit ? '+' : '−'}
            {fmtCents(Math.abs(amountCents))}
          </div>
          <div className="mt-1 text-xs text-text-secondary">to</div>
          <div className="text-sm font-medium text-text-primary truncate">
            {targetEmail}
          </div>
        </div>

        <div className="mt-4 rounded-md border border-border bg-surface p-3 text-xs text-text-primary">
          <div className="font-semibold uppercase tracking-wide text-[10px] text-text-secondary">
            Reason
          </div>
          <div className="mt-1">{reason}</div>
        </div>

        <p className="mt-4 text-xs text-text-secondary">
          This is irreversible from here — to reverse it, post a{' '}
          {isCredit ? 'negative' : 'positive'} credit with a reason explaining
          the reversal.
        </p>

        {requireRetype && (
          <div className="mt-4">
            <label className="block">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Re-type the dollar amount to confirm
              </div>
              <input
                data-testid="confirm-credit-retype"
                type="text"
                inputMode="decimal"
                autoFocus
                value={retype}
                onChange={(e) => setRetype(e.target.value)}
                placeholder={expectedDollarString}
                className={[
                  'w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2',
                  retypeMatch
                    ? 'border-success focus:ring-success/20'
                    : 'border-border focus:ring-primary/20',
                ].join(' ')}
              />
            </label>
            {retype && !retypeMatch && (
              <p className="mt-1 text-[11px] text-danger">
                Doesn't match — expected {expectedDollarString}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-credit-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-credit-confirm"
            onClick={onConfirm}
            disabled={!okToConfirm || submitting}
            className={[
              'rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors',
              !okToConfirm || submitting
                ? 'bg-border cursor-not-allowed text-text-secondary'
                : isCredit
                  ? 'bg-success hover:opacity-90'
                  : 'bg-danger hover:opacity-90',
            ].join(' ')}
          >
            {submitting
              ? 'Applying…'
              : isCredit
                ? 'Confirm credit'
                : 'Confirm debit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Override onboarding card ────────────────────────────────────────────────

function OverrideOnboardingCard({
  userId,
  current,
}: {
  userId: string
  current: boolean
}) {
  const [reason, setReason] = useState('')
  const m = useAdminOverrideOnboarding(userId)
  const desired = !current
  const ok = reason.trim().length > 0

  return (
    <ActionCard
      testid="action-override-onboarding"
      title="Override onboarding state"
      info="Toggles users.onboarding_completed. Use when a user is stuck mid-onboarding due to a client bug (e.g. CreateProfile won't save) — flipping it to true lets them into the home screen. Flipping it false forces them back through onboarding on next sign-in. Reason is required."
    >
      <p className="text-xs text-text-secondary">
        Currently:{' '}
        <span className={current ? 'text-success font-medium' : 'text-danger font-medium'}>
          {current ? 'completed' : 'not completed'}
        </span>
      </p>
      <Field
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="e.g. CreateProfile blocked by a bug, manually unblocking"
        maxLength={200}
      />
      <ActionButton
        testid="action-override-onboarding-submit"
        label={`Set to ${desired ? 'completed' : 'not completed'}`}
        loading={m.isPending}
        disabled={!ok}
        onClick={() => {
          m.mutate(
            { onboarding_completed: desired, reason: reason.trim() },
            { onSuccess: () => setReason('') },
          )
        }}
      />
      <ActionResult
        mutation={m}
        successText={(d) =>
          d.changed
            ? `Set to ${d.onboarding_completed ? 'completed' : 'not completed'}`
            : `Already ${d.onboarding_completed ? 'completed' : 'not completed'} — no change`
        }
      />
    </ActionCard>
  )
}

// ── Audit list ──────────────────────────────────────────────────────────────

function AuditList({ userId, active }: { userId: string; active: boolean }) {
  const { data, isLoading } = useAdminUserAudit({ userId, enabled: active })
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Recent admin actions</h2>
        <InfoTooltip
          text="Forensic record of every admin write against this user. Each row shows the admin who did it, the action token (send_push / grant_wallet_credit / override_onboarding / …), the payload, and when. Reads do not log."
          align="left"
        />
      </div>
      <div className="mt-3">
        {isLoading && !data && <p className="text-xs text-text-secondary">Loading…</p>}
        {data && data.audit.length === 0 && (
          <p className="text-xs text-text-secondary">No admin actions logged for this user yet.</p>
        )}
        {data && data.audit.length > 0 && (
          <ul className="divide-y divide-border">
            {data.audit.map((row) => (
              <li key={row.id} data-testid={`audit-row-${row.id}`} className="py-3">
                <AuditRowLine row={row} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AuditRowLine({ row }: { row: AdminAuditRow }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-secondary">
            {row.action}
          </span>
          <span className="text-xs text-text-primary truncate">
            {summarisePayload(row.action, row.payload)}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-text-secondary truncate">
          by {row.admin_email ?? row.admin_id.slice(0, 8) + '…'}
        </div>
      </div>
      <div className="shrink-0 text-[11px] text-text-secondary">
        {fmtDateTime(row.created_at)}
      </div>
    </div>
  )
}

function summarisePayload(action: string, p: Record<string, unknown>): string {
  if (action === 'send_push') {
    const title = typeof p['title'] === 'string' ? p['title'] : ''
    const sent = typeof p['tokens_succeeded'] === 'number' ? p['tokens_succeeded'] : '?'
    const attempted = typeof p['tokens_attempted'] === 'number' ? p['tokens_attempted'] : '?'
    return `"${title}" → ${sent}/${attempted} devices`
  }
  if (action === 'grant_wallet_credit') {
    const amount = typeof p['amount_cents'] === 'number' ? p['amount_cents'] : 0
    const reason = typeof p['reason'] === 'string' ? p['reason'] : ''
    return `${fmtCents(amount)} · ${reason}`
  }
  if (action === 'override_onboarding') {
    return `${String(p['from'])} → ${String(p['to'])}` +
      (typeof p['reason'] === 'string' ? ` · ${p['reason']}` : '')
  }
  return JSON.stringify(p)
}

// ── shared action atoms ─────────────────────────────────────────────────────

function ActionCard({
  testid,
  title,
  info,
  children,
}: {
  testid: string
  title: string
  info: string
  children: React.ReactNode
}) {
  return (
    <div data-testid={testid} className="relative rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <InfoTooltip text={info} align="left" />
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  inputMode?: 'text' | 'decimal'
  multiline?: boolean
}) {
  const common = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    maxLength,
    inputMode,
    className:
      'w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
  } as const
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      {multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
    </label>
  )
}

function ActionButton({
  testid,
  label,
  loading,
  disabled,
  onClick,
}: {
  testid: string
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        'mt-1 w-full rounded-md px-3 py-2 text-sm font-semibold transition-colors',
        disabled || loading
          ? 'bg-border text-text-secondary cursor-not-allowed'
          : 'bg-primary text-white hover:bg-primary-dark',
      ].join(' ')}
    >
      {loading ? 'Working…' : label}
    </button>
  )
}

interface MutationLike<T> {
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  data?: T
  error?: Error | null
}

function ActionResult<T>({
  mutation,
  successText,
}: {
  mutation: MutationLike<T>
  successText: (data: T) => string
}) {
  if (mutation.isSuccess && mutation.data) {
    return (
      <p className="text-xs text-success">✓ {successText(mutation.data)}</p>
    )
  }
  if (mutation.isError && mutation.error) {
    const e = mutation.error
    const msg = e instanceof AdminApiException ? `${e.code}: ${e.message}` : e.message
    return <p className="text-xs text-danger">✗ {msg}</p>
  }
  return null
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
