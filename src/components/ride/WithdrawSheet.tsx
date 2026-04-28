import { useState } from 'react'
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

function genIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function WithdrawSheet({ open, onClose, balanceCents, hasBank, onSuccess }: WithdrawSheetProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<WithdrawStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!open) return null

  async function handleWithdraw() {
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
        body: JSON.stringify({ amount_cents: balanceCents }),
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
              We're transferring {formatCents(balanceCents)} to your bank.
            </p>
            <p className="text-xs text-text-secondary mb-5">Expect it in about 2 business days.</p>
            <PrimaryButton data-testid="withdraw-sheet-done" onClick={onClose}>Done</PrimaryButton>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-1">Transfer your balance to your linked bank.</p>
            <p className="text-2xl font-bold text-text-primary mb-5" data-testid="withdraw-sheet-amount">
              {formatCents(balanceCents)}
            </p>

            {errorMsg && (
              <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="withdraw-sheet-error">
                {errorMsg}
              </p>
            )}

            <PrimaryButton
              data-testid="withdraw-sheet-confirm"
              onClick={handleWithdraw}
              disabled={balanceCents <= 0}
              isLoading={status === 'submitting'}
              loadingLabel="Transferring to bank…"
            >
              Confirm withdrawal
            </PrimaryButton>
            <button
              onClick={onClose}
              disabled={status === 'submitting'}
              className="mt-3 w-full py-2 text-sm font-medium text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
