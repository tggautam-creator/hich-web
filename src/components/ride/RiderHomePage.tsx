import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import { reverseGeocode } from '@/lib/geocode'
import { useAuthStore } from '@/stores/authStore'
import BottomNav from '@/components/ui/BottomNav'
import SpotlightOverlay from '@/components/onboarding/SpotlightOverlay'
import { useOnboardingStore } from '@/stores/onboardingStore'
import PwaInstallBanner from '@/components/ui/PwaInstallBanner'
import SuggestedRidesHero from '@/components/suggestions/SuggestedRidesHero'
import { useSuggestionsTop } from '@/hooks/useSuggestions'
import HowItWorksCarousel from '@/components/home/HowItWorksCarousel'
import { RIDER_HOW_IT_WORKS } from '@/components/home/howItWorksSlides'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RiderHomePageProps {
  'data-testid'?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Rider home — iOS-parity vertical scroll redesign (2026-06-05).
 *
 * Replaces the previous map-first floating-card layout with the
 * scroll-and-stack pattern from
 * `ios/Tago/Features/RiderHome/RiderHomePage.swift`. The map UI moved
 * inside `DestinationSearchPage` / `MapPickerPage`; home is now a
 * static information surface (greeting + hero + pills + suggestions +
 * how-it-works), so users land on something readable instead of a
 * full-screen map they don't need until they're actively searching.
 *
 * Sections (top → bottom):
 *   1. PWA install banner (web-only) + slim TAGO wordmark + floating
 *      bell (top-right)
 *   2. Greeting: "Hi there, {firstName}!" + "Where would you like to go?"
 *   3. Primary hero: "Find your ride" capsule → /rides/board
 *   4. Secondary pills: "Instant carpool" + "Ride board"
 *   5. "Suggested for you" card (wraps SuggestedRidesHero)
 *   6. "Get matched with a driver" card with routine + post CTAs
 *   7. "How Instant Carpool works" placeholder card
 *
 * Bottom-docked:
 *   - Active-ride banner (when there's a ride in flight)
 *   - BottomNav
 *
 * Functionality preserved from the old map-first layout:
 *   - Geolocation watch for reverse-geocoded `locationName`
 *   - Active rides count + unread notifications
 *   - Realtime-availability advisory modal (web-only — fires from
 *     the Instant Carpool pill, surfaced when driver supply is low)
 *   - Spotlight onboarding overlay
 */
export default function RiderHomePage({ 'data-testid': testId }: RiderHomePageProps) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const hasSeenWalkthrough = useOnboardingStore((s) => s.hasSeenWalkthrough)

  const [locationName, setLocationName] = useState('Current Location')
  const [activeRideCount, setActiveRideCount] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [showRealtimeNotice, setShowRealtimeNotice] = useState(false)
  const gpsFixedRef = useRef(false)
  const gpsLocationRef = useRef<{ lat: number; lng: number } | null>(null)

  // Fetch active ride count + unread notifications
  useEffect(() => {
    async function fetchCounts() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const [ridesResp, notifResp] = await Promise.all([
          fetch('/api/rides/active', { headers: { Authorization: `Bearer ${session.access_token}` } }),
          fetch('/api/notifications/unread-count', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        ])
        if (ridesResp.ok) {
          const body = (await ridesResp.json()) as { rides: unknown[] }
          setActiveRideCount(body.rides.length)
        }
        if (notifResp.ok) {
          const body = (await notifResp.json()) as { count: number }
          setUnreadCount(body.count)
        }
      } catch {
        // non-fatal
      }
    }
    void fetchCounts()
  }, [])

  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        gpsLocationRef.current = { lat, lng }
        // Reverse-geocode only on the first GPS fix
        if (!gpsFixedRef.current) {
          gpsFixedRef.current = true
          void reverseGeocode(lat, lng).then(setLocationName)
        }
      },
      () => { /* geolocation denied or unavailable */ },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    )
    return () => { navigator.geolocation.clearWatch(watchId) }
  }, [])

  const continueToInstantMatch = useCallback(() => {
    setShowRealtimeNotice(false)
    const coord = gpsLocationRef.current
    navigate('/ride/search', {
      state: coord
        ? { locationName, originLat: coord.lat, originLng: coord.lng }
        : { locationName },
    })
  }, [navigate, locationName])

  const greetingText = (() => {
    const full = profile?.full_name?.trim() ?? ''
    const first = full.split(/\s+/)[0] ?? ''
    return first ? `Hi there, ${first}!` : 'Hi there!'
  })()

  return (
    <div
      data-testid={testId ?? 'rider-home-page'}
      className="relative min-h-dvh w-full font-sans bg-surface"
    >
      {/* ── PWA install banner ──────────────────────────────────────────── */}
      <PwaInstallBanner />

      {/* ── Slim frosted top bar — wordmark + notifications ────────────────── */}
      <div
        data-testid="top-bar"
        className="sticky top-0 z-[40] bg-white/90 backdrop-blur-sm border-b border-border flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 0.75rem) + 0.25rem)', paddingBottom: '0.75rem' }}
      >
        <span className="font-bold text-lg text-primary tracking-widest select-none">
          TAGO
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

      {/* ── Scroll content ────────────────────────────────────────────────
          Top brand-hue backdrop bleeds from under the greeting down to
          ~40% of the scroll, mirroring the soft gradient that lives on
          Profile + Wallet so all four primary tabs share the same
          chrome rhythm. */}
      <div
        className="px-4 pt-8 pb-32 flex flex-col gap-5"
        style={{
          background: 'linear-gradient(180deg, rgba(58,90,228,0.12) 0%, rgba(58,90,228,0.04) 35%, transparent 60%)',
        }}
      >
        {/* Greeting block */}
        <div className="flex flex-col items-center gap-1 mt-6 mb-2">
          <h1
            data-testid="rider-home-greeting"
            className="text-3xl font-bold text-text-primary text-center"
          >
            {greetingText}
          </h1>
          <p className="text-sm text-text-secondary text-center">
            Where would you like to go?
          </p>
        </div>

        {/* Primary hero — "Find your ride" */}
        <button
          type="button"
          data-testid="rider-home-find-ride-hero"
          onClick={() => navigate('/rides/board', { state: { fromTab: 'home' } })}
          className="w-full flex items-center gap-3 rounded-3xl bg-white border border-border/60 px-5 py-5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.99] transition-transform text-left"
        >
          <span className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-primary" aria-hidden="true">
              <path d="M3 11l18-8-8 18-2-8-8-2z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-text-primary">Find your ride</p>
            <p className="text-xs text-text-secondary mt-0.5">Pick from rides heading your way</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-text-secondary/50 shrink-0" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>

        {/* Secondary pills row — Instant carpool + Ride board */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            data-testid="rider-home-instant-carpool-pill"
            onClick={() => setShowRealtimeNotice(true)}
            className="flex flex-col items-start gap-1.5 rounded-2xl bg-white border border-border/60 px-4 py-3.5 shadow-sm active:scale-[0.98] transition-transform text-left"
          >
            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <p className="text-sm font-bold text-text-primary">Instant carpool</p>
            <p className="text-[11px] text-text-secondary">Need one right now?</p>
          </button>

          <button
            type="button"
            data-testid="rider-home-ride-board-pill"
            onClick={() => navigate('/rides/board/browse', { state: { fromTab: 'home' } })}
            className="flex flex-col items-start gap-1.5 rounded-2xl bg-white border border-border/60 px-4 py-3.5 shadow-sm active:scale-[0.98] transition-transform text-left"
          >
            <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <p className="text-sm font-bold text-text-primary">Ride board</p>
            <p className="text-[11px] text-text-secondary">See every posted ride</p>
          </button>
        </div>

        {/* Suggested for you card — wraps the shared SuggestedRidesHero */}
        <SuggestedForYouCard />

        {/* Get matched — post a trip + add routine entry points */}
        <div className="rounded-2xl bg-white border border-primary/10 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary">Get matched with a driver</h2>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            Post a trip or add a routine so we can match you with drivers heading the same way.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="rider-home-add-routine"
              onClick={() => navigate('/schedule/rider', { state: { tripType: 'routine' } })}
              className="rounded-xl bg-primary text-white px-3 py-2.5 text-xs font-semibold active:opacity-90"
            >
              + Add routine
            </button>
            <button
              type="button"
              data-testid="rider-home-post-trip"
              onClick={() => navigate('/schedule/rider')}
              className="rounded-xl bg-primary/10 text-primary px-3 py-2.5 text-xs font-semibold active:bg-primary/20"
            >
              + Post a trip
            </button>
          </div>
        </div>

        {/* How Instant Carpool works — swipeable 7-slide carousel
            mirroring ios/Tago/Features/RiderHome/HowItWorksCarousel.
            Replaces the prior static 3-step <ol> placeholder so web
            matches iOS's swipeable cold-start explainer. */}
        <div className="rounded-2xl bg-white border border-primary/10 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
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
          <HowItWorksCarousel slides={RIDER_HOW_IT_WORKS} tint="primary" data-testid="rider-how-it-works" />
        </div>
      </div>

      {/* ── Bottom: docked active-ride banner + nav ──────────────────────── */}
      {activeRideCount > 0 && (
        <div
          className="fixed left-0 right-0 z-[30] px-4"
          style={{ bottom: 'calc(max(env(safe-area-inset-bottom), 0px) + 4.5rem)' }}
        >
          <button
            type="button"
            data-testid="active-ride-banner"
            onClick={() => navigate('/rides')}
            className="w-full rounded-2xl bg-primary px-4 py-3 shadow-lg flex items-center gap-3 active:opacity-90 transition-opacity"
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
        </div>
      )}

      <BottomNav activeTab="home" />

      {/* ── Realtime availability advisory overlay ─────────────────────────── */}
      {showRealtimeNotice && (
        <div
          className="fixed inset-0 z-[1200] bg-background/55 backdrop-blur-[2px] p-4 flex items-center justify-center"
          onClick={() => setShowRealtimeNotice(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-white/80 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-warning via-primary to-success" />
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-warning">Instant Match Update</p>
                  <h2 className="mt-1 text-2xl leading-tight font-extrabold text-text-primary">Fewer Drivers Online Right Now</h2>
                </div>
                <button
                  type="button"
                  data-testid="realtime-notice-close"
                  onClick={() => setShowRealtimeNotice(false)}
                  aria-label="Close availability notice"
                  className="h-9 w-9 rounded-full bg-surface text-text-secondary hover:text-text-primary text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <p className="text-base leading-8 text-text-secondary">
                Instant Match is the feature that finds a nearby student driver right away, similar to Uber or Lyft.
              </p>

              <p className="text-base leading-8 text-text-secondary">
                Right now, campus driver supply is low, so opening this fully could mean long waits and a poor experience. We are actively onboarding more student drivers and expanding coverage.
              </p>

              <p className="text-sm font-medium text-text-primary">
                Best options today:
              </p>

              <div className="grid grid-cols-1 gap-2">
                <button
                  data-testid="realtime-notice-post-ride"
                  onClick={() => { setShowRealtimeNotice(false); navigate('/schedule/rider') }}
                  className="w-full rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold text-left"
                >
                  Schedule a Ride Request
                </button>

                <button
                  data-testid="realtime-notice-add-routine"
                  onClick={() => { setShowRealtimeNotice(false); navigate('/schedule/rider', { state: { tripType: 'routine' } }) }}
                  className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-text-primary text-left"
                >
                  Save a Recurring Ride
                </button>

                <button
                  data-testid="realtime-notice-ride-board"
                  onClick={() => { setShowRealtimeNotice(false); navigate('/rides/board/browse', { state: { fromTab: 'home' } }) }}
                  className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-text-primary text-left"
                >
                  Browse Ride Board
                </button>
              </div>

              <button
                data-testid="realtime-notice-continue-search"
                onClick={continueToInstantMatch}
                className="w-full rounded-xl bg-warning/10 text-warning px-4 py-2.5 text-sm font-semibold"
              >
                Try Instant Match Anyway
              </button>

              <p className="text-xs text-text-secondary text-center">
                Thanks for helping us build a better ride network for students.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Spotlight walkthrough for new users ──────────────────────────── */}
      {!hasSeenWalkthrough && <SpotlightOverlay />}
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

/**
 * Wraps SuggestedRidesHero in a labeled card matching iOS
 * `suggestedRidesCard` (RiderHomePage+Sections.swift:105). The card
 * is always present (with empty-state copy when there are no
 * matches) so users learn the feature exists even before they have
 * matches — iOS uses the same `.embedded` presentation pattern.
 */
function SuggestedForYouCard() {
  const { data, isLoading } = useSuggestionsTop('rider')
  const suggestions = data ?? []
  return (
    <div className="rounded-2xl bg-white border border-primary/10 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-primary" aria-hidden="true">
          <path d="M12 2l2.4 6.6L21 9l-5.4 3.9L17.4 19 12 15.6 6.6 19l1.8-6.1L3 9l6.6-.4z" />
        </svg>
        <h2 className="text-sm font-bold text-text-primary">Suggested for you</h2>
      </div>
      {isLoading ? (
        <p className="text-xs text-text-secondary py-2">Looking for matches&hellip;</p>
      ) : suggestions.length === 0 ? (
        <p data-testid="suggested-empty-state" className="text-xs text-text-secondary py-2 leading-relaxed">
          No matches yet. Post a trip or add a routine and we&rsquo;ll find drivers heading the same way.
        </p>
      ) : (
        <SuggestedRidesHero side="rider" hideWhenEmpty={false} />
      )}
    </div>
  )
}
