import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import { colors as tokenColors } from '@/lib/tokens'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'

const stripePromise = env.STRIPE_PUBLISHABLE_KEY
  ? loadStripe(env.STRIPE_PUBLISHABLE_KEY)
  : null

const AMOUNT_PILLS = [1000, 2000, 5000] // $10, $20, $50
const MIN_CENTS = 500
const MAX_CENTS = 20000

function AddFundsForm() {
  const navigate = useNavigate()
  const stripe = useStripe()
  const elements = useElements()
  const { refreshProfile } = useAuthStore()

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customInput, setCustomInput] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const customCents = customInput ? Math.round(parseFloat(customInput) * 100) : 0
  const amountCents = isCustom ? customCents : (selectedAmount ?? 0)
  const isValidAmount = amountCents >= MIN_CENTS && amountCents <= MAX_CENTS

  function handlePillClick(cents: number) {
    setSelectedAmount(cents)
    setIsCustom(false)
    setCustomInput('')
    setError(null)
  }

  function handleCustomFocus() {
    setIsCustom(true)
    setSelectedAmount(null)
    setError(null)
  }

  function handleCustomChange(value: string) {
    // Allow digits and one decimal point
    if (/^\d*\.?\d{0,2}$/.test(value)) {
      setCustomInput(value)
    }
  }

  async function handleSubmit() {
    if (!stripe || !elements || !isValidAmount) return

    setProcessing(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Not authenticated')
        return
      }

      // Create PaymentIntent on server
      const res = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount_cents: amountCents }),
      })

      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } }
        throw new Error(body.error?.message ?? 'Failed to create payment')
      }

      const { clientSecret, paymentIntentId } = await res.json() as { clientSecret: string; paymentIntentId: string }

      // Confirm payment
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) {
        setError('Card element not loaded')
        return
      }

      const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement },
      })

      if (stripeError) {
        setError(stripeError.message ?? 'Payment failed')
        return
      }

      // Confirm topup on server to credit wallet immediately
      await fetch('/api/wallet/confirm-topup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      })

      setSuccess(true)
      trackEvent('payment_completed', { amount_cents: amountCents })
      await refreshProfile()

      // Navigate back to wallet after brief delay
      setTimeout(() => navigate('/wallet'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setProcessing(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-16" data-testid="success-state">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
          <svg className="h-8 w-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="mt-4 text-lg font-semibold text-text-primary">
          {formatCents(amountCents)} added!
        </p>
        <p className="mt-1 text-sm text-text-secondary">Returning to wallet…</p>
      </div>
    )
  }

  // Slice 11: iOS Safari doesn't auto-dismiss the keyboard when you tap
  // outside an input. Without this, the on-screen keyboard sits over the
  // Pay button and the user has no obvious way to get past it. Blur the
  // active element on any tap that isn't on an interactive control.
  function dismissKeyboardIfBlankTap(e: React.PointerEvent<HTMLFormElement>) {
    const target = e.target as HTMLElement
    // Don't dismiss when the tap is on (or inside) an input, button, or label
    if (target.closest('input, textarea, button, label, [contenteditable], [role="button"]')) return
    const active = document.activeElement as HTMLElement | null
    if (active && typeof active.blur === 'function') active.blur()
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
      onPointerDown={dismissKeyboardIfBlankTap}
    >
      {/* Amount pills */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm font-medium text-text-secondary">Select amount</p>
          {/* Slice 9: surface the topup range upfront so the rider doesn't
              hit a wall after typing $300. Was: error appeared only after a
              bad submit. */}
          <p className="text-xs text-text-secondary" data-testid="amount-range-hint">
            {formatCents(MIN_CENTS)} – {formatCents(MAX_CENTS)} per topup
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3" data-testid="amount-pills">
          {AMOUNT_PILLS.map((cents) => (
            <button
              key={cents}
              onClick={() => handlePillClick(cents)}
              className={`rounded-2xl py-3 text-center font-semibold transition-colors ${
                selectedAmount === cents && !isCustom
                  ? 'bg-primary text-white'
                  : 'bg-white text-text-primary border border-border hover:border-primary'
              }`}
              data-testid={`pill-${cents}`}
            >
              {formatCents(cents)}
            </button>
          ))}
        </div>
      </div>

      {/* Custom amount */}
      <div>
        <p className="mb-2 text-sm font-medium text-text-secondary">Or enter custom amount</p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-text-secondary">$</span>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            placeholder="0.00"
            value={customInput}
            onFocus={handleCustomFocus}
            onChange={(e) => handleCustomChange(e.target.value)}
            onKeyDown={(e) => {
              // Slice 11: tapping the iOS keyboard's "Done" key fires
              // Enter — blur so the keyboard collapses and the Pay
              // button comes back into view.
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur()
              }
            }}
            className={`w-full rounded-2xl border py-3 pl-8 pr-4 text-lg ${
              isCustom ? 'border-primary ring-1 ring-primary' : 'border-border'
            }`}
            data-testid="custom-amount-input"
          />
        </div>
        {isCustom && customInput && !isValidAmount && (
          <p className="mt-1 text-xs text-danger" data-testid="amount-error">
            {/* Specific reason instead of generic range — Slice 9 */}
            {amountCents < MIN_CENTS
              ? `Minimum is ${formatCents(MIN_CENTS)}`
              : `Maximum is ${formatCents(MAX_CENTS)} per topup`}
          </p>
        )}
      </div>

      {/* Card element */}
      <div>
        <p className="mb-2 text-sm font-medium text-text-secondary">Card details</p>
        <div className="rounded-2xl border border-border bg-white p-4" data-testid="card-element">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: tokenColors.textPrimary,
                  '::placeholder': { color: tokenColors.textSecondary },
                },
              },
            }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-danger" data-testid="payment-error">{error}</p>
      )}

      {/* Submit */}
      <PrimaryButton
        type="submit"
        onClick={handleSubmit}
        disabled={!isValidAmount || !stripe}
        isLoading={processing}
        loadingLabel="Processing payment…"
        data-testid="pay-button"
      >
        {isValidAmount ? `Add ${formatCents(amountCents)}` : 'Select an amount'}
      </PrimaryButton>
    </form>
  )
}

export default function AddFundsPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface pb-20" data-testid="add-funds-page">
      {/* Header */}
      <div className="border-b border-border bg-white px-6 pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
        <button
          onClick={() => navigate('/wallet')}
          className="mb-2 text-sm text-text-secondary"
          data-testid="back-button"
        >
          ← Back to Wallet
        </button>
        <h1 className="text-xl font-bold text-text-primary">Add Funds</h1>
      </div>

      <div className="px-6 py-6">
        {stripePromise ? (
          <Elements stripe={stripePromise}>
            <AddFundsForm />
          </Elements>
        ) : (
          <div className="rounded-2xl bg-white p-6 text-center" data-testid="stripe-unavailable">
            <p className="text-text-secondary">
              Payment is not configured yet. Please set up Stripe keys.
            </p>
          </div>
        )}
      </div>

      <BottomNav activeTab="payment" />
    </div>
  )
}
