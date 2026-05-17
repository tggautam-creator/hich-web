import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import type { PaymentRequest, PaymentRequestPaymentMethodEvent } from '@stripe/stripe-js'
import { Elements, CardElement, PaymentRequestButtonElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import { env } from '@/lib/env'
import { colors as tokenColors } from '@/lib/tokens'
import { useAuthStore } from '@/stores/authStore'
import { formatCents } from '@/lib/fare'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'

interface SavedCardOption {
  id: string
  brand: string
  last4: string
}

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
  // W-T1-P2 — saved-card top-up. Lets the rider charge an existing
  // payment method without retyping the card. Loaded lazily; null
  // until the fetch resolves OR when no saved cards exist.
  const [savedCard, setSavedCard] = useState<SavedCardOption | null>(null)
  const [paymentMethodMode, setPaymentMethodMode] = useState<'saved' | 'new'>('saved')
  // W-T1-P1 — Stripe Payment Request Button (Apple Pay on Safari iOS,
  // Google Pay on Chrome Android). Only set when the device + browser
  // actually support it (`canMakePayment()` returns truthy).
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null)

  const customCents = customInput ? Math.round(parseFloat(customInput) * 100) : 0
  const amountCents = isCustom ? customCents : (selectedAmount ?? 0)
  const isValidAmount = amountCents >= MIN_CENTS && amountCents <= MAX_CENTS

  // Resolve which Stripe payment method id (if any) we'll use for
  // the top-up confirm. Memoised so the value stays stable across
  // unrelated re-renders.
  const savedCardPmId = useMemo(
    () => (paymentMethodMode === 'saved' && savedCard ? savedCard.id : null),
    [paymentMethodMode, savedCard],
  )

  // Default to "new card" when no saved card is on file; otherwise
  // prefer the saved-card path (one-tap charge).
  useEffect(() => {
    if (!savedCard) setPaymentMethodMode('new')
  }, [savedCard])

  // Load the rider's default saved card so we can render a one-tap
  // "Use saved card · Visa •••• 4242" button above the CardElement.
  // Silent on failure — falls back to the new-card flow.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const resp = await fetch('/api/payment/methods', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!resp.ok) return
        const body = (await resp.json()) as {
          methods: Array<{ id: string; brand: string; last4: string; is_default: boolean }>
          default_method_id: string | null
        }
        if (cancelled) return
        const match = body.methods.find((m) => m.id === body.default_method_id)
          ?? body.methods.find((m) => m.is_default)
          ?? body.methods[0]
        if (match) {
          setSavedCard({ id: match.id, brand: match.brand, last4: match.last4 })
          setPaymentMethodMode('saved')
        }
      } catch {
        // silent — fallback to new-card form
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Initialise the Stripe Payment Request (Apple Pay / Google Pay).
  // Re-runs whenever `amountCents` changes since the wallet sheet
  // shows the exact total. `canMakePayment()` returns null on
  // unsupported browsers (Firefox, Safari without Apple Pay set up,
  // any non-HTTPS context) — in that case we leave the button hidden.
  useEffect(() => {
    if (!stripe || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
      setPaymentRequest(null)
      return
    }
    // Defensive — old / mocked Stripe builds may lack
    // `paymentRequest`. Skip silently (the new-card form still works).
    if (typeof stripe.paymentRequest !== 'function') {
      setPaymentRequest(null)
      return
    }
    const pr = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: { label: 'Tago wallet top-up', amount: amountCents },
      requestPayerName: false,
      requestPayerEmail: false,
    })
    let cancelled = false
    void pr.canMakePayment().then((result) => {
      if (cancelled) return
      setPaymentRequest(result ? pr : null)
    }).catch(() => setPaymentRequest(null))

    // When the user confirms inside the Apple/Google Pay sheet, Stripe
    // hands us a PaymentMethod id; we create a topup PaymentIntent
    // server-side, confirm it off-session with that PM, then signal
    // success back to the sheet so it dismisses with a checkmark.
    const handler = async (ev: PaymentRequestPaymentMethodEvent) => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          ev.complete('fail')
          setError('Not authenticated')
          return
        }
        const createResp = await fetch('/api/wallet/topup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ amount_cents: amountCents }),
        })
        if (!createResp.ok) {
          ev.complete('fail')
          const body = await createResp.json() as { error?: { message?: string } }
          setError(body.error?.message ?? 'Failed to create payment')
          return
        }
        const { clientSecret, paymentIntentId } = await createResp.json() as { clientSecret: string; paymentIntentId: string }
        const { error: confirmErr } = await stripe.confirmCardPayment(
          clientSecret,
          { payment_method: ev.paymentMethod.id },
          { handleActions: false },
        )
        if (confirmErr) {
          ev.complete('fail')
          setError(confirmErr.message ?? 'Payment failed')
          return
        }
        ev.complete('success')
        await fetch('/api/wallet/confirm-topup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ payment_intent_id: paymentIntentId }),
        })
        setSuccess(true)
        trackEvent('payment_completed', { amount_cents: amountCents, method: 'payment_request' })
        await refreshProfile()
        setTimeout(() => navigate('/wallet'), 2000)
      } catch (err) {
        ev.complete('fail')
        setError(err instanceof Error ? err.message : 'Payment failed')
      }
    }
    pr.on('paymentmethod', handler)

    return () => {
      cancelled = true
      // PaymentRequest objects don't have a documented `off` symmetric
      // to `on('paymentmethod')`; abandoning the closure is enough
      // because the new effect creates a fresh `pr` instance.
    }
    // intentionally re-create the PR object on amount changes so the
    // wallet sheet shows the correct total; navigate + refreshProfile
    // are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe, amountCents])

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
    if (!stripe || !isValidAmount) return
    // New-card mode needs the CardElement; saved-card mode uses the
    // stored PM id and doesn't.
    if (paymentMethodMode === 'new' && !elements) return

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

      // Confirm payment — branch on payment-method source.
      let confirmErr: Error | { message?: string } | undefined
      if (savedCardPmId) {
        // W-T1-P2 — charge the saved PM. Off-session-style confirm
        // hits Stripe with the existing card and clears immediately
        // for the vast majority of riders who tipped/paid before.
        const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: savedCardPmId,
        })
        confirmErr = stripeError
      } else {
        const cardElement = elements?.getElement(CardElement)
        if (!cardElement) {
          setError('Card element not loaded')
          return
        }
        const { error: stripeError } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElement },
        })
        confirmErr = stripeError
      }

      if (confirmErr) {
        setError(confirmErr.message ?? 'Payment failed')
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
      trackEvent('payment_completed', {
        amount_cents: amountCents,
        method: savedCardPmId ? 'saved_card' : 'new_card',
      })
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

      {/* W-T1-P1 — Apple Pay / Google Pay button. Only renders when
          the browser supports it AND a valid amount is picked (Stripe
          requires a non-zero total). Tapping it opens the platform
          wallet sheet; on confirm we POST /topup + confirm-topup
          inline (see paymentmethod handler). */}
      {paymentRequest && isValidAmount && (
        <div data-testid="payment-request-button">
          <PaymentRequestButtonElement
            options={{ paymentRequest, style: { paymentRequestButton: { height: '48px' } } }}
          />
          <div className="my-3 flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-secondary">
            <div className="h-px flex-1 bg-border" />
            <span>or pay with a card</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      {/* W-T1-P2 — saved-card one-tap row + new-card toggle. Only
          rendered when the rider actually has a card on file; otherwise
          we fall straight through to the CardElement. */}
      {savedCard && (
        <div data-testid="payment-method-section">
          <p className="mb-2 text-sm font-medium text-text-secondary">Pay with</p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setPaymentMethodMode('saved')}
              aria-pressed={paymentMethodMode === 'saved'}
              data-testid="saved-card-option"
              className={[
                'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
                paymentMethodMode === 'saved'
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-white',
              ].join(' ')}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-12 items-center justify-center rounded-md bg-primary/10 text-xs font-bold uppercase text-primary">
                  {savedCard.brand.slice(0, 4)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text-primary">
                    {savedCard.brand.charAt(0).toUpperCase() + savedCard.brand.slice(1)} •••• {savedCard.last4}
                  </span>
                  <span className="block text-xs text-text-secondary">Saved card · one-tap charge</span>
                </span>
              </span>
              {paymentMethodMode === 'saved' && (
                <svg className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethodMode('new')}
              aria-pressed={paymentMethodMode === 'new'}
              data-testid="new-card-option"
              className={[
                'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
                paymentMethodMode === 'new'
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-white',
              ].join(' ')}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-8 w-12 items-center justify-center rounded-md bg-surface text-xs font-bold uppercase text-text-secondary">
                  New
                </span>
                <span className="text-sm font-semibold text-text-primary">Use a different card</span>
              </span>
              {paymentMethodMode === 'new' && (
                <svg className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Card element — hidden when paying with the saved card so
          the form keeps its single-decision focus. */}
      {paymentMethodMode === 'new' && (
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
      )}

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
