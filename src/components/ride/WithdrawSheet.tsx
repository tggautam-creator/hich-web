import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import PrimaryButton from '@/components/ui/PrimaryButton'

interface WithdrawSheetProps {
  open: boolean
  onClose: () => void
  balanceCents: number
  hasBank: boolean
  onSuccess: () => void
}

type WithdrawStatus = 'idle' | 'submitting' | 'success' | 'error'

const MIN_WITHDRAW_CENTS = 100

function genIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Parse an amount string into cents. Accepts "5", "5.5", "5.50".
 * Returns 0 on invalid input (used to gate the Confirm button).
 */
function parseAmountCents(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return 0
  const n = parseFloat(trimmed)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 100)
}

export default function WithdrawSheet({ open, onClose, balanceCents, hasBank, onSuccess }: WithdrawSheetProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<WithdrawStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // W-T1-P3 — editable amount. Defaults to the full balance for
  // single-tap parity with the old full-balance behaviour.
  const [amountText, setAmountText] = useState('')
  // W-T1-P4 — confirm step before firing the irreversible transfer.
  const [showConfirm, setShowConfirm] = useState(false)
  // Bank label + last4 so the confirm dialog can read "Funds go to
  // Chase •••• 4242. This action is irreversible from Tago." Loaded
  // from /api/connect/status; falls back to generic "your bank" copy
  // when the lookup hasn't completed or returned a method.
  const [bankInfo, setBankInfo] = useState<{ label: string; last4: string } | null>(null)

  // Pre-fill amount input with the full balance whenever the sheet
  // opens — matches the prior single-tap behaviour but lets the user
  // edit before confirming.
  useEffect(() => {
    if (!open) return
    setAmountText((balanceCents / 100).toFixed(2))
    setStatus('idle')
    setErrorMsg(null)
    setShowConfirm(false)
  }, [open, balanceCents])

  // Load payout method label + last4 so the confirm dialog tells the
  // driver exactly where the money's going. Silent on failure.
  useEffect(() => {
    if (!open || !hasBank) return
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const resp = await fetch('/api/connect/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) return
        const body = (await resp.json()) as {
          payout_method_label?: string | null
          payout_method_last4?: string | null
        }
        if (cancelled) return
        if (body.payout_method_label && body.payout_method_last4) {
          setBankInfo({ label: body.payout_method_label, last4: body.payout_method_last4 })
        }
      } catch {
        // silent — fallback copy is acceptable
      }
    })()
    return () => { cancelled = true }
  }, [open, hasBank])

  if (!open) return null

  const enteredCents = parseAmountCents(amountText)
  const overBalance = enteredCents > balanceCents
  const underMinimum = enteredCents > 0 && enteredCents < MIN_WITHDRAW_CENTS
  const validationError = overBalance
    ? `Max is ${formatCents(balanceCents)}`
    : underMinimum
      ? `Minimum withdrawal is $${(MIN_WITHDRAW_CENTS / 100).toFixed(2)}`
      : null
  const amountIsValid = enteredCents >= MIN_WITHDRAW_CENTS && !overBalance

  const setPill = (cents: number) => {
    setAmountText((cents / 100).toFixed(2))
  }

  async function submitWithdraw() {
    setShowConfirm(false)
    setStatus('submitting')
    setErrorMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': genIdempotencyKey(),
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount_cents: enteredCents }),
      })
      const json = await res.json() as { error?: { message?: string } }
      if (!res.ok) {
        setErrorMsg(json.error?.message ?? 'Withdrawal failed')
        setStatus('error')
        return
      }
      setStatus('success')
      onSuccess()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  const bankLine = bankInfo
    ? `${bankInfo.label} •••• ${bankInfo.last4}`
    : 'your linked bank'

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center" data-testid="withdraw-sheet">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl bg-white p-6 shadow-2xl"
      >
        <h3 className="text-lg font-bold text-text-primary mb-2">Withdraw to bank</h3>

        {!hasBank ? (
          <>
            <p className="text-sm text-text-secondary mb-5">
              Link a bank account to withdraw your earnings.
            </p>
            <PrimaryButton
              data-testid="withdraw-sheet-link-bank"
              onClick={() => navigate('/stripe/payouts')}
            >
              Link Bank Account
            </PrimaryButton>
            <button onClick={onClose} className="mt-3 w-full py-2 text-sm font-medium text-text-secondary">
              Cancel
            </button>
          </>
        ) : status === 'success' ? (
          <>
            <p className="text-sm text-text-secondary mb-1">
              We&apos;re transferring {formatCents(enteredCents)} to your bank.
            </p>
            <p className="text-xs text-text-secondary mb-5">Expect it in about 2 business days.</p>
            <PrimaryButton data-testid="withdraw-sheet-done" onClick={onClose}>Done</PrimaryButton>
          </>
        ) : (
          <>
            {/* Available — keeps the previous big-number affordance
                but now serves as the cap reference for the input. */}
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1">
              Available
            </p>
            <p className="text-2xl font-bold text-text-primary mb-4" data-testid="withdraw-sheet-amount">
              {formatCents(balanceCents)}
            </p>

            {/* W-T1-P3 — editable amount + Half/All chips. */}
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                Amount to withdraw
              </span>
              <div
                className={[
                  'mt-1 flex items-center gap-1 rounded-xl border bg-white px-3 py-2.5 transition-colors',
                  amountIsValid
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-border',
                ].join(' ')}
              >
                <span className="text-lg font-bold text-text-secondary">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={amountText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, '')
                    const parts = raw.split('.')
                    const normalized = parts.length > 1
                      ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`
                      : raw
                    setAmountText(normalized)
                  }}
                  onBlur={() => {
                    const n = parseFloat(amountText)
                    if (Number.isFinite(n) && n > 0) setAmountText(n.toFixed(2))
                  }}
                  placeholder="0.00"
                  data-testid="withdraw-sheet-amount-input"
                  className="flex-1 bg-transparent text-lg font-bold text-text-primary focus:outline-none"
                />
              </div>
            </label>

            <div className="mt-2 flex gap-2" data-testid="withdraw-sheet-pills">
              <button
                type="button"
                onClick={() => setPill(Math.floor(balanceCents / 2))}
                disabled={balanceCents < MIN_WITHDRAW_CENTS * 2}
                data-testid="withdraw-sheet-pill-half"
                className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary disabled:opacity-40"
              >
                Half · {formatCents(Math.floor(balanceCents / 2))}
              </button>
              <button
                type="button"
                onClick={() => setPill(balanceCents)}
                data-testid="withdraw-sheet-pill-all"
                className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
              >
                All · {formatCents(balanceCents)}
              </button>
            </div>

            {/* Validation message — lives below the chips so it
                reads top-to-bottom with the rest of the layout. */}
            {validationError && (
              <p className="mt-3 text-xs text-danger" data-testid="withdraw-sheet-validation">
                {validationError}
              </p>
            )}

            {errorMsg && (
              <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="withdraw-sheet-error">
                {errorMsg}
              </p>
            )}

            <div className="mt-5">
              <PrimaryButton
                data-testid="withdraw-sheet-confirm"
                onClick={() => setShowConfirm(true)}
                disabled={!amountIsValid}
                isLoading={status === 'submitting'}
                loadingLabel="Transferring to bank…"
              >
                Continue
              </PrimaryButton>
              <button
                onClick={onClose}
                disabled={status === 'submitting'}
                className="mt-3 w-full py-2 text-sm font-medium text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* W-T1-P4 — confirm dialog before the irreversible Stripe
            transfer. Matches iOS WithdrawSheet alert verbatim. */}
        {showConfirm && (
          <div
            className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/55 px-6"
            data-testid="withdraw-confirm-dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <h4 className="text-base font-bold text-text-primary">
                Withdraw {formatCents(enteredCents)}?
              </h4>
              <p className="mt-2 text-sm text-text-secondary">
                Funds go to {bankLine}. This action is irreversible from Tago.
              </p>
              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => { void submitWithdraw() }}
                  data-testid="withdraw-confirm-yes"
                  className="w-full rounded-2xl bg-primary py-3 text-sm font-bold text-white active:opacity-90"
                >
                  Withdraw
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  data-testid="withdraw-confirm-cancel"
                  className="w-full rounded-2xl border border-border py-3 text-sm font-bold text-text-primary active:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
