import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import type { Transaction } from '@/types/database'

interface TransactionDetailPageProps {
  'data-testid'?: string
}

interface Counterparty {
  full_name: string | null
  role: 'rider' | 'driver'
}

const CREDIT_TYPES = new Set([
  'topup',
  'fare_credit',
  'tip_credit',
  'wallet_refund',
  'adjustment_credit',
  'withdrawal_failed_refund',
])

function isCredit(type: string): boolean {
  return CREDIT_TYPES.has(type)
}

/** Human label for the transaction kind, used in the hero badge. */
function typeTitle(type: string): string {
  switch (type) {
    case 'topup': return 'Top-up'
    case 'fare_debit': return 'Ride fare'
    case 'fare_credit': return 'Ride earnings'
    case 'tip_debit': return 'Tip sent'
    case 'tip_credit': return 'Tip received'
    case 'withdrawal': return 'Withdrawal'
    case 'withdrawal_failed_refund': return 'Withdrawal refunded'
    case 'wallet_refund': return 'Refund'
    case 'adjustment_credit': return 'Adjustment'
    case 'adjustment_debit': return 'Adjustment'
    default: return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}

/**
 * Detail / audit view for a single wallet transaction. Mirrors iOS
 * `TransactionDetailPage.swift` — signed-amount hero, status pill,
 * counterparty card (when ride-linked), copyable references for
 * audit (transaction id, Stripe PaymentIntent, Stripe Transfer,
 * linked ride), description, "View ride details" deep-link, settle
 * date (for withdrawals), and the wallet-balance-after line.
 *
 * Reads the transaction directly from Supabase via RLS — the
 * `transactions` table policy already restricts to `user_id = auth.uid()`,
 * so no per-id server endpoint is needed.
 */
export default function TransactionDetailPage({
  'data-testid': testId,
}: TransactionDetailPageProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tx, setTx] = useState<Transaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [counterparty, setCounterparty] = useState<Counterparty | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Fetch the transaction (RLS enforces user-owns-row).
  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', id)
        .single()
      if (cancelled) return
      if (err || !data) {
        setError('Transaction not found.')
        setLoading(false)
        return
      }
      setTx(data as Transaction)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [id])

  // Fetch counterparty info if the transaction is ride-linked.
  useEffect(() => {
    if (!tx?.ride_id) return
    let cancelled = false
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: rideData } = await supabase
        .from('rides')
        .select('rider_id, driver_id')
        .eq('id', tx.ride_id!)
        .single()
      if (!rideData || cancelled) return
      const meIsRider = rideData.rider_id === user.id
      const otherId = meIsRider ? rideData.driver_id : rideData.rider_id
      if (!otherId) return
      const { data: userData } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', otherId)
        .single()
      if (cancelled) return
      if (userData) {
        setCounterparty({
          full_name: userData.full_name,
          role: meIsRider ? 'driver' : 'rider',
        })
      }
    })()
    return () => { cancelled = true }
  }, [tx?.ride_id])

  // Copy-to-clipboard with a tiny toast.
  function copyToClipboard(value: string, fieldLabel: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedField(fieldLabel)
      window.setTimeout(() => setCopiedField(null), 1500)
    })
  }

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-surface"
        data-testid={testId ?? 'transaction-detail'}
      >
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error || !tx) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6"
        data-testid={testId ?? 'transaction-detail'}
      >
        <p className="text-text-secondary" data-testid="transaction-not-found">
          {error ?? 'Transaction not found.'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/wallet', { replace: true })}
          className="rounded-2xl bg-primary px-6 py-2 text-sm font-semibold text-white"
        >
          Back to wallet
        </button>
      </div>
    )
  }

  const credit = isCredit(tx.type)
  const sign = credit ? '+' : '−'
  const amountLabel = `${sign}${formatCents(Math.abs(tx.amount_cents))}`
  const amountColor = credit ? 'text-success' : 'text-danger'

  // Status pill — `withdrawal_failed_refund` is the one type that
  // surfaces "failed" today; everything else reads as completed.
  const statusLabel = tx.type === 'withdrawal_failed_refund' ? 'Refunded — withdrawal failed' : 'Completed'
  const statusClass = tx.type === 'withdrawal_failed_refund'
    ? 'bg-danger/10 text-danger'
    : 'bg-success/10 text-success'

  // PAY.15 — strip the server's `Refund — withdrawal declined: ` prefix
  // so the failure reason renders cleanly in the warning banner.
  const withdrawalFailureReason =
    tx.type === 'withdrawal_failed_refund'
      && typeof tx.description === 'string'
      && tx.description.startsWith('Refund — withdrawal declined: ')
      ? tx.description.replace('Refund — withdrawal declined: ', '')
      : null

  const settleDate = tx.transfer_paid_at
    ? new Date(tx.transfer_paid_at).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : null

  const createdAt = new Date(tx.created_at).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div
      className="min-h-screen bg-surface pb-12"
      data-testid={testId ?? 'transaction-detail'}
    >
      {/* Header */}
      <div
        className="border-b border-border bg-white px-6 pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
      >
        <button
          type="button"
          onClick={() => navigate('/wallet')}
          className="mb-2 text-sm text-text-secondary"
          data-testid="back-button"
        >
          ← Back to wallet
        </button>
        <h1 className="text-xl font-bold text-text-primary">Transaction</h1>
      </div>

      <div className="px-6 py-6 space-y-4">
        {/* Amount hero */}
        <div className="rounded-2xl bg-white p-5 shadow-sm" data-testid="amount-hero">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            {typeTitle(tx.type)}
          </p>
          <p
            className={`mt-1 text-4xl font-bold tabular-nums ${amountColor}`}
            data-testid="amount-label"
            aria-label={`${formatCents(Math.abs(tx.amount_cents))} ${credit ? 'credited' : 'debited'}`}
          >
            {amountLabel}
          </p>
        </div>

        {/* Status pill */}
        <div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}
            data-testid="status-pill"
          >
            {statusLabel}
          </span>
        </div>

        {/* Withdrawal failure banner */}
        {withdrawalFailureReason && (
          <div
            className="rounded-2xl bg-danger/10 px-4 py-3"
            data-testid="withdrawal-failure-banner"
          >
            <p className="text-xs font-bold text-danger">Why did this fail?</p>
            <p className="mt-1 text-sm text-text-primary">{withdrawalFailureReason}</p>
            <p className="mt-2 text-xs text-text-secondary">
              Update your bank in Payouts or contact support if this keeps happening.
            </p>
          </div>
        )}

        {/* Counterparty card (ride-linked only) */}
        {counterparty && (
          <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="counterparty-card">
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              {counterparty.role === 'driver' ? 'Driver' : 'Rider'}
            </p>
            <p className="mt-1 text-base font-semibold text-text-primary">
              {counterparty.full_name ?? 'Unknown'}
            </p>
          </div>
        )}

        {/* View ride deep-link */}
        {tx.ride_id && (
          <button
            type="button"
            onClick={() => { navigate(`/ride/summary/${tx.ride_id}`) }}
            data-testid="view-ride-button"
            className="flex w-full items-center justify-between rounded-2xl bg-primary py-3 px-4 text-sm font-bold text-white active:opacity-90"
          >
            View ride details
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}

        {/* Funding-source row (top-ups with pm_brand / pm_wallet) */}
        {tx.type === 'topup' && (tx.pm_brand || tx.pm_wallet) && (
          <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="funding-source">
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Funded by
            </p>
            <p className="mt-1 text-sm font-semibold text-text-primary">
              {tx.pm_wallet
                ? tx.pm_wallet
                  .replace('_', ' ')
                  .replace(/\b\w/g, (c) => c.toUpperCase())
                : `${(tx.pm_brand ?? '').charAt(0).toUpperCase() + (tx.pm_brand ?? '').slice(1)} •••• ${tx.pm_last4 ?? '••••'}`}
            </p>
          </div>
        )}

        {/* Description */}
        {tx.description && tx.type !== 'withdrawal_failed_refund' && (
          <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="description-card">
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
              Note
            </p>
            <p className="mt-1 text-sm text-text-primary">{tx.description}</p>
          </div>
        )}

        {/* References */}
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="references-card">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
            References
          </p>
          <ReferenceRow label="Transaction ID" value={tx.id} onCopy={copyToClipboard} />
          {tx.payment_intent_id && (
            <ReferenceRow
              label="Stripe PaymentIntent"
              value={tx.payment_intent_id}
              onCopy={copyToClipboard}
            />
          )}
          {tx.transfer_id && (
            <ReferenceRow
              label="Stripe Transfer"
              value={tx.transfer_id}
              onCopy={copyToClipboard}
            />
          )}
          {tx.ride_id && (
            <ReferenceRow
              label="Linked ride"
              value={tx.ride_id}
              onCopy={copyToClipboard}
            />
          )}
        </div>

        {/* Metadata */}
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="metadata-card">
          <MetaRow label="Posted" value={createdAt} />
          {settleDate && <MetaRow label="Settled at bank" value={settleDate} />}
          <MetaRow
            label="Wallet balance after"
            value={formatCents(tx.balance_after_cents)}
          />
        </div>
      </div>

      {/* Copy toast */}
      {copiedField && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-success px-4 py-2 text-xs font-bold text-white shadow-lg"
          data-testid="copied-toast"
        >
          Copied {copiedField}
        </div>
      )}
    </div>
  )
}

function ReferenceRow({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: (value: string, fieldLabel: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, label)}
      className="flex w-full items-start justify-between gap-3 py-2 text-left active:opacity-70"
      data-testid={`reference-${label.replace(/\s+/g, '-').toLowerCase()}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
          {label}
        </p>
        <p className="truncate font-mono text-[11px] text-text-primary">{value}</p>
      </div>
      <span className="text-[10px] font-bold text-primary">Copy</span>
    </button>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  )
}
