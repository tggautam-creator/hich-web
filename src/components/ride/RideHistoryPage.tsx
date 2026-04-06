import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { formatCents } from '@/lib/fare'
import BottomNav from '@/components/ui/BottomNav'
import AppIcon from '@/components/ui/AppIcon'
import type { Ride } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RideHistoryPageProps {
  'data-testid'?: string
}

interface RideWithUser extends Ride {
  other_name?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RideHistoryPage({ 'data-testid': testId }: RideHistoryPageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)

  const [rides, setRides] = useState<RideWithUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return

    const profileId = profile.id

    async function load() {
      // Fetch completed rides where user is rider or driver
      const { data: asRider } = await supabase
        .from('rides')
        .select('*')
        .eq('rider_id', profileId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(50)

      const { data: asDriver } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', profileId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(50)

      const all = [...(asRider ?? []), ...(asDriver ?? [])]
      // Deduplicate and sort by ended_at descending
      const uniqueMap = new Map<string, Ride>()
      for (const r of all) {
        if (!uniqueMap.has(r.id)) uniqueMap.set(r.id, r)
      }
      const sorted = Array.from(uniqueMap.values()).sort(
        (a, b) => new Date(b.ended_at ?? b.created_at).getTime() - new Date(a.ended_at ?? a.created_at).getTime(),
      )

      // Fetch other user names
      const otherIds = sorted.map((r) =>
        r.rider_id === profileId ? r.driver_id : r.rider_id,
      ).filter((id): id is string => !!id)
      const uniqueOtherIds = [...new Set(otherIds)]

      let nameMap: Record<string, string> = {}
      if (uniqueOtherIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', uniqueOtherIds)
        if (users) {
          nameMap = Object.fromEntries(users.map((u) => [u.id, u.full_name ?? 'Unknown']))
        }
      }

      const enriched: RideWithUser[] = sorted.map((r) => {
        const otherId = r.rider_id === profileId ? r.driver_id : r.rider_id
        return { ...r, other_name: otherId ? nameMap[otherId] ?? 'Unknown' : 'Unknown' }
      })

      setRides(enriched)
      setLoading(false)
    }

    void load()
  }, [profile])

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatTime(dateStr: string | null): string {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface" data-testid={testId ?? 'ride-history'}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-20" data-testid={testId ?? 'ride-history'}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pb-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}>
        <button
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm"
          data-testid="back-button"
        >
          <svg className="h-5 w-5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-text-primary">Ride History</h1>
      </div>

      {/* Empty state */}
      {rides.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6" data-testid="empty-state">
          <div className="h-14 w-14 rounded-full bg-surface flex items-center justify-center"><AppIcon name="car-request" className="h-7 w-7 text-text-secondary" /></div>
          <p className="text-text-secondary">No completed rides yet.</p>
        </div>
      )}

      {/* Ride list */}
      <div className="space-y-3 px-6">
        {rides.map((ride) => {
          const isDriver = ride.driver_id === profile?.id
          const fareCents = ride.fare_cents ?? 0
          const platformFee = Math.round(fareCents * 0.15)
          const displayAmount = isDriver
            ? fareCents - platformFee
            : fareCents

          return (
            <div
              key={ride.id}
              className="rounded-2xl bg-white shadow-sm overflow-hidden"
              data-testid={`ride-${ride.id}`}
            >
              <button
                onClick={() => navigate(`/ride/summary/${ride.id}`)}
                className="w-full p-4 text-left active:bg-gray-50 transition-colors"
                data-testid={`ride-summary-${ride.id}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Other user + role */}
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-primary text-sm font-bold">
                        {ride.other_name?.charAt(0)?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <p className="font-medium text-text-primary text-sm">{ride.other_name}</p>
                        <p className="text-xs text-text-secondary">{isDriver ? 'You drove' : 'You rode'}</p>
                      </div>
                    </div>

                    {/* Destination */}
                    {ride.destination_name && (
                      <p className="mt-2 text-xs text-text-secondary truncate">
                        📍 {ride.destination_name}
                      </p>
                    )}

                    {/* Date + time */}
                    <p className="mt-1 text-xs text-text-secondary">
                      {formatDate(ride.ended_at)} · {formatTime(ride.ended_at)}
                    </p>
                  </div>

                  {/* Amount */}
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${isDriver ? 'text-success' : 'text-text-primary'}`}>
                      {isDriver ? '+' : '−'}{formatCents(displayAmount)}
                    </p>
                  </div>
                </div>
              </button>

              {/* Report button */}
              <div className="border-t border-border/60 px-4 py-2">
                <button
                  onClick={() => navigate(`/report/${ride.id}`)}
                  className="text-xs text-text-secondary active:text-danger transition-colors"
                  data-testid={`report-ride-${ride.id}`}
                >
                  Report an issue with this ride
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <BottomNav activeTab="home" />
    </div>
  )
}
