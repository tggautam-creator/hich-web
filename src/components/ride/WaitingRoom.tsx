import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatCents, type FareRange } from '@/lib/fare'
import type { PlaceSuggestion } from '@/lib/places'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaitingRoomProps {
  'data-testid'?: string
}

interface LocationState {
  destination: PlaceSuggestion
  fareRange: FareRange
  rideId: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WaitingRoom({ 'data-testid': testId }: WaitingRoomProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  const [isCancelling, setCancelling] = useState(false)

  // Redirect if missing required state
  useEffect(() => {
    if (!state?.rideId) {
      navigate('/home/rider', { replace: true })
    }
  }, [state, navigate])

  // Subscribe to ride status changes via Supabase Realtime
  useEffect(() => {
    if (!state?.rideId) return

    const channel = supabase
      .channel(`ride-status-${state.rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${state.rideId}`,
        },
        (payload) => {
          const newStatus = (payload.new as Record<string, unknown>)['status']
          if (newStatus === 'accepted') {
            navigate(`/ride/messaging/${state.rideId}`, { replace: true })
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [state?.rideId, navigate])

  if (!state?.rideId) return null

  const { destination, fareRange } = state
  const isSingleFare = fareRange.low.fare_cents === fareRange.high.fare_cents
  const fareDisplay = isSingleFare
    ? formatCents(fareRange.low.fare_cents)
    : `${formatCents(fareRange.low.fare_cents)}–${formatCents(fareRange.high.fare_cents)}`

  async function handleCancel() {
    setCancelling(true)
    try {
      await supabase
        .from('rides')
        .update({ status: 'cancelled' })
        .eq('id', state!.rideId)
    } finally {
      navigate('/home/rider', { replace: true })
    }
  }

  return (
    <div
      data-testid={testId ?? 'waiting-room-page'}
      className="min-h-dvh w-full bg-white flex flex-col font-sans"
    >

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-center px-4 border-b border-border"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)', paddingBottom: '0.75rem' }}
      >
        <h1 className="text-lg font-semibold text-text-primary">Finding a Driver</h1>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">

        {/* Animated pulse */}
        <div className="relative flex items-center justify-center">
          <span className="absolute h-24 w-24 rounded-full bg-primary/20 animate-ping" />
          <span className="absolute h-16 w-16 rounded-full bg-primary/30 animate-pulse" />
          <span className="relative h-10 w-10 rounded-full bg-primary flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M5 15v-3l2-4h10l2 4v3" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <circle cx="7" cy="18" r="2" />
              <circle cx="17" cy="18" r="2" />
            </svg>
          </span>
        </div>

        <div className="text-center space-y-2">
          <p data-testid="status-text" className="text-xl font-semibold text-text-primary">
            Finding you a driver…
          </p>
          <p className="text-sm text-text-secondary">
            Sit tight — we're notifying nearby drivers
          </p>
        </div>

        {/* Destination + fare card */}
        <div className="w-full max-w-sm bg-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="min-w-0">
              <p data-testid="destination-name" className="text-sm font-medium text-text-primary truncate">
                {destination.mainText}
              </p>
              <p className="text-xs text-text-secondary truncate">{destination.secondaryText}</p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Estimated fare</span>
            <span data-testid="fare-display" className="text-lg font-bold text-text-primary">{fareDisplay}</span>
          </div>
        </div>
      </div>

      {/* ── Cancel button ─────────────────────────────────────────────────────── */}
      <div
        className="px-6 pb-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
      >
        <button
          data-testid="cancel-button"
          onClick={() => { void handleCancel() }}
          disabled={isCancelling}
          className="w-full rounded-2xl py-4 text-base font-semibold text-danger border-2 border-danger/30 bg-danger/5 active:bg-danger/10 transition-colors disabled:opacity-50"
        >
          {isCancelling ? 'Cancelling…' : 'Cancel Ride'}
        </button>
      </div>
    </div>
  )
}
