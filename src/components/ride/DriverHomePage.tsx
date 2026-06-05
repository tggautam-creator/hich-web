import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { DEFAULT_CENTER } from '@/lib/mapConstants'
import BottomNav from '@/components/ui/BottomNav'
import PwaInstallBanner from '@/components/ui/PwaInstallBanner'
import BankOnboardPrompt from '@/components/ride/BankOnboardPrompt'
import SuggestedRidesHero from '@/components/suggestions/SuggestedRidesHero'
import { useSuggestionsTop } from '@/hooks/useSuggestions'
import { onSnoozeChange, dispatchSnoozeChange } from '@/lib/snoozeEvents'
import HowItWorksCarousel from '@/components/home/HowItWorksCarousel'
import { DRIVER_HOW_IT_WORKS } from '@/components/home/howItWorksSlides'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverHomePageProps {
  'data-testid'?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GPS_INTERVAL_MS = 30_000
const CAP_CENTS = 10_000

function formatSnoozeRemaining(until: Date, nowMs: number): string {
  const ms = until.getTime() - nowMs
  if (ms <= 0) return '0s'
  const totalSec = Math.ceil(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  if (hours >= 1) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  if (minutes >= 1) return `${minutes}m`
  return `${totalSec}s`
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Driver home — iOS-parity vertical scroll redesign (2026-06-05).
 *
 * Replaces the previous map-first floating-card layout with the
 * scroll-and-stack pattern from
 * `ios/Tago/Features/DriverHome/DriverHomePage.swift`. The driver's
 * GPS still posts every 30s when online (preserved from the prior
 * layout); the map UI itself is gone — drivers don't need a static
 * driver-self map on home (any active-ride surface has its own map).
 *
 * Scroll sections (top → bottom):
 *   1. Sticky frosted top bar: Online/Snoozed pill + TAGO DRIVER +
 *      notifications bell
 *   2. Greeting: "Hi there, {firstName}!" + "Ready to drive?"
 *   3. Primary hero: "Find riders · Pre-claim rides heading your way"
 *      → /rides/board
 *   4. "Ride board" pill → /rides/board
 *   5. "Get matched with a rider" card with Add routine + Post trip
 *      CTAs
 *   6. "Suggested for you" card (wraps SuggestedRidesHero side=driver)
 *   7. Bank info card (wallet balance + connect-bank state + progress)
 *   8. Preferences card (Waive caregiver fee toggle)
 *   9. "How Instant Carpool works" placeholder card
 *
 * Bottom-docked:
 *   - Status toast
 *   - Active-ride banner (when count > 0)
 *   - Bank slim banner (when atWalletCap)
 *   - Online toggle / Resume snooze button
 *   - Pending-earnings pill (web-only safety surface) — fixed under
 *     toggle so unsettled payouts stay visible
 *   - BottomNav
 *
 * Preserved from the old map-first layout:
 *   - GPS watch + 30s post-to-driver_locations cadence while online
 *   - Snooze countdown + cross-screen snooze event listener
 *   - $100 wallet-cap gate on Go Online when no bank linked
 *   - Stripe-return onboarding completion + profile refresh
 *   - Pending-earnings pill from /api/wallet/pending-earnings
 *   - BankOnboardPrompt post-ride modal
 */
export default function DriverHomePage({ 'data-testid': testId }: DriverHomePageProps) {
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const navigate = useNavigate()

  const hasBank = profile?.stripe_onboarding_complete === true
  const balance = profile?.wallet_balance ?? 0
  const atWalletCap = !hasBank && balance >= CAP_CENTS

  const [isOnline, setIsOnline] = useState(false)
  const [onlineStateLoaded, setOnlineStateLoaded] = useState(false)
  const [snoozedUntil, setSnoozedUntil] = useState<Date | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [resumingSnooze, setResumingSnooze] = useState(false)
  const [activeRideCount, setActiveRideCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [pendingTotalCents, setPendingTotalCents] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [statusToast, setStatusToast] = useState<string | null>(null)
  const [waiveCaregiverFee, setWaiveCaregiverFee] = useState(
    profile?.waive_caregiver_fee === true,
  )
  const [savingWaive, setSavingWaive] = useState(false)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestCoordsRef = useRef<{ lat: number; lng: number }>(DEFAULT_CENTER)
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch active ride count + unread notifications + pending earnings ───
  useEffect(() => {
    async function fetchCounts() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const auth = { Authorization: `Bearer ${session.access_token}` }
        const [ridesResp, notifResp, pendingResp] = await Promise.all([
          fetch('/api/rides/active', { headers: auth }),
          fetch('/api/notifications/unread-count', { headers: auth }),
          fetch('/api/wallet/pending-earnings', { headers: auth }),
        ])
        if (ridesResp.ok) {
          const body = (await ridesResp.json()) as { rides: unknown[] }
          setActiveRideCount(body.rides.length)
        }
        if (notifResp.ok) {
          const body = (await notifResp.json()) as { count: number }
          setUnreadCount(body.count)
        }
        if (pendingResp.ok) {
          const body = (await pendingResp.json()) as { pending: unknown[]; total_cents: number }
          setPendingTotalCents(body.total_cents)
          setPendingCount(body.pending.length)
        }
      } catch {
        // non-fatal
      }
    }
    void fetchCounts()
  }, [])

  // ── Sync preferences toggle when profile arrives / refreshes ─────────
  useEffect(() => {
    setWaiveCaregiverFee(profile?.waive_caregiver_fee === true)
  }, [profile?.waive_caregiver_fee])

  // ── Load persisted online/offline state from driver_locations on mount
  useEffect(() => {
    if (!profile?.id) return
    void supabase
      .from('driver_locations')
      .select('is_online, snoozed_until')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsOnline(data?.is_online === true)
        const raw = (data as { snoozed_until?: string | null } | null)?.snoozed_until
        if (raw) {
          const until = new Date(raw)
          if (until.getTime() > Date.now()) setSnoozedUntil(until)
        }
        setOnlineStateLoaded(true)
      })
  }, [profile?.id])

  // ── Snooze countdown — tick every second while snoozedUntil is set ──
  useEffect(() => {
    if (!snoozedUntil) return
    const id = window.setInterval(() => {
      const now = Date.now()
      setNowTick(now)
      if (snoozedUntil.getTime() <= now) {
        setSnoozedUntil(null)
        window.clearInterval(id)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [snoozedUntil])

  // ── Cross-screen snooze listener ─────────────────────────────────────
  useEffect(() => {
    return onSnoozeChange(({ snoozedUntil: until }) => {
      if (until && until.getTime() > Date.now()) {
        setSnoozedUntil(until)
      } else {
        setSnoozedUntil(null)
      }
    })
  }, [])

  // ── Post GPS to driver_locations ──────────────────────────────────────
  const postLocation = useCallback(async () => {
    if (!profile?.id) return
    const { lat, lng } = latestCoordsRef.current
    await supabase.from('driver_locations').upsert(
      {
        user_id: profile.id,
        location: { type: 'Point', coordinates: [lng, lat] },
        recorded_at: new Date().toISOString(),
        is_online: isOnline,
      },
      { onConflict: 'user_id' },
    )
  }, [profile?.id, isOnline])

  // ── Watch GPS + poll location to server ───────────────────────────────
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        latestCoordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      },
      () => { /* denied */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    )

    if (isOnline) {
      void postLocation()
      gpsIntervalRef.current = setInterval(() => {
        void postLocation()
      }, GPS_INTERVAL_MS)
    }

    return () => {
      navigator.geolocation.clearWatch(watchId)
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
    }
  }, [isOnline, postLocation])

  function showToast(message: string) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setStatusToast(message)
    toastTimeoutRef.current = setTimeout(() => setStatusToast(null), 3000)
  }

  // ── Stripe-return handler ─────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('stripe_return') !== '1') return
    async function completeOnboarding() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        await fetch('/api/connect/onboard/complete', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        await refreshProfile()
      } catch {
        // non-fatal
      }
    }
    void completeOnboarding()
    searchParams.delete('stripe_return')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams, refreshProfile])

  async function handleResumeSnooze() {
    if (resumingSnooze) return
    setResumingSnooze(true)
    const previous = snoozedUntil
    setSnoozedUntil(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setSnoozedUntil(previous)
        showToast('Sign in to resume.')
        return
      }
      const resp = await fetch('/api/rides/snooze', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!resp.ok) {
        setSnoozedUntil(previous)
        dispatchSnoozeChange(previous)
        showToast("Couldn't resume — try again.")
        return
      }
      dispatchSnoozeChange(null)
      showToast('Resumed — ride requests will appear here')
    } catch {
      setSnoozedUntil(previous)
      showToast('Network error — try again.')
    } finally {
      setResumingSnooze(false)
    }
  }

  async function handleToggleOnline() {
    if (atWalletCap && !isOnline) {
      showToast('Add a bank to keep earning — you\'ve hit the $100 limit')
      return
    }

    const next = !isOnline
    setIsOnline(next)

    showToast(
      next
        ? 'You are now online — ride requests will appear here'
        : 'You are now offline — you won\'t receive ride requests',
    )

    if (profile?.id) {
      const { lat, lng } = latestCoordsRef.current
      await supabase.from('driver_locations').upsert(
        {
          user_id: profile.id,
          is_online: next,
          location: { type: 'Point', coordinates: [lng, lat] },
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
    }
  }

  async function handleToggleWaiveCaregiver(next: boolean) {
    if (!profile?.id || savingWaive) return
    setSavingWaive(true)
    const previous = waiveCaregiverFee
    setWaiveCaregiverFee(next)
    try {
      const { error } = await supabase
        .from('users')
        .update({ waive_caregiver_fee: next })
        .eq('id', profile.id)
      if (error) {
        setWaiveCaregiverFee(previous)
        showToast("Couldn't update preferences — try again.")
        return
      }
      await refreshProfile()
    } catch {
      setWaiveCaregiverFee(previous)
      showToast('Network error — try again.')
    } finally {
      setSavingWaive(false)
    }
  }

  const greetingText = (() => {
    const full = profile?.full_name?.trim() ?? ''
    const first = full.split(/\s+/)[0] ?? ''
    return first ? `Hi there, ${first}!` : 'Hi there!'
  })()

  return (
    <div
      data-testid={testId ?? 'driver-home-page'}
      className="relative min-h-dvh w-full font-sans bg-surface"
    >
      {/* ── PWA install banner ──────────────────────────────────────────── */}
      <PwaInstallBanner />

      {/* ── Sticky frosted top bar ──────────────────────────────────────── */}
      <div
        data-testid="top-bar"
        className="sticky top-0 z-[40] bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        {snoozedUntil ? (
          <div
            data-testid="snoozed-indicator"
            className="flex items-center gap-2 rounded-full bg-warning/15 px-3 py-1.5 text-xs font-bold text-warning"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
              <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
            </svg>
            Snoozed · {formatSnoozeRemaining(snoozedUntil, nowTick)}
          </div>
        ) : (
          <div
            data-testid="online-indicator"
            className={[
              'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
              isOnline ? 'bg-success/10 text-success' : 'bg-border/50 text-text-secondary',
            ].join(' ')}
          >
            <span
              className={[
                'h-2 w-2 rounded-full',
                isOnline ? 'bg-success animate-pulse' : 'bg-text-secondary',
              ].join(' ')}
            />
            {isOnline ? 'Online' : 'Offline'}
          </div>
        )}

        <span className="font-bold text-sm text-text-primary tracking-wider select-none">
          TAGO DRIVER
        </span>

        <button
          data-testid="notifications-bell"
          onClick={() => navigate('/notifications')}
          aria-label="Notifications"
          className="relative p-1 text-text-primary active:opacity-60 transition-opacity"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Status toast ────────────────────────────────────────────────── */}
      {statusToast && (
        <div
          data-testid="status-toast"
          className={[
            'fixed left-4 right-4 z-[1100] rounded-2xl px-4 py-3 shadow-lg text-sm font-medium text-center transition-all animate-slide-down',
            isOnline ? 'bg-success text-white' : 'bg-text-primary text-white',
          ].join(' ')}
          style={{ top: 'calc(max(env(safe-area-inset-top), 0.75rem) + 4rem)' }}
        >
          {statusToast}
        </div>
      )}

      {/* ── Scroll content ────────────────────────────────────────────────
          Top brand-hue backdrop matches Profile + Wallet + RiderHome.
          Driver gets the success/green tint so the chrome reads
          driver-mode at a glance without changing the gradient shape. */}
      <div
        className="px-4 pt-8 pb-48 flex flex-col gap-5"
        style={{
          background: 'linear-gradient(180deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.04) 35%, transparent 60%)',
        }}
      >
        {/* Greeting */}
        <div className="flex flex-col items-center gap-1 mt-6 mb-2">
          <h1
            data-testid="driver-home-greeting"
            className="text-3xl font-bold text-text-primary text-center"
          >
            {greetingText}
          </h1>
          <p className="text-sm text-text-secondary text-center">Ready to drive?</p>
        </div>

        {/* Primary hero — "Find riders" */}
        <button
          type="button"
          data-testid="driver-home-find-riders-hero"
          onClick={() => navigate('/rides/board', { state: { fromTab: 'drive' } })}
          className="w-full flex items-center gap-3 rounded-3xl bg-white border border-border/60 px-5 py-5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.99] transition-transform text-left"
        >
          <span className="h-11 w-11 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-success" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22a8 8 0 0 1 16 0" />
              <path d="M19 5l-1.5 1.5" />
              <path d="M21 7h-2" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-text-primary">Find riders</p>
            <p className="text-xs text-text-secondary mt-0.5">Pre-claim rides heading your way</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary/50 shrink-0" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>

        {/* "Ride board" pill — routes straight to the list view to
            mirror iOS rideBoardListPill onBrowseRideBoardList. The
            hero above stays on the smart-search /rides/board (iOS
            onOpenRideBoard). */}
        <button
          type="button"
          data-testid="driver-home-ride-board-pill"
          onClick={() => navigate('/rides/board/browse', { state: { fromTab: 'drive' } })}
          className="w-full flex items-center gap-3 rounded-2xl bg-white border border-border/60 px-4 py-3 shadow-sm active:scale-[0.99] transition-transform text-left"
        >
          <span className="h-9 w-9 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-success" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary">Ride board</p>
            <p className="text-[11px] text-text-secondary">See every rider request</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary/50 shrink-0" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Get matched — post a trip + add routine entry points */}
        <div className="rounded-2xl bg-white border border-success/15 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary">Get matched with a rider</h2>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Post a trip or add a routine so we can match you with riders heading the same way.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="driver-home-add-routine"
              onClick={() => navigate('/schedule', { state: { tripType: 'routine' } })}
              className="rounded-xl bg-success text-white px-3 py-2.5 text-xs font-semibold active:opacity-90"
            >
              + Add routine
            </button>
            <button
              type="button"
              data-testid="driver-home-post-trip"
              onClick={() => navigate('/schedule')}
              className="rounded-xl bg-success/10 text-success px-3 py-2.5 text-xs font-semibold active:bg-success/20"
            >
              + Post a ride
            </button>
          </div>
        </div>

        {/* Suggested for you card — driver side */}
        <DriverSuggestedForYouCard />

        {/* Bank info card */}
        <BankInfoCard
          balanceCents={balance}
          hasBank={hasBank}
          atWalletCap={atWalletCap}
          onConnect={() => navigate('/stripe/payouts')}
        />

        {/* Preferences card */}
        <div
          data-testid="driver-home-preferences-card"
          className="rounded-2xl bg-white border border-success/15 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary">Preferences</h2>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">Waive caregiver fee</p>
              <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">
                Don&rsquo;t charge the extra caregiver fare on accessibility rides.
              </p>
            </div>
            <span className="relative inline-flex shrink-0 mt-1">
              <input
                type="checkbox"
                data-testid="driver-home-waive-caregiver-toggle"
                checked={waiveCaregiverFee}
                disabled={savingWaive}
                onChange={(e) => { void handleToggleWaiveCaregiver(e.target.checked) }}
                className="sr-only peer"
              />
              <span
                aria-hidden="true"
                className="h-6 w-10 rounded-full bg-border transition-colors peer-checked:bg-success peer-disabled:opacity-60"
              />
              <span
                aria-hidden="true"
                className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
              />
            </span>
          </label>
        </div>

        {/* How Instant Carpool works — driver-side carousel mirrors
            ios/Tago/Features/DriverHome/DriverHomePage+Sections.swift
            driverHowItWorksCard. Replaces the prior static 3-step
            <ol> placeholder. */}
        <div className="rounded-2xl bg-white border border-success/15 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary flex-1">How Instant Carpool works</h2>
            <span className="text-[10px] font-semibold text-text-secondary">Swipe</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-text-secondary" aria-hidden="true">
              <path d="M21.71 11.29l-9-9a.996.996 0 0 0-1.41 0l-9 9a.996.996 0 1 0 1.41 1.41L4 11.41V20a1 1 0 0 0 1 1h6v-7h2v7h6a1 1 0 0 0 1-1v-8.59l.29.29a1 1 0 0 0 1.42-1.41z" />
            </svg>
          </div>
          <HowItWorksCarousel slides={DRIVER_HOW_IT_WORKS} tint="success" data-testid="driver-how-it-works" />
        </div>
      </div>

      {/* ── Bottom-docked action stack ──────────────────────────────────── */}
      <div
        className="fixed left-0 right-0 z-[30] px-4 flex flex-col gap-2"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
      >
        {activeRideCount > 0 && (
          <button
            type="button"
            data-testid="active-ride-banner"
            onClick={() => navigate('/rides')}
            className="w-full rounded-2xl bg-success px-4 py-3 shadow-lg flex items-center gap-3 active:opacity-90 transition-opacity"
          >
            <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">{activeRideCount}</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-white">
                {activeRideCount === 1 ? 'You have an active ride' : `You have ${activeRideCount} active rides`}
              </p>
              <p className="text-xs text-white/70">Tap to view</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-white/70 shrink-0" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Bank slim banner — only at the $100 cap (urgent state) */}
        {!hasBank && atWalletCap && (
          <div
            data-testid="bank-setup-banner"
            className="w-full rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 bg-warning/10 border border-warning/30"
          >
            <div className="h-8 w-8 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning" aria-hidden="true">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-text-primary">
                Add a bank to keep earning
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                You&rsquo;ve hit the $100 cap. Link a bank to go back online.
              </p>
            </div>
            <button
              data-testid="setup-bank-button"
              onClick={() => navigate('/stripe/payouts')}
              className="rounded-xl bg-warning text-white px-3 py-2 text-xs font-semibold active:opacity-90"
            >
              Link
            </button>
          </div>
        )}

        {/* Online toggle (or Resume button while snoozed) */}
        {snoozedUntil ? (
          <button
            type="button"
            data-testid="resume-snooze-button"
            onClick={() => { void handleResumeSnooze() }}
            disabled={resumingSnooze}
            className="w-full rounded-2xl bg-warning/15 border-2 border-warning px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all disabled:opacity-60"
          >
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-warning" />
            </span>
            <span className="flex-1 text-sm font-bold text-left text-warning">
              {resumingSnooze
                ? 'Resuming…'
                : `Paused — Resume now (${formatSnoozeRemaining(snoozedUntil, nowTick)} left)`}
            </span>
            <span className="text-xs font-bold text-warning">
              {resumingSnooze ? '…' : 'Resume'}
            </span>
          </button>
        ) : (
          <button
            type="button"
            data-testid="online-toggle"
            onClick={() => { void handleToggleOnline() }}
            disabled={!onlineStateLoaded || (atWalletCap && !isOnline)}
            className={[
              'w-full rounded-2xl shadow-lg px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-all',
              !onlineStateLoaded || (atWalletCap && !isOnline) ? 'opacity-60' : '',
              isOnline ? 'bg-white border-2 border-success' : 'bg-white border border-border',
            ].join(' ')}
          >
            <span className="relative flex h-3 w-3 shrink-0">
              {isOnline && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />}
              <span className={['relative inline-flex h-3 w-3 rounded-full', isOnline ? 'bg-success' : 'bg-text-secondary'].join(' ')} />
            </span>
            <span className={['flex-1 text-sm font-semibold text-left', isOnline ? 'text-success' : 'text-text-secondary'].join(' ')}>
              {isOnline
                ? 'Online — receiving rides'
                : atWalletCap
                  ? 'Link a bank to go online'
                  : 'Offline — tap to go online'}
            </span>
            <div className={['relative h-6 w-10 rounded-full shrink-0 transition-colors', isOnline ? 'bg-success' : 'bg-border'].join(' ')}>
              <div className={['absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', isOnline ? 'translate-x-4' : 'translate-x-0.5'].join(' ')} />
            </div>
          </button>
        )}

        {/* Pending earnings pill — web-only safety surface */}
        {pendingTotalCents >= 100 && (
          <button
            type="button"
            data-testid="pending-earnings-pill"
            onClick={() => navigate('/wallet')}
            aria-label={`View ${pendingCount} pending payment${pendingCount === 1 ? '' : 's'}, total $${(pendingTotalCents / 100).toFixed(2)}`}
            className="w-full bg-warning/10 border border-warning/25 rounded-2xl px-4 py-2.5 flex items-center gap-3 active:scale-[0.99] transition-transform"
          >
            <div className="h-7 w-7 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-warning" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="text-xs font-semibold text-text-primary">
                ${(pendingTotalCents / 100).toFixed(2)} pending
              </p>
              <p className="text-[10px] text-text-secondary">
                {pendingCount} ride{pendingCount === 1 ? '' : 's'} awaiting rider payment
              </p>
            </div>
          </button>
        )}
      </div>

      <BottomNav activeTab="drive" />

      {/* ── F4: post-ride bank-onboard prompt ──────────────────────────── */}
      <BankOnboardPrompt walletBalanceCents={balance} hasBank={hasBank} />
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

/**
 * Wraps SuggestedRidesHero(side='driver') in a labeled card matching
 * iOS `driverSuggestedRidesCard` (DriverHomePage+Sections.swift:143).
 * Always present so drivers learn the feature even before they have
 * matches — same pattern as the rider home card.
 */
function DriverSuggestedForYouCard() {
  const { data, isLoading } = useSuggestionsTop('driver')
  const suggestions = data ?? []
  return (
    <div className="rounded-2xl bg-white border border-success/15 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-success" aria-hidden="true">
          <path d="M12 2l2.4 6.6L21 9l-5.4 3.9L17.4 19 12 15.6 6.6 19l1.8-6.1L3 9l6.6-.4z" />
        </svg>
        <h2 className="text-sm font-bold text-text-primary">Suggested for you</h2>
      </div>
      {isLoading ? (
        <p className="text-xs text-text-secondary py-2">Looking for matches&hellip;</p>
      ) : suggestions.length === 0 ? (
        <p data-testid="driver-suggested-empty-state" className="text-xs text-text-secondary py-2 leading-relaxed">
          No matches yet. Add a routine or post a trip and we&rsquo;ll find riders heading the same way.
        </p>
      ) : (
        <SuggestedRidesHero side="driver" hideWhenEmpty={false} />
      )}
    </div>
  )
}

/**
 * Combined wallet balance + bank-status card. Always renders so the
 * driver always knows their payout state at a glance. Mirrors iOS
 * `bankInfoCard` (DriverHomePage+Sections.swift:62).
 */
function BankInfoCard({
  balanceCents,
  hasBank,
  atWalletCap,
  onConnect,
}: {
  balanceCents: number
  hasBank: boolean
  atWalletCap: boolean
  onConnect: () => void
}) {
  const balanceLabel = `$${(balanceCents / 100).toFixed(2)}`
  const progress = Math.min(1, balanceCents / CAP_CENTS)
  const subtitle = hasBank
    ? 'Earnings settle to your linked bank on the standard payout schedule.'
    : atWalletCap
      ? "You've hit the $100 cap — connect a bank to keep earning."
      : 'Earnings sit in your Tago wallet until you connect a bank for payouts.'

  return (
    <div
      data-testid="driver-home-bank-info-card"
      className="rounded-2xl bg-white border border-success/15 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
            {hasBank ? 'Wallet balance' : 'Earnings waiting'}
          </p>
          <p className="text-3xl font-bold text-text-primary mt-1">{balanceLabel}</p>
        </div>
        <div
          className={[
            'h-10 w-10 rounded-full flex items-center justify-center shrink-0',
            hasBank ? 'bg-success/10' : 'bg-warning/10',
          ].join(' ')}
        >
          {hasBank ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-success" aria-hidden="true">
              <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-warning" aria-hidden="true">
              <rect x="2" y="6" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
              <path d="M6 14h.01" />
            </svg>
          )}
        </div>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{subtitle}</p>
      {!hasBank && (
        <>
          <div className="h-2 w-full rounded-full bg-success/15 overflow-hidden">
            <div
              data-testid="driver-home-bank-progress"
              className={['h-full rounded-full transition-all', atWalletCap ? 'bg-warning' : 'bg-success'].join(' ')}
              style={{ width: `${Math.max(2, progress * 100)}%` }}
            />
          </div>
          <button
            type="button"
            data-testid="driver-home-bank-connect"
            onClick={onConnect}
            className="w-full rounded-xl bg-success py-2.5 text-sm font-semibold text-white active:opacity-90 transition-opacity"
          >
            Connect bank
          </button>
        </>
      )}
    </div>
  )
}
