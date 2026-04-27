import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

const stripePromise = loadStripe(env.STRIPE_PUBLISHABLE_KEY ?? '')

interface SaveCardPageProps {
  'data-testid'?: string
}

interface SaveCardFormProps {
  returnTo: string | null
  confirmState: unknown
  fromTab?: string | null
}

function SaveCardForm({ returnTo, confirmState, fromTab }: SaveCardFormProps) {
  const navigate = useNavigate()
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      // Get SetupIntent client secret
      const res = await fetch('/api/payment/setup-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Failed to initialize card setup')
        return
      }

      const { clientSecret } = (await res.json()) as { clientSecret: string }

      const cardElement = elements.getElement(CardElement)
      if (!cardElement) { setError('Card element not found'); return }

      const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      })

      if (stripeError) {
        setError(stripeError.message ?? 'Card setup failed')
        return
      }

      let dedupHit = false
      if (setupIntent?.payment_method) {
        const pmId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method.id

        // Set as default — critical: check response so we don't silently skip it
        const defaultResp = await fetch('/api/payment/default-method', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ payment_method_id: pmId }),
        })
        if (!defaultResp.ok) {
          const body = (await defaultResp.json().catch(() => ({}))) as { error?: { message?: string } }
          setError(body.error?.message ?? 'Card saved but could not set as default. Please set it manually.')
          return
        }
        // Server detects fingerprint collisions and detaches the new pm,
        // promoting the existing one instead. Without surfacing this the
        // user sees the form succeed but the card list is unchanged and
        // (rightly) gets confused. Show a short notice before navigating.
        const body = (await defaultResp.json().catch(() => ({}))) as { deduplicated?: boolean }
        dedupHit = body.deduplicated === true
      }

      // Return to the page that redirected here (ride confirm / ride board),
      // restoring any state that was passed through (destination, fare, etc.).
      const goNext = () => {
        if (returnTo) {
          navigate(returnTo, {
            replace: true,
            state: fromTab ? { fromTab, confirmState } : confirmState ?? null,
          })
        } else {
          navigate('/payment/methods', { replace: true })
        }
      }

      if (dedupHit) {
        setNotice('This card is already on your account — using the existing one.')
        // Keep the spinner gone but defer nav so the message is actually read.
        setLoading(false)
        setTimeout(goNext, 2200)
        return
      }

      goNext()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-border bg-white p-4">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#1a1a1a',
                '::placeholder': { color: '#9ca3af' },
              },
            },
          }}
        />
      </div>

      {notice && (
        <div
          data-testid="card-notice"
          role="status"
          className="rounded-xl bg-success/10 border border-success/30 px-4 py-3 text-sm text-success font-medium text-center"
        >
          {notice}
        </div>
      )}

      {error && (
        <p data-testid="card-error" className="text-sm text-danger text-center">
          {error}
        </p>
      )}

      <PrimaryButton
        data-testid="save-card-button"
        type="submit"
        disabled={!stripe || loading}
        className="w-full"
      >
        {loading ? 'Saving...' : 'Save card'}
      </PrimaryButton>
    </form>
  )
}

export default function SaveCardPage({
  'data-testid': testId = 'save-card-page',
}: SaveCardPageProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { returnTo?: string; confirmState?: unknown; fromTab?: string } | null
  const returnTo = locationState?.returnTo ?? null
  const confirmState = locationState?.confirmState ?? null
  const fromTab = locationState?.fromTab ?? null

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans"
    >
      {/* Header */}
      <div
        className="bg-white border-b border-border px-4 flex items-center gap-3"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <button onClick={() => { navigate(-1) }} className="p-1" aria-label="Go back">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-text-primary">Add payment method</h1>
      </div>

      <div className="flex-1 px-4 py-6">
        {/* Context banner — shown when redirected from a ride request */}
        {returnTo && (
          <div
            data-testid="card-required-banner"
            className="mb-5 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-start gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true">
              <rect x="2" y="6" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </svg>
            <p className="text-sm text-text-primary">
              A payment method is required to request rides. Add your card to continue.
            </p>
          </div>
        )}

        <p className="mb-6 text-sm text-text-secondary">
          Your card will be charged automatically after each ride. Card details are securely handled by Stripe.
        </p>

        <Elements stripe={stripePromise}>
          <SaveCardForm returnTo={returnTo} confirmState={confirmState} fromTab={fromTab} />
        </Elements>
      </div>
    </div>
  )
}
