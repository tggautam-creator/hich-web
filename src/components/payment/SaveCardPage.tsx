import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { env } from '@/lib/env'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'

const stripePromise = loadStripe(env.STRIPE_PUBLISHABLE_KEY ?? '')

interface SaveCardPageProps {
  'data-testid'?: string
}

function SaveCardForm() {
  const navigate = useNavigate()
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setError('Failed to initialize card setup')
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

      if (setupIntent?.payment_method) {
        // Set as default payment method
        const pmId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method.id

        await fetch('/api/payment/default-method', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ payment_method_id: pmId }),
        })
      }

      navigate('/payment/methods', { replace: true })
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
        <p className="mb-6 text-sm text-text-secondary">
          Your card will be charged automatically after each ride. Card details are securely handled by Stripe.
        </p>

        <Elements stripe={stripePromise}>
          <SaveCardForm />
        </Elements>
      </div>
    </div>
  )
}
