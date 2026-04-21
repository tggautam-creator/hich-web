import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatCents } from '@/lib/fare'
import { trackEvent } from '@/lib/analytics'

interface BankOnboardPromptProps {
  walletBalanceCents: number
  hasBank: boolean
}

const DISMISS_KEY = 'tago_bank_prompt_dismissed_at_balance'

/**
 * F4 — post-ride nudge.
 *
 * Renders once per earnings bump: a driver who just got their wallet balance
 * incremented (and has no bank on file) sees this. Dismissal is stored keyed
 * on the balance at dismissal time — if the balance later grows, the prompt
 * comes back. Onboarding removes the prompt forever.
 */
export default function BankOnboardPrompt({ walletBalanceCents, hasBank }: BankOnboardPromptProps) {
  const navigate = useNavigate()
  const [dismissedAt, setDismissedAt] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const raw = window.localStorage.getItem(DISMISS_KEY)
    return raw ? Number(raw) || 0 : 0
  })

  const shouldShow = !hasBank && walletBalanceCents > 0 && walletBalanceCents > dismissedAt

  useEffect(() => {
    if (shouldShow) trackEvent('bank_prompt_shown', { balance_cents: walletBalanceCents })
  }, [shouldShow, walletBalanceCents])

  if (!shouldShow) return null

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(walletBalanceCents))
    } catch {
      // ignore quota / private mode errors
    }
    setDismissedAt(walletBalanceCents)
    trackEvent('bank_prompt_dismissed', { balance_cents: walletBalanceCents })
  }

  function handleAccept() {
    trackEvent('bank_prompt_accepted', { balance_cents: walletBalanceCents })
    navigate('/stripe/payouts')
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center sm:items-center px-4 pb-6 sm:pb-0">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
        onClick={handleDismiss}
      />
      <div
        data-testid="bank-onboard-prompt"
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-success"
            aria-hidden="true"
          >
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>
        <h3 className="text-center text-lg font-bold text-text-primary mb-1">
          You earned {formatCents(walletBalanceCents)}!
        </h3>
        <p className="text-center text-sm text-text-secondary mb-6">
          Link a bank to withdraw your earnings. It only takes a minute.
        </p>
        <button
          data-testid="bank-onboard-prompt-accept"
          onClick={handleAccept}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white active:opacity-90 transition-opacity mb-3"
        >
          Link Bank Account
        </button>
        <button
          data-testid="bank-onboard-prompt-dismiss"
          type="button"
          onClick={handleDismiss}
          className="w-full py-2 text-sm font-medium text-text-secondary"
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
