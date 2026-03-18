import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import PrimaryButton from '@/components/ui/PrimaryButton'
import BottomNav from '@/components/ui/BottomNav'

interface Transaction {
  id: string
  type: string
  amount_cents: number
  balance_after_cents: number
  description: string | null
  created_at: string
}

async function fetchTransactions(): Promise<Transaction[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch('/api/wallet/transactions', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error('Failed to fetch transactions')
  const json = await res.json() as { transactions: Transaction[] }
  return json.transactions
}

export default function WalletPage() {
  const navigate = useNavigate()
  const { profile, refreshProfile } = useAuthStore()

  // Refresh profile once on mount to get latest wallet_balance from DB
  useEffect(() => { void refreshProfile() }, [refreshProfile])

  const balance = profile?.wallet_balance ?? 0

  const { data: transactions = [], isLoading: loading } = useQuery({
    queryKey: ['wallet-transactions'],
    queryFn: fetchTransactions,
  })

  function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function typeLabel(type: string): string {
    switch (type) {
      case 'topup': return 'Added funds'
      case 'fare_debit': return 'Ride fare'
      case 'fare_credit': return 'Ride earnings'
      case 'refund': return 'Refund'
      default: return type
    }
  }

  function typeIcon(type: string): string {
    switch (type) {
      case 'topup': return '+'
      case 'fare_credit': return '+'
      case 'fare_debit': return '−'
      case 'refund': return '+'
      default: return ''
    }
  }

  function isCredit(type: string): boolean {
    return type === 'topup' || type === 'fare_credit' || type === 'refund'
  }

  return (
    <div className="min-h-screen bg-surface pb-20" data-testid="wallet-page">
      {/* Header */}
      <div className="bg-primary px-6 pb-8 pt-12 text-white">
        <p className="text-sm text-white/80">Your balance</p>
        <p className="text-4xl font-bold" data-testid="wallet-balance">
          {formatCents(balance)}
        </p>
      </div>

      {/* Add Funds */}
      <div className="px-6 py-4">
        <PrimaryButton
          onClick={() => navigate('/wallet/add')}
          data-testid="add-funds-button"
        >
          Add Funds
        </PrimaryButton>
      </div>

      {/* Transactions */}
      <div className="px-6">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">
          Transaction History
        </h2>

        {loading && (
          <div className="flex justify-center py-8" data-testid="loading-spinner">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && transactions.length === 0 && (
          <div className="rounded-2xl bg-white p-8 text-center" data-testid="empty-state">
            <p className="text-3xl">💳</p>
            <p className="mt-2 font-semibold text-text-primary">No transactions yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Add funds to your wallet to get started
            </p>
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-2" data-testid="transaction-list">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-2xl bg-white px-4 py-3"
                data-testid="transaction-item"
              >
                <div>
                  <p className="font-medium text-text-primary">
                    {tx.description ?? typeLabel(tx.type)}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {formatDate(tx.created_at)}
                  </p>
                </div>
                <p
                  className={`font-semibold ${isCredit(tx.type) ? 'text-success' : 'text-danger'}`}
                  data-testid="transaction-amount"
                >
                  {typeIcon(tx.type)}{formatCents(Math.abs(tx.amount_cents))}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav activeTab="wallet" />
    </div>
  )
}
