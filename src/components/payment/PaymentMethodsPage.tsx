import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'

interface PaymentMethodsPageProps {
  'data-testid'?: string
}

interface CardInfo {
  id: string
  brand: string
  last4: string
  exp_month: number
  exp_year: number
  is_default: boolean
}

export default function PaymentMethodsPage({
  'data-testid': testId = 'payment-methods-page',
}: PaymentMethodsPageProps) {
  const navigate = useNavigate()
  const [cards, setCards] = useState<CardInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchMethods = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch('/api/payment/methods', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const body = (await res.json()) as { methods: CardInfo[] }
        setCards(body.methods)
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchMethods() }, [fetchMethods])

  async function setDefault(methodId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      await fetch('/api/payment/default-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ payment_method_id: methodId }),
      })

      setCards((prev) =>
        prev.map((c) => ({ ...c, is_default: c.id === methodId })),
      )
    } catch {
      // non-fatal
    }
  }

  async function removeCard(methodId: string) {
    setDeletingId(methodId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const res = await fetch(`/api/payment/methods/${methodId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (res.ok) {
        setCards((prev) => prev.filter((c) => c.id !== methodId))
      }
    } catch {
      // non-fatal
    } finally {
      setDeletingId(null)
    }
  }

  function brandIcon(brand: string): string {
    switch (brand.toLowerCase()) {
      case 'visa': return 'Visa'
      case 'mastercard': return 'MC'
      case 'amex': return 'Amex'
      case 'discover': return 'Disc'
      default: return brand.slice(0, 4)
    }
  }

  return (
    <div
      data-testid={testId}
      className="flex min-h-dvh flex-col bg-surface font-sans pb-20"
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
        <h1 className="text-lg font-bold text-text-primary">Payment methods</h1>
      </div>

      <div className="flex-1 px-4 py-6">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && cards.length === 0 && (
          <div className="flex flex-col items-center text-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary" aria-hidden="true">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <p className="mb-1 font-semibold text-text-primary">No cards saved</p>
            <p className="mb-6 text-sm text-text-secondary">
              Add a card to pay for rides automatically after each trip.
            </p>
            <PrimaryButton
              data-testid="add-first-card-button"
              onClick={() => { navigate('/payment/add') }}
              className="w-full max-w-sm"
            >
              Add a card
            </PrimaryButton>
          </div>
        )}

        {!loading && cards.length > 0 && (
          <div className="space-y-3">
            {cards.map((card) => (
              <div
                key={card.id}
                data-testid="payment-card"
                className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm border border-border"
              >
                {/* Brand badge */}
                <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-text-secondary">
                  {brandIcon(card.brand)}
                </div>

                {/* Card info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} ****{card.last4}
                  </p>
                  <p className="text-xs text-text-secondary">
                    Expires {String(card.exp_month).padStart(2, '0')}/{card.exp_year}
                  </p>
                </div>

                {/* Default badge or set default */}
                {card.is_default ? (
                  <span className="shrink-0 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                    Default
                  </span>
                ) : (
                  <button
                    onClick={() => { void setDefault(card.id) }}
                    className="shrink-0 text-xs text-primary font-medium"
                  >
                    Set default
                  </button>
                )}

                {/* Remove */}
                <button
                  data-testid="remove-card-button"
                  onClick={() => { void removeCard(card.id) }}
                  disabled={deletingId === card.id}
                  className="shrink-0 p-1 text-text-secondary hover:text-danger"
                  aria-label="Remove card"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}

            <PrimaryButton
              data-testid="add-another-card-button"
              onClick={() => { navigate('/payment/add') }}
              className="w-full mt-4"
            >
              Add another card
            </PrimaryButton>
          </div>
        )}
      </div>

      <BottomNav activeTab="payment" />
    </div>
  )
}
